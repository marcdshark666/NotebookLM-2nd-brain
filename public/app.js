const elements = {
  authPill: document.querySelector("#auth-pill"),
  authCopy: document.querySelector("#auth-copy"),
  connectLink: document.querySelector("#connect-link"),
  logoutButton: document.querySelector("#logout-button"),
  disconnectButton: document.querySelector("#disconnect-button"),
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
  auth: null,
  lastSources: [],
};

boot();

async function boot() {
  wireEvents();
  readUrlFlags();
  await refreshAuth();
  if (state.auth?.connected) {
    await loadSources();
  }
}

function wireEvents() {
  elements.askForm.addEventListener("submit", handleAsk);
  elements.sourceForm.addEventListener("submit", handleSourceSearch);
  elements.refreshButton.addEventListener("click", () => loadSources(elements.sourceQuery.value.trim()));
  elements.logoutButton.addEventListener("click", handleLogout);
  elements.disconnectButton.addEventListener("click", handleDisconnect);
}

function readUrlFlags() {
  const url = new URL(window.location.href);
  const connected = url.searchParams.get("google");
  const error = url.searchParams.get("error");

  if (connected === "connected") {
    elements.answerShell.classList.remove("empty");
    elements.answerText.textContent = "Google-kontot är anslutet. Du kan nu fråga över de källor som den här prototypen kan söka i.";
  }

  if (error) {
    elements.answerShell.classList.remove("empty");
    elements.answerText.textContent = `Autentiseringen eller anslutningen stoppades: ${error}`;
  }

  if (connected || error) {
    url.search = "";
    window.history.replaceState({}, "", url.toString());
  }
}

async function refreshAuth() {
  try {
    const response = await fetch("/api/auth/status", { cache: "no-store" });
    const payload = await response.json();
    state.auth = payload;
    renderAuth();
  } catch (error) {
    renderAuthError(error);
  }
}

function renderAuth() {
  const auth = state.auth || {};
  const connected = Boolean(auth.connected);

  elements.authPill.textContent = connected ? "Ansluten till Google" : "Inte ansluten";
  elements.authPill.className = `status-pill ${connected ? "connected" : "disconnected"}`;

  if (!auth.hasGoogleCredentials) {
    elements.authCopy.textContent = "Servern saknar ännu Google OAuth-uppgifter. Lägg in klient-id och klient-hemlighet i .env först.";
    elements.connectLink.setAttribute("aria-disabled", "true");
    elements.connectLink.href = "#";
    elements.connectLink.style.pointerEvents = "none";
  } else if (connected) {
    const name = auth.profile?.name || auth.profile?.email || "Google-kontot";
    const persistence = auth.hasPersistentAuth
      ? "Krypterad återanvändning av auth är aktiverad om refresh token sparas lokalt."
      : "Auth fungerar, men utan TOKEN_STORE_SECRET måste du logga in igen efter serveromstart.";
    const llmState = auth.llmConfigured
      ? "LLM-syntes är konfigurerad för friare svar."
      : "LLM-syntes är inte konfigurerad, så svaren blir mer extraktiva.";
    elements.authCopy.textContent = `${name} är anslutet. ${persistence} ${llmState}`;
    elements.connectLink.style.pointerEvents = "";
  } else {
    elements.authCopy.textContent = "Klicka på Connect Google för att godkänna åtkomst med OAuth utan att lämna lösenordet till appen.";
    elements.connectLink.style.pointerEvents = "";
  }

  elements.logoutButton.disabled = !connected;
  elements.disconnectButton.disabled = !connected;
  elements.askButton.disabled = !connected;
}

function renderAuthError(error) {
  elements.authPill.textContent = "Statusfel";
  elements.authPill.className = "status-pill disconnected";
  elements.authCopy.textContent = `Det gick inte att läsa status från servern. ${error.message || error}`;
  elements.askButton.disabled = true;
}

async function handleAsk(event) {
  event.preventDefault();
  const question = elements.questionInput.value.trim();
  if (!question) return;

  setAskingState(true);
  elements.answerShell.classList.remove("empty");
  elements.answerText.textContent = "Söker efter relevanta källor och bygger ett samlat svar…";
  clearLists();

  try {
    const response = await fetch("/api/ask", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ question }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Frågan misslyckades.");
    }

    renderAnswer(payload);
  } catch (error) {
    elements.answerText.textContent = error.message || "Det gick inte att bearbeta frågan.";
  } finally {
    setAskingState(false);
  }
}

function renderAnswer(payload) {
  elements.answerText.textContent = payload.answer || "Inget svar kom tillbaka.";
  renderCitationList(payload.citations || []);
  renderSimpleFileList(elements.matchedList, payload.matchedFiles || [], "Inga användbara filer lästes.");
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
        ? `<a class="source-link" href="${escapeHtml(citation.file.webViewLink)}" target="_blank" rel="noreferrer">Öppna fil</a>`
        : "";
      return `
        <li>
          <strong>[${citation.id}] ${escapeHtml(citation.file?.name || "Okänd fil")}</strong>
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
        ? `<a class="source-link" href="${escapeHtml(file.webViewLink)}" target="_blank" rel="noreferrer">Öppna</a>`
        : "";
      return `
        <li>
          <strong>${escapeHtml(file.name || "Namnlös fil")}</strong>
          <div class="source-meta">
            <span>${escapeHtml(file.label || file.mimeType || "")}</span>
            <span>${file.extractable ? "Text läsbar" : "Ej fullt läsbar ännu"}</span>
          </div>
          ${link}
        </li>
      `;
    })
    .join("");
}

function renderSkippedList(files) {
  if (!files.length) {
    elements.skippedList.innerHTML = "<li>Inga matchade filer hoppades över.</li>";
    return;
  }

  elements.skippedList.innerHTML = files
    .map((file) => {
      return `
        <li>
          <strong>${escapeHtml(file.name || "Namnlös fil")}</strong>
          <div class="source-meta">
            <span>${escapeHtml(file.label || file.mimeType || "")}</span>
            <span>${escapeHtml(file.reason || "Okänd orsak")}</span>
          </div>
        </li>
      `;
    })
    .join("");
}

async function handleSourceSearch(event) {
  event.preventDefault();
  await loadSources(elements.sourceQuery.value.trim());
}

async function loadSources(query = "") {
  if (!state.auth?.connected) {
    elements.sourceSummary.textContent = "Anslut Google först för att läsa in källor.";
    elements.sourceList.innerHTML = "";
    return;
  }

  elements.sourceSummary.textContent = "Läser in källor…";
  elements.sourceList.innerHTML = "";

  try {
    const url = new URL("/api/sources", window.location.origin);
    if (query) {
      url.searchParams.set("query", query);
    }

    const response = await fetch(url, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Källistan kunde inte hämtas.");
    }

    state.lastSources = payload.files || [];
    renderSources(query);
  } catch (error) {
    elements.sourceSummary.textContent = error.message || "Det gick inte att läsa källor.";
  }
}

function renderSources(query) {
  const files = state.lastSources;
  const summaryBase = query
    ? `Visar ${files.length} träffar för "${query}".`
    : `Visar ${files.length} nyliga eller relevanta filer.`;

  elements.sourceSummary.textContent = files.length
    ? `${summaryBase} Grön etikett betyder att prototypen kan försöka läsa texten direkt.`
    : "Inga filer hittades för den här sökningen.";

  elements.sourceList.innerHTML = files
    .map((file) => {
      const tagClass = file.extractable ? "supported" : "unsupported";
      const tagText = file.extractable ? "Läsbar text" : "Format nästa steg";
      const modified = file.modifiedTime ? new Date(file.modifiedTime).toLocaleString("sv-SE") : "okänt datum";
      const link = file.webViewLink
        ? `<a class="source-link" href="${escapeHtml(file.webViewLink)}" target="_blank" rel="noreferrer">Öppna i Drive</a>`
        : "";

      return `
        <article class="source-item">
          <div class="source-tag ${tagClass}">${tagText}</div>
          <h3>${escapeHtml(file.name || "Namnlös fil")}</h3>
          <div class="source-meta">
            <span>${escapeHtml(file.label || file.mimeType || "")}</span>
            <span>Senast ändrad ${escapeHtml(modified)}</span>
            ${file.owner ? `<span>Ägare ${escapeHtml(file.owner)}</span>` : ""}
          </div>
          ${link}
        </article>
      `;
    })
    .join("");
}

async function handleLogout() {
  await postAuthAction("/api/auth/logout");
}

async function handleDisconnect() {
  await postAuthAction("/api/auth/disconnect");
}

async function postAuthAction(path) {
  try {
    const response = await fetch(path, { method: "POST" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "Autentiseringsåtgärden misslyckades.");
    }

    elements.answerShell.classList.remove("empty");
    elements.answerText.textContent = "Sessionen rensades. Du kan ansluta igen när du vill.";
    clearLists();
    await refreshAuth();
    await loadSources("");
  } catch (error) {
    elements.answerText.textContent = error.message || "Det gick inte att rensa auth.";
  }
}

function setAskingState(active) {
  elements.askButton.disabled = active;
  elements.askButton.textContent = active ? "Arbetar…" : "Fråga alla källor";
}

function clearLists() {
  elements.citationList.innerHTML = "";
  elements.matchedList.innerHTML = "";
  elements.skippedList.innerHTML = "";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
