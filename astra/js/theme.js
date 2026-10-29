/* Appearance: colour theme and text size. Loaded in <head>, before anything is drawn, so the page never flashes
   the wrong colours. The choice is kept under its own small key so it can be read this early. */
window.AstraTheme = (function () {
  "use strict";

  const KEY = "astra.appearance.v1";
  const THEMES = [
    { id: "system", name: "Match this computer" },
    { id: "dark", name: "Dark" },
    { id: "light", name: "Light" },
    { id: "contrast", name: "High contrast" },
  ];
  const SIZES = [
    { id: "normal", name: "Standard" },
    { id: "large", name: "Larger" },
  ];
  const DEFAULTS = { theme: "system", textSize: "normal" };

  const media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;

  function clean(p) {
    p = p && typeof p === "object" ? p : {};
    return {
      theme: THEMES.some((t) => t.id === p.theme) ? p.theme : DEFAULTS.theme,
      textSize: SIZES.some((s) => s.id === p.textSize) ? p.textSize : DEFAULTS.textSize,
    };
  }

  function read() {
    try {
      return clean(JSON.parse(localStorage.getItem(KEY) || "null"));
    } catch {
      return { ...DEFAULTS };
    }
  }

  let current = read();

  /* "system" follows the computer's light or dark setting, and changes with it. */
  const resolved = (theme) => (theme === "system" ? (media && media.matches ? "light" : "dark") : theme);

  function paint() {
    const root = document.documentElement;
    const theme = resolved(current.theme);
    root.dataset.theme = theme;
    root.dataset.text = current.textSize;
    root.style.colorScheme = theme === "light" ? "light" : "dark";
  }

  function set(prefs) {
    current = clean({ ...current, ...prefs });
    try {
      localStorage.setItem(KEY, JSON.stringify(current));
    } catch {
      /* storage blocked: the choice lasts for this visit */
    }
    paint();
    return current;
  }

  media?.addEventListener?.("change", () => current.theme === "system" && paint());
  /* Changed in another Astra tab, or while the side panel is open: follow it. */
  addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    current = read();
    paint();
  });
  paint();

  return { THEMES, SIZES, get: () => ({ ...current }), set, resolved: () => resolved(current.theme), clean };
})();
