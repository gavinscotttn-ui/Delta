/* Praxis is offline. Astra's AI assistant needs a model downloaded from the internet, so in Praxis it is
   not offered: every check says so and nothing loads. Ask still answers from the guides and documents. */
window.AstraAI = (function () {
  "use strict";
  const reason = "Praxis works offline, and the AI assistant needs a download, so it is not included.";
  const no = async () => {
    throw new Error(reason);
  };
  return {
    support: () => ({ ok: false, reason }),
    installed: async () => [],
    load: no,
    chat: no,
    unload: async () => {},
    selfTest: async () => ({ ok: false, error: reason }),
    useEngine: () => {},
    onStatus: () => () => {},
    status: () => ({ state: "idle", model: "", device: "", loadedMs: 0 }),
  };
})();
