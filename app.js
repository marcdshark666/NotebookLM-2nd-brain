const STORAGE_KEYS = {
  clientId: "notebookBridge.googleClientId",
  profile: "notebookBridge.profile",
  session: "notebookBridge.session",
};

const GOOGLE_SCOPE = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.readonly",
].join(" ");

const GOOGLE_EXPORT_TYPES = new Map([
  ["application/vnd.google-apps.document", "text/plain"],
  ["application/vnd.google-apps.presentation", "text/plain"],
  ["application/vnd.google-apps.spreadsheet", "text/csv"],
]);

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

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "if", "in", "into", "is", "it",
  "of", "on", "or", "that", "the", "this", "to", "with", "att", "av", "bara", "bli", "de", "dem", "den",
  "det", "dig", "din", "ditt", "dar", "eller", "en", "ett", "finns", "fran", "for", "ha", "har", "hur",
  "inte", "jag", "kan", "man", "med", "mig", "min", "mina", "ni", "nu", "och", "om", "pa", "sa", "ska",
  "som", "till", "under", "upp", "vad", "var", "vi", "vill", "vore", "vara",
]);

const elements = {
  authPill: document.querySelector("#auth-pill"),
  authCopy: document.querySelector("#auth-copy"),
  clientIdInput: document.querySelector("#client-id-input"),
  originOutput: document.querySelector("#origin-output"),
  pagesOutput: document.querySelector("#pages-output"),
  connectButton: document.querySelector("#connect-button"),
  logoutButton: document.querySelector("#logout-button"),
  clearClientIdButton: document.querySelector("#clear-client-id-button"),
  askForm: document.querySelector("#ask-form"),
  askButton: document.querySelector("#ask-button"),
  questionInput: document.querySelector("#question-input"),
  answerShell: document.querySelector("#answer-shell"),
  answerText: document.querySelector("#answer-text"),
  citationList: document.querySelector("#citation-list"),
  matchedList: document.querySelector("#matched-list"),
  skippedList: document.querySelector("#skipped-list"),
  sourceForm: document.querySelector("#source-form"),
  sourceQuery: document.querySelector("#source-query"),
  sourceSummary: document.querySelector("#source-summary"),
  sourceList: document.querySelector("#source-list"),
  refreshButton: document.querySelector("#refresh-button"),
};

const state = {
  clientId: "",
  accessToken: "",
  expiresAt: 0,
  profile: null,
  lastSources: [],
};

boot();

async function boot() {
  renderLocationInfo();
  restoreClientId();
  restoreSession();
  wireEvents();
  renderAuth();

  if (hasActiveSession()) {
    try {
      await hydrateProfile();
      renderAuth();
      await loadSources("");
    } catch (error) {
      clearSession(false);
      renderAuth();
      setAnswerText(error.message || "Sessionen kunde inte ateranvandas.");
    }
  }
}

function wireEvents() {
  elements.clientIdInput.addEventListener("input", handleClientIdInput);
  elements.connectButton.addEventListener("click", handleConnect);
  elements.logoutButton.addEventListener("click", handleDisconnect);
  elements.clearClientIdButton.addEventListener("click", handleClearClientId);
  elements.askForm.addEventListener("submit", handleAsk);
  elements.sourceForm.addEventListener("submit", handleSourceSearch);
  elements.refreshButton.addEventListener("click", () => loadSources(elements.sourceQuery.value.trim()));
}

function renderLocationInfo() {
  elements.originOutput.textContent = window.location.origin;
  elements.pagesOutput.textContent = window.location.href;
}

function restoreClientId() {
  state.clientId = localStorage.getItem(STORAGE_KEYS.clientId) || "";
  elements.clientIdInput.value = state.clientId;
}

function restoreSession() {
  const rawSession = sessionStorage.getItem(STORAGE_KEYS.session);
  const rawProfile = sessionStorage.getItem(STORAGE_KEYS.profile) || localStorage.getItem(STORAGE_KEYS.profile);
  if (rawProfile) {
    try {
      state.profile = JSON.parse(rawProfile);
    } catch {
      state.profile = null;
    }
  }

  if (!rawSession) return;

  try {
    const parsed = JSON.parse(rawSession);
    if (parsed.expiresAt > Date.now() + 30_000 && parsed.accessToken) {
      state.accessToken = parsed.accessToken;
      state.expiresAt = parsed.expiresAt;
    } else {
      clearSession(false);
    }
  } catch {
    clearSession(false);
  }
}

function persistSession() {
  sessionStorage.setItem(
    STORAGE_KEYS.session,
    JSON.stringify({
      accessToken: state.accessToken,
      expiresAt: state.expiresAt,
    })
  );

  if (state.profile) {
    const serialized = JSON.stringify(state.profile);
    sessionStorage.setItem(STORAGE_KEYS.profile, serialized);
    localStorage.setItem(STORAGE_KEYS.profile, serialized);
  }
}

function clearSession(render = true) {
  state.accessToken = "";
  state.expiresAt = 0;
  state.profile = null;
  sessionStorage.removeItem(STORAGE_KEYS.session);
  sessionStorage.removeItem(STORAGE_KEYS.profile);
  localStorage.removeItem(STORAGE_KEYS.profile);

  if (render) {
    renderAuth();
    renderSources([]);
  }
}

function hasActiveSession() {
  return Boolean(state.accessToken && state.expiresAt > Date.now() + 30_000);
}

function handleClientIdInput(event) {
  state.clientId = String(event.target.value || "").trim();
  localStorage.setItem(STORAGE_KEYS.clientId, state.clientId);
  renderAuth();
}

async function handleConnect() {
  if (!state.clientId) {
    setAnswerText("Lagg in ditt Google Web Client ID forst.");
    return;
  }

  try {
    setConnectBusy(true);
    const tokenResponse = await requestGoogleToken("consent");
    state.accessToken = tokenResponse.access_token;
    state.expiresAt = Date.now() + Math.max(Number(tokenResponse.expires_in || 3600) - 60, 60) * 1000;
    await hydrateProfile();
    persistSession();
    renderAuth();
    setAnswerText("Google-kontot ar anslutet. Nu kan sidan lasa kallor direkt i webblasaren.");
    await loadSources("");
  } catch (error) {
    setAnswerText(error.message || "Google-anslutningen misslyckades.");
  } finally {
    setConnectBusy(false);
  }
}

async function handleDisconnect() {
  try {
    const googleApi = await waitForGoogle();
    if (state.accessToken) {
      googleApi.accounts.oauth2.revoke(state.accessToken, () => {});
    }
  } catch {
    // ignore revoke failures and still clear local session
  }

  clearSession();
  setAnswerText("Anslutningen rensades. Klicka pa Connect Google om du vill ge atkomst igen.");
}

function handleClearClientId() {
  localStorage.removeItem(STORAGE_KEYS.clientId);
  state.clientId = "";
  elements.clientIdInput.value = "";
  clearSession();
  setAnswerText("Client ID togs bort fran webblasaren.");
}

async function requestGoogleToken(promptValue) {
  const googleApi = await waitForGoogle();

  return new Promise((resolve, reject) => {
    const tokenClient = googleApi.accounts.oauth2.initTokenClient({
      client_id: state.clientId,
      scope: GOOGLE_SCOPE,
      callback: (response) => {
        if (response?.error) {
          reject(new Error(response.error));
          return;
        }
        resolve(response);
      },
      error_callback: (error) => {
        reject(new Error(error?.type || "Google popup blocked or failed."));
      },
    });

    tokenClient.requestAccessToken({ prompt: promptValue });
  });
}

async function waitForGoogle() {
  if (window.google?.accounts?.oauth2) {
    return window.google;
  }

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      if (window.google?.accounts?.oauth2) {
        window.clearInterval(interval);
        resolve(window.google);
        return;
      }

      if (Date.now() - startedAt > 10_000) {
        window.clearInterval(interval);
        reject(new Error("Google Identity Services laddades inte. Kontrollera att popup och tredjepartsskript ar tillatna."));
      }
    }, 50);
  });
}

async function hydrateProfile() {
  if (!hasActiveSession()) return null;
  state.profile = await fetchGoogleJson("https://www.googleapis.com/oauth2/v3/userinfo");
  persistSession();
  return state.profile;
}

function renderAuth() {
  const connected = hasActiveSession();
  elements.connectButton.disabled = !state.clientId;
  elements.logoutButton.disabled = !connected;
  elements.askButton.disabled = !connected;

  elements.authPill.textContent = connected ? "Ansluten till Google" : "Inte ansluten";
  elements.authPill.className = `status-pill ${connected ? "connected" : "disconnected"}`;

  if (!state.clientId) {
    elements.authCopy.textContent =
      "Borja med att skapa ett Google Web Client ID, lagg in origin ovan i Google Cloud och klistra sedan in Client ID har.";
    return;
  }

  if (!connected) {
    elements.authCopy.textContent =
      "Client ID ar sparat lokalt i webblasaren. Klicka pa Connect Google for att ge tillfallig access token till dina Drive-kallor.";
    return;
  }

  const minutesLeft = Math.max(1, Math.round((state.expiresAt - Date.now()) / 60_000));
  const profileText = state.profile?.name || state.profile?.email || "Ditt Google-konto";
  elements.authCopy.textContent = `${profileText} ar anslutet. Access-token ar aktiv i ungefär ${minutesLeft} minuter eller tills du disconnectar.`;
}

function setConnectBusy(active) {
  elements.connectButton.disabled = active || !state.clientId;
  elements.connectButton.textContent = active ? "Ansluter..." : "Connect Google";
}

async function handleAsk(event) {
  event.preventDefault();

  const question = String(elements.questionInput.value || "").trim();
  if (!question) return;

  if (!hasActiveSession()) {
    setAnswerText("Anslut Google forst. GitHub Pages-versionen kan inte lasa dina kallor utan en aktiv access token.");
    return;
  }

  try {
    setAskBusy(true);
    setAnswerText("Soker efter relevanta kallor och bygger ett samlat svar...");
    clearLists();
    const payload = await answerQuestionAcrossSources(question);
    renderAnswer(payload);
  } catch (error) {
    setAnswerText(error.message || "Det gick inte att bearbeta fragan.");
  } finally {
    setAskBusy(false);
  }
}

async function handleSourceSearch(event) {
  event.preventDefault();
  await loadSources(elements.sourceQuery.value.trim());
}

async function loadSources(query) {
  if (!hasActiveSession()) {
    elements.sourceSummary.textContent = "Anslut Google forst for att lasa in kallor.";
    elements.sourceList.innerHTML = "";
    return;
  }

  elements.sourceSummary.textContent = "Laser in kallor...";
  elements.sourceList.innerHTML = "";

  try {
    const files = await searchDriveFiles(query, 24);
    state.lastSources = files;
    renderSources(files, query);
  } catch (error) {
    elements.sourceSummary.textContent = error.message || "Det gick inte att lasa kallor.";
  }
}

async function searchDriveFiles(query, limit) {
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
    fields: "files(id,name,mimeType,modifiedTime,webViewLink,size,shared,owners(displayName))",
    q: qParts.join(" and "),
    includeItemsFromAllDrives: "true",
    supportsAllDrives: "true",
  });

  const payload = await fetchGoogleJson(`https://www.googleapis.com/drive/v3/files?${params.toString()}`);
  const files = Array.isArray(payload.files) ? payload.files : [];

  return files
    .map((file) => ({ ...file, extractable: isExtractableMime(file.mimeType), label: mimeLabel(file.mimeType) }))
    .sort((left, right) => scoreFile(right, terms) - scoreFile(left, terms));
}

async function answerQuestionAcrossSources(question) {
  const terms = extractSearchTerms(question);
  const candidateFiles = await searchDriveFiles(question, 10);
  const contexts = [];
  const skipped = [];

  for (const file of candidateFiles.slice(0, 8)) {
    if (!isExtractableMime(file.mimeType)) {
      skipped.push({ ...serializeFile(file), reason: "Formatet lases inte direkt i den har versionen." });
      continue;
    }

    try {
      const text = await downloadFileText(file);
      if (!text) {
        skipped.push({ ...serializeFile(file), reason: "Filen gav ingen lasbar text." });
        continue;
      }

      const snippets = extractRelevantSnippets(text, terms);
      if (!snippets.length) {
        skipped.push({ ...serializeFile(file), reason: "Ingen stark textmatchning hittades efter extraktion." });
        continue;
      }

      contexts.push({ file, snippets, score: scoreSnippets(snippets, terms) });
    } catch (error) {
      skipped.push({ ...serializeFile(file), reason: error.message });
    }
  }

  contexts.sort((left, right) => right.score - left.score);

  return {
    question,
    answer: buildExtractiveAnswer(question, contexts, skipped),
    citations: contexts.slice(0, 6).map((context, index) => ({
      id: index + 1,
      file: serializeFile(context.file),
      excerpt: squeezeWhitespace(context.snippets[0]).slice(0, 320),
    })),
    matchedFiles: contexts.map((context) => serializeFile(context.file)),
    skippedFiles: skipped,
  };
}

async function downloadFileText(file) {
  const size = Number(file.size || 0);
  if (size > 2_500_000 && !GOOGLE_EXPORT_TYPES.has(file.mimeType)) {
    throw new Error("Filen ar for stor for direkt textlasning i Pages-versionen.");
  }

  if (GOOGLE_EXPORT_TYPES.has(file.mimeType)) {
    const exportUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}/export`);
    exportUrl.searchParams.set("mimeType", GOOGLE_EXPORT_TYPES.get(file.mimeType));
    return normalizeExtractedText(await fetchGoogleText(exportUrl.toString()));
  }

  if (isDirectTextMime(file.mimeType)) {
    const mediaUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}`);
    mediaUrl.searchParams.set("alt", "media");
    return normalizeExtractedText(await fetchGoogleText(mediaUrl.toString()));
  }

  return "";
}

async function fetchGoogleJson(url) {
  const response = await fetchWithToken(url);
  return response.json();
}

async function fetchGoogleText(url) {
  const response = await fetchWithToken(url);
  return response.text();
}

async function fetchWithToken(url) {
  if (!hasActiveSession()) {
    throw new Error("Google-sessionen har gatt ut. Klicka pa Connect Google igen.");
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${state.accessToken}`,
    },
  });

  if (response.status === 401) {
    clearSession();
    throw new Error("Access-token gick ut eller avvisades. Klicka pa Connect Google igen.");
  }

  if (!response.ok) {
    const text = await response.text();
    try {
      const payload = JSON.parse(text);
      throw new Error(extractGoogleError(payload) || "Google API-fel.");
    } catch {
      throw new Error(text || "Google API-fel.");
    }
  }

  return response;
}

function renderAnswer(payload) {
  setAnswerText(payload.answer || "Inget svar kom tillbaka.");
  renderCitationList(payload.citations || []);
  renderSimpleFileList(elements.matchedList, payload.matchedFiles || [], "Inga anvandbara filer lastes.");
  renderSkippedList(payload.skippedFiles || []);
}

function renderCitationList(citations) {
  if (!citations.length) {
    elements.citationList.innerHTML = "<li>Inga direkta citat kunde byggas.</li>";
    return;
  }

  elements.citationList.innerHTML = citations
    .map((citation) => {
      const link = citation.file?.webViewLink
        ? `<a class="source-link" href="${escapeHtml(citation.file.webViewLink)}" target="_blank" rel="noreferrer">Oppna fil</a>`
        : "";
      return `
        <li>
          <strong>[${citation.id}] ${escapeHtml(citation.file?.name || "Okand fil")}</strong>
          <div class="source-meta">${escapeHtml(citation.file?.label || "")}</div>
          <div>${escapeHtml(citation.excerpt || "")}</div>
          ${link}
        </li>
      `;
    })
    .join("");
}

function renderSimpleFileList(target, files, emptyText) {
  if (!files.length) {
    target.innerHTML = `<li>${escapeHtml(emptyText)}</li>`;
    return;
  }

  target.innerHTML = files
    .map((file) => {
      const link = file.webViewLink
        ? `<a class="source-link" href="${escapeHtml(file.webViewLink)}" target="_blank" rel="noreferrer">Oppna</a>`
        : "";
      return `
        <li>
          <strong>${escapeHtml(file.name || "Namnlos fil")}</strong>
          <div class="source-meta">
            <span>${escapeHtml(file.label || file.mimeType || "")}</span>
            <span>${file.extractable ? "Text lasbar" : "Ej fullt lasbar annu"}</span>
          </div>
          ${link}
        </li>
      `;
    })
    .join("");
}

function renderSkippedList(files) {
  if (!files.length) {
    elements.skippedList.innerHTML = "<li>Inga matchade filer hoppades over.</li>";
    return;
  }

  elements.skippedList.innerHTML = files
    .map((file) => `
      <li>
        <strong>${escapeHtml(file.name || "Namnlos fil")}</strong>
        <div class="source-meta">
          <span>${escapeHtml(file.label || file.mimeType || "")}</span>
          <span>${escapeHtml(file.reason || "Okand orsak")}</span>
        </div>
      </li>
    `)
    .join("");
}

function renderSources(files, query = "") {
  if (!files.length) {
    elements.sourceSummary.textContent = query
      ? `Inga filer hittades for "${query}".`
      : "Inga filer hittades i den har hamtningen.";
    elements.sourceList.innerHTML = "";
    return;
  }

  const summaryBase = query
    ? `Visar ${files.length} traffar for "${query}".`
    : `Visar ${files.length} nyliga eller relevanta filer.`;

  elements.sourceSummary.textContent = `${summaryBase} Gron etikett betyder att den har versionen kan forsoka lasa texten direkt.`;
  elements.sourceList.innerHTML = files
    .map((file) => {
      const tagClass = file.extractable ? "supported" : "unsupported";
      const tagText = file.extractable ? "Lasbar text" : "Format nasta steg";
      const modified = file.modifiedTime ? new Date(file.modifiedTime).toLocaleString("sv-SE") : "okant datum";
      const link = file.webViewLink
        ? `<a class="source-link" href="${escapeHtml(file.webViewLink)}" target="_blank" rel="noreferrer">Oppna i Drive</a>`
        : "";

      return `
        <article class="source-item">
          <div class="source-tag ${tagClass}">${tagText}</div>
          <h3>${escapeHtml(file.name || "Namnlos fil")}</h3>
          <div class="source-meta">
            <span>${escapeHtml(file.label || file.mimeType || "")}</span>
            <span>Senast andrad ${escapeHtml(modified)}</span>
            ${file.owner ? `<span>Agare ${escapeHtml(file.owner)}</span>` : ""}
          </div>
          ${link}
        </article>
      `;
    })
    .join("");
}

function setAskBusy(active) {
  elements.askButton.disabled = active || !hasActiveSession();
  elements.askButton.textContent = active ? "Arbetar..." : "Fraga alla kallor";
}

function clearLists() {
  elements.citationList.innerHTML = "";
  elements.matchedList.innerHTML = "";
  elements.skippedList.innerHTML = "";
}

function setAnswerText(text) {
  elements.answerShell.classList.remove("empty");
  elements.answerText.textContent = text;
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
        "Jag hittade relevanta filer men den har forsta Pages-versionen kunde inte lasa ut tillrackligt mycket text for att ge ett tryggt samlat svar.",
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

function extractGoogleError(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.error_description === "string" && payload.error_description) return payload.error_description;
  if (typeof payload.error === "string" && payload.error) return payload.error;
  if (payload.error?.message) return payload.error.message;
  return "";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
