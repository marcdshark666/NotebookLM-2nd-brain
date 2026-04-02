"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

loadLocalEnv();

const PORT = clampInteger(Number(process.env.PORT || 3180), 1, 65535);
const COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "nb_bridge_sid";
const IDENTITY_COOKIE_NAME = process.env.IDENTITY_COOKIE_NAME || "nb_bridge_identity";
const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || "").trim();
const GOOGLE_CLIENT_SECRET = String(process.env.GOOGLE_CLIENT_SECRET || "").trim();
const COOKIE_SIGNING_SECRET = String(process.env.COOKIE_SIGNING_SECRET || process.env.TOKEN_STORE_SECRET || GOOGLE_CLIENT_SECRET || "").trim();
const TOKEN_STORE_SECRET = String(process.env.TOKEN_STORE_SECRET || "").trim();
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || "").trim();
const OPENAI_BASE_URL = String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const OPENAI_MODEL = String(process.env.OPENAI_MODEL || "").trim();
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const TOKEN_STORE_PATH = path.join(DATA_DIR, "token-store.enc");
const GOOGLE_SCOPES = ["openid", "email", "profile", "https://www.googleapis.com/auth/drive.readonly"];
const SUPPORTED_TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/manifest+json",
  "application/xml",
  "application/xhtml+xml",
  "application/x-ndjson",
  "application/x-javascript",
  "image/svg+xml",
  "text/cache-manifest",
  "text/calendar",
  "text/css",
  "text/csv",
  "text/html",
  "text/javascript",
  "text/markdown",
  "text/plain",
  "text/tab-separated-values",
  "text/xml",
]);
const GOOGLE_EXPORT_TYPES = new Map([
  ["application/vnd.google-apps.document", "text/plain"],
  ["application/vnd.google-apps.presentation", "text/plain"],
  ["application/vnd.google-apps.spreadsheet", "text/csv"],
]);
const MIME_LABELS = new Map([
  ["application/vnd.google-apps.document", "Google Doc"],
  ["application/vnd.google-apps.presentation", "Google Slides"],
  ["application/vnd.google-apps.spreadsheet", "Google Sheets"],
  ["application/pdf", "PDF"],
  ["text/plain", "Text"],
  ["text/markdown", "Markdown"],
  ["text/csv", "CSV"],
  ["application/json", "JSON"],
]);
const STATIC_MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "i", "if", "in", "into", "is", "it",
  "of", "on", "or", "that", "the", "this", "to", "with", "är", "att", "av", "bara", "bli", "de", "dem", "den",
  "det", "dig", "din", "ditt", "där", "eller", "en", "ett", "finns", "från", "för", "ha", "har", "hur", "inte",
  "jag", "kan", "man", "med", "mig", "min", "mina", "ni", "nu", "och", "om", "på", "så", "ska", "som", "till",
  "under", "upp", "vad", "var", "vi", "vill", "vore", "vår", "våra", "även",
]);

const sessions = new Map();
const pendingStates = new Map();
let tokenStore = loadTokenStore();

ensureDirectory(DATA_DIR);

const server = http.createServer(async (req, res) => {
  try {
    await routeRequest(req, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, {
      error: "Internal server error",
      detail: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

server.listen(PORT, () => {
  console.log(`NotebookBridge running on ${process.env.APP_BASE_URL || `http://localhost:${PORT}`}`);
});

async function routeRequest(req, res) {
  cleanupPendingStates();

  const requestUrl = new URL(req.url, getAppBaseUrl(req));
  const pathname = decodeURIComponent(requestUrl.pathname);
  const session = getOrRestoreSession(req, res);

  if (req.method === "GET" && pathname === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      service: "notebook-bridge",
      hasGoogleCredentials: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
      hasPersistentAuth: Boolean(TOKEN_STORE_SECRET && COOKIE_SIGNING_SECRET),
      llmConfigured: Boolean(OPENAI_API_KEY && OPENAI_MODEL),
    });
  }

  if (req.method === "GET" && pathname === "/api/auth/status") {
    return sendJson(res, 200, {
      connected: Boolean(session && session.tokens),
      hasGoogleCredentials: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
      hasPersistentAuth: Boolean(TOKEN_STORE_SECRET && COOKIE_SIGNING_SECRET),
      llmConfigured: Boolean(OPENAI_API_KEY && OPENAI_MODEL),
      profile: session?.profile || null,
      sourceSummary: session?.sourceSummary || null,
    });
  }

  if (req.method === "GET" && pathname === "/auth/google/start") return startGoogleAuth(req, res, session);
  if (req.method === "GET" && pathname === "/auth/google/callback") return finishGoogleAuth(req, res, requestUrl);
  if (req.method === "POST" && pathname === "/api/auth/logout") return logoutSession(req, res, session);
  if (req.method === "POST" && pathname === "/api/auth/disconnect") return disconnectStoredAuth(req, res, session);

  if (req.method === "GET" && pathname === "/api/sources") {
    if (!session || !session.tokens) {
      return sendJson(res, 401, { error: "Google is not connected for this browser session." });
    }

    const limit = clampInteger(Number(requestUrl.searchParams.get("limit") || 24), 1, 60);
    const query = String(requestUrl.searchParams.get("query") || "");
    const files = await searchDriveFiles(session, query, limit);
    session.sourceSummary = { loadedAt: new Date().toISOString(), count: files.length, query };
    return sendJson(res, 200, { files: files.map(serializeFile) });
  }

  if (req.method === "POST" && pathname === "/api/ask") {
    if (!session || !session.tokens) {
      return sendJson(res, 401, { error: "Connect Google before asking across your sources." });
    }

    const body = await readJsonBody(req);
    const question = String(body?.question || "").trim();
    if (question.length < 4) {
      return sendJson(res, 400, { error: "Please enter a longer question." });
    }

    const answer = await answerQuestionAcrossSources(session, question);
    session.lastQuestionAt = new Date().toISOString();
    return sendJson(res, 200, answer);
  }

  if (req.method === "GET" && pathname === "/") return serveFile(res, path.join(PUBLIC_DIR, "index.html"));
  if (req.method === "GET") {
    const staticServed = await tryServeStatic(pathname, res);
    if (staticServed) return;
    return serveFile(res, path.join(PUBLIC_DIR, "index.html"));
  }

  sendJson(res, 404, { error: "Not found" });
}

async function startGoogleAuth(req, res, existingSession) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return redirect(res, "/?error=missing_google_credentials");
  }

  const session = existingSession || createSession();
  sessions.set(session.id, session);
  setSessionCookies(req, res, session);

  const state = crypto.randomUUID();
  pendingStates.set(state, { sid: session.id, createdAt: Date.now() });

  const redirectUri = new URL("/auth/google/callback", getAppBaseUrl(req)).toString();
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  });

  redirect(res, `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}

async function finishGoogleAuth(req, res, requestUrl) {
  const code = String(requestUrl.searchParams.get("code") || "");
  const state = String(requestUrl.searchParams.get("state") || "");
  const oauthError = String(requestUrl.searchParams.get("error") || "");
  const pending = pendingStates.get(state);

  if (!pending) return redirect(res, "/?error=invalid_or_expired_state");

  pendingStates.delete(state);

  if (oauthError) return redirect(res, `/?error=${encodeURIComponent(oauthError)}`);
  if (!code) return redirect(res, "/?error=missing_authorization_code");

  const redirectUri = new URL("/auth/google/callback", getAppBaseUrl(req)).toString();
  const tokenPayload = await exchangeGoogleCodeForTokens(code, redirectUri);
  const profile = await fetchGoogleUserProfile(tokenPayload.access_token);
  const session = sessions.get(pending.sid) || createSession(pending.sid);

  session.subject = profile.sub;
  session.profile = profile;
  session.tokens = normalizeTokenPayload(tokenPayload, tokenStore.identities[profile.sub]?.tokens?.refreshToken || "");
  sessions.set(session.id, session);
  setSessionCookies(req, res, session);
  persistIdentity(session);

  redirect(res, "/?google=connected");
}

function logoutSession(req, res, session) {
  if (session) sessions.delete(session.id);
  clearCookie(res, COOKIE_NAME, req);
  clearCookie(res, IDENTITY_COOKIE_NAME, req);
  sendJson(res, 200, { ok: true });
}

function disconnectStoredAuth(req, res, session) {
  if (session?.subject && tokenStore.identities[session.subject]) {
    delete tokenStore.identities[session.subject];
    saveTokenStore();
  }

  if (session) sessions.delete(session.id);
  clearCookie(res, COOKIE_NAME, req);
  clearCookie(res, IDENTITY_COOKIE_NAME, req);
  sendJson(res, 200, { ok: true, removedPersistedAuth: true });
}

async function exchangeGoogleCodeForTokens(code, redirectUri) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(extractGoogleError(payload) || "Google token exchange failed.");
  return payload;
}

async function fetchGoogleUserProfile(accessToken) {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(extractGoogleError(payload) || "Failed to load Google profile.");

  return {
    sub: String(payload.sub || ""),
    email: String(payload.email || ""),
    name: String(payload.name || ""),
    picture: String(payload.picture || ""),
  };
}

async function ensureAccessToken(session) {
  if (!session?.tokens?.accessToken) {
    throw new Error("No Google access token is available for this session.");
  }

  if (Date.now() < Number(session.tokens.expiresAt || 0)) {
    return session.tokens.accessToken;
  }

  if (!session.tokens.refreshToken) {
    throw new Error("The Google refresh token is missing. Reconnect the account.");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: session.tokens.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(extractGoogleError(payload) || "Failed to refresh the Google access token.");

  session.tokens = normalizeTokenPayload(payload, session.tokens.refreshToken);
  persistIdentity(session);
  return session.tokens.accessToken;
}

async function searchDriveFiles(session, query, limit) {
  const terms = extractSearchTerms(query || "");
  const qParts = ["trashed = false", "mimeType != 'application/vnd.google-apps.folder'"];

  if (terms.length) {
    const fullTextClause = terms
      .map((term) => {
        const escaped = escapeDriveQueryValue(term);
        return `(name contains '${escaped}' or fullText contains '${escaped}')`;
      })
      .join(" or ");
    qParts.push(`(${fullTextClause})`);
  }

  const params = new URLSearchParams({
    pageSize: String(limit),
    orderBy: "modifiedTime desc",
    fields: "files(id,name,mimeType,modifiedTime,webViewLink,size,shared,owners(displayName),capabilities/canDownload)",
    q: qParts.join(" and "),
    includeItemsFromAllDrives: "true",
    supportsAllDrives: "true",
  });

  const payload = await googleJson(session, `https://www.googleapis.com/drive/v3/files?${params.toString()}`);
  const files = Array.isArray(payload.files) ? payload.files : [];

  return files
    .map((file) => ({ ...file, extractable: isExtractableMime(file.mimeType), label: mimeLabel(file.mimeType) }))
    .sort((left, right) => scoreFile(right, terms) - scoreFile(left, terms));
}

async function answerQuestionAcrossSources(session, question) {
  const terms = extractSearchTerms(question);
  const candidateFiles = await searchDriveFiles(session, question, 10);
  const contexts = [];
  const skipped = [];

  for (const file of candidateFiles.slice(0, 8)) {
    if (!isExtractableMime(file.mimeType)) {
      skipped.push({ ...serializeFile(file), reason: "Unsupported extraction type in this prototype." });
      continue;
    }

    try {
      const text = await downloadFileText(session, file);
      if (!text) {
        skipped.push({ ...serializeFile(file), reason: "The file did not yield readable text." });
        continue;
      }

      const snippets = extractRelevantSnippets(text, terms);
      if (!snippets.length) {
        skipped.push({ ...serializeFile(file), reason: "No strong matching passages were found in the extracted text." });
        continue;
      }

      contexts.push({ file, snippets, score: scoreSnippets(snippets, terms) });
    } catch (error) {
      skipped.push({ ...serializeFile(file), reason: error.message });
    }
  }

  contexts.sort((left, right) => right.score - left.score);

  let answerText = buildExtractiveAnswer(question, contexts, skipped);
  let mode = "extractive";

  if (OPENAI_API_KEY && OPENAI_MODEL && contexts.length) {
    try {
      answerText = await synthesizeWithOpenAI(question, contexts);
      mode = "model";
    } catch (error) {
      console.error("OpenAI synthesis failed:", error.message);
    }
  }

  return {
    question,
    mode,
    terms,
    answer: answerText,
    citations: contexts.slice(0, 6).map((context, index) => ({
      id: index + 1,
      file: serializeFile(context.file),
      excerpt: squeezeWhitespace(context.snippets[0]).slice(0, 320),
    })),
    matchedFiles: contexts.map((context) => serializeFile(context.file)),
    skippedFiles: skipped,
    searchedAt: new Date().toISOString(),
  };
}

async function synthesizeWithOpenAI(question, contexts) {
  const compactContexts = contexts.slice(0, 6).map((context, index) => {
    const excerptBlock = context.snippets
      .slice(0, 2)
      .map((snippet) => squeezeWhitespace(snippet).slice(0, 520))
      .join("\n");

    return `[${index + 1}] ${context.file.name}\nType: ${mimeLabel(context.file.mimeType)}\nLink: ${context.file.webViewLink || "n/a"}\nExtracts:\n${excerptBlock}`;
  });

  const systemPrompt = [
    "You answer only from the supplied source excerpts.",
    "Be concise, practical, and explicit about uncertainty.",
    "When you make a claim, cite the supporting source numbers like [1] or [2].",
    "If the excerpts are insufficient, say so directly.",
  ].join(" ");

  const userPrompt = [`Question: ${question}`, "", "Source excerpts:", compactContexts.join("\n\n")].join("\n");

  const response = await fetch(`${OPENAI_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
        { role: "user", content: [{ type: "input_text", text: userPrompt }] },
      ],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(extractOpenAiError(payload) || "OpenAI synthesis failed.");

  const outputText = extractOpenAiText(payload);
  if (!outputText) throw new Error("OpenAI returned no readable answer text.");
  return outputText.trim();
}

async function downloadFileText(session, file) {
  const directSize = Number(file.size || 0);
  if (directSize > 2_500_000 && !GOOGLE_EXPORT_TYPES.has(file.mimeType)) {
    throw new Error("The file is too large for direct text extraction in this prototype.");
  }

  if (GOOGLE_EXPORT_TYPES.has(file.mimeType)) {
    const mimeType = GOOGLE_EXPORT_TYPES.get(file.mimeType);
    const exportUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}/export`);
    exportUrl.searchParams.set("mimeType", mimeType);
    return normalizeExtractedText(await googleText(session, exportUrl.toString()));
  }

  if (isDirectTextMime(file.mimeType)) {
    const mediaUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}`);
    mediaUrl.searchParams.set("alt", "media");
    return normalizeExtractedText(await googleText(session, mediaUrl.toString()));
  }

  return "";
}

function extractRelevantSnippets(text, terms) {
  const chunks = splitIntoChunks(text);
  const scored = chunks
    .map((chunk) => ({ chunk, score: scoreText(chunk, terms) }))
    .sort((left, right) => right.score - left.score);

  const selected = [];
  for (const item of scored) {
    if (!item.chunk) continue;
    if (!selected.length && !terms.length) {
      selected.push(item.chunk);
      continue;
    }
    if (item.score <= 0 && terms.length) continue;
    selected.push(item.chunk);
    if (selected.length >= 3) break;
  }

  if (!selected.length && chunks.length) return chunks.slice(0, 2);
  return selected;
}

function splitIntoChunks(text) {
  const normalized = normalizeExtractedText(text);
  const rawParagraphs = normalized
    .split(/\n{2,}/)
    .map((part) => squeezeWhitespace(part))
    .filter((part) => part.length >= 40);

  const paragraphs = rawParagraphs.length ? rawParagraphs : chunkByLength(normalized, 550);
  const chunks = [];

  paragraphs.forEach((paragraph) => {
    if (paragraph.length <= 850) {
      chunks.push(paragraph);
      return;
    }

    chunkByLength(paragraph, 550).forEach((piece) => chunks.push(piece));
  });

  return dedupe(chunks).slice(0, 30);
}

function buildExtractiveAnswer(question, contexts, skipped) {
  if (!contexts.length) {
    if (skipped.length) {
      return [
        "Jag hittade relevanta filer men den har forsta versionen kunde inte lasa ut tillrackligt mycket text for att ge ett tryggt samlat svar.",
        "Det vanligaste skalet ar att matchningen hamnade i PDF, bild, ljud, video eller andra format som annu inte extraheras har.",
        `Fragan jag forsokte besvara var: "${question}".`,
      ].join(" ");
    }

    return "Jag hittade inga tydliga textpassager som matchade fragan i de kallor som sokningen tog fram. Testa att gora fragan mer konkret eller sok pa ett filnamn, amne eller datum.";
  }

  const opening = contexts
    .slice(0, 2)
    .map((context, index) => `Kalla ${index + 1}, ${context.file.name}, sager i korthet att ${snippetToClaim(context.snippets[0])}`)
    .join(" ");

  const supportingFiles = contexts.slice(2, 5).map((context) => context.file.name);
  const supportText = supportingFiles.length ? ` Fler traffar som starker samma spar var ${supportingFiles.join(", ")}.` : "";
  const caveatText = skipped.length ? ` ${skipped.length} matchande filer kunde inte anvandas fullt ut i den har versionen.` : "";

  return `Samlad lasning over de mest relevanta kallorna: ${opening}.${supportText}${caveatText}`.trim();
}

function snippetToClaim(snippet) {
  const cleaned = squeezeWhitespace(snippet).replace(/^[-:;,\s]+/, "").replace(/[.;,\s]+$/, "");
  return cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
}

function scoreFile(file, terms) {
  const haystack = `${String(file.name || "").toLowerCase()} ${mimeLabel(file.mimeType).toLowerCase()}`;
  const nameScore = terms.reduce((total, term) => total + (haystack.includes(term) ? 6 : 0), 0);
  const extractableBonus = isExtractableMime(file.mimeType) ? 3 : 0;
  return nameScore + extractableBonus + recencyScore(file.modifiedTime);
}

function recencyScore(modifiedTime) {
  const timestamp = new Date(modifiedTime || 0).getTime();
  if (!timestamp) return 0;
  const ageDays = (Date.now() - timestamp) / (1000 * 60 * 60 * 24);
  if (ageDays <= 1) return 4;
  if (ageDays <= 7) return 3;
  if (ageDays <= 30) return 2;
  if (ageDays <= 90) return 1;
  return 0;
}

function scoreText(text, terms) {
  if (!terms.length) return text.length ? 1 : 0;
  const haystack = String(text || "").toLowerCase();
  let score = 0;
  terms.forEach((term) => {
    score += (haystack.split(term).length - 1) * 4;
  });
  if (haystack.length < 80) score -= 2;
  return score;
}

function scoreSnippets(snippets, terms) {
  return snippets.reduce((total, snippet) => total + scoreText(snippet, terms), 0);
}

function extractSearchTerms(text) {
  return dedupe(String(text || "").toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || [])
    .filter((term) => term.length >= 3)
    .filter((term) => !STOP_WORDS.has(term))
    .slice(0, 6);
}

function isExtractableMime(mimeType) {
  return GOOGLE_EXPORT_TYPES.has(mimeType) || isDirectTextMime(mimeType);
}

function isDirectTextMime(mimeType) {
  return mimeType?.startsWith("text/") || SUPPORTED_TEXT_MIME_TYPES.has(mimeType) || mimeType?.endsWith("+json") || mimeType?.endsWith("+xml");
}

function mimeLabel(mimeType) {
  if (!mimeType) return "Unknown";
  return MIME_LABELS.get(mimeType) || mimeType.replace("application/", "").replace("text/", "");
}

function normalizeTokenPayload(payload, existingRefreshToken) {
  const expiresIn = clampInteger(Number(payload.expires_in || 3600), 60, 60 * 60 * 24 * 365);
  return {
    accessToken: String(payload.access_token || ""),
    refreshToken: String(payload.refresh_token || existingRefreshToken || ""),
    expiresAt: Date.now() + Math.max(expiresIn - 60, 60) * 1000,
    scope: String(payload.scope || ""),
    tokenType: String(payload.token_type || "Bearer"),
  };
}

async function googleJson(session, url) {
  const text = await googleRequest(session, url);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("The Google API returned invalid JSON.");
  }
}

async function googleText(session, url) {
  return googleRequest(session, url);
}

async function googleRequest(session, url) {
  const accessToken = await ensureAccessToken(session);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const text = await response.text();

  if (!response.ok) {
    try {
      const payload = JSON.parse(text);
      throw new Error(extractGoogleError(payload) || "Google API request failed.");
    } catch {
      throw new Error(text || "Google API request failed.");
    }
  }

  return text;
}

function getOrRestoreSession(req, res) {
  const cookies = parseCookies(req.headers.cookie || "");
  const sid = cookies[COOKIE_NAME];
  if (sid && sessions.has(sid)) return sessions.get(sid);

  const identity = verifyIdentityCookie(cookies[IDENTITY_COOKIE_NAME] || "");
  if (!identity) return null;

  const stored = tokenStore.identities[identity.subject];
  if (!stored?.tokens?.refreshToken && !stored?.tokens?.accessToken) return null;

  const session = createSession(sid || crypto.randomUUID());
  session.subject = identity.subject;
  session.profile = stored.profile || null;
  session.tokens = stored.tokens || null;
  sessions.set(session.id, session);
  setSessionCookies(req, res, session);
  return session;
}

function createSession(id = crypto.randomUUID()) {
  return { id, subject: "", profile: null, tokens: null, sourceSummary: null, lastQuestionAt: null };
}

function setSessionCookies(req, res, session) {
  setCookie(res, COOKIE_NAME, session.id, {
    httpOnly: true,
    maxAgeSeconds: 60 * 60 * 24 * 30,
    path: "/",
    req,
  });

  if (session.subject && COOKIE_SIGNING_SECRET) {
    setCookie(res, IDENTITY_COOKIE_NAME, signIdentityCookie(session.subject), {
      httpOnly: true,
      maxAgeSeconds: 60 * 60 * 24 * 30,
      path: "/",
      req,
    });
  }
}

function signIdentityCookie(subject) {
  const payload = base64UrlEncode(JSON.stringify({ subject, issuedAt: Date.now() }));
  const signature = createHmac(payload);
  return `${payload}.${signature}`;
}

function verifyIdentityCookie(rawValue) {
  if (!rawValue || !COOKIE_SIGNING_SECRET) return null;
  const [payload, signature] = String(rawValue).split(".");
  if (!payload || !signature) return null;
  const expected = createHmac(payload);
  if (!safeEqual(signature, expected)) return null;

  try {
    const decoded = JSON.parse(base64UrlDecode(payload));
    if (!decoded?.subject) return null;
    return decoded;
  } catch {
    return null;
  }
}

function createHmac(payload) {
  return crypto.createHmac("sha256", COOKIE_SIGNING_SECRET).update(payload).digest("hex");
}

function parseCookies(headerValue) {
  return String(headerValue || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, pair) => {
      const separator = pair.indexOf("=");
      if (separator < 0) return cookies;
      const key = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      cookies[key] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function setCookie(res, name, value, options = {}) {
  const segments = [`${name}=${encodeURIComponent(value)}`];
  segments.push(`Path=${options.path || "/"}`);
  segments.push(`SameSite=${options.sameSite || "Lax"}`);
  if (options.httpOnly !== false) segments.push("HttpOnly");
  if (options.maxAgeSeconds) segments.push(`Max-Age=${options.maxAgeSeconds}`);
  if (isSecureRequest(options.req)) segments.push("Secure");

  const existing = res.getHeader("Set-Cookie");
  const allCookies = Array.isArray(existing) ? existing : existing ? [existing] : [];
  res.setHeader("Set-Cookie", [...allCookies, segments.join("; ")]);
}

function clearCookie(res, name, req) {
  setCookie(res, name, "", { httpOnly: true, maxAgeSeconds: 0, path: "/", req });
}

function isSecureRequest(req) {
  if (!req) return String(process.env.APP_BASE_URL || "").startsWith("https://");
  return (
    String(process.env.APP_BASE_URL || "").startsWith("https://") ||
    req.socket?.encrypted ||
    String(req.headers["x-forwarded-proto"] || "").toLowerCase() === "https"
  );
}

function persistIdentity(session) {
  if (!TOKEN_STORE_SECRET || !session?.subject || !session?.tokens?.refreshToken) return;
  tokenStore.identities[session.subject] = {
    profile: session.profile || null,
    tokens: session.tokens,
    savedAt: new Date().toISOString(),
  };
  saveTokenStore();
}

function loadTokenStore() {
  if (!TOKEN_STORE_SECRET || !fs.existsSync(TOKEN_STORE_PATH)) {
    return { version: 1, identities: {} };
  }

  try {
    const raw = fs.readFileSync(TOKEN_STORE_PATH, "utf8");
    const decrypted = decryptString(raw, TOKEN_STORE_SECRET);
    const parsed = JSON.parse(decrypted);
    return { version: 1, identities: parsed?.identities || {} };
  } catch (error) {
    console.error("Failed to load token store:", error.message);
    return { version: 1, identities: {} };
  }
}

function saveTokenStore() {
  if (!TOKEN_STORE_SECRET) return;
  ensureDirectory(DATA_DIR);
  fs.writeFileSync(TOKEN_STORE_PATH, encryptString(JSON.stringify(tokenStore), TOKEN_STORE_SECRET), "utf8");
}

function encryptString(plaintext, secret) {
  const key = crypto.createHash("sha256").update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    iv: base64UrlFromBuffer(iv),
    tag: base64UrlFromBuffer(tag),
    ciphertext: base64UrlFromBuffer(ciphertext),
  });
}

function decryptString(serialized, secret) {
  const payload = JSON.parse(serialized);
  const key = crypto.createHash("sha256").update(secret).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, base64UrlToBuffer(payload.iv));
  decipher.setAuthTag(base64UrlToBuffer(payload.tag));
  const plaintext = Buffer.concat([decipher.update(base64UrlToBuffer(payload.ciphertext)), decipher.final()]);
  return plaintext.toString("utf8");
}

function base64UrlEncode(value) {
  return base64UrlFromBuffer(Buffer.from(String(value), "utf8"));
}

function base64UrlDecode(value) {
  return base64UrlToBuffer(value).toString("utf8");
}

function base64UrlFromBuffer(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBuffer(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, "base64");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function loadLocalEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separator = trimmed.indexOf("=");
    if (separator < 0) return;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  });
}

function serializeFile(file) {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    label: mimeLabel(file.mimeType),
    modifiedTime: file.modifiedTime,
    webViewLink: file.webViewLink || "",
    owner: Array.isArray(file.owners) && file.owners[0] ? file.owners[0].displayName || "" : "",
    shared: Boolean(file.shared),
    extractable: isExtractableMime(file.mimeType),
  };
}

function extractGoogleError(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.error_description === "string" && payload.error_description) return payload.error_description;
  if (typeof payload.error === "string" && payload.error) return payload.error;
  if (payload.error?.message) return payload.error.message;
  return "";
}

function extractOpenAiError(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (payload.error?.message) return payload.error.message;
  if (typeof payload.message === "string") return payload.message;
  return "";
}

function extractOpenAiText(payload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text;

  const fragments = [];
  const outputs = Array.isArray(payload.output) ? payload.output : [];
  outputs.forEach((item) => {
    const content = Array.isArray(item.content) ? item.content : [];
    content.forEach((entry) => {
      if (typeof entry.text === "string") fragments.push(entry.text);
      if (typeof entry.output_text === "string") fragments.push(entry.output_text);
    });
  });

  return fragments.join("\n").trim();
}

async function readJsonBody(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON body.");
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function tryServeStatic(pathname, res) {
  const normalized = pathname === "/" ? "" : pathname.replace(/^\/+/, "");
  if (!normalized) return false;

  const filePath = path.join(PUBLIC_DIR, normalized);
  if (!isPathInside(filePath, PUBLIC_DIR)) return false;
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return false;

  await serveFile(res, filePath);
  return true;
}

async function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = STATIC_MIME_TYPES[ext] || "application/octet-stream";
  const content = await fs.promises.readFile(filePath);
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=300",
  });
  res.end(content);
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function getAppBaseUrl(req) {
  if (process.env.APP_BASE_URL) return String(process.env.APP_BASE_URL).replace(/\/+$/, "");
  const protocol = isSecureRequest(req) ? "https" : "http";
  return `${protocol}://${req.headers.host}`;
}

function normalizeExtractedText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/\u0000/g, "")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 24000);
}

function squeezeWhitespace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function chunkByLength(text, size) {
  const chunks = [];
  let cursor = 0;
  while (cursor < text.length) {
    chunks.push(text.slice(cursor, cursor + size).trim());
    cursor += size;
  }
  return chunks.filter(Boolean);
}

function dedupe(values) {
  return [...new Set(values)];
}

function escapeDriveQueryValue(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function ensureDirectory(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }
}

function isPathInside(candidatePath, parentPath) {
  const relative = path.relative(parentPath, candidatePath);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function cleanupPendingStates() {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [state, entry] of pendingStates.entries()) {
    if (entry.createdAt < cutoff) pendingStates.delete(state);
  }
}

function clampInteger(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.round(value), min), max);
}
