(function pageBridge() {
  const PAGE_SOURCE = "notebook-bridge-page";
  const EXTENSION_SOURCE = "notebook-bridge-extension";

  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;

    const data = event.data;
    if (!data || data.source !== PAGE_SOURCE || !data.type || !data.requestId) return;

    try {
      const payload = await chrome.runtime.sendMessage({
        type: data.type,
        requestId: data.requestId,
        payload: data.payload || {},
      });

      window.postMessage(
        {
          source: EXTENSION_SOURCE,
          requestId: data.requestId,
          ok: true,
          payload: payload || {},
        },
        window.location.origin
      );
    } catch (error) {
      window.postMessage(
        {
          source: EXTENSION_SOURCE,
          requestId: data.requestId,
          ok: false,
          error: error?.message || "Bridge request failed",
        },
        window.location.origin
      );
    }
  });
})();
