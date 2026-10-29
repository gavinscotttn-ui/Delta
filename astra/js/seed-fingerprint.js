/* A short fingerprint of a template, quick line, workflow, guide or shortcut, taken from the fields a person can edit.
   Astra uses it to tell a built-in item nobody has changed (safe to update to the latest wording) from one someone
   has edited (left alone). Personal fields such as favourites and use counts are not part of it. */
window.AstraFingerprint = (function () {
  "use strict";

  const text = (v) => (typeof v === "string" ? v : "");
  const list = (v) => (Array.isArray(v) ? v : []);
  const tags = (v) =>
    list(v)
      .map((t) => String(t).trim())
      .filter(Boolean);
  const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

  /* The same clean-up Astra applies when it stores an item, so a stored item and its source give the same result. */
  const CANONICAL = {
    templates: (t) => [text(t.title), text(t.category), tags(t.tags), text(t.body)],
    snippets: (l) => [text(l.text), text(l.category), text(l.shortcut).toLowerCase()],
    workflows: (w) => [
      text(w.title),
      text(w.category),
      tags(w.tags),
      list(w.steps).map(String).filter(Boolean),
      text(w.guide),
    ],
    knowledge: (k) => [
      text(k.title),
      text(k.type),
      text(k.category),
      tags(k.tags),
      text(k.summary),
      text(k.body),
      !!k.rich,
      text(k.quick),
      list(k.related).filter((r) => typeof r === "string"),
      list(k.docs)
        .filter(isObject)
        .filter((d) => text(d.id))
        .map((d) => [text(d.id), text(d.find), Number(d.page) || 0, text(d.label)]),
    ],
    shortcuts: (s) => {
      let url = "https://";
      try {
        const parsed = new URL(text(s.url));
        if (parsed.protocol === "https:") url = parsed.href;
      } catch {
        /* not a valid address */
      }
      return [text(s.title), url, text(s.key).slice(0, 1).toUpperCase()];
    },
  };

  /* FNV-1a, 32 bits, written as 8 hex characters. Ample for telling versions of the same item apart. */
  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }

  const of = (kind, item) => (CANONICAL[kind] ? hash(JSON.stringify(CANONICAL[kind](item || {}))) : "");

  return { of };
})();
