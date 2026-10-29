/* Praxis: runs before any of Astra's own scripts.
   1. Puts the saved workspace back into this page's storage, so Astra finds it exactly as before.
   2. Saves every change Astra makes to its storage into Praxis's folder (%APPDATA%\Praxis), so the
      workspace survives the browser's data being cleared and is the same in every Praxis window.
   3. Inside the Praxis window, hands the surrounding window (sidebar, search, privacy screen) to Praxis.
   Nothing here talks to anything but this computer's own Praxis. */
(function () {
  "use strict";
  const meta = document.querySelector('meta[name="praxis-token"]');
  const TOKEN = meta ? meta.content : "";
  const ls = window.localStorage;
  /* Appearance is per window and follows Praxis's own setting, so it is not saved here. */
  const synced = (k) => typeof k === "string" && k.startsWith("astra.") && k !== "astra.appearance.v1";

  let saved = {};
  try {
    saved = JSON.parse(document.getElementById("praxis-kv").textContent) || {};
  } catch {
    saved = {};
  }

  const send = (key, value, keepalive) =>
    fetch("/api/kv/" + encodeURIComponent(key), {
      method: value === null ? "DELETE" : "PUT",
      headers: { "X-Praxis-Token": TOKEN, "Content-Type": "text/plain;charset=utf-8" },
      body: value === null ? undefined : value,
      keepalive: !!keepalive && (value || "").length < 60000,
    }).catch(() => {});

  try {
    for (const [k, v] of Object.entries(saved)) if (synced(k) && ls.getItem(k) !== v) ls.setItem(k, v);
    /* Anything this browser had that Praxis has not seen yet (a first run) goes to Praxis once. */
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (synced(k) && !(k in saved)) send(k, ls.getItem(k));
    }
  } catch {
    /* storage blocked: Astra still runs, nothing is kept */
  }

  /* Write-through, a moment after the last change so a burst of edits is one write. */
  const pending = new Map();
  let timer = 0;
  const flush = (keepalive) => {
    clearTimeout(timer);
    timer = 0;
    for (const [k, v] of pending) send(k, v, keepalive);
    pending.clear();
  };
  const queue = (k, v) => {
    pending.set(k, v);
    if (!timer) timer = setTimeout(flush, 300);
  };
  const proto = Storage.prototype;
  const setItem = proto.setItem;
  const removeItem = proto.removeItem;
  proto.setItem = function (k, v) {
    setItem.call(this, k, v);
    if (this === ls && synced(k)) queue(k, String(v));
  };
  proto.removeItem = function (k) {
    removeItem.call(this, k);
    if (this === ls && synced(k)) queue(k, null);
  };
  addEventListener("pagehide", () => flush(true));

  /* Inside the Praxis window: Praxis draws the sidebar and owns search, page keys and the privacy screen. */
  let parentHost = null;
  try {
    if (window.parent !== window && window.parent.PraxisHost) parentHost = window.parent.PraxisHost;
  } catch {
    parentHost = null;
  }
  if (parentHost) {
    window.PraxisHost = parentHost;
    document.documentElement.classList.add("in-praxis");
  }
})();
