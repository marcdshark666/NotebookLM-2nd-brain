const NOTEBOOK_READY_TIMEOUT_MS = 45000;
const NOTEBOOK_RESPONSE_TIMEOUT_MS = 120000;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((payload) => sendResponse(payload))
    .catch((error) => sendResponse({ ok: false, error: error?.message || "Bridge failure" }));

  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case "PING":
      return { ready: true };
    case "ASK_NOTEBOOKS":
      return askNotebooks(message.payload || {});
    default:
      throw new Error("Unknown bridge message type");
  }
}

async function askNotebooks(payload) {
  const question = String(payload.question || "").trim();
  const notebooks = Array.isArray(payload.notebooks) ? payload.notebooks : [];

  if (!question) {
    throw new Error("Question is required");
  }

  if (!notebooks.length) {
    throw new Error("No notebooks were provided");
  }

  const responses = [];
  for (const notebook of notebooks) {
    responses.push(await askSingleNotebook(notebook, question));
  }

  return { responses };
}

async function askSingleNotebook(notebook, question) {
  const tab = await ensureNotebookTab(notebook.url);

  try {
    await waitForTabComplete(tab.id, NOTEBOOK_READY_TIMEOUT_MS);
    const response = await sendNotebookMessage(tab.id, {
      type: "RUN_NOTEBOOK_PROMPT",
      payload: {
        question,
        requestedTitle: notebook.title || "NotebookLM",
      },
    });

    return {
      ok: Boolean(response?.ok),
      title: response?.title || notebook.title || "NotebookLM",
      requestedTitle: notebook.title || "NotebookLM",
      answer: response?.answer || "",
      url: notebook.url,
      error: response?.error || "",
    };
  } catch (error) {
    return {
      ok: false,
      title: notebook.title || "NotebookLM",
      requestedTitle: notebook.title || "NotebookLM",
      answer: "",
      url: notebook.url,
      error: error?.message || "Notebook tab failed",
    };
  }
}

async function ensureNotebookTab(url) {
  const tabs = await chrome.tabs.query({});
  const existingTab = tabs.find((tab) => normalizeNotebookUrl(tab.url) === normalizeNotebookUrl(url));
  if (existingTab) {
    return existingTab;
  }

  return chrome.tabs.create({
    url,
    active: false,
  });
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let removedListener;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Notebook tab load timed out"));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      if (removedListener) {
        chrome.tabs.onRemoved.removeListener(removedListener);
      }
    };

    const handleUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === "complete") {
        settled = true;
        cleanup();
        resolve();
      }
    };

    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") {
        settled = true;
        cleanup();
        resolve();
        return;
      }

      chrome.tabs.onUpdated.addListener(handleUpdated);
    }).catch((error) => {
      cleanup();
      reject(error);
    });

    removedListener = function handleRemoved(removedTabId) {
      if (removedTabId !== tabId || settled) return;
      cleanup();
      reject(new Error("Notebook tab was closed"));
    };

    chrome.tabs.onRemoved.addListener(removedListener);
  });
}

function sendNotebookMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Notebook response timed out"));
    }, NOTEBOOK_RESPONSE_TIMEOUT_MS);

    chrome.tabs.sendMessage(tabId, message)
      .then((response) => {
        clearTimeout(timer);
        resolve(response || {});
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function normalizeNotebookUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString();
  } catch {
    return String(url || "");
  }
}
