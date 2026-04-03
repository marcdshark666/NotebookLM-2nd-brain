const STORAGE_KEYS = {
  clientId: "notebookBridge.googleClientId",
};

const APP_CONFIG = {
  googleClientId: window.NOTEBOOK_BRIDGE_GOOGLE_CLIENT_ID || "",
};

const BRIDGE_REQUEST_SOURCE = "notebook-bridge-page";
const BRIDGE_RESPONSE_SOURCE = "notebook-bridge-extension";
const BROWSER_BRIDGE_TIMEOUT_MS = 150000;
const GOOGLE_CLIENT_ID_PATTERN = /^\d+-[a-z0-9._-]+\.apps\.googleusercontent\.com$/i;
const GOOGLE_LOGIN_PROMPT = "select_account consent";
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

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

const NOTEBOOKS = [
  {
    id: "allergologi",
    title: "Allergologi",
    url: "https://notebooklm.google.com/notebook/a177068e-f656-472c-8c68-8aefe9e0d434",
    keywords: ["allergi", "allergologi", "astma", "atopi", "anafylaxi", "urtikaria", "eksem", "pollen", "histamin"],
  },
  {
    id: "dermatologi-venerologi",
    title: "Dermatologi och venerologi",
    url: "https://notebooklm.google.com/notebook/514f947b-c84f-4f04-a11a-7b8e8ddf3474",
    keywords: ["hud", "dermatologi", "venerologi", "acne", "psoriasis", "eksem", "utslag", "melanom", "nevus", "sti", "std"],
  },
  {
    id: "gastroenterologi",
    title: "Gastroenterologi",
    url: "https://notebooklm.google.com/notebook/8945321b-2d35-4611-a573-17c667874c64",
    keywords: ["gastro", "gastroenterologi", "ibd", "crohn", "ulceros", "magsack", "tarm", "kolit", "celiaki", "reflux", "lever"],
  },
];

const elements = {
  authPill: document.querySelector("#auth-pill"),
  authCopy: document.querySelector("#auth-copy"),
  clientIdInput: document.querySelector("#client-id-input"),
  originOutput: document.querySelector("#origin-output"),
  pagesOutput: document.querySelector("#pages-output"),
  connectButton: document.querySelector("#connect-button"),
  logoutButton: document.querySelector("#logout-button"),
  clearClientIdButton: document.querySelector("#clear-client-id-button"),
  agentOrbButton: document.querySelector("#agent-orb-button"),
  agentOrbCanvas: document.querySelector("#agent-orb-canvas"),
  orbTitle: document.querySelector("#orb-title"),
  orbCopy: document.querySelector("#orb-copy"),
  orbChipAuth: document.querySelector("#orb-chip-auth"),
  orbChipScan: document.querySelector("#orb-chip-scan"),
  orbChipAnswer: document.querySelector("#orb-chip-answer"),
  sessionIndicator: document.querySelector("#session-indicator"),
  sourceIndicator: document.querySelector("#source-indicator"),
  modeIndicator: document.querySelector("#mode-indicator"),
  askForm: document.querySelector("#ask-form"),
  askButton: document.querySelector("#ask-button"),
  questionInput: document.querySelector("#question-input"),
  answerShell: document.querySelector("#answer-shell"),
  answerText: document.querySelector("#answer-text"),
  answerMeta: document.querySelector("#answer-meta"),
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
  lastSources: [],
  browserBridgeAvailable: false,
  isAsking: false,
  isLoadingSources: false,
  orbAnimationFrame: 0,
  orbCanvasSize: 0,
  orbDevicePixelRatio: 1,
};

boot();

async function boot() {
  renderLocationInfo();
  restoreClientId();
  wireEvents();
  initAgentOrb();
  renderAuth();
  renderAgentSurface();
  void detectBrowserBridge();
}

function wireEvents() {
  elements.clientIdInput.addEventListener("input", handleClientIdInput);
  elements.connectButton.addEventListener("click", handleConnectButton);
  elements.logoutButton.addEventListener("click", handleDisconnect);
  elements.clearClientIdButton.addEventListener("click", handleClearClientId);
  elements.agentOrbButton.addEventListener("click", handleAgentOrbClick);
  elements.askForm.addEventListener("submit", handleAsk);
  elements.sourceForm.addEventListener("submit", handleSourceSearch);
  elements.refreshButton.addEventListener("click", () => loadSources(elements.sourceQuery.value.trim()));
}

async function handleConnectButton() {
  if (hasActiveSession()) {
    await handleDisconnect();
    return;
  }

  await handleConnect();
}

function initAgentOrb() {
  resizeAgentOrbCanvas();
  window.addEventListener("resize", resizeAgentOrbCanvas, { passive: true });

  const animate = (time) => {
    drawAgentOrb(time);
    state.orbAnimationFrame = window.requestAnimationFrame(animate);
  };

  state.orbAnimationFrame = window.requestAnimationFrame(animate);
}

function resizeAgentOrbCanvas() {
  const canvas = elements.agentOrbCanvas;
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  state.orbCanvasSize = Math.max(1, rect.width);
  state.orbDevicePixelRatio = ratio;
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
}

function drawAgentOrb(time) {
  const canvas = elements.agentOrbCanvas;
  const context = canvas.getContext("2d");
  const size = state.orbCanvasSize;
  const ratio = state.orbDevicePixelRatio;

  if (!context || !size) return;

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, size, size);
  context.translate(size / 2, size / 2);

  const profile = getOrbProfile();
  const radius = size * 0.34;
  const timeScale = time * 0.001;

  const glow = context.createRadialGradient(0, 0, radius * 0.18, 0, 0, radius * 1.22);
  glow.addColorStop(0, `rgba(${profile.core}, 0.34)`);
  glow.addColorStop(0.48, `rgba(${profile.rim}, 0.16)`);
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = glow;
  context.beginPath();
  context.arc(0, 0, radius * 1.28, 0, Math.PI * 2);
  context.fill();

  drawOrbWave(context, radius * 1.04, timeScale, profile, 1.1, 0.12, 0);
  drawOrbWave(context, radius * 0.9, timeScale, profile, 1.45, 0.08, 1.6);
  drawOrbWave(context, radius * 0.77, timeScale, profile, 1.8, 0.06, 3.1);

  context.save();
  context.rotate(timeScale * (0.1 + profile.energy * 0.14));
  context.strokeStyle = `rgba(${profile.rim}, 0.22)`;
  context.lineWidth = 1.2;
  context.setLineDash([8, 12]);
  context.beginPath();
  context.arc(0, 0, radius * 1.15, 0, Math.PI * 2);
  context.stroke();
  context.restore();

  for (let index = 0; index < 3; index += 1) {
    const angle = timeScale * (0.36 + index * 0.12) + index * 2.094;
    const nodeRadius = radius * (0.74 + index * 0.09);
    const x = Math.cos(angle) * nodeRadius;
    const y = Math.sin(angle) * nodeRadius;
    const nodeGlow = context.createRadialGradient(x, y, 0, x, y, 14 + profile.energy * 10);
    nodeGlow.addColorStop(0, `rgba(${profile.highlight}, 0.9)`);
    nodeGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = nodeGlow;
    context.beginPath();
    context.arc(x, y, 12 + profile.energy * 6, 0, Math.PI * 2);
    context.fill();
  }

  const core = context.createRadialGradient(0, 0, radius * 0.08, 0, 0, radius * 0.62);
  core.addColorStop(0, `rgba(${profile.highlight}, 0.88)`);
  core.addColorStop(0.4, `rgba(${profile.core}, 0.42)`);
  core.addColorStop(1, "rgba(3, 6, 10, 0.03)");
  context.fillStyle = core;
  context.beginPath();
  context.arc(0, 0, radius * 0.64, 0, Math.PI * 2);
  context.fill();

  context.setTransform(1, 0, 0, 1, 0, 0);
}

function drawOrbWave(context, baseRadius, timeScale, profile, speed, variance, phaseOffset) {
  context.beginPath();

  for (let step = 0; step <= 180; step += 1) {
    const angle = (step / 180) * Math.PI * 2;
    const wobble =
      1 +
      variance * Math.sin(angle * 3 + timeScale * speed + phaseOffset) +
      variance * 0.6 * Math.cos(angle * 6 - timeScale * speed * 1.4 + phaseOffset);
    const pulse = 1 + profile.energy * 0.1 * Math.sin(angle * 2 - timeScale * (speed + 0.5));
    const radius = baseRadius * wobble * pulse;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;

    if (step === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  }

  context.closePath();
  context.strokeStyle = `rgba(${profile.rim}, ${0.16 + profile.energy * 0.18})`;
  context.lineWidth = 1.3 + profile.energy * 1.1;
  context.stroke();
}

function getOrbProfile() {
  if (state.isAsking) {
    return {
      energy: 1,
      core: "84, 194, 255",
      rim: "132, 226, 255",
      highlight: "241, 193, 125",
    };
  }

  if (state.isLoadingSources) {
    return {
      energy: 0.74,
      core: "97, 164, 255",
      rim: "151, 210, 255",
      highlight: "127, 213, 255",
    };
  }

  if (hasActiveSession()) {
    return {
      energy: 0.54,
      core: "92, 224, 193",
      rim: "182, 244, 222",
      highlight: "127, 213, 255",
    };
  }

  if (state.clientId) {
    return {
      energy: 0.34,
      core: "241, 193, 125",
      rim: "255, 224, 182",
      highlight: "127, 213, 255",
    };
  }

  return {
    energy: 0.2,
    core: "74, 97, 126",
    rim: "132, 156, 186",
    highlight: "127, 213, 255",
  };
}

async function handleAgentOrbClick() {
  if (!hasActiveSession()) {
    elements.questionInput.focus();
    return;
  }

  elements.questionInput.focus();
}

function renderAgentSurface() {
  const connected = hasActiveSession();
  const sourceCount = state.lastSources.length;
  let title = "Waiting";
  let copy = "Login with Google to wake the agent.";
  let mode = "Idle";
  let session = "Offline";

  if (!state.clientId) {
    title = "Login ready";
    copy = state.browserBridgeAvailable
      ? "Ask directly. The local NotebookLM bridge is ready."
      : "You can ask directly now, or add Google later for Drive search.";
    mode = "Setup";
  } else if (!connected) {
    title = "Login ready";
    copy = state.browserBridgeAvailable
      ? "Ask directly with the NotebookLM bridge, or login with Google for Drive search."
      : "Ask directly, or login with Google and choose one of your existing accounts.";
    mode = "Authenticate";
  } else if (state.isAsking) {
    title = "Scanning";
    copy = "Reading matches and shaping one answer back.";
    mode = "Answer";
    session = "Connected";
  } else if (state.isLoadingSources) {
    title = "Linking";
    copy = "Refreshing the source layer around your agent.";
    mode = "Scan";
    session = "Connected";
  } else {
    title = "Ready";
    copy = "Ask one question. Get one combined answer back.";
    mode = "Linked";
    session = "Connected";
  }

  elements.orbTitle.textContent = title;
  elements.orbCopy.textContent = copy;
  elements.sessionIndicator.textContent = session;
  elements.sourceIndicator.textContent = `${sourceCount} loaded`;
  elements.modeIndicator.textContent = mode;

  setChipState(elements.orbChipAuth, !state.clientId || !connected);
  setChipState(elements.orbChipScan, connected && state.isLoadingSources);
  setChipState(elements.orbChipAnswer, connected && state.isAsking);
}

function setChipState(element, active) {
  element.classList.toggle("active", Boolean(active));
}

function renderLocationInfo() {
  elements.originOutput.textContent = window.location.origin;
  elements.pagesOutput.textContent = window.location.href;
}

function restoreClientId() {
  const storedClientId = normalizeClientId(readStoredClientId());
  const configuredClientId = normalizeClientId(APP_CONFIG.googleClientId);

  if (isValidGoogleClientId(storedClientId)) {
    applyClientId(storedClientId, { persist: true });
    return;
  }

  if (storedClientId) {
    clearStoredClientId();
  }

  if (isValidGoogleClientId(configuredClientId)) {
    applyClientId(configuredClientId, { persist: false });
    return;
  }

  clearClientIdState();
}

function persistSession() {
  // Intentionally no-op.
  // We do not persist access tokens between page loads, so Google re-authorization is required again.
}

function clearSession(render = true) {
  state.accessToken = "";
  state.expiresAt = 0;
  state.lastSources = [];
  state.isAsking = false;
  state.isLoadingSources = false;

  if (render) {
    renderAuth();
    elements.sourceSummary.textContent = "Logga in med Google for att lasa in kallor.";
    elements.sourceList.innerHTML = "";
    renderAgentSurface();
  }
}

function hasActiveSession() {
  return Boolean(state.accessToken && state.expiresAt > Date.now() + 30_000);
}

function handleClientIdInput(event) {
  const nextValue = normalizeClientId(event.target.value);

  if (!nextValue) {
    clearClientIdState();
  } else if (isValidGoogleClientId(nextValue)) {
    applyClientId(nextValue, { persist: true });
  } else {
    clearClientIdState();
  }

  renderAuth();
  renderAgentSurface();
}

async function handleConnect() {
  if (!ensureClientId()) {
    setAnswerText("Google Client ID behovs innan Google kan oppnas.");
    return;
  }

  try {
    setConnectBusy(true);
    const tokenResponse = await requestGoogleToken(GOOGLE_LOGIN_PROMPT);
    state.accessToken = tokenResponse.access_token;
    state.expiresAt = Date.now() + Math.max(Number(tokenResponse.expires_in || 3600) - 60, 60) * 1000;
    persistSession();
    renderAuth();
    renderAgentSurface();
    setAnswerText("Google ar anslutet. Du kan nu fraga agenten.");
    await loadSources("");
  } catch (error) {
    handleGoogleConnectError(error);
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
  setAnswerText("Sessionen ar stangd.");
  renderAgentSurface();
}

function handleClearClientId() {
  clearClientIdState();
  clearSession();
  setAnswerText("Client ID togs bort fran webblasaren.");
  renderAgentSurface();
}

function ensureClientId() {
  if (isValidGoogleClientId(state.clientId)) return true;

  clearClientIdState();

  const providedClientId = window.prompt(
    "Klistra in ditt Google Web Client ID, inte din e-postadress.\nExempel: 123456789012-abc123def456.apps.googleusercontent.com"
  );
  const normalizedClientId = normalizeClientId(providedClientId);

  if (!normalizedClientId) {
    return false;
  }

  if (!isValidGoogleClientId(normalizedClientId)) {
    clearClientIdState();
    setAnswerText("Det dar ser inte ut som ett Google Web Client ID. Anvand vardet som slutar med .apps.googleusercontent.com.");
    return false;
  }

  applyClientId(normalizedClientId, { persist: true });
  renderAuth();
  renderAgentSurface();
  return true;
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

function renderAuth() {
  const connected = hasActiveSession();
  elements.connectButton.disabled = false;
  elements.logoutButton.disabled = !connected;
  elements.askButton.disabled = false;

  elements.authPill.textContent = connected ? "Ansluten till Google" : "Inte ansluten";
  elements.authPill.className = `status-pill ${connected ? "connected" : "disconnected"}`;
  elements.connectButton.textContent = connected ? "Logout" : "Login with Google";

  if (!state.clientId) {
    elements.authCopy.textContent = "Google Client ID saknas i den har sessionen.";
    renderAgentSurface();
    return;
  }

  if (!connected) {
    elements.authCopy.textContent = "Google maste godkannas pa nytt varje ny inloggning.";
    renderAgentSurface();
    return;
  }

  const minutesLeft = Math.max(1, Math.round((state.expiresAt - Date.now()) / 60_000));
  elements.authCopy.textContent = `Google-sessionen ar aktiv i ungefar ${minutesLeft} minuter till.`;
  renderAgentSurface();
}

function setConnectBusy(active) {
  elements.connectButton.disabled = active;
  elements.connectButton.textContent = active ? "Opening Google account chooser..." : hasActiveSession() ? "Logout" : "Login with Google";
}

async function handleAsk(event) {
  event.preventDefault();

  const question = String(elements.questionInput.value || "").trim();
  if (!question) return;

  try {
    setAskBusy(true);
    setAnswerText("Analyserar fragan och matchar relevanta notebooks...");
    renderAnswerMeta([]);
    clearLists();
    const browserBridgePayload = await answerQuestionViaBrowserBridge(question);
    const payload = browserBridgePayload
      || (hasActiveSession()
        ? await answerQuestionAcrossSources(question)
        : answerQuestionAcrossNotebooks(question));
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
    elements.sourceSummary.textContent = "Logga in med Google forst.";
    elements.sourceList.innerHTML = "";
    state.lastSources = [];
    renderAgentSurface();
    return;
  }

  state.isLoadingSources = true;
  renderAgentSurface();
  elements.sourceSummary.textContent = "Laser in kallor...";
  elements.sourceList.innerHTML = "";

  try {
    const files = await searchDriveFiles(query, 24);
    state.lastSources = files;
    renderSources(files, query);
  } catch (error) {
    elements.sourceSummary.textContent = error.message || "Det gick inte att lasa kallor.";
  } finally {
    state.isLoadingSources = false;
    renderAgentSurface();
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
  const notebookMatches = rankRelevantNotebooks(question).slice(0, 3);
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
    notebookMatches,
    citations: contexts.slice(0, 6).map((context, index) => ({
      id: index + 1,
      file: serializeFile(context.file),
      excerpt: squeezeWhitespace(context.snippets[0]).slice(0, 320),
    })),
    matchedFiles: contexts.map((context) => serializeFile(context.file)),
    skippedFiles: skipped,
  };
}

function answerQuestionAcrossNotebooks(question) {
  const matches = rankRelevantNotebooks(question);
  const topMatches = matches.slice(0, 3);

  if (!topMatches.length) {
    return {
      answer: "Jag kunde inte avgora en enda tydlig specialitet utifran fragan, sa jag visar dina notebooks som narmaste startpunkter.",
      notebookMatches: NOTEBOOKS,
      citations: [],
      matchedFiles: [],
      skippedFiles: [],
    };
  }

  const titles = topMatches.map((entry) => entry.title);
  const opening =
    topMatches.length === 1
      ? `Den mest relevanta notebooken for fragan verkar vara ${titles[0]}.`
      : `De mest relevanta notebooks for fragan verkar vara ${titles.join(", ")}.`;

  const support =
    " Jag kan just nu anvanda dina NotebookLM-lankar som en smart katalog och skicka dig till ratt omrade direkt fran fragan.";

  return {
    answer: `${opening}${support}`,
    notebookMatches: topMatches,
    citations: [],
    matchedFiles: [],
    skippedFiles: [],
  };
}

async function answerQuestionViaBrowserBridge(question) {
  const notebookMatches = rankRelevantNotebooks(question).slice(0, 3);
  if (!notebookMatches.length) return null;

  const bridgeReady = await detectBrowserBridge();
  if (!bridgeReady) return null;

  try {
    const payload = await sendBridgeRequest(
      "ASK_NOTEBOOKS",
      {
        question,
        notebooks: notebookMatches,
      },
      BROWSER_BRIDGE_TIMEOUT_MS
    );

    const responses = Array.isArray(payload?.responses) ? payload.responses : [];
    const successful = responses.filter((response) => response?.ok && response?.answer);
    if (!successful.length) return null;

    return {
      answer: buildBrowserBridgeAnswer(question, successful),
      notebookMatches: successful.map((response) => ({
        title: response.title || response.requestedTitle || "NotebookLM",
        url: response.url || "",
      })),
      citations: [],
      matchedFiles: [],
      skippedFiles: [],
    };
  } catch {
    state.browserBridgeAvailable = false;
    renderAgentSurface();
    return null;
  }
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
    throw new Error("Google-sessionen har gatt ut. Logga in igen.");
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${state.accessToken}`,
    },
  });

  if (response.status === 401) {
    clearSession();
    throw new Error("Access-token gick ut eller avvisades. Logga in igen.");
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
  renderAnswerMeta(payload.notebookMatches || []);
  renderCitationList(payload.citations || []);
  renderSimpleFileList(elements.matchedList, payload.matchedFiles || [], "Inga anvandbara filer lastes.");
  renderSkippedList(payload.skippedFiles || []);
}

function renderAnswerMeta(notebooks) {
  if (!elements.answerMeta) return;

  if (!notebooks.length) {
    elements.answerMeta.innerHTML = "";
    elements.answerMeta.classList.add("empty");
    return;
  }

  elements.answerMeta.classList.remove("empty");
  elements.answerMeta.innerHTML = notebooks
    .map((notebook) => `
      <a class="notebook-link-chip" href="${escapeHtml(notebook.url)}" target="_blank" rel="noreferrer">
        ${escapeHtml(notebook.title)}
      </a>
    `)
    .join("");
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
    renderAgentSurface();
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
  renderAgentSurface();
}

function setAskBusy(active) {
  state.isAsking = active;
  elements.askButton.disabled = active;
  elements.askButton.textContent = active ? "Thinking..." : "Ask";
  renderAgentSurface();
}

function handleGoogleConnectError(error) {
  const message = String(error?.message || "").trim();

  if (message.includes("invalid_client")) {
    clearClientIdState();
    clearSession(false);
    renderAuth();
    renderAgentSurface();
    setAnswerText("Det sparade vardet var inte ett giltigt Google Web Client ID for web. Jag tog bort det lokalt, sa din e-post sparas inte har.");
    return;
  }

  setAnswerText(message || "Google-anslutningen misslyckades.");
}

async function detectBrowserBridge() {
  try {
    const payload = await sendBridgeRequest("PING", {}, 2500);
    state.browserBridgeAvailable = Boolean(payload?.ready);
  } catch {
    state.browserBridgeAvailable = false;
  }

  renderAgentSurface();
  return state.browserBridgeAvailable;
}

function sendBridgeRequest(type, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const requestId = createRequestId();
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Notebook bridge timeout"));
    }, timeoutMs);

    const handleMessage = (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== BRIDGE_RESPONSE_SOURCE || data.requestId !== requestId) return;

      cleanup();
      if (data.ok === false) {
        reject(new Error(data.error || "Notebook bridge error"));
        return;
      }

      resolve(data.payload || {});
    };

    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener("message", handleMessage);
    };

    window.addEventListener("message", handleMessage);
    window.postMessage(
      {
        source: BRIDGE_REQUEST_SOURCE,
        type,
        requestId,
        payload,
      },
      window.location.origin
    );
  });
}

function createRequestId() {
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeClientId(value) {
  return String(value || "").trim();
}

function isValidGoogleClientId(value) {
  return GOOGLE_CLIENT_ID_PATTERN.test(normalizeClientId(value));
}

function applyClientId(clientId, options = {}) {
  const persist = options.persist !== false;
  const normalizedClientId = normalizeClientId(clientId);

  state.clientId = normalizedClientId;
  elements.clientIdInput.value = normalizedClientId;

  if (persist) {
    storeClientId(normalizedClientId);
  }
}

function clearClientIdState() {
  state.clientId = "";
  elements.clientIdInput.value = "";
  clearStoredClientId();
}

function readStoredClientId() {
  try {
    return window.sessionStorage.getItem(STORAGE_KEYS.clientId) || localStorage.getItem(STORAGE_KEYS.clientId) || "";
  } catch {
    return localStorage.getItem(STORAGE_KEYS.clientId) || "";
  }
}

function storeClientId(clientId) {
  try {
    window.sessionStorage.setItem(STORAGE_KEYS.clientId, clientId);
  } catch {
    // ignore session storage failures and fall back to in-memory state only
  }

  localStorage.removeItem(STORAGE_KEYS.clientId);
}

function clearStoredClientId() {
  try {
    window.sessionStorage.removeItem(STORAGE_KEYS.clientId);
  } catch {
    // ignore session storage failures
  }

  localStorage.removeItem(STORAGE_KEYS.clientId);
}

function clearLists() {
  renderAnswerMeta([]);
  elements.citationList.innerHTML = "";
  elements.matchedList.innerHTML = "";
  elements.skippedList.innerHTML = "";
}

function setAnswerText(text) {
  elements.answerShell.classList.remove("empty");
  elements.answerText.textContent = text;
}

function rankRelevantNotebooks(question) {
  const terms = extractSearchTerms(question);
  const questionText = String(question || "").toLowerCase();

  const scored = NOTEBOOKS
    .map((notebook) => {
      const titleTerms = extractSearchTerms(notebook.title);
      const keywordMatches = notebook.keywords.reduce((total, keyword) => total + (questionText.includes(keyword) ? 4 : 0), 0);
      const titleMatches = titleTerms.reduce((total, term) => total + (terms.includes(term) ? 5 : 0), 0);
      const looseMatches = terms.reduce((total, term) => {
        const inTitle = notebook.title.toLowerCase().includes(term);
        const inKeywords = notebook.keywords.some((keyword) => keyword.includes(term) || term.includes(keyword));
        return total + (inTitle || inKeywords ? 2 : 0);
      }, 0);

      return {
        ...notebook,
        score: keywordMatches + titleMatches + looseMatches,
      };
    })
    .sort((left, right) => right.score - left.score);

  return scored.filter((notebook, index) => notebook.score > 0 || index === 0);
}

function buildBrowserBridgeAnswer(question, responses) {
  const sections = responses.slice(0, 3).map((response) => {
    const title = response.title || response.requestedTitle || "NotebookLM";
    const cleanedAnswer = squeezeWhitespace(response.answer).slice(0, 1800);
    return `${title}: ${cleanedAnswer}`;
  });

  return [
    `NotebookLM-svar for fragan "${question}":`,
    sections.join("\n\n"),
  ].join("\n\n");
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
