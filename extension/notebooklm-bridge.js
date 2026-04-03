(function notebookLmBridge() {
  const RESPONSE_STABLE_POLLS = 3;
  const POLL_INTERVAL_MS = 1200;
  const MAX_WAIT_MS = 120000;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "RUN_NOTEBOOK_PROMPT") return false;

    runNotebookPrompt(message.payload || {})
      .then((payload) => sendResponse(payload))
      .catch((error) => sendResponse({
        ok: false,
        error: error?.message || "NotebookLM automation failed",
        title: document.title || "NotebookLM",
        answer: "",
      }));

    return true;
  });

  async function runNotebookPrompt(payload) {
    const question = String(payload.question || "").trim();
    if (!question) {
      throw new Error("Question is empty");
    }

    await waitForPageReady();
    const promptField = await waitForPromptField();
    const baseline = snapshotVisibleTextBlocks();

    focusPromptField(promptField);
    setPromptValue(promptField, question);
    await sleep(350);
    await sendPrompt(promptField, question);

    const answer = await waitForNewAnswer(baseline);

    return {
      ok: true,
      title: payload.requestedTitle || extractNotebookTitle(),
      answer,
    };
  }

  async function waitForPageReady() {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 45000) {
      if (document.body && document.readyState !== "loading") {
        return;
      }
      await sleep(200);
    }

    throw new Error("NotebookLM page did not become ready");
  }

  async function waitForPromptField() {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 45000) {
      const field = findPromptField();
      if (field) return field;
      await sleep(500);
    }

    throw new Error("Could not find the NotebookLM chat input");
  }

  function findPromptField() {
    const candidates = [
      ...document.querySelectorAll("textarea"),
      ...document.querySelectorAll('[contenteditable="true"][role="textbox"]'),
      ...document.querySelectorAll('[contenteditable="true"]'),
    ];

    return candidates.find((element) => {
      if (!isVisible(element)) return false;
      if (element.closest("header, nav")) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 220 && rect.height > 28;
    }) || null;
  }

  function focusPromptField(field) {
    field.scrollIntoView({ behavior: "instant", block: "center" });
    field.focus();
  }

  function setPromptValue(field, value) {
    if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(field.constructor.prototype, "value")?.set;
      if (setter) {
        setter.call(field, value);
      } else {
        field.value = value;
      }

      field.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    field.textContent = value;
    field.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
  }

  async function sendPrompt(field, question) {
    const sendButton = findSendButton(field);
    if (sendButton) {
      sendButton.click();
      return;
    }

    field.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    }));
    field.dispatchEvent(new KeyboardEvent("keyup", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    }));

    await sleep(500);

    const afterAttempt = snapshotVisibleTextBlocks().find((block) => block.text.includes(question));
    if (!afterAttempt) {
      throw new Error("Prompt could not be submitted");
    }
  }

  function findSendButton(field) {
    const root = field.closest("form, section, div") || document;
    const buttons = [...root.querySelectorAll('button, [role="button"]')];
    const preferred = buttons.find((button) => {
      if (!isVisible(button)) return false;
      const label = normalizeSpace(button.getAttribute("aria-label") || button.getAttribute("title") || button.textContent);
      return /send|submit|skicka|fraga|ask/i.test(label);
    });

    if (preferred) return preferred;

    return buttons.find((button) => {
      if (!isVisible(button)) return false;
      return !button.hasAttribute("disabled");
    }) || null;
  }

  async function waitForNewAnswer(baseline) {
    const startedAt = Date.now();
    let lastCandidate = "";
    let stableCount = 0;

    while (Date.now() - startedAt < MAX_WAIT_MS) {
      await sleep(POLL_INTERVAL_MS);
      const currentBlocks = snapshotVisibleTextBlocks();
      const candidate = currentBlocks
        .filter((block) => !baseline.some((baselineBlock) => baselineBlock.text === block.text))
        .filter((block) => block.text.length >= 80)
        .sort((left, right) => right.score - left.score)[0];

      if (!candidate) continue;

      if (candidate.text === lastCandidate) {
        stableCount += 1;
      } else {
        lastCandidate = candidate.text;
        stableCount = 1;
      }

      if (stableCount >= RESPONSE_STABLE_POLLS) {
        return candidate.text;
      }
    }

    throw new Error("NotebookLM answer did not arrive in time");
  }

  function snapshotVisibleTextBlocks() {
    const blocks = [];
    const seen = new Set();
    const candidates = document.querySelectorAll("article, main div, main p, main li, section div");

    for (const element of candidates) {
      if (!isVisible(element)) continue;
      if (element.closest("button, nav, header, footer, textarea, input, form")) continue;

      const text = normalizeSpace(element.innerText || "");
      if (text.length < 80 || text.length > 6000) continue;
      if (seen.has(text)) continue;

      const rect = element.getBoundingClientRect();
      const score = text.length + Math.max(0, window.innerHeight - rect.top);
      blocks.push({ text, score });
      seen.add(text);
    }

    return blocks;
  }

  function extractNotebookTitle() {
    const heading = document.querySelector("h1, h2");
    const title = normalizeSpace(heading?.textContent || document.title || "NotebookLM");
    return title.replace(/\s*-\s*NotebookLM\s*$/i, "");
  }

  function isVisible(element) {
    if (!element || !(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function normalizeSpace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }
})();
