/* Knowledge-base helpers: guide rendering, document links and searching inside documents.
   No access to Astra's state or the DOM, so it can be tested on its own. */
window.AstraKB = (function () {
  "use strict";

  const LIB = window.AstraLibrary || { categories: [], docs: [], index: [] };
  const docs = LIB.docs;
  /* The page text (js/library/index.js, about 700 KB) is loaded after the first paint, so a new tab opens fast.
     Until then searches inside documents return nothing; callers that need it wait for loadIndex(). */
  let pages = LIB.index || null;
  const allPages = () => pages || [];

  const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" };
  const esc = (s) => String(s ?? "").replace(/[&<>'"]/g, (c) => ESCAPES[c]);
  const norm = (s) => String(s).toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();

  const docById = (id) => docs.find((d) => d.id === id);
  const docIndex = new Map(docs.map((d, i) => [d.id, i]));

  /* Page text, normalised once, on first use. */
  let lowered = null;
  let lowering = [];
  const low = () => {
    if (lowered) return lowered;
    const all = allPages();
    for (let i = lowering.length; i < all.length; i++) lowering.push(norm(all[i][2]));
    return (lowered = lowering);
  };
  /* Prepares the page text in small slices while the browser is idle, so a slow computer never stalls. */
  function warm() {
    return new Promise((resolve) => {
      const idle =
        typeof requestIdleCallback === "function"
          ? (fn) => requestIdleCallback(fn, { timeout: 500 })
          : (fn) => setTimeout(fn, 16);
      const tick = (deadline) => {
        if (lowered) return resolve();
        const all = allPages();
        const end =
          performance.now() + (deadline?.timeRemaining ? Math.max(4, deadline.timeRemaining() - 2) : 8);
        while (lowering.length < all.length && performance.now() < end)
          for (let n = 0; n < 16 && lowering.length < all.length; n++)
            lowering.push(norm(all[lowering.length][2]));
        if (lowering.length >= all.length) {
          low();
          resolve();
        } else idle(tick);
      };
      idle(tick);
    });
  }

  let loading = null;
  const listeners = [];
  const indexReady = () => pages !== null;

  function loadIndex() {
    if (pages) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((resolve) => {
      const done = () => {
        pages = (window.AstraLibrary && window.AstraLibrary.index) || [];
        lowered = null;
        lowering = [];
        resolve();
        listeners.forEach((fn) => fn());
      };
      if (typeof document === "undefined") return done();
      const s = document.createElement("script");
      s.src = "js/library/index.js";
      s.onload = done;
      s.onerror = done; /* without it, searching inside documents finds nothing, and everything else works */
      document.head.appendChild(s);
    });
    return loading;
  }

  const onIndex = (fn) => listeners.push(fn);

  function bytes(n) {
    if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
    return Math.max(1, Math.round(n / 1024)) + " KB";
  }

  /* A link that opens a document, at a page when the browser's PDF viewer supports it. */
  function docHref(doc, page) {
    return encodeURI(doc.file) + (page > 1 ? "#page=" + page : "");
  }

  /* Finds the page of a document containing `phrase` (a reference written as text, not a number,
     so it survives a document being replaced). Falls back to page 1. */
  function locate(docId, phrase) {
    const di = docIndex.get(docId);
    if (di === undefined || !phrase) return 1;
    const needle = norm(phrase);
    const pages = allPages();
    const lowered = low();
    for (let i = 0; i < pages.length; i++) {
      if (pages[i][0] === di && lowered[i].includes(needle)) return pages[i][1];
    }
    /* Not word for word (the document may have been replaced): use the best page for the words. */
    const best = searchPages(phrase, { docId, limit: 1 })[0];
    return best ? best.page : 1;
  }

  /* True when `phrase` appears word for word on some page of the document. */
  function hasExact(docId, phrase) {
    const di = docIndex.get(docId);
    const needle = norm(phrase);
    const lowered = low();
    return allPages().some((p, i) => p[0] === di && lowered[i].includes(needle));
  }

  /* ---------------------------------------------------------------- search */

  function terms(query) {
    return norm(query)
      .split(" ")
      .filter((t) => t.length > 1 || /\d/.test(t));
  }

  function snippet(text, ts) {
    const low = text.toLowerCase();
    let at = -1;
    for (const t of ts) {
      const i = low.indexOf(t);
      if (i !== -1 && (at === -1 || i < at)) at = i;
    }
    const start = Math.max(0, (at === -1 ? 0 : at) - 70);
    const end = Math.min(text.length, start + 260);
    /* Highlight in the plain text, then escape each piece, so a search word can never cut into an escaped
       character (searching "amp" or "mark" would otherwise break the markup). */
    const raw = text.slice(start, end);
    const words = ts.filter(Boolean).sort((a, b) => b.length - a.length);
    let out = "";
    let last = 0;
    if (words.length)
      for (const m of raw.matchAll(
        new RegExp(words.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi"),
      )) {
        out += esc(raw.slice(last, m.index)) + `<mark>${esc(m[0])}</mark>`;
        last = m.index + m[0].length;
      }
    out += esc(raw.slice(last));
    return (start > 0 ? "… " : "") + out + (end < text.length ? " …" : "");
  }

  /* Pages that contain every search word, best first. */
  const titleLow = new Map();
  const lowTitle = (doc) => {
    let t = titleLow.get(doc);
    if (t === undefined) titleLow.set(doc, (t = norm(doc.title)));
    return t;
  };

  function searchPages(query, { limit = 40, category = "", docId = "" } = {}) {
    /* Longest word first: it is usually the rarest, so pages without it are skipped soonest. */
    const ts = terms(query).sort((a, b) => b.length - a.length);
    if (!ts.length) return [];
    const phrase = norm(query);
    const hits = [];
    const pages = allPages();
    const lowered = low();
    for (let i = 0; i < pages.length; i++) {
      const doc = docs[pages[i][0]];
      if ((category && doc.category !== category) || (docId && doc.id !== docId)) continue;
      const text = lowered[i];
      let score = 0;
      let ok = true;
      for (const t of ts) {
        let n = 0;
        let from = 0;
        while ((from = text.indexOf(t, from)) !== -1) {
          n++;
          from += t.length;
          if (n >= 20) break;
        }
        if (!n) {
          ok = false;
          break;
        }
        score += 1 + Math.min(n, 10) * 0.4;
      }
      if (!ok) continue;
      if (ts.length > 1 && text.includes(phrase)) score += 6;
      if (lowTitle(doc).includes(phrase)) score += 2;
      hits.push({ doc, page: pages[i][1], score, i });
    }
    hits.sort((a, b) => b.score - a.score || a.i - b.i);
    return hits
      .slice(0, limit)
      .map((h) => ({ doc: h.doc, page: h.page, score: h.score, snippet: snippet(pages[h.i][2], ts) }));
  }

  /* Documents whose title, summary or tags match. */
  function searchDocs(query, { category = "" } = {}) {
    const ts = terms(query);
    return docs.filter((d) => {
      if (category && d.category !== category) return false;
      if (!ts.length) return true;
      const hay = norm(`${d.title} ${d.category} ${d.kind} ${d.summary} ${d.tags.join(" ")}`);
      return ts.every((t) => hay.includes(t));
    });
  }

  /* ----------------------------------------------------- rendering guides */

  /* Inline: **bold** and `code`. Input is escaped first, so nothing in a guide can inject markup.
     Code spans are lifted out before bold is applied, so `*77` inside **bold** is safe. */
  function inline(text) {
    const codes = [];
    const lifted = esc(text).replace(/`([^`]+)`/g, (_, c) => {
      codes.push(c);
      return `\u0000${codes.length - 1}\u0000`;
    });
    return lifted
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(
        /\u0000(\d+)\u0000/g,
        (_, i) =>
          `<code class="copyable" data-action="copy-code" role="button" tabindex="0" title="Click to copy">${codes[i]}</code>`,
      );
  }

  /* Guide markup: "## heading", "- bullet", "1. step", "> note", "| table |" and blank lines. */
  function render(body) {
    const lines = String(body).split("\n");
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        i++;
      } else if (line.startsWith("## ")) {
        out.push(`<h3>${inline(line.slice(3))}</h3>`);
        i++;
      } else if (line.startsWith("> ")) {
        const buf = [];
        while (i < lines.length && lines[i].startsWith("> ")) buf.push(lines[i++].slice(2));
        out.push(`<blockquote>${buf.map(inline).join("<br>")}</blockquote>`);
      } else if (/^\d+\. /.test(line)) {
        const start = parseInt(line, 10);
        const items = [];
        while (i < lines.length && /^\d+\. /.test(lines[i])) items.push(lines[i++].replace(/^\d+\. /, ""));
        out.push(`<ol start="${start}">${items.map((t) => `<li>${inline(t)}</li>`).join("")}</ol>`);
      } else if (line.startsWith("- ")) {
        const items = [];
        while (i < lines.length && lines[i].startsWith("- ")) items.push(lines[i++].slice(2));
        out.push(`<ul>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</ul>`);
      } else if (line.startsWith("|")) {
        const rows = [];
        while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
        const cells = (r) =>
          r
            .replace(/^\|/, "")
            .replace(/\|\s*$/, "")
            .split(/\s\|\s|\|(?=\s)/)
            .map((c) => c.trim());
        const hasHead = rows.length > 1 && /^\|[\s:|-]+\|?$/.test(rows[1]);
        const head = hasHead ? cells(rows[0]) : null;
        const bodyRows = rows.slice(hasHead ? 2 : 0).map(cells);
        out.push(
          `<div class="kb-table"><table>${head ? `<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>` : ""}<tbody>${bodyRows
            .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
            .join("")}</tbody></table></div>`,
        );
      } else {
        const buf = [];
        while (i < lines.length && lines[i].trim() && !/^(## |> |\d+\. |- |\|)/.test(lines[i]))
          buf.push(lines[i++]);
        out.push(`<p>${buf.map(inline).join(" ")}</p>`);
      }
    }
    return out.join("");
  }

  /* The same guide as plain text, for copying into a ticket. */
  function plain(body) {
    return String(body)
      .split("\n")
      .filter((l) => !/^\|[\s:|-]+\|?$/.test(l))
      .map((l) =>
        l
          .replace(/^## /, "")
          .replace(/^> /, "")
          .replace(/^\|/, "")
          .replace(/\s*\|\s*$/, "")
          .replace(/\s\|\s/g, "  |  ")
          .replace(/\*\*([^*]+)\*\*/g, "$1")
          .replace(/`([^`]+)`/g, "$1"),
      )
      .join("\n");
  }

  return {
    docs,
    categories: LIB.categories,
    docById,
    docHref,
    locate,
    hasExact,
    searchPages,
    searchDocs,
    render,
    plain,
    bytes,
    hasLibrary: docs.length > 0,
    indexReady,
    loadIndex,
    onIndex,
    warm,
  };
})();
