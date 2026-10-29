/* Praxis is offline: no models are downloaded, so there is nothing to choose from. */
window.AstraModels = (function () {
  "use strict";
  const reason = "Praxis works offline, so models cannot be downloaded.";
  const no = async () => {
    throw new Error(reason);
  };
  return {
    CATALOG: [],
    choose: () => null,
    sha256: no,
    plan: no,
    install: no,
    installed: async () => [],
    remove: async () => {},
    configure: () => {},
    hub: () => "",
  };
})();
