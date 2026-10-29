/* Astra — offline service-desk workspace. No network requests; everything lives in localStorage. */
(function () {
  "use strict";

  const KEY = "astra.offline.fresh.v1";
  const SEED = window.AstraSeed;
  const SEED_KINDS = ["templates", "snippets", "workflows", "knowledge", "shortcuts"];
  /* The sidebar, in groups; Alt 1 to Alt 0 open the pages in this order. */
  const NAV = [
    ["", ["Home", "Triage"]],
    ["Write", ["Replies", "Templates"]],
    ["Find", ["Ask", "Knowledge", "Library"]],
    ["Tools", ["Workflows", "Toolkit"]],
    ["", ["Settings"]],
  ];
  const PAGES = NAV.flatMap(([, pages]) => pages);
  const KB_TYPES = ["Guide", "Example", "Fault", "How-to", "Reference"];
  const KB = window.AstraKB;
  const SLOTS = ["AM 08:00–13:00", "PM 13:00–18:00"];

  /* ------------------------------------------------------------------ helpers */

  const $ = (selector, root = document) => root.querySelector(selector);
  const uid = () =>
    crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
  const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const asList = (v) => (Array.isArray(v) ? v : []);
  const asText = (v, fallback = "") => (typeof v === "string" ? v : fallback);
  const asTags = (v) =>
    asList(v)
      .map((t) => String(t).trim())
      .filter(Boolean);
  const splitTags = (text) =>
    text
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

  const ESCAPES = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  };
  const esc = (s) => String(s ?? "").replace(/[&<>'"]/g, (c) => ESCAPES[c]);

  const pad = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  /* Formatted by hand, in the en-GB style: the browser's locale formatter costs a noticeable moment to start,
     and the clock is the first thing a new tab shows. */
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const longDate = (d) => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  const clockTime = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const shortDate = (d = new Date()) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  const stampTime = (d = new Date()) => `${shortDate(d)}, ${clockTime(d)}`;
  const dateFromInput = (value) => (value ? new Date(value + "T12:00:00") : new Date(NaN));
  const dateUK = (value) => (value ? longDate(dateFromInput(value)) : "");

  const host = (url) => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "Open link";
    }
  };

  const PLACEHOLDER = /\{\s*([^}]+?)\s*\}/g;
  const placeholders = (body) => [...new Set([...body.matchAll(PLACEHOLDER)].map((m) => m[1]))];
  /* {date}, {port_date}, {close_date}: a date box. Not {update_time}, which is a time. */
  const isDateKey = (k) => k === "date" || k.endsWith("_date");
  /* A template's first lines, with each detail it fills in shown as a small label rather than {braces}. */
  const previewHtml = (body) =>
    esc(body.replace(/\n+/g, " ")).replace(
      new RegExp(PLACEHOLDER.source, "g"),
      (_, key) => `<span class="ph">${key.replaceAll("_", " ")}</span>`,
    );
  /* A word and its plain stems: "closing" also finds "close", "dropping" "drop", "calls" "call". */
  const stems = (word) => {
    const out = [word];
    const bare = word.length > 4 ? word.replace(/(ing|ed|es|s)$/, "") : word;
    if (bare !== word) {
      out.push(bare);
      if (/([b-df-hj-np-tv-z])\1$/.test(bare)) out.push(bare.slice(0, -1));
    }
    return out;
  };
  /* Every word typed must appear somewhere in the item, in any order. */
  const textMatches = (x, query) => {
    const text = searchText(x);
    return query
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .every((word) => stems(word).some((w) => text.includes(w)));
  };
  const searchText = (x) =>
    [x.title, x.text, x.category, asList(x.tags).join(" "), x.body, x.summary, asList(x.steps).join(" ")]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

  /* Best matches first: words in the title count most, then whole words in the tags, then anywhere else. */
  const matchScore = (x, query) => {
    const title = asText(x.title || x.text).toLowerCase();
    const tags = asList(x.tags).join(" ").toLowerCase();
    let score = 0;
    for (const word of query.toLowerCase().split(/\s+/).filter(Boolean)) {
      if (new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(title)) score += 4;
      else if (title.includes(word)) score += 2;
      if (tags.includes(word)) score += 1;
    }
    return score;
  };

  /* ------------------------------------------------------------ data & storage */

  const normalTemplate = (t) => {
    t = isObject(t) ? t : {};
    return {
      id: asText(t.id) || uid(),
      title: asText(t.title, "Untitled template"),
      category: asText(t.category, "General"),
      tags: asTags(t.tags),
      favourite: !!t.favourite,
      useCount: Number(t.useCount) || 0,
      lastUsedAt: asText(t.lastUsedAt),
      body: asText(t.body),
    };
  };

  /* A quick line: a ready-made sentence that copies in one click. */
  const normalSnippet = (l) => {
    l = isObject(l) ? l : {};
    return {
      id: asText(l.id) || uid(),
      text: asText(l.text).slice(0, 2000),
      category: asText(l.category, "My lines"),
      shortcut: AstraExpand.valid(l.shortcut) ? l.shortcut.toLowerCase() : "",
      favourite: !!l.favourite,
      useCount: Number(l.useCount) || 0,
    };
  };

  const normalWorkflow = (w) => {
    w = isObject(w) ? w : {};
    return {
      id: asText(w.id) || uid(),
      title: asText(w.title, "Untitled workflow"),
      category: asText(w.category, "General"),
      tags: asTags(w.tags),
      steps: asList(w.steps).map(String).filter(Boolean),
      guide: asText(w.guide),
    };
  };

  const normalKnowledge = (k) => {
    k = isObject(k) ? k : {};
    return {
      id: asText(k.id) || uid(),
      title: asText(k.title, "Untitled item"),
      type: KB_TYPES.includes(k.type) ? k.type : "Guide",
      category: asText(k.category, "General"),
      tags: asTags(k.tags),
      summary: asText(k.summary),
      body: asText(k.body),
      rich: !!k.rich,
      quick: asText(k.quick),
      related: asList(k.related).filter((r) => typeof r === "string"),
      docs: asList(k.docs)
        .filter(isObject)
        .map((d) => ({
          id: asText(d.id),
          find: asText(d.find),
          page: Number(d.page) || 0,
          label: asText(d.label),
        }))
        .filter((d) => d.id),
    };
  };

  const normalShortcut = (s) => {
    s = isObject(s) ? s : {};
    let url = "https://";
    try {
      const parsed = new URL(asText(s.url));
      if (parsed.protocol === "https:") url = parsed.href;
    } catch {
      /* keep the placeholder */
    }
    const key = asText(s.key).slice(0, 1).toUpperCase();
    return {
      id: asText(s.id) || uid(),
      title: asText(s.title, "Shortcut"),
      url,
      key: /^[A-Z0-9]$/.test(key) ? key : "",
    };
  };

  const NORMALISE = {
    templates: normalTemplate,
    snippets: normalSnippet,
    workflows: normalWorkflow,
    knowledge: normalKnowledge,
    shortcuts: normalShortcut,
  };

  const shortcutHref = (url) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" ? parsed.href : "#";
    } catch {
      return "#";
    }
  };

  const seedKey = (kind, item) => `${kind}:${item.id}`;

  /* Personal fields kept when a built-in item is updated to newer wording. */
  const PERSONAL = {
    templates: ["favourite", "useCount", "lastUsedAt"],
    snippets: ["favourite", "useCount"],
  };

  /* Adds built-in items this workspace has not been offered yet; items the user deleted stay deleted.
     Built-in items nobody has edited (they still match a past built-in version) are brought up to date, and ones
     that are no longer built in are removed. Anything the user changed is left exactly as it is. */
  let seedChanged = false;
  function mergeSeed(s) {
    const seen = new Set(s.seenSeed);
    const history = SEED.history || {};
    const FP = window.AstraFingerprint;
    const unedited = (kind, item) => (history[seedKey(kind, item)] || []).includes(FP.of(kind, item));
    for (const kind of SEED_KINDS) {
      const current = new Set(SEED[kind].map((item) => item.id));
      for (const item of SEED[kind]) {
        const key = seedKey(kind, item);
        const at = s[kind].findIndex((x) => x.id === item.id);
        if (!seen.has(key)) {
          seen.add(key);
          if (at === -1) {
            s[kind].push(NORMALISE[kind](structuredClone(item)));
            seedChanged = true;
          }
        } else if (
          at !== -1 &&
          FP.of(kind, s[kind][at]) !== FP.of(kind, item) &&
          unedited(kind, s[kind][at])
        ) {
          const fresh = NORMALISE[kind](structuredClone(item));
          for (const f of PERSONAL[kind] || []) fresh[f] = s[kind][at][f];
          s[kind][at] = fresh;
          seedChanged = true;
        }
      }
      const kept = s[kind].filter(
        (x) => current.has(x.id) || !history[seedKey(kind, x)] || !unedited(kind, x),
      );
      if (kept.length !== s[kind].length) seedChanged = true;
      s[kind] = kept;
    }
    s.seenSeed = [...seen];
    return s;
  }

  const AI_DEFAULTS = { enabled: false, model: "" };

  /* The local assistant stays off until it is switched on. Older settings for a cloud address or key are dropped. */
  const normalAI = (a) => {
    a = isObject(a) ? a : {};
    const model = /^[\w.-]{1,80}$/.test(asText(a.model).trim()) ? asText(a.model).trim() : "";
    return {
      enabled: a.enabled === true && model !== "",
      model,
    };
  };

  /* Questions Astra could not answer. Kept on this device so you can see which guides are worth writing. */
  const GAP_WHY = ["none", "weak", "unhelpful"];
  const normalGaps = (list) =>
    asList(list)
      .filter(isObject)
      .map((g) => ({
        q: asText(g.q).trim().slice(0, 200),
        why: GAP_WHY.includes(g.why) ? g.why : "none",
        n: Math.max(1, Math.min(999, Math.floor(Number(g.n)) || 1)),
        at: asText(g.at).slice(0, 30),
      }))
      .filter((g) => g.q)
      .slice(0, 100);

  const gapKey = (q) =>
    q
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  function logGap(question, why) {
    const q = AstraAssistant.redact(question).trim().slice(0, 200);
    if (!q) return false;
    const found = state.gaps.find((g) => gapKey(g.q) === gapKey(q));
    if (found) {
      found.n = Math.min(999, found.n + 1);
      found.at = new Date().toISOString();
      if (why === "unhelpful") found.why = why;
    } else state.gaps.unshift({ q, why, n: 1, at: new Date().toISOString() });
    state.gaps = state.gaps.slice(0, 100);
    save();
    return true;
  }

  const defaults = () => ({
    version: 2,
    ai: { ...AI_DEFAULTS },
    profile: { ...SEED.profile },
    settings: { privacyOnHide: false, zohoShortcuts: false, setupDone: false },
    templates: [],
    snippets: [],
    workflows: [],
    knowledge: [],
    shortcuts: [],
    seenSeed: [],
    activity: [],
    gaps: [],
    updatedAt: new Date().toISOString(),
  });

  /* Turns anything stored or imported into a safe, complete workspace. */
  function hydrate(raw) {
    const x = isObject(raw) ? raw : {};
    const d = defaults();
    const s = {
      ...d,
      profile: Object.fromEntries(
        Object.entries(d.profile).map(([k, v]) => [
          k,
          isObject(x.profile) && k in x.profile ? asText(x.profile[k]).slice(0, 80) : v,
        ]),
      ),
      settings: {
        privacyOnHide: isObject(x.settings) ? x.settings.privacyOnHide === true : d.settings.privacyOnHide,
        zohoShortcuts: isObject(x.settings) && x.settings.zohoShortcuts === true,
        /* Only a brand-new workspace sees first-run setup; one saved or imported before it existed has been set up. */
        setupDone: raw == null ? false : !isObject(x.settings) || x.settings.setupDone !== false,
      },
      activity: asList(x.activity)
        .filter(isObject)
        .slice(0, 30)
        .map((a) => ({
          id: asText(a.id).slice(0, 80) || uid(),
          title: asText(a.title).slice(0, 120),
          text: asText(a.text).slice(0, 4000),
          customer: asText(a.customer).slice(0, 200),
          ticket: asText(a.ticket).slice(0, 200),
          at: asText(a.at).slice(0, 30),
        })),
      gaps: normalGaps(x.gaps),
      updatedAt: asText(x.updatedAt, d.updatedAt),
      ai: normalAI(x.ai),
    };
    for (const kind of SEED_KINDS) s[kind] = asList(x[kind]).map(NORMALISE[kind]);
    /* A workspace saved before built-in items were tracked is assumed to have been offered the first release's items. */
    s.seenSeed = Array.isArray(x.seenSeed)
      ? x.seenSeed.filter((k) => typeof k === "string")
      : raw == null
        ? []
        : SEED.baseline || [];
    return mergeSeed(s);
  }

  function load() {
    try {
      const stored = localStorage.getItem(KEY);
      return hydrate(stored ? JSON.parse(stored) : null);
    } catch {
      return hydrate(null);
    }
  }

  let state = load();
  /* Built-in content was added or updated while loading: store it now, not at the next edit. */
  const savedBefore = (() => {
    try {
      return localStorage.getItem(KEY) !== null;
    } catch {
      return false;
    }
  })();
  let page = "Home";
  let searchMode = "Google";
  let filter = "";
  let categoryFilter = "";
  let lastFocus = null;
  let repaint = null;

  const app = $("#app");
  const modalLayer = $("#modalLayer");
  const modal = $("#modal");
  /* Details templates and quick lines fill in by themselves: your own, today's date, and those found in the email
     triaged last. Anything else is asked for when the line or template is copied. Nothing is kept about customers. */

  /* How an email greets someone: "Priya" from "Priya Shah", "Mr Shah" from "Mr Priya Shah". */
  function firstName(name) {
    const words = String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!words.length) return "";
    if (/^(mr|mrs|ms|miss|mx|dr)\.?$/i.test(words[0]))
      return words.length > 1 ? `${words[0]} ${words[words.length - 1]}` : "";
    return words[0];
  }

  function emailValues() {
    const t = AstraTriageView.latest() || {};
    return {
      customer: t.company || "",
      contact: firstName(t.name),
      ticket: (t.tickets || [])[0] || "",
      site: t.postcode || "",
      mobile: (t.contactPhones || [])[0] || "",
    };
  }

  const knownValues = () => ({
    ...emailValues(),
    my_name: state.profile.name,
    company: state.profile.company,
    today: longDate(new Date()),
  });

  const extensionId = window.chrome?.runtime?.id || "";
  /* The key that opens Astra Lite, as set in the browser (it can be changed there, or left unset). */
  let liteKey = "";
  window.chrome?.commands
    ?.getAll?.()
    .then(
      (all) =>
        (liteKey = (all.find((c) => c.name === "_execute_action")?.shortcut || "").replaceAll("+", " ")),
    )
    .catch(() => {});
  function save() {
    state.updatedAt = new Date().toISOString();
    try {
      const text = JSON.stringify(state);
      localStorage.setItem(KEY, text);
      $("#saveState").textContent = "Saved " + clockTime();
      shareShortcuts();
    } catch {
      toast("Could not save. Export a backup now.");
    }
  }

  /* With shortcuts on in Zoho Desk, the lines and your details are kept where the extension's
     script on Zoho's pages can read them (the extension's own storage, on this computer). Off, they are removed. */
  const SHORTCUT_KEY = "astra.shortcuts";
  let sharedShortcuts = "";
  function shareShortcuts() {
    const store = window.chrome?.storage?.local;
    if (!store || !extensionId) return;
    if (!state.settings.zohoShortcuts) {
      if (sharedShortcuts !== "off") store.remove(SHORTCUT_KEY).catch(() => {});
      sharedShortcuts = "off";
      return;
    }
    const data = { lines: AstraExpand.linesOf(state.snippets), values: lineValues() };
    const text = JSON.stringify(data);
    if (text === sharedShortcuts) return;
    sharedShortcuts = text;
    store.set({ [SHORTCUT_KEY]: data }).catch(() => {});
  }

  /* ------------------------------------------------------------ small UI bits */

  function toast(text) {
    const el = $("#toast");
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  async function copy(text, message = "Copied to clipboard") {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.cssText = "position:fixed;opacity:0";
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    toast(message);
  }

  function openModal(html, wide = false) {
    lastFocus = document.activeElement;
    modal.className = "modal" + (wide ? " wide" : "");
    modal.innerHTML = html;
    modalLayer.classList.add("open");
    setTimeout(() => {
      const first =
        $(".modal-body input, .modal-body textarea, .modal-body select", modal) ||
        $(".primary-btn", modal) ||
        $("button", modal);
      modal.scrollTop = 0;
      first?.focus({ preventScroll: true });
    }, 0);
  }

  function closeModal() {
    if (!modalLayer.classList.contains("open")) return;
    modalLayer.classList.remove("open");
    modal.innerHTML = "";
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
    lastFocus = null;
  }

  const modalHead = (title, sub = "", tag = "") =>
    `<div class="modal-head"><div>${tag ? `<span class="tag">${esc(tag)}</span>` : ""}<h2 id="modalTitle">${esc(title)}</h2>${
      sub ? `<p>${esc(sub)}</p>` : ""
    }</div><button type="button" class="icon-btn" data-action="close" aria-label="Close">×</button></div>`;

  function confirmDelete(label, onConfirm) {
    if (confirm(`Delete this ${label}? Export a backup first if you may need it later.`)) onConfirm();
  }

  /* --------------------------------------------------------------- navigation */

  function renderNav() {
    const btn = (n) =>
      `<button class="nav-btn ${page === n ? "active" : ""}" data-action="page" data-id="${n}"${
        page === n ? ' aria-current="page"' : ""
      }>${n}</button>`;
    $("#nav").innerHTML = NAV.map(([label, pages]) =>
      label
        ? `<div class="nav-group" role="group" aria-labelledby="nav-${label}"><span class="nav-label" id="nav-${label}">${label}</span>${pages.map(btn).join("")}</div>`
        : `<div class="nav-group">${pages.map(btn).join("")}</div>`,
    ).join("");
    $("#pageTitle").textContent = page;
  }

  function go(next) {
    page = next;
    filter = "";
    categoryFilter = "";
    closeModal();
    $("#sidebar").classList.remove("open");
    render();
    scrollTo(0, 0);
  }

  /* Redrawing a page replaces its elements. Whatever had focus, and anything typed into a field that is drawn
     again, comes back, so keyboard users are not thrown to the top and nothing typed is lost. */
  function keep(fn) {
    const old = document.activeElement;
    const sig =
      old && old !== document.body
        ? old.id
          ? "#" + CSS.escape(old.id)
          : old.dataset && old.dataset.action
            ? `[data-action="${CSS.escape(old.dataset.action)}"]` +
              (old.dataset.id ? `[data-id="${CSS.escape(old.dataset.id)}"]` : "") +
              (old.dataset.name ? `[data-name="${CSS.escape(old.dataset.name)}"]` : "")
            : ""
        : "";
    const typed = [
      ...app.querySelectorAll(
        "input[id]:not([type=radio]):not([type=checkbox]):not([type=file]), textarea[id]",
      ),
    ]
      .filter((el) => el.value)
      .map((el) => [el.id, el.value]);
    fn();
    for (const [id, value] of typed) {
      const el = document.getElementById(id);
      if (el && !el.value) el.value = value;
    }
    if (sig && (!document.activeElement || document.activeElement === document.body)) {
      const back = document.querySelector(sig);
      if (back) back.focus({ preventScroll: true });
    }
  }

  function render() {
    keep(draw);
  }

  function draw() {
    renderNav();
    const pages = {
      Home: homePage,
      Templates: templatesPage,
      Replies: repliesPage,
      Workflows: workflowsPage,
      Ask: () => AstraAsk.render(app),
      Triage: () => AstraTriageView.render(app),
      Knowledge: knowledgePage,
      Library: libraryPage,
      Toolkit: toolkitPage,
      Settings: settingsPage,
    };
    (pages[page] || homePage)();
    if (page === "Settings") fillAI();
    showTitle();
  }

  /* The top bar names the page only once the page's own heading has scrolled out of sight, so it is never shown
     twice. Pages without a heading (Home) always show it. */
  const topbar = document.querySelector(".topbar");
  function showTitle() {
    const head = app.querySelector(".page-head h2");
    topbar.classList.toggle("titled", !head || head.getBoundingClientRect().bottom < topbar.offsetHeight);
  }
  let titleFrame = 0;
  addEventListener(
    "scroll",
    () => {
      if (!titleFrame)
        titleFrame = requestAnimationFrame(() => {
          titleFrame = 0;
          showTitle();
        });
    },
    { passive: true },
  );

  const pageHead = (title, actions = "") =>
    `<div class="page-head"><h2>${title}</h2><div class="actions">${actions}</div></div>`;

  /* ------------------------------------------------------------------- search */

  function searchRows(query, perKind) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const match = (list) =>
      list
        .filter((x) => textMatches(x, q))
        .sort((x, y) => matchScore(y, q) - matchScore(x, q))
        .slice(0, perKind);
    /* A code, MAC address or IP address typed into search goes straight to the tool that explains it. */
    const tools = [
      ...AstraNet.lookup(query).map((e) => ({
        type: "Code",
        item: {
          id: `${e.kind === "SIP" ? "sip" : "cause"} ${e.code}`,
          title: `${e.kind} ${e.code} · ${e.name}`,
        },
        action: "open-tool",
        label: e.meaning,
      })),
    ];
    if (/\bloa\b|letter of authority|\bcloa\b/i.test(query))
      tools.push({
        type: "Form",
        item: { id: "loa", title: "Fill an LOA" },
        action: "fill-loa",
        label: "Letter of authority for porting, filled in from the last email",
      });
    if (/\b(rais\w* (a |the )?fault|fault (report|form)|log (a |the )?fault)\b/i.test(query))
      tools.push({
        type: "Form",
        item: { id: "horizon", title: "Raise a fault" },
        action: "raise-fault",
        label: "The report Gamma or Openreach need",
      });
    for (const [re, id, title, label] of [
      [/\bqr\b|qr code|wi-?fi code/i, "qrTool", "Make a QR code", "Web link, Wi-Fi, phone number or email"],
      [
        /\bpassword (maker|generator)|\b(make|new|random) (a )?(password|pin)\b|\bpin (maker|generator)/i,
        "pwTool",
        "Make a password or PIN",
        "Made on this computer, never saved",
      ],
      [
        /phonetic|spell (it |this )?out|nato/i,
        "spellTool",
        "Spell it out",
        "Letters in the phonetic alphabet, for reading out",
      ],
    ])
      if (re.test(query)) tools.push({ type: "Tool", item: { id, title }, action: "go-tool", label });
    if (/\bcrf\b|requirement form/i.test(query))
      tools.push({
        type: "Form",
        item: { id: "crf-request", title: "Copy the CRF email" },
        action: "form-email",
        label: "Download the CRF itself from Toolkit or the Library",
      });
    const number = AstraNumbers.lookup(query);
    if (number)
      tools.push({
        type: "Number",
        item: { id: query.trim(), title: number.national },
        action: "open-tool",
        label: number.valid
          ? [number.kind, number.area, number.network && `range given to ${number.network}`]
              .filter(Boolean)
              .join(" · ")
          : "Not a valid UK number",
      });
    const code = AstraNumbers.areaOf(query);
    if (code)
      tools.push({
        type: "Code",
        item: { id: query.trim(), title: `${query.trim()} is ${code}` },
        action: "open-tool",
        label: "UK dialling code",
      });
    const macOut = AstraNet.mac(query);
    if (macOut)
      tools.push({
        type: "MAC",
        item: { id: query.trim(), title: macOut.colons },
        action: "open-tool",
        label: "All formats",
      });
    const net = AstraNet.subnet(query);
    if (net)
      tools.push({
        type: "IP",
        item: { id: query.trim(), title: `${net.network}/${net.prefix}` },
        action: "open-tool",
        label: `${net.scope} · ${net.hosts.toLocaleString("en-GB")} usable addresses`,
      });
    const replies = AstraReplies.search(query, perKind).map((r) => ({
      type: "Reply",
      item: { id: r.situation.id + (r.stage ? "|" + r.stage : ""), title: r.situation.title },
      action: "open-replies",
      label: r.stage ? AstraReplies.stageById(r.stage).name : r.situation.group,
    }));
    /* Your systems, by name or address: "billing", "crm", "zoho", "gamma". */
    const sites = state.shortcuts
      .filter((x) => shortcutHref(x.url) !== "#")
      .filter((x) => `${x.title} ${host(x.url)}`.toLowerCase().includes(q))
      .slice(0, perKind)
      .map((x) => ({
        type: "Site",
        item: { id: x.id, title: x.title },
        href: shortcutHref(x.url),
        label: `${host(x.url)}${x.key ? ` · Alt ${x.key}` : ""}`,
      }));
    const lines = match(state.snippets).map((x) => ({
      type: "Line",
      item: { id: x.id, title: lineTitle(x) },
      action: "copy-line",
      label: `${x.category} · copies in one click`,
    }));
    const rows = [
      ...tools,
      ...sites,
      ...lines,
      ...replies,
      ...match(state.templates).map((x) => ({
        type: "Template",
        item: x,
        action: "use-template",
      })),
      ...match(state.workflows).map((x) => ({
        type: "Workflow",
        item: x,
        action: "run-workflow",
      })),
      ...match(state.knowledge).map((x) => ({
        type: x.type === "Fault" ? "Fault" : "Guide",
        item: x,
        action: "view-knowledge",
      })),
    ];
    /* Documents: by title first, then pages that contain the words. */
    if (KB.hasLibrary) {
      KB.searchDocs(query)
        .slice(0, 3)
        .forEach((d) =>
          rows.push({
            type: "Doc",
            item: d,
            href: KB.docHref(d, 1),
            label: d.category,
          }),
        );
      KB.searchPages(query, { limit: perKind }).forEach((h) =>
        rows.push({
          type: "Page",
          item: { id: h.doc.id, title: h.doc.title },
          href: KB.docHref(h.doc, h.page),
          label: `Page ${h.page}`,
          snippet: h.snippet,
        }),
      );
    }
    return rows;
  }

  const resultsHtml = (rows, emptyText) =>
    rows.length
      ? rows
          .map((r) => {
            const inner = `<span class="result-type">${r.type}</span><span><b>${esc(r.item.title)}</b><small>${
              r.snippet || esc(r.label ?? r.item.category)
            }</small></span><b aria-hidden="true">→</b>`;
            return r.href
              ? `<a class="result-row" href="${esc(r.href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`
              : `<button class="result-row" data-action="${r.action}" data-id="${esc(r.item.id)}">${inner}</button>`;
          })
          .join("")
      : `<div class="empty">${emptyText}</div>`;

  function showStartResults(query) {
    const box = $("#searchResults");
    if (!query.trim()) {
      box.className = "search-results";
      box.innerHTML = "";
      return;
    }
    box.innerHTML = resultsHtml(
      searchRows(query, 5),
      "No match. You can add it yourself in Templates, Workflows or Knowledge.",
    );
    box.className = "search-results show";
  }

  function runStartSearch() {
    const query = $("#startSearch")?.value.trim();
    if (!query) return;
    if (searchMode === "Google") {
      location.href = "https://www.google.com/search?q=" + encodeURIComponent(query);
    } else {
      showStartResults(query);
    }
  }

  /* ------------------------------------------------------------ LOA filler */

  /* The blank LOA is only loaded when the form is first opened. */
  let loaTemplate = null;
  const loadLoaTemplate = () =>
    (loaTemplate ||= new Promise((resolve, reject) => {
      if (window.AstraForms?.loaDocx) return resolve();
      const s = document.createElement("script");
      s.src = "js/forms/loa-template.js";
      s.onload = resolve;
      s.onerror = () => reject(new Error("The LOA template is missing."));
      document.head.appendChild(s);
    }));

  const POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

  /* ------------------------------------------------------- supplier fault reports */

  /* What the supplier needs, gathered once and copied as text for their fault form (see faults.js for the rules).
     Kept until another email is triaged. */
  const F = window.AstraFaults;
  let fault = null;
  function faultDraft(kind) {
    const t = AstraTriageView.latest() || {};
    if (!fault || fault.from !== t.summary) {
      const handset = (t.models || [])[0] || "";
      fault = {
        from: t.summary,
        kind: "horizon",
        problem: t.summary || "",
        quality: false,
        access: "",
        codec: "",
        examples: Array.from({ length: F.MIN_EXAMPLES }, (_, i) => ({
          when: (t.times || [])[i] ? `${(t.times || [])[i]}` : "",
          from: "",
          to: "",
          handset,
          what: "",
        })),
        checks: [],
        charges: false,
        lights: "",
        result: "",
        siteAccess: "",
        number: "",
        notes: "",
      };
    }
    if (kind) fault.kind = kind;
    return fault;
  }

  function faultReport() {
    const f = fault;
    const e = emailValues();
    const base = { ref: e.ticket, customer: e.customer, site: e.site, problem: f.problem };
    return f.kind === "horizon"
      ? F.horizon({
          ...base,
          examples: f.examples,
          quality: f.quality,
          access: f.access,
          codec: f.codec,
          notes: f.notes,
        })
      : F.line({
          ...base,
          number: f.number,
          checks: f.checks,
          charges: f.charges,
          lights: f.lights,
          result: f.result,
          access: f.siteAccess,
        });
  }

  function faultFormHtml() {
    const f = fault;
    const input = (key, label, value, attrs = "") =>
      `<label class="field"><span>${label}</span><input data-fault="${key}" value="${esc(value)}" autocomplete="off" ${attrs}></label>`;
    if (f.kind === "horizon")
      return `${input("problem", "What is wrong", f.problem, 'placeholder="e.g. calls drop after 30 seconds"')}
        <label class="check-line"><input type="checkbox" data-fault="quality" ${f.quality ? "checked" : ""}> <span>A call quality fault (choppy, robotic, one-way, echo)</span></label>
        ${
          f.quality
            ? `<div class="fields cols-2">${input("access", "Your access investigation", f.access, 'placeholder="Packet loss, jitter and latency on the line"')}${input("codec", "Codec in use", f.codec, 'placeholder="e.g. G.711"')}</div>`
            : ""
        }
        <h4 class="fault-sub">Call examples <span class="muted">at least ${F.MIN_EXAMPLES}</span></h4>
        <div class="fault-examples">${f.examples
          .map(
            (e, i) =>
              `<fieldset class="fault-example"><legend>Call ${i + 1}</legend><div class="fields cols-3">${F.EXAMPLE_FIELDS.map(
                ([k, label]) =>
                  `<label class="field"><span>${label}</span><input data-fault-example="${i}" data-key="${k}" value="${esc(e[k])}" autocomplete="off"${
                    k === "from" || k === "to" ? ' inputmode="tel"' : ""
                  }></label>`,
              ).join("")}</div>${
                f.examples.length > F.MIN_EXAMPLES
                  ? `<button type="button" class="link-btn quiet" data-action="fault-drop" data-id="${i}">Remove call ${i + 1}</button>`
                  : ""
              }</fieldset>`,
          )
          .join("")}</div>
        <button type="button" class="secondary-btn" data-action="fault-add">Add another call</button>
        ${input("notes", "Anything else for Gamma (optional)", f.notes)}`;
    return `${input("problem", "What is wrong", f.problem, 'placeholder="e.g. no dial tone, broadband down"')}
      ${input("number", "Line or service", f.number, 'placeholder="Phone number or broadband reference"')}
      <fieldset class="fault-checks"><legend>First-line checks done with the customer</legend>${F.LINE_CHECKS.map(
        (c) =>
          `<label class="check-line"><input type="checkbox" data-fault-check="${c.id}" ${f.checks.includes(c.id) ? "checked" : ""}> <span>${esc(c.label)}</span></label>`,
      ).join("")}</fieldset>
      <div class="fields cols-2">${input("lights", "Router lights", f.lights, 'placeholder="e.g. sync on, PPP off"')}${input("result", "What the checks showed", f.result)}</div>
      ${input("siteAccess", "Site access and contact for an engineer", f.siteAccess)}
      <label class="check-line fault-charges"><input type="checkbox" data-fault="charges" ${f.charges ? "checked" : ""}> <span><b>The customer accepts</b> that ${esc(F.CHARGES)}. Our T&Cs (4.2) need this before a fault goes to Openreach.</span></label>`;
  }

  function paintFault() {
    const out = faultReport();
    const preview = $("#faultPreview");
    if (preview) preview.value = out.text;
    const box = $("#faultMissing");
    if (box) {
      box.hidden = !out.missing.length;
      box.textContent = out.missing.length ? `Still needed: ${out.missing.join("; ")}.` : "";
    }
  }

  function showFault(kind) {
    faultDraft(kind);
    const tab = (id, name) =>
      `<button type="button" class="${fault.kind === id ? "on" : ""}" aria-pressed="${fault.kind === id}" data-action="fault-kind" data-id="${id}">${name}</button>`;
    openModal(
      modalHead("Raise a fault") +
        `<div class="modal-body fault-body"><div class="segmented" role="group" aria-label="Kind of fault">${tab("horizon", "Horizon call fault")}${tab("line", "Broadband or phone line")}</div>
          <div class="fault-form" id="faultForm">${faultFormHtml()}</div>
          <p class="hint warn" id="faultMissing" aria-live="polite" hidden></p>
          <label class="field"><span>For the supplier's fault form</span><textarea id="faultPreview" rows="12" readonly></textarea></label>
        </div>
        <div class="modal-foot"><div></div><div><button class="primary-btn" data-action="fault-copy">Copy report</button></div></div>`,
      true,
    );
    paintFault();
  }

  /* Typing in the fault form updates the report in place: the form is not rebuilt under the cursor. */
  modal.addEventListener("input", (e) => {
    if (!fault) return;
    const el = e.target;
    if (el.dataset.fault && el.type !== "checkbox") fault[el.dataset.fault] = el.value;
    else if (el.dataset.faultExample !== undefined)
      fault.examples[Number(el.dataset.faultExample)][el.dataset.key] = el.value;
    else return;
    paintFault();
  });
  modal.addEventListener("change", (e) => {
    if (!fault) return;
    const el = e.target;
    if (el.dataset.faultCheck) {
      fault.checks = el.checked
        ? [...new Set([...fault.checks, el.dataset.faultCheck])]
        : fault.checks.filter((c) => c !== el.dataset.faultCheck);
    } else if (el.dataset.fault === "quality") {
      fault.quality = el.checked;
      $("#faultForm").innerHTML = faultFormHtml();
    } else if (el.dataset.fault === "charges") fault.charges = el.checked;
    else return;
    paintFault();
  });

  function fillLoa() {
    const t = AstraTriageView.latest() || {};
    const site = (t.postcode || "").trim();
    const sitePostcode = POSTCODE.test(site) ? site.toUpperCase() : t.postcode || "";
    const f = (id, label, value = "", attrs = "") =>
      `<label class="field"><span>${label}</span><input id="${id}" value="${esc(value)}" autocomplete="off" ${attrs}></label>`;
    const providers = AstraLOA.PROVIDERS.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join(
      "",
    );
    openModal(
      modalHead(
        "Letter of authority",
        "Fill in what you know; anything left blank stays blank for the customer.",
      ) +
        `<div class="modal-body loa-form">
        <h3>Losing provider</h3>
        <div class="fields cols-2"><label class="field"><span>Provider</span><select id="loaProvider"><option value="">Choose the losing provider</option>${providers}<option value="other">Another provider</option></select></label>${f("loaCurrentName", "Name on the form")}
          ${f("loaCurrentAddress", "Address")}${f("loaCurrentEmail", "Contact email")}
          ${f("loaNewEmail", "New provider contact email (optional)")}</div>
        <h3>Site address</h3>
        <div class="fields cols-2">${f("loaBuilding", "Building name or number", POSTCODE.test(site) ? "" : site)}${f("loaStreet", "Street")}${f("loaTown", "Town or city")}${f("loaCounty", "County")}${f("loaPostcode", "Postcode", sitePostcode)}</div>
        <h3>Numbers to port</h3>
        <div class="fields cols-2"><label class="field"><span>One per line</span><textarea id="loaNumbers" rows="5" spellcheck="false">${esc((t.numbers || []).join("\n"))}</textarea></label><div><label class="field"><span>Main billing number, if known</span><input id="loaMbn" autocomplete="off"></label><p class="hint" id="loaNumberCheck" aria-live="polite"></p></div></div>
        <h3>Company, as on the latest bill</h3>
        <div class="fields cols-2">${f("loaCompany", "Company name", t.company || "")}${f("loaRegNo", "Company registration number")}${f("loaAccountNo", "Billing account number (non-geographic only)")}</div>
        <label class="check-line"><input type="checkbox" id="loaSameAddress" checked> <span>Billing address is the same as the site address</span></label>
        <div class="fields cols-2" id="loaBilling" hidden>${f("loaBillingAddress", "Billing address")}${f("loaBillingTown", "Town or city")}${f("loaBillingCounty", "County")}${f("loaBillingPostcode", "Postcode")}</div>
        <h3>Customer signing</h3>
        <div class="fields cols-2">${f("loaRequester", "Name", t.name || "")}${f("loaJob", "Job title")}${f("loaRequesterEmail", "Email", t.email || "", 'type="email"')}${f("loaDate", "Date (leave blank for the customer)", "", 'type="date"')}</div>
        </div><div class="modal-foot"><div class="foot-left"><button type="button" class="secondary-btn" id="loaEmail">Copy email</button></div><div><button class="secondary-btn" data-action="close">Cancel</button><button class="primary-btn" id="loaDownload">Download LOA</button></div></div>`,
      true,
    );
    const $m = (id) => $("#" + id, modal);
    $m("loaProvider").onchange = (e) => {
      const p = AstraLOA.PROVIDERS.find((x) => x.id === e.target.value);
      $m("loaCurrentName").value = p ? p.name : "";
      $m("loaCurrentAddress").value = p ? p.address : "";
      $m("loaCurrentEmail").value = p ? p.email : "";
      if (e.target.value === "other") $m("loaCurrentName").focus();
    };
    if (t.provider && AstraLOA.PROVIDERS.some((x) => x.id === t.provider)) {
      $m("loaProvider").value = t.provider;
      $m("loaProvider").onchange({ target: $m("loaProvider") });
    }
    /* The email greets the person signing, or the company, and the form stays open. */
    $m("loaEmail").onclick = () => {
      const t = state.templates.find((x) => x.id === "loa-request");
      if (!t) return toast("That email template has been deleted. Add it again in Templates.");
      const who = $m("loaRequester").value.trim().split(/\s+/)[0] || $m("loaCompany").value.trim();
      const known = knownValues();
      copy(
        t.body.replace(PLACEHOLDER, (_, k) =>
          k === "customer" || k === "contact" ? who || "there" : known[k] || `[${k}]`,
        ),
        "Email copied",
      );
    };
    $m("loaSameAddress").onchange = (e) => ($m("loaBilling").hidden = e.target.checked);
    const numbers = () =>
      $m("loaNumbers")
        .value.split(/[\n,;]+/)
        .map((n) => n.trim())
        .filter(Boolean);
    const checkNumbers = () => {
      const list = numbers();
      const bad = list.filter((n) => !AstraTriage.ukPhone(n));
      $m("loaNumberCheck").textContent = !list.length
        ? "No numbers yet."
        : `${list.length} number${list.length === 1 ? "" : "s"}${bad.length ? `. Check: ${bad.join(", ")}` : ", all valid UK numbers."}${
            list.length > AstraLOA.PAGE1_NUMBERS
              ? ` The first ${AstraLOA.PAGE1_NUMBERS} go on page 1, the rest on the continuation sheet.`
              : ""
          }`;
    };
    $m("loaNumbers").addEventListener("input", checkNumbers);
    checkNumbers();
    $m("loaDownload").onclick = async () => {
      const button = $m("loaDownload");
      const list = numbers().map((n) => AstraTriage.ukPhone(n) || n);
      const same = $m("loaSameAddress").checked;
      const v = (id) => $m(id).value.trim();
      const dateValue = v("loaDate");
      const values = {
        currentName: v("loaCurrentName"),
        currentAddress: v("loaCurrentAddress"),
        currentEmail: v("loaCurrentEmail"),
        newEmail: v("loaNewEmail"),
        building: v("loaBuilding"),
        street: v("loaStreet"),
        town: v("loaTown"),
        county: v("loaCounty"),
        postcode: v("loaPostcode").toUpperCase(),
        numbers: list,
        mbn: AstraTriage.ukPhone(v("loaMbn")) || v("loaMbn"),
        company: v("loaCompany"),
        billingAddress: same
          ? [v("loaBuilding"), v("loaStreet")].filter(Boolean).join(", ")
          : v("loaBillingAddress"),
        billingTown: same ? v("loaTown") : v("loaBillingTown"),
        billingCounty: same ? v("loaCounty") : v("loaBillingCounty"),
        billingPostcode: (same ? v("loaPostcode") : v("loaBillingPostcode")).toUpperCase(),
        regNo: v("loaRegNo"),
        accountNo: v("loaAccountNo"),
        requesterName: v("loaRequester"),
        jobTitle: v("loaJob"),
        requesterEmail: v("loaRequesterEmail"),
        date: dateValue ? shortDate(dateFromInput(dateValue)) : "",
      };
      if (!values.company) {
        $m("loaCompany").classList.add("invalid");
        $m("loaCompany").focus();
        return toast("Enter the company name");
      }
      button.disabled = true;
      try {
        await loadLoaTemplate();
        const blob = await AstraLOA.build(values);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `LOA - ${AstraAudio.safeName(values.company) || "customer"}.docx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        closeModal();
        toast("LOA downloaded");
      } catch (err) {
        toast(err.message || "The LOA could not be created");
      } finally {
        button.disabled = false;
      }
    };
  }

  /* The email that goes with a form, from the (editable) template of the same name, with what is known filled in. */
  function formEmail(id) {
    const t = state.templates.find((x) => x.id === id);
    if (!t) return toast("That email template has been deleted. Add it again in Templates.");
    const known = knownValues();
    if (placeholders(t.body).some((k) => !known[k])) return useTemplate(id);
    copy(
      t.body.replace(PLACEHOLDER, (_, k) => known[k]),
      "Email copied",
    );
  }

  function showKeys() {
    const row = (keys, what) =>
      `<tr><td>${keys.map((k) => `<kbd>${esc(k)}</kbd>`).join(" ")}</td><td>${esc(what)}</td></tr>`;
    const pages = PAGES.map((p, i) => {
      const key = String((i + 1) % 10);
      return state.shortcuts.some((x) => x.key === key) ? "" : row([`Alt ${key}`], p);
    }).join("");
    const portals = state.shortcuts
      .filter((s) => s.key)
      .map((s) => row([`Alt ${s.key}`], s.title))
      .join("");
    openModal(
      modalHead("Keyboard shortcuts") +
        `<div class="modal-body"><table class="keys-table"><tbody>
        ${row(["Ctrl K"], "Search everything")}
        ${liteKey ? row([liteKey], "Astra Lite, on top of any page") : ""}
        ${row(["/"], "Search on Home")}
        ${row(["Ctrl Enter"], "Triage the pasted email")}
        ${row(["Enter"], "Ask the question")}
        ${row(["Esc"], "Close a window")}
        ${row(["?"], "This list")}
        ${pages}${portals}</tbody></table></div>`,
    );
  }

  /* Up and Down move through the results; Enter opens the one marked, or the first. */
  function resultKeys(input, box, enter = null) {
    let at = -1;
    const rows = () => [...box.querySelectorAll(".result-row")];
    const mark = () => {
      rows().forEach((r, i) => {
        r.id = `${box.id}-${i}`;
        r.classList.toggle("active", i === at);
      });
      if (at >= 0) input.setAttribute("aria-activedescendant", `${box.id}-${at}`);
      else input.removeAttribute("aria-activedescendant");
    };
    input.addEventListener("input", () => {
      at = -1;
      input.removeAttribute("aria-activedescendant");
    });
    input.addEventListener("keydown", (e) => {
      const list = rows();
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && list.length) {
        e.preventDefault();
        at = e.key === "ArrowDown" ? Math.min(list.length - 1, at + 1) : Math.max(0, at - 1);
        mark();
        list[at].scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter" && !e.isComposing) {
        if (enter && at < 0) return enter(e);
        if (!list.length) return;
        e.preventDefault();
        (list[at] || list[0]).click();
      }
    });
  }

  function globalSearch() {
    openModal(
      modalHead("Find anything") +
        `<div class="modal-body"><input class="search-input full" id="globalSearchInput" role="combobox" aria-expanded="true" aria-controls="globalResults" aria-autocomplete="list" aria-label="Search Astra" placeholder="Templates, quick lines, guides, documents, numbers" autocomplete="off"><div class="search-results show mt" id="globalResults" role="listbox"><div class="empty">Start typing.</div></div></div>`,
    );
    const input = $("#globalSearchInput");
    const box = $("#globalResults");
    /* Focused at once, so the first letter typed after Ctrl K is not lost. */
    input.focus();
    resultKeys(input, box);
    /* Typing faster than the search can run only searches for the latest text. */
    let queued = 0;
    input.addEventListener("input", () => {
      cancelAnimationFrame(queued);
      queued = requestAnimationFrame(showResults);
    });
    function showResults() {
      const q = input.value.trim();
      const askRow = q
        ? `<button class="result-row" data-action="ask-from-search" data-q="${esc(q)}"><span class="result-type">Ask</span><span><b>Ask Astra: ${esc(q)}</b><small>An answer from the guides and documents</small></span><b aria-hidden="true">→</b></button>`
        : "";
      box.innerHTML = resultsHtml(searchRows(q, 5), q ? "No match." : "Start typing.") + askRow;
    }
  }

  /* --------------------------------------------------------------------- home */

  /* What was copied, newest first, each one click from the clipboard again. Kept on this computer only. */
  function noteCopy(title, text) {
    state.activity.unshift({
      id: uid(),
      title: String(title).slice(0, 120),
      text: String(text).slice(0, 4000),
      at: new Date().toISOString(),
    });
    state.activity = state.activity.slice(0, 30);
  }

  function recentCopiesHtml() {
    const recent = state.activity.slice(0, 6);
    return recent.length
      ? recent
          .map((a) => {
            const inner = `<b>${esc(a.title)}</b><small>${esc(relativeTime(a.at))}</small>`;
            return a.text
              ? `<button class="activity-item" data-action="recopy" data-id="${esc(a.id)}" title="Copy again">${inner}</button>`
              : `<div class="activity-item">${inner}</div>`;
          })
          .join("")
      : '<span class="muted">Nothing copied yet.</span>';
  }

  /* Quick lines on Home: the starred ones, or any line that matches what is typed, each one click from the clipboard. */
  function homeLinesHtml(query = "") {
    const q = query.trim().toLowerCase();
    const list = q
      ? state.snippets
          .filter((l) => textMatches(l, q))
          .sort((a, b) => matchScore(b, q) - matchScore(a, q))
          .slice(0, 14)
      : state.snippets.filter((l) => l.favourite).slice(0, 14);
    return list.length
      ? list
          .map(
            (l) =>
              `<button class="home-line" data-action="copy-line" data-id="${esc(l.id)}"><span>${previewHtml(l.text)}</span>${
                l.shortcut ? `<kbd class="line-key">${esc(l.shortcut)}</kbd>` : ""
              }<em class="line-done" aria-hidden="true">Copied</em></button>`,
          )
          .join("")
      : `<p class="muted home-lines-empty">${q ? "No line matches." : "Star quick lines on the Templates page to keep them here."}</p>`;
  }

  function homePage() {
    const now = new Date();
    const pinned = state.templates.filter((t) => t.favourite).slice(0, 7);
    const sysLinks = state.shortcuts
      .map(
        (s) =>
          `<a class="quick-link" href="${esc(shortcutHref(s.url))}" target="_blank" rel="noopener noreferrer"><span><b>${esc(
            s.title,
          )}</b><small>${esc(host(s.url))}</small></span>${s.key ? `<kbd>Alt ${esc(s.key)}</kbd>` : ""}</a>`,
      )
      .join("");

    app.innerHTML = `
      <div class="home-top">
        <div class="home-clock"><div class="big-time" id="clock">${clockTime(now)}</div><div class="date-label">${longDate(now)}</div></div>
        <div class="search-wrap">
          <div class="start-search">
            <div class="search-toggle" role="group" aria-label="Search where">
              <button class="${searchMode === "Google" ? "active" : ""}" aria-pressed="${searchMode === "Google"}" data-action="mode" data-id="Google">Google</button>
              <button class="${searchMode === "Astra" ? "active" : ""}" aria-pressed="${searchMode === "Astra"}" data-action="mode" data-id="Astra">Astra</button>
            </div>
            <input id="startSearch" aria-label="Search" autocomplete="off" placeholder="${
              searchMode === "Google" ? "Search Google" : "Find a template, workflow or guide"
            }">
            <button class="secondary-btn" data-action="run-search">Search</button>
          </div>
          <div class="search-results" id="searchResults"></div>
        </div>
      </div>
      <div class="dash">
        <section class="card card-pad home-lines-card" aria-labelledby="linesHeading">
          <div class="section-title"><h3 id="linesHeading">Quick lines</h3><button data-action="quick-lines">All lines</button></div>
          <input class="search-input full" id="homeLineFilter" aria-label="Find a quick line" placeholder="Find a line, e.g. close 5pm" autocomplete="off">
          <div class="home-lines" id="homeLines">${homeLinesHtml()}</div>
        </section>
        <div class="grid">
          <section class="card card-pad">
            <form class="home-triage" id="homeTriage"><label class="field"><span>Triage an email</span><textarea id="homeTriageInput" rows="5" placeholder="Paste the customer's email or ticket" spellcheck="false"></textarea></label><button class="primary-btn" type="submit">Triage <kbd>Ctrl Enter</kbd></button></form>
          </section>
          <section class="card card-pad">
            <div class="section-title"><h3>Systems</h3><button data-action="page" data-id="Settings">Edit</button></div>
            <div class="quick-links">${sysLinks}</div>
          </section>
        </div>
      </div>
      <div class="dash-row">
        <section class="card card-pad">
          <div class="section-title"><h3>Pinned templates</h3><button data-action="template-tab" data-id="templates">All templates</button></div>
          <div class="action-list">${
            pinned
              .map((t) => {
                const n = placeholders(t.body).length;
                return `<button class="action-row" data-action="use-template" data-id="${esc(t.id)}"><span><b>${esc(
                  t.title,
                )}</b><small>${esc(t.category)} · ${n} detail${n === 1 ? "" : "s"}</small></span><em>Use</em></button>`;
              })
              .join("") || '<div class="empty">No pinned templates.</div>'
          }</div>
        </section>
        <section class="card card-pad">
          <div class="section-title"><h3>Workflows</h3><button data-action="page" data-id="Workflows">All workflows</button></div>
          <div class="action-list">${state.workflows
            .slice(0, 6)
            .map(
              (w) =>
                `<button class="action-row" data-action="run-workflow" data-id="${esc(w.id)}"><span><b>${esc(
                  w.title,
                )}</b><small>${w.steps.length} steps · ${esc(w.category)}</small></span><em>Start</em></button>`,
            )
            .join("")}</div>
        </section>
        <section class="card card-pad">
          <div class="section-title"><h3>Recent copies</h3></div>
          <div id="recentCopies">${recentCopiesHtml()}</div>
        </section>
      </div>`;

    const input = $("#startSearch");
    let queued = 0;
    input.addEventListener("input", () => {
      if (searchMode !== "Astra") return;
      cancelAnimationFrame(queued);
      queued = requestAnimationFrame(() => showStartResults(input.value));
    });
    resultKeys(input, $("#searchResults"), (e) => {
      e.preventDefault();
      runStartSearch();
    });
    const lines = $("#homeLineFilter");
    lines.addEventListener("input", () => ($("#homeLines").innerHTML = homeLinesHtml(lines.value)));
    /* Enter copies the first line found. */
    lines.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      $("#homeLines .home-line")?.click();
    });
  }

  function relativeTime(iso) {
    if (!iso) return "";
    const minutes = Math.round((Date.now() - new Date(iso)) / 60000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return minutes + "m ago";
    if (minutes < 1440) return Math.floor(minutes / 60) + "h ago";
    return shortDate(new Date(iso));
  }

  /* ---------------------------------------------------- list pages (3 of them) */

  function listPage({
    title,
    newAction,
    newLabel,
    placeholder,
    items,
    row,
    emptyText,
    chips = false,
    before = "",
    after = null,
    chipClass = "",
  }) {
    const categories = chips ? ["All", ...new Set(items().map((x) => x.category))] : [];
    if (!categories.includes(categoryFilter)) categoryFilter = "";
    app.innerHTML =
      pageHead(title, `<button class="primary-btn" data-action="${newAction}">${newLabel}</button>`) +
      before +
      `<div class="toolbar"><input class="search-input" id="filterInput" aria-label="${placeholder}" placeholder="${placeholder}" value="${esc(
        filter,
      )}" autocomplete="off"><div class="chips ${chipClass}" id="chips"${chips ? "" : " hidden"}></div></div><div class="item-list" id="itemList"></div><div id="extraList"></div>`;

    const paint = () => {
      const q = filter.trim().toLowerCase();
      const shown = items().filter(
        (x) => (!q || textMatches(x, q)) && (!categoryFilter || x.category === categoryFilter),
      );
      if (q) shown.sort((x, y) => matchScore(y, q) - matchScore(x, q));
      $("#chips").innerHTML = categories
        .map((c) => {
          const active = (c === "All" && !categoryFilter) || c === categoryFilter;
          return `<button class="chip ${active ? "active" : ""}" data-action="category" data-id="${esc(c)}" aria-pressed="${active}">${esc(c)}</button>`;
        })
        .join("");
      $("#itemList").innerHTML = shown.map(row).join("") || `<div class="empty">${emptyText}</div>`;
      if (after) $("#extraList").innerHTML = after(filter.trim());
    };
    paint();
    repaint = paint;
    $("#filterInput").addEventListener("input", (e) => {
      filter = e.target.value;
      paint();
    });
  }

  /* Your initials after a separator, or nothing while no profile is set. */
  const byline = (sep) => (state.profile.initials ? sep + state.profile.initials : "");

  /* ----------------------------------------------------------------- replies */

  /* The reply builder: a situation, a stage of the ticket, and the details typed in make the email. */
  const R = window.AstraReplies;
  const rb = {
    situation: R.SITUATIONS[0].id,
    stage: "first-reply",
    audience: "customer",
    tone: "friendly",
    length: "email",
    query: "",
    values: { supplier_ref: "", date: "", timeslot: "", close_date: "", notice_received: "" },
    raw: {},
    contact: "",
  };

  /* Details the reply can use: what is typed here, the last triaged email and your profile. */
  function replyValues() {
    const e = emailValues();
    return {
      ...rb.values,
      /* The notice date gives the day the customer's 90 days' notice ends (T&Cs 10.2). */
      notice_end: rb.raw.notice_received ? dateUK(AstraContract.noticeEnd(rb.raw.notice_received)) : "",
      /* Chasing to close today: the ticket closes at 5pm today. */
      close_date:
        rb.raw.close_date && rb.raw.close_date === isoDate(new Date()) ? "today" : rb.values.close_date,
      contact: rb.contact || e.contact,
      ticket: rb.values.ticket ?? e.ticket,
      site: e.site,
      sender: state.profile.name,
    };
  }

  /* Opens the builder on a situation (and stage), e.g. from Triage or Ctrl K. */
  function openReplies(situation, stage = "", show = go) {
    const s = R.situationById(situation);
    if (s) {
      rb.situation = s.id;
      rb.audience = "customer";
      rb.stage = stage || (s.kind === "howto" ? "answer" : "first-reply");
    }
    show("Replies");
  }

  const segmented = (name, options, current, label) =>
    `<div class="segmented" role="group" aria-label="${esc(label)}">${options
      .map(
        (o) =>
          `<button type="button" aria-pressed="${o.id === current}" class="${o.id === current ? "on" : ""}" data-action="reply-opt" data-name="${name}" data-id="${o.id}">${esc(o.name)}</button>`,
      )
      .join("")}</div>`;

  function repliesPage() {
    app.innerHTML =
      pageHead("Replies") +
      `<div class="replies-grid">
        <section class="card replies-pick"><label class="field"><span class="sr-only">Find a situation</span><input class="search-input" id="replySearch" placeholder="Find a situation, e.g. calls dropping or chase" value="${esc(rb.query)}" autocomplete="off"></label><div id="replyList" class="reply-list"></div></section>
        <section class="card replies-write" id="replyWrite"></section>
      </div>`;
    const paintList = () => {
      const q = rb.query.trim();
      const found = q ? R.search(q, 30) : null;
      const groups = new Map();
      for (const s of found ? found.map((x) => x.situation) : R.SITUATIONS) {
        if (!groups.has(found ? "Best matches" : s.group)) groups.set(found ? "Best matches" : s.group, []);
        groups.get(found ? "Best matches" : s.group).push(s);
      }
      $("#replyList").innerHTML =
        [...groups]
          .map(
            ([g, list]) =>
              `<h3 class="reply-group">${esc(g)}</h3>${list
                .map(
                  (s) =>
                    `<button class="reply-item ${s.id === rb.situation ? "on" : ""}" aria-pressed="${s.id === rb.situation}" data-action="reply-situation" data-id="${esc(s.id)}"${
                      found ? ` data-stage="${esc(found.find((x) => x.situation === s)?.stage || "")}"` : ""
                    }>${esc(s.title)}</button>`,
                )
                .join("")}`,
          )
          .join("") || '<p class="muted">Nothing matches. Try fewer words.</p>';
    };
    paintList();
    paintReply();
    $("#replySearch").addEventListener("input", (e) => {
      rb.query = e.target.value;
      paintList();
    });
  }

  /* The right-hand side: stage, options, details and the email itself. Stages are shown in the order a ticket goes. */
  const STAGE_GROUPS = ["Start", "Updates", "Engineer", "Finish"];
  function paintReply() {
    const box = $("#replyWrite");
    if (!box) return;
    const s = R.situationById(rb.situation);
    const audiences = R.audiencesFor(s);
    if (!audiences.some((a) => a.id === rb.audience)) rb.audience = "customer";
    const stages = R.stagesFor(s, rb.audience);
    if (!stages.some((x) => x.id === rb.stage)) rb.stage = stages[0].id;
    const stage = R.stageById(rb.stage);
    const v = replyValues();
    const out = R.compose({
      situation: s,
      stage,
      audience: rb.audience,
      tone: rb.tone,
      length: rb.length,
      values: v,
    });
    const guide = state.knowledge.find((k) => k.id === s.guide);
    const field = (key, label, attrs = "", after = "") =>
      `<label class="field"><span>${label}</span><input data-reply="${key}" value="${esc(
        key === "contact" || key === "ticket" ? v[key] || "" : rb.values[key] || "",
      )}" ${attrs}></label>${after}`;
    const extra = [
      ["raised", "escalated"].includes(stage.id)
        ? field("supplier_ref", `${esc(s.supplier || "Supplier")} reference`)
        : "",
      stage.id === "engineer-booked"
        ? field("date", "Date", 'type="date"') +
          `<label class="field"><span>Time slot</span><select data-reply="timeslot"><option value="">Select</option>${SLOTS.map(
            (x) => `<option ${rb.values.timeslot === x ? "selected" : ""}>${x}</option>`,
          ).join("")}</select></label>`
        : "",
      s.id === "cancel-service" && stage.id === "progress"
        ? field("notice_received", "Written notice received", 'type="date"')
        : "",
      stage.id === "no-reply-final"
        ? field(
            "close_date",
            "Close the ticket on",
            'type="date"',
            '<div class="field-quick"><button type="button" class="small-btn" data-action="close-today">Today, 5pm</button></div>',
          )
        : "",
    ].join("");
    box.innerHTML = `<div class="reply-head"><div><h3>${esc(s.title)}</h3></div>${
      guide
        ? `<button class="link-btn quiet" data-action="view-knowledge" data-id="${esc(guide.id)}">Guide: ${esc(guide.title)}</button>`
        : ""
    }</div>
      <div class="reply-stages" role="group" aria-label="Stage of the ticket">${STAGE_GROUPS.map((g) => {
        const here = stages.filter((x) => x.group === g);
        return here.length
          ? `<div class="stage-row"><span class="stage-label" aria-hidden="true">${g}</span><div class="stage-btns">${here
              .map(
                (x) =>
                  `<button type="button" aria-pressed="${x.id === stage.id}" class="stage-btn ${x.id === stage.id ? "on" : ""}" data-action="reply-stage" data-id="${x.id}" title="${esc(x.hint)}">${esc(x.name)}</button>`,
              )
              .join("")}</div></div>`
          : "";
      }).join("")}</div>
      <div class="reply-options">${audiences.length > 1 ? segmented("audience", audiences, rb.audience, "Who it is for") : ""}${segmented(
        "length",
        R.LENGTHS,
        rb.length,
        "Length",
      )}${rb.length === "email" ? segmented("tone", R.TONES, rb.tone, "Tone") : ""}</div>
      <div class="fields cols-3 reply-fields">${field("contact", "Contact name", 'placeholder="First name"')}${field(
        "ticket",
        "Ticket",
        'placeholder="Reference"',
      )}${extra}</div>
      <p class="hint warn" id="replyMissing" aria-live="polite" ${out.missing.length ? "" : "hidden"}>${esc(missingText(out.missing))}</p>
      ${
        rb.length === "email"
          ? `<label class="field"><span>Subject</span><input id="replySubject" value="${esc(out.subject)}"></label>`
          : ""
      }
      <label class="field"><span>${rb.length === "email" ? "Email" : "Message"}</span><textarea id="replyBody" rows="${Math.max(8, out.body.split("\n").length + 1)}">${esc(out.body)}</textarea></label>
      <div class="tool-actions"><button class="primary-btn" data-action="copy-reply">Copy ${rb.length === "email" ? "email" : "message"}</button>${
        rb.length === "email"
          ? '<button class="secondary-btn" data-action="copy-subject">Copy subject</button>'
          : ""
      }<button class="secondary-btn" data-action="save-reply">Save as my template</button></div>
`;
    /* Typing in a detail updates the email in place: the form is not rebuilt, so focus, half-typed dates and the
       button about to be clicked all stay put. */
    for (const el of box.querySelectorAll("[data-reply]"))
      el.addEventListener(el.type === "date" || el.tagName === "SELECT" ? "change" : "input", () => {
        const key = el.dataset.reply;
        if (key === "contact") rb.contact = el.value.trim();
        else if (el.type === "date") {
          rb.raw[key] = el.value;
          rb.values[key] = el.value ? dateUK(el.value) : "";
        } else rb.values[key] = el.value;
        updateReply();
      });
    /* Date inputs hold the date in their own format; the email gets the written-out date. */
    for (const el of box.querySelectorAll('input[type="date"][data-reply]'))
      el.value = rb.raw[el.dataset.reply] || "";
  }

  const missingText = (missing) =>
    missing.length
      ? `Add the ${missing.map((m) => ({ date: "date", timeslot: "time slot", close_date: "closing date" })[m] || m).join(" and ")} above.`
      : "";

  function updateReply() {
    const out = R.compose({
      situation: R.situationById(rb.situation),
      stage: R.stageById(rb.stage),
      audience: rb.audience,
      tone: rb.tone,
      length: rb.length,
      values: replyValues(),
    });
    $("#replyBody").value = out.body;
    if ($("#replySubject")) $("#replySubject").value = out.subject;
    $("#replyMissing").textContent = missingText(out.missing);
    $("#replyMissing").hidden = !out.missing.length;
  }

  /* A new email: nothing from the last customer's reply carries over. */
  function resetReplies() {
    rb.contact = "";
    rb.values = { supplier_ref: "", date: "", timeslot: "", close_date: "", notice_received: "" };
    rb.raw = {};
  }

  function copyReply() {
    const s = R.situationById(rb.situation);
    const stage = R.stageById(rb.stage);
    const missing = R.compose({ situation: s, stage, values: replyValues() }).missing;
    if (missing.length) {
      toast(missingText(missing));
      return $(`[data-reply="${missing[0]}"]`)?.focus();
    }
    copy($("#replyBody").value, "Reply copied");
    noteCopy(`${s.title}: ${stage.name.toLowerCase()}`, $("#replyBody").value);
  }

  function saveReplyTemplate() {
    const s = R.situationById(rb.situation);
    const stage = R.stageById(rb.stage);
    const t = normalTemplate({
      title: `${s.title}: ${stage.name.toLowerCase()}`,
      category: s.group,
      tags: s.tags,
      body: $("#replyBody").value,
    });
    state.templates.unshift(t);
    save();
    toast("Saved to Templates");
  }

  /* Templates holds both kinds of ready-made text: quick lines, which copy in one click, and full templates. */
  let templateTab = "lines";
  const templateTabs = () =>
    `<div class="segmented page-tabs" role="group" aria-label="Show">${[
      ["lines", "Quick lines", state.snippets.length],
      ["templates", "Templates", state.templates.length],
    ]
      .map(
        ([id, name, n]) =>
          `<button type="button" class="${templateTab === id ? "on" : ""}" aria-pressed="${templateTab === id}" data-action="template-tab" data-id="${id}">${name} <span class="count">${n}</span></button>`,
      )
      .join("")}</div>`;

  function templatesPage() {
    if (templateTab === "lines") return linesPage();
    listPage({
      title: "Templates",
      before: templateTabs(),
      newAction: "new-template",
      newLabel: "New template",
      placeholder: "Search templates",
      items: () => state.templates,
      emptyText: "No templates match.",
      chips: true,
      row: (t) =>
        `<article class="item-row"><div class="item-meta"><span class="tag">${esc(t.category)}</span><button class="pin-button ${
          t.favourite ? "on" : ""
        }" data-action="toggle-pin" data-id="${esc(t.id)}" aria-pressed="${t.favourite}">${
          t.favourite ? "Pinned" : "Pin"
        }</button></div><h3>${esc(t.title)}</h3><p>${previewHtml(t.body)}</p><div class="row-actions"><button class="secondary-btn" data-action="use-template" data-id="${esc(
          t.id,
        )}">Use</button><button class="secondary-btn" data-action="edit-template" data-id="${esc(t.id)}">Edit</button></div></article>`,
    });
  }

  function linesPage() {
    listPage({
      title: "Templates",
      before: templateTabs(),
      newAction: "new-line",
      newLabel: "New quick line",
      placeholder: "Search quick lines",
      items: () => state.snippets,
      emptyText: "No quick lines match.",
      chips: true,
      row: (l) =>
        `<article class="item-row line-row"><button class="line-copy" data-action="copy-line" data-id="${esc(l.id)}"><span class="line-text">${previewHtml(
          l.text,
        )}</span><span class="line-meta">${esc(l.category)}${
          l.shortcut
            ? `<kbd class="line-key" title="Type it and a space to use the line">${esc(l.shortcut)}</kbd>`
            : ""
        }<span class="line-done" aria-hidden="true">Copied</span></span></button><div class="row-actions"><button class="star-btn ${
          l.favourite ? "on" : ""
        }" data-action="star-line" data-id="${esc(l.id)}" aria-pressed="${l.favourite}" aria-label="Star: keep on Home and in Astra Lite" title="Keep on Home and in Astra Lite">${
          l.favourite ? "★" : "☆"
        }</button><button class="secondary-btn" data-action="edit-line" data-id="${esc(l.id)}">Edit</button></div></article>`,
    });
  }

  /* ------------------------------------------------------------- quick lines */

  /* Details a quick line fills in by itself: your profile, today's date and the email triaged last. */
  const lineValues = knownValues;
  const fillLine = (text, values) =>
    text.replace(new RegExp(PLACEHOLDER.source, "g"), (m, k) => values[k] || m);
  /* A line's first words, for lists and Recent copies. */
  const lineTitle = (l) => {
    const t = l.text.replace(/\s+/g, " ").trim();
    return t.length > 70 ? t.slice(0, 67).trimEnd() + "…" : t;
  };
  const LINE_LABELS = {
    my_name: "Your name",
    supplier_ref: "Supplier reference",
    update_time: "Update by",
    contact: "Contact's first name",
    mobile: "Phone",
  };

  /* One click: copied at once, with the details Astra knows. Only a detail it cannot know is asked for. */
  function copyLine(id, from) {
    const l = state.snippets.find((x) => x.id === id);
    if (!l) return;
    const known = lineValues();
    const missing = placeholders(l.text).filter((k) => !known[k]);
    const done = async (text) => {
      l.useCount += 1;
      noteCopy(lineTitle(l), text);
      save();
      await copy(text, "Copied");
      /* The line that was copied says so for a moment, where the eye already is. */
      const btn = from?.isConnected ? from : null;
      btn?.classList.add("copied");
      setTimeout(() => btn?.classList.remove("copied"), 1400);
      const recent = $("#recentCopies");
      if (recent) recent.innerHTML = recentCopiesHtml();
    };
    if (!missing.length) return done(fillLine(l.text, known));
    openModal(
      modalHead("Fill in the details", l.category) +
        `<div class="modal-body"><div class="fields cols-2">${missing
          .map((k) => {
            const label = LINE_LABELS[k] || k.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
            if (k === "timeslot")
              return `<label class="field"><span>${esc(label)}</span><select data-fill="${esc(k)}"><option value="">Select</option>${SLOTS.map(
                (x) => `<option>${x}</option>`,
              ).join("")}</select></label>`;
            return `<label class="field"><span>${esc(label)}</span><input ${isDateKey(k) ? 'type="date"' : ""} data-fill="${esc(k)}" autocomplete="off"></label>`;
          })
          .join(
            "",
          )}</div><label class="field mt"><span>Preview</span><textarea id="linePreview" rows="4" readonly></textarea></label></div><div class="modal-foot"><div></div><div><button class="secondary-btn" data-action="close">Cancel</button><button class="primary-btn" id="copyLineFilled">Copy</button></div></div>`,
    );
    const inputs = [...modal.querySelectorAll("[data-fill]")];
    const values = () => ({
      ...known,
      ...Object.fromEntries(
        inputs.map((el) => [el.dataset.fill, el.type === "date" ? dateUK(el.value) : el.value.trim()]),
      ),
    });
    const update = () =>
      ($("#linePreview").value = l.text.replace(
        new RegExp(PLACEHOLDER.source, "g"),
        (m, k) => values()[k] || `[${k.replaceAll("_", " ")}]`,
      ));
    inputs.forEach((el) =>
      el.addEventListener(el.type === "date" || el.tagName === "SELECT" ? "change" : "input", () => {
        el.classList.remove("invalid");
        update();
      }),
    );
    update();
    $("#copyLineFilled").onclick = () => {
      const empty = inputs.filter((el) => !el.value.trim());
      if (empty.length) {
        empty.forEach((el) => el.classList.add("invalid"));
        empty[0].focus();
        return toast("Complete the highlighted detail first");
      }
      /* Typed once, not again: your name and company go into your details. */
      const typed = values();
      for (const el of inputs) {
        const k = el.dataset.fill;
        if (k === "my_name") state.profile.name = typed[k];
        if (k === "company") state.profile.company = typed[k];
      }
      closeModal();
      done(fillLine(l.text, typed));
      if (page === "Home") keep(homePage);
    };
  }

  function editLine(id) {
    const groups = [...new Set(state.snippets.map((l) => l.category))];
    editDialog({
      kind: "snippets",
      label: "quick line",
      newTitle: "New quick line",
      editTitle: "Edit quick line",
      saveLabel: "Save line",
      saved: "Quick line saved",
      id,
      list: () => state.snippets,
      blank: () => normalSnippet({ category: categoryFilter || "My lines" }),
      subtitle:
        "{customer}, {contact}, {ticket}, {site}, {mobile}, {supplier_ref}, {update_time}, {my_name}, {company} and {today} fill in from your details and the last email triaged; anything else in braces is asked for when copied.",
      fields: (l) =>
        areaField("lineText", "Line", l.text, 4) +
        `<label class="field"><span>Group</span><input id="lineGroup" list="lineGroups" value="${esc(l.category)}" required autocomplete="off"><datalist id="lineGroups">${groups
          .map((g) => `<option value="${esc(g)}"></option>`)
          .join("")}</datalist></label>` +
        `<label class="field"><span>Shortcut (optional)</span><input id="lineShortcut" value="${esc(
          l.shortcut,
        )}" placeholder=";close5" pattern=";[A-Za-z0-9]+(-[A-Za-z0-9]+)*" maxlength="21" title="A semicolon then up to 20 letters, digits or dashes, such as ;close5" autocomplete="off" spellcheck="false"></label><p class="hint span-all">Type the shortcut and a space in any box in Astra${
          extensionId ? ", or in Zoho Desk once it is allowed in Settings," : ""
        } and it becomes this line. A shortcut another line has moves to this one.</p>`,
      collect: () => {
        const shortcut = $("#lineShortcut").value.trim().toLowerCase();
        if (shortcut)
          for (const other of state.snippets)
            if (other.id !== id && other.shortcut === shortcut) other.shortcut = "";
        return {
          text: $("#lineText").value.trim(),
          category: $("#lineGroup").value.trim() || "My lines",
          shortcut: AstraExpand.valid(shortcut) ? shortcut : "",
        };
      },
    });
  }

  function workflowsPage() {
    listPage({
      title: "Workflows",
      newAction: "new-workflow",
      newLabel: "New workflow",
      placeholder: "Search workflows",
      items: () => state.workflows,
      emptyText: "No workflows match.",
      row: (w) =>
        `<article class="item-row"><div class="item-meta"><span class="tag">${esc(w.category)}</span><span class="steps-count">${w.steps.length} steps</span></div><h3>${esc(
          w.title,
        )}</h3><p>${esc(w.steps.slice(0, 3).join(" · "))}</p><div class="row-actions"><button class="secondary-btn" data-action="run-workflow" data-id="${esc(
          w.id,
        )}">Start</button><button class="secondary-btn" data-action="edit-workflow" data-id="${esc(w.id)}">Edit</button></div></article>`,
    });
  }

  /* The fault finder shows the commonest faults; the rest are one click away. */
  const FF_SHOWN = 8;
  let faultFinderOpen = false;
  function knowledgePage() {
    const quick = state.knowledge.filter((k) => k.quick);
    const extra = quick.length - FF_SHOWN;
    const fault = quick.length
      ? `<div class="fault-finder ${faultFinderOpen ? "" : "collapsed"}"><span class="ff-label">Fault finder</span><div class="ff-buttons" id="ffButtons">${quick
          .map(
            (k, i) =>
              `<button class="secondary-btn ${i >= FF_SHOWN ? "ff-extra" : ""}" data-action="view-knowledge" data-id="${esc(k.id)}">${esc(k.quick)}</button>`,
          )
          .join("")}${
          extra > 0
            ? `<button class="small-btn ff-toggle" data-action="ff-more" aria-expanded="${faultFinderOpen}" aria-controls="ffButtons">${faultFinderOpen ? "Fewer" : `${extra} more`}</button>`
            : ""
        }</div></div>`
      : "";
    listPage({
      title: "Knowledge",
      newAction: "new-knowledge",
      newLabel: "New guide",
      placeholder: "Search guides, faults and documents",
      items: () => state.knowledge,
      emptyText: "No guides match. Documents are searched below.",
      chips: true,
      chipClass: "wrap",
      before: fault,
      after: (q) => {
        if (q.length < 3 || !KB.hasLibrary) return "";
        const hits = KB.searchPages(q, { limit: 6 });
        if (!hits.length) return "";
        return `<div class="section-gap"><div class="section-title"><div><h3>Also in the library</h3><p>Pages inside the supplier documents that match.</p></div><button data-action="page" data-id="Library">Search the library</button></div><div class="item-list">${hits.map(hitRow).join("")}</div></div>`;
      },
      row: (k) =>
        `<article class="item-row"><div class="item-meta"><span class="tag">${esc(k.type)}</span><span class="steps-count">${esc(
          k.category,
        )}</span></div><h3>${esc(k.title)}</h3><p>${esc(k.summary || k.body)}</p><div class="row-actions"><button class="secondary-btn" data-action="view-knowledge" data-id="${esc(
          k.id,
        )}">Open</button><button class="secondary-btn" data-action="edit-knowledge" data-id="${esc(k.id)}">Edit</button></div></article>`,
    });
  }

  /* ----------------------------------------------------------------- library */

  const hitRow = (h) =>
    `<article class="item-row doc-row"><div class="item-meta"><span class="tag">Page ${h.page}</span><span class="steps-count">${esc(
      h.doc.category,
    )}</span></div><h3>${esc(h.doc.title)}</h3><p class="snippet">${h.snippet}</p><div class="row-actions"><a class="secondary-btn" href="${esc(
      KB.docHref(h.doc, h.page),
    )}" target="_blank" rel="noopener noreferrer">Open page</a></div></article>`;

  const docRow = (d) =>
    `<article class="item-row doc-row"><div class="item-meta"><span class="tag">${esc(d.category)}</span><span class="steps-count">${
      d.pages
    } page${d.pages === 1 ? "" : "s"}</span></div><h3>${esc(d.title)}</h3><p>${esc(d.note || d.summary)}</p><div class="row-actions"><a class="secondary-btn" href="${esc(
      KB.docHref(d, 1),
    )}" target="_blank" rel="noopener noreferrer">Open</a><a class="secondary-btn" href="${esc(encodeURI(d.file))}" download="${esc(
      d.file.split("/").pop(),
    )}" title="Download the PDF (${KB.bytes(d.bytes)})">PDF</a>${
      d.original
        ? `<a class="secondary-btn" href="${esc(encodeURI(d.original))}" download="${esc(d.original.split("/").pop())}" title="Download the ${/\.xlsx?$/i.test(d.original) ? "Excel" : "Word"} original (${KB.bytes(
            d.originalBytes,
          )})">${/\.xlsx?$/i.test(d.original) ? "Excel" : "Word"}</a>`
        : ""
    }</div></article>`;

  function libraryPage() {
    if (!KB.hasLibrary) {
      app.innerHTML = pageHead("Library") + '<div class="empty">No documents yet.</div>';
      return;
    }
    const categories = ["All", ...KB.categories];
    if (!categories.includes(categoryFilter)) categoryFilter = "";
    app.innerHTML =
      pageHead("Library") +
      `<div class="toolbar"><input class="search-input" id="filterInput" aria-label="Search the library" placeholder="Search inside every document" value="${esc(
        filter,
      )}" autocomplete="off"><div class="chips wrap" id="chips"></div></div><div id="libraryList"></div>`;

    const paint = () => {
      const q = filter.trim();
      const category = categoryFilter;
      $("#chips").innerHTML = categories
        .map((c) => {
          const active = (c === "All" && !category) || c === category;
          return `<button class="chip ${active ? "active" : ""}" data-action="category" data-id="${esc(c)}" aria-pressed="${active}">${esc(c)}</button>`;
        })
        .join("");
      const docsShown = KB.searchDocs(q, { category });
      const waiting = q && !KB.indexReady();
      let html = "";
      if (!q) {
        html = `<div class="item-list">${docsShown.map(docRow).join("")}</div>`;
      } else {
        const hits = KB.searchPages(q, { limit: 40, category });
        if (docsShown.length)
          html += `<div class="section-title"><div><h3>Documents</h3></div></div><div class="item-list">${docsShown.map(docRow).join("")}</div>`;
        if (hits.length)
          html += `<div class="section-gap"><div class="section-title"><div><h3>Inside the documents</h3><p>${hits.length} page${
            hits.length === 1 ? "" : "s"
          } found, best first.</p></div></div><div class="item-list">${hits.map(hitRow).join("")}</div></div>`;
        if (waiting)
          html += '<div class="item-list"><div class="empty">Loading the document text…</div></div>';
        else if (!html)
          html =
            '<div class="item-list"><div class="empty">Nothing found. Try fewer or different words.</div></div>';
      }
      $("#libraryList").innerHTML = html;
    };
    paint();
    repaint = paint;
    $("#filterInput").addEventListener("input", (e) => {
      filter = e.target.value;
      paint();
    });
  }

  /* -------------------------------------------------------- use a template */

  function useTemplate(id) {
    const t = state.templates.find((x) => x.id === id);
    if (!t) return;
    const keys = placeholders(t.body);
    /* Calendar-invite wording with a date can also be saved as a real invite for Outlook or any calendar. */
    const dateKey = keys.find(isDateKey);
    const invite = /calendar invite/i.test(t.title) && dateKey;
    const known = lineValues();
    const fieldHtml = keys
      .map((k) => {
        const label = k.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
        if (k === "timeslot")
          return `<label class="field"><span>${esc(label)}</span><select data-fill="${esc(k)}"><option value="">Select</option>${SLOTS.map(
            (s) => `<option>${s}</option>`,
          ).join("")}</select></label>`;
        return `<label class="field"><span>${esc(label)}</span><input ${
          isDateKey(k) ? 'type="date"' : ""
        } data-fill="${esc(k)}" value="${esc(isDateKey(k) ? "" : known[k] || "")}"></label>`;
      })
      .join("");

    openModal(
      modalHead(t.title, t.category) +
        `<div class="modal-body"><div class="fields cols-2">${
          fieldHtml || '<span class="muted">No details needed.</span>'
        }</div><label class="field mt"><span>Preview</span><textarea id="templatePreview" rows="10" readonly></textarea></label></div><div class="modal-foot"><button class="secondary-btn" data-action="edit-template" data-id="${esc(
          t.id,
        )}">Edit wording</button><div><button class="secondary-btn" data-action="close">Cancel</button>${
          invite ? '<button class="secondary-btn" id="icsBuilt">Download invite (.ics)</button>' : ""
        }<button class="primary-btn" id="copyBuilt">Copy reply</button></div></div>`,
      true,
    );

    const inputs = [...modal.querySelectorAll("[data-fill]")];
    const valueOf = (el) => (el.type === "date" ? dateUK(el.value) : el.value);
    const update = () => {
      const values = Object.fromEntries(inputs.map((el) => [el.dataset.fill, valueOf(el)]));
      $("#templatePreview").value = t.body.replace(PLACEHOLDER, (_, k) => values[k] || `[${k}]`);
    };
    inputs.forEach((el) => {
      el.addEventListener("input", () => {
        el.classList.remove("invalid");
        update();
      });
    });
    update();

    const complete = () => {
      const empty = inputs.filter((el) => !el.value);
      if (!empty.length) return true;
      empty.forEach((el) => el.classList.add("invalid"));
      empty[0].focus();
      toast("Complete the highlighted detail first");
      return false;
    };

    if (invite)
      $("#icsBuilt").onclick = () => {
        if (!complete()) return;
        const raw = Object.fromEntries(inputs.map((el) => [el.dataset.fill, el.value]));
        const title = t.title.replace(/\s*\((calendar invite)\)\s*$/i, "").replace(/:.*$/, "");
        const text = AstraICS.build({
          title: known.customer ? `${title}: ${known.customer}` : title,
          description: $("#templatePreview").value,
          date: raw[dateKey],
          slot: raw.timeslot || "",
          location: known.site,
        });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([text], { type: "text/calendar" }));
        a.download = `${AstraAudio.safeName(title)} ${raw[dateKey]}.ics`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        toast("Invite saved. Open it to add it to the calendar, or attach it to the email.");
      };

    $("#copyBuilt").onclick = async () => {
      if (!complete()) return;
      const at = new Date().toISOString();
      t.useCount += 1;
      t.lastUsedAt = at;
      noteCopy(t.title, $("#templatePreview").value);
      save();
      await copy($("#templatePreview").value);
      closeModal();
      if (page === "Home") keep(homePage);
    };
  }

  /* ------------------------------------------------------- edit dialogs (3) */

  /* One shared shape: open a form, collect fields, upsert into a list, optional delete. */
  function editDialog({
    kind,
    label,
    newTitle,
    editTitle = "",
    saveLabel,
    saved,
    id,
    blank,
    list,
    subtitle,
    fields,
    collect,
    wide = true,
  }) {
    const existing = id && list().find((x) => x.id === id);
    const item = existing ? structuredClone(existing) : blank();
    openModal(
      modalHead(existing ? item.title || editTitle : newTitle, subtitle) +
        `<form id="editForm"><div class="modal-body"><div class="fields cols-2">${fields(item)}</div></div><div class="modal-foot"><div>${
          existing ? `<button type="button" class="danger-btn" id="deleteItem">Delete</button>` : ""
        }</div><div><button type="button" class="secondary-btn" data-action="close">Cancel</button><button class="primary-btn">${saveLabel}</button></div></div></form>`,
      wide,
    );
    $("#editForm").onsubmit = (e) => {
      e.preventDefault();
      Object.assign(item, collect());
      const current = existing && list().find((x) => x.id === item.id);
      if (current) Object.assign(current, item);
      else list().unshift(item);
      save();
      closeModal();
      render();
      toast(saved);
    };
    if (existing)
      $("#deleteItem").onclick = () =>
        confirmDelete(label, () => {
          state[kind] = state[kind].filter((x) => x.id !== id);
          save();
          closeModal();
          render();
        });
  }

  const textField = (id, label, value, { required = true, span = false } = {}) =>
    `<label class="field ${span ? "span-all" : ""}"><span>${label}</span><input id="${id}" ${required ? "required" : ""} value="${esc(value)}"></label>`;
  const areaField = (id, label, value, rows) =>
    `<label class="field span-all"><span>${label}</span><textarea id="${id}" rows="${rows}" required>${esc(value)}</textarea></label>`;

  function editTemplate(id) {
    editDialog({
      kind: "templates",
      label: "template",
      newTitle: "New template",
      saveLabel: "Save template",
      saved: "Template saved",
      id,
      list: () => state.templates,
      blank: () => ({ ...normalTemplate({ category: "General" }), title: "" }),
      subtitle:
        "{my_name}, {company} and {today} fill in by themselves, and {customer}, {contact}, {ticket}, {site} and {mobile} from the last email triaged; anything else is asked for.",
      fields: (t) =>
        textField("tTitle", "Name", t.title) +
        textField("tCategory", "Category", t.category) +
        textField("tTags", "Search tags, comma separated", t.tags.join(", "), {
          required: false,
        }) +
        `<label class="field"><span>Home</span><select id="tFav"><option value="no">Not pinned</option><option value="yes" ${
          t.favourite ? "selected" : ""
        }>Pinned</option></select></label>` +
        areaField("tBody", "Exact message wording", t.body, 12),
      collect: () => ({
        title: $("#tTitle").value.trim(),
        category: $("#tCategory").value.trim(),
        tags: splitTags($("#tTags").value),
        favourite: $("#tFav").value === "yes",
        body: $("#tBody").value,
      }),
    });
  }

  function editWorkflow(id) {
    editDialog({
      kind: "workflows",
      label: "workflow",
      newTitle: "New workflow",
      saveLabel: "Save workflow",
      saved: "Workflow saved",
      id,
      list: () => state.workflows,
      blank: () => ({ ...normalWorkflow({ category: "General" }), title: "" }),
      subtitle: "One step per line.",
      fields: (w) =>
        textField("wTitle", "Name", w.title) +
        textField("wCategory", "Category", w.category) +
        textField("wTags", "Search tags, comma separated", w.tags.join(", "), {
          required: false,
          span: true,
        }) +
        areaField("wSteps", "Steps, one per line", w.steps.join("\n"), 12),
      collect: () => ({
        title: $("#wTitle").value.trim(),
        category: $("#wCategory").value.trim(),
        tags: splitTags($("#wTags").value),
        steps: $("#wSteps")
          .value.split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    });
  }

  function editKnowledge(id) {
    editDialog({
      kind: "knowledge",
      label: "guide",
      newTitle: "New guide",
      saveLabel: "Save guide",
      saved: "Guide saved",
      id,
      list: () => state.knowledge,
      blank: () => ({ ...normalKnowledge({ category: "General" }), title: "" }),
      subtitle: "Guides and reference for your team.",
      fields: (k) =>
        textField("kTitle", "Title", k.title) +
        `<label class="field"><span>Type</span><select id="kType">${KB_TYPES.map(
          (t) => `<option ${k.type === t ? "selected" : ""}>${t}</option>`,
        ).join("")}</select></label>` +
        textField("kCategory", "Category", k.category) +
        textField("kTags", "Search tags", k.tags.join(", "), {
          required: false,
        }) +
        textField("kSummary", "Short description", k.summary, {
          required: false,
          span: true,
        }) +
        areaField("kBody", "Content", k.body, 13),
      collect: () => ({
        title: $("#kTitle").value.trim(),
        type: $("#kType").value,
        category: $("#kCategory").value.trim(),
        tags: splitTags($("#kTags").value),
        summary: $("#kSummary").value.trim(),
        body: $("#kBody").value,
      }),
    });
  }

  function viewKnowledge(id) {
    const k = state.knowledge.find((x) => x.id === id);
    if (!k) return;
    /* Source links open at the page a phrase is on, which needs the document text. */
    if (!KB.indexReady() && k.docs.length) {
      KB.loadIndex().then(() => viewKnowledge(id));
      return;
    }
    const sources = k.docs
      .map((d) => {
        const doc = KB.docById(d.id);
        if (!doc) return "";
        const page = d.page || KB.locate(d.id, d.find);
        return `<a class="small-btn" href="${esc(KB.docHref(doc, page))}" target="_blank" rel="noopener noreferrer"><span>${esc(
          d.label || doc.title,
        )}</span><small>${esc(doc.title)}${page > 1 ? ", page " + page : ""}</small></a>`;
      })
      .join("");
    const related = k.related
      .map((rid) => state.knowledge.find((x) => x.id === rid))
      .filter(Boolean)
      .map(
        (r) =>
          `<button class="small-btn" data-action="view-knowledge" data-id="${esc(r.id)}"><span>${esc(r.title)}</span></button>`,
      )
      .join("");
    const content = k.rich
      ? `<div class="kb-body">${KB.render(k.body)}</div>`
      : `<pre class="pre">${esc(k.body)}</pre>`;
    openModal(
      modalHead(k.title, k.category, k.type) +
        `<div class="modal-body">${content}${
          sources ? `<div class="kb-links"><h3>Sources</h3><div class="link-row">${sources}</div></div>` : ""
        }${related ? `<div class="kb-links"><h3>Related</h3><div class="link-row">${related}</div></div>` : ""}</div><div class="modal-foot"><button class="secondary-btn" data-action="edit-knowledge" data-id="${esc(
          k.id,
        )}">Edit</button><div><button class="secondary-btn" id="copyKnowledge">Copy</button><button class="primary-btn" data-action="close">Done</button></div></div>`,
      true,
    );
    $("#copyKnowledge").onclick = () => copy(k.rich ? KB.plain(k.body) : k.body, "Knowledge copied");
  }

  /* A workflow's ticks and working note stay while Astra is open, so closing the window does not lose them. */
  const progress = new Map();
  function workflowProgress(w) {
    if (!progress.has(w.id)) progress.set(w.id, { done: [], note: "" });
    return progress.get(w.id);
  }
  function runWorkflow(id) {
    const w = state.workflows.find((x) => x.id === id);
    if (!w) return;
    const p = workflowProgress(w);
    const count = () => p.done.filter((i) => i < w.steps.length).length;
    openModal(
      modalHead(w.title, `${count()} of ${w.steps.length} complete`) +
        `<div class="modal-body"><div class="check-list">${w.steps
          .map(
            (s, i) =>
              `<label class="check-step${p.done.includes(i) ? " done" : ""}"><input type="checkbox" data-step="${i}" ${
                p.done.includes(i) ? "checked" : ""
              }><span><b>${i + 1}.</b> ${esc(s)}</span></label>`,
          )
          .join(
            "",
          )}</div><label class="field mt"><span>Working note</span><textarea id="workflowNote" rows="5" placeholder="Results, reference, owner and next update">${esc(
          p.note,
        )}</textarea></label></div><div class="modal-foot"><div class="foot-left"><button class="secondary-btn" data-action="edit-workflow" data-id="${esc(
          w.id,
        )}">Edit workflow</button>${
          w.guide && state.knowledge.some((x) => x.id === w.guide)
            ? `<button class="secondary-btn" data-action="view-knowledge" data-id="${esc(w.guide)}">Read the guide</button>`
            : ""
        }<button class="secondary-btn" id="restartWorkflow">Start again</button></div><div><button class="secondary-btn" id="copyWorkflow">Copy run note</button><button class="primary-btn" data-action="close">Done</button></div></div>`,
      true,
    );
    const checks = [...modal.querySelectorAll("[data-step]")];
    const status = $(".modal-head p", modal);
    checks.forEach((c) => {
      c.onchange = () => {
        const i = Number(c.dataset.step);
        c.closest(".check-step").classList.toggle("done", c.checked);
        p.done = c.checked ? [...new Set([...p.done, i])] : p.done.filter((x) => x !== i);
        status.textContent = `${count()} of ${w.steps.length} complete`;
      };
    });
    $("#workflowNote").oninput = (e) => {
      p.note = e.target.value.slice(0, 2000);
    };
    $("#restartWorkflow").onclick = () => {
      p.done = [];
      p.note = "";
      checks.forEach((c) => {
        c.checked = false;
        c.closest(".check-step").classList.remove("done");
      });
      $("#workflowNote").value = "";
      status.textContent = `0 of ${w.steps.length} complete`;
    };
    $("#copyWorkflow").onclick = () => {
      const lines = checks.map((c, i) => `${c.checked ? "[x]" : "[ ]"} ${w.steps[i]}`).join("\n");
      const note = $("#workflowNote").value.trim();
      copy(`${w.title}\n${lines}\n\n${note}`.trim(), "Workflow note copied");
    };
  }

  /* ----------------------------------------------------------------- toolkit */

  const toolOutput = {};

  /* ----------------------------------------------------------------- QR codes */

  /* What was typed for each kind of code is kept while Astra is open, never saved: a Wi-Fi password stays here. */
  const QR_KINDS = [
    ["link", "Web link"],
    ["wifi", "Wi-Fi"],
    ["phone", "Phone"],
    ["email", "Email"],
    ["text", "Text"],
  ];
  const qr = { kind: "link", v: { security: "WPA" }, last: null };

  function qrFieldsHtml() {
    const v = qr.v;
    const input = (key, label, attrs = "") =>
      `<label class="field"><span>${label}</span><input data-qr="${key}" value="${esc(v[key] || "")}" autocomplete="off" spellcheck="false" ${attrs}></label>`;
    if (qr.kind === "wifi")
      return `<div class="fields cols-2">${input("ssid", "Network name")}${input("password", "Password")}<label class="field"><span>Security</span><select data-qr="security">${[
        ["WPA", "WPA, WPA2 or WPA3"],
        ["WEP", "WEP"],
        ["nopass", "None"],
      ]
        .map(([id, name]) => `<option value="${id}"${v.security === id ? " selected" : ""}>${name}</option>`)
        .join(
          "",
        )}</select></label></div><label class="check-line"><input type="checkbox" data-qr="hidden"${v.hidden ? " checked" : ""}> <span>Hidden network</span></label>`;
    if (qr.kind === "phone")
      return input("phone", "Phone number", 'inputmode="tel" placeholder="e.g. 0117 496 0555"');
    if (qr.kind === "email")
      return `${input("to", "To", 'type="email" placeholder="name@example.co.uk"')}${input("subject", "Subject")}<label class="field"><span>Message</span><textarea data-qr="body" rows="3">${esc(v.body || "")}</textarea></label>`;
    if (qr.kind === "text")
      return `<label class="field"><span>Text</span><textarea data-qr="text" rows="4">${esc(v.text || "")}</textarea></label>`;
    return input("url", "Web address", 'type="url" placeholder="e.g. www.telecomnetworks.co.uk"');
  }

  /* The text the phone reads, and a short name for the file. */
  function qrContent() {
    const v = qr.v;
    const t = (k) => String(v[k] || "").trim();
    if (qr.kind === "wifi")
      return t("ssid")
        ? {
            text: AstraQR.wifi({
              ssid: t("ssid"),
              password: v.password || "",
              security: v.security,
              hidden: !!v.hidden,
            }),
            name: `Wi-Fi ${t("ssid")}`,
          }
        : null;
    if (qr.kind === "phone")
      return AstraQR.tel(t("phone")) ? { text: AstraQR.tel(t("phone")), name: t("phone") } : null;
    if (qr.kind === "email")
      return AstraQR.mailto({ to: t("to"), subject: t("subject"), body: t("body") })
        ? { text: AstraQR.mailto({ to: t("to"), subject: t("subject"), body: t("body") }), name: t("to") }
        : null;
    if (qr.kind === "text") return t("text") ? { text: v.text, name: "text" } : null;
    if (!t("url")) return null;
    /* A phone treats "www.example.com" as plain text; with https:// it opens it. */
    const url = /^[a-z][a-z0-9+.-]*:/i.test(t("url")) ? t("url") : `https://${t("url")}`;
    return { text: url, name: url.replace(/^https?:\/\//i, "") };
  }

  function paintQr() {
    const image = $("#qrImage");
    if (!image) return;
    const content = qrContent();
    const caption = $("#qrCaption");
    qr.last = null;
    if (!content) {
      image.innerHTML = "";
      image.classList.add("empty");
      caption.textContent = "Fill in the details to make the code.";
      return;
    }
    try {
      const code = AstraQR.encode(content.text, { level: "M" });
      qr.last = { code, ...content };
      image.classList.remove("empty");
      image.innerHTML = AstraQR.svg(code);
      caption.textContent = `Scans as: ${content.text}`;
    } catch {
      image.innerHTML = "";
      image.classList.add("empty");
      caption.textContent = "Too long for a QR code. Shorten it, or send a link instead.";
    }
  }

  function wireQr() {
    const card = $("#qrTool");
    if (!card) return;
    const read = (e) => {
      const key = e.target.dataset.qr;
      if (!key) return;
      qr.v[key] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
      paintQr();
    };
    card.addEventListener("input", read);
    card.addEventListener("change", read);
    paintQr();
  }

  function qrPng() {
    const { code } = qr.last;
    const n = code.size + 8;
    const px = Math.max(8, Math.ceil(640 / n));
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = n * px;
    const g = canvas.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = "#000";
    code.dark.forEach((row, y) =>
      row.forEach((on, x) => on && g.fillRect((x + 4) * px, (y + 4) * px, px, px)),
    );
    return new Promise((done, fail) =>
      canvas.toBlob((b) => (b ? done(b) : fail(new Error("no image"))), "image/png"),
    );
  }

  function saveBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const qrFileName = (ext) => `QR - ${AstraAudio.safeName(qr.last.name) || "code"}.${ext}`;

  /* ------------------------------------------------------- passwords and PINs */

  const pw = { kind: "password", length: { password: 16, pin: 6 }, symbols: true, clear: true, value: "" };

  function pwFieldsHtml() {
    const range = pw.kind === "pin" ? 'min="4" max="12"' : 'min="8" max="64"';
    return `<div class="fields cols-2"><label class="field"><span>Length</span><input type="number" id="pwLength" ${range} value="${pw.length[pw.kind]}"></label></div>${
      pw.kind === "pin"
        ? '<p class="hint">No repeats or runs such as 1111, 1234 or 1212.</p>'
        : `<label class="check-line"><input type="checkbox" id="pwSymbols"${pw.symbols ? " checked" : ""}> <span>Symbols</span></label><label class="check-line"><input type="checkbox" id="pwClear"${pw.clear ? " checked" : ""}> <span>Leave out characters that look alike (l, 1, I, O, 0)</span></label>`
    }`;
  }

  function makePassword() {
    const box = $("#pwResult");
    if (!box) return;
    pw.value =
      pw.kind === "pin"
        ? AstraPasswords.pin({ length: pw.length.pin })
        : AstraPasswords.password({ length: pw.length.password, symbols: pw.symbols, clear: pw.clear });
    box.innerHTML = `<code class="pw-value">${esc(pw.value)}</code><small class="pw-said">${esc(AstraPhonetic.line(pw.value))}</small>`;
  }

  function wirePassword() {
    const card = $("#pwTool");
    if (!card) return;
    card.addEventListener("change", (e) => {
      if (e.target.id === "pwLength") {
        const [min, max] = pw.kind === "pin" ? [4, 12] : [8, 64];
        const n = Math.max(min, Math.min(max, parseInt(e.target.value, 10) || pw.length[pw.kind]));
        pw.length[pw.kind] = n;
        e.target.value = n;
      } else if (e.target.id === "pwSymbols") pw.symbols = e.target.checked;
      else if (e.target.id === "pwClear") pw.clear = e.target.checked;
      else return;
      makePassword();
    });
    makePassword();
  }

  /* ------------------------------------------------------------- spell it out */

  function paintSpell(value) {
    const box = $("#spellResult");
    if (!box) return;
    box.innerHTML = value
      ? `<ol class="spell-list">${AstraPhonetic.spell(value)
          .map(
            (x) => `<li><code>${esc(x.char === " " ? "␣" : x.char)}</code><span>${esc(x.said)}</span></li>`,
          )
          .join("")}</ol>`
      : "";
  }

  /* ------------------------------------------------------------ audio converter */

  let audioFile = null;
  let audioLast = null; /* { name, url, preview } of the last conversion, for Listen */

  function audioToolHtml() {
    const A = window.AstraAudio;
    const formats = A.FORMATS.map(
      (f, i) =>
        `<label class="audio-format"><input type="radio" name="audioFormat" value="${f.id}" ${i === 0 ? "checked" : ""}><span><b>${esc(f.name)}</b> <small>${esc(f.detail)}${f.horizon ? " · Gamma Horizon" : ""}</small></span></label>`,
    ).join("");
    const volumes = A.VOLUMES.map(
      (v) =>
        `<label class="check-line"><input type="radio" name="audioVolume" value="${v.id}" ${v.id === "medium" ? "checked" : ""}> <span>${esc(v.name)}</span></label>`,
    ).join("");
    return `<section class="card tool-card wide-tool" id="audioTool"><h3>Audio converter</h3>
      <div class="audio-grid">
        <div>
          <label class="audio-drop" for="audioFileInput"><input type="file" id="audioFileInput" accept="audio/*,video/*,.mp3,.m4a,.wav,.ogg,.flac,.aac,.wma"><b id="audioFileName">${audioFile ? esc(audioFile.name) : "Choose or drop an audio file"}</b><small>MP3, M4A, WAV, OGG, FLAC, or the sound from a video</small></label>
          <fieldset class="audio-formats"><legend>Output format</legend>${formats}</fieldset>
        </div>
        <div>
          <fieldset class="size-choices"><legend>Volume</legend>${volumes}</fieldset>
          <label class="check-line"><input type="checkbox" id="audioPhone"> <span>Optimise for phone lines (300 to 3,400 Hz)</span></label>
          <label class="check-line" id="audioTrimRow" hidden><input type="checkbox" id="audioTrim"> <span>Trim to Horizon's 625 seconds, fading out at the end</span></label>
          <div class="tool-actions"><button class="primary-btn" data-action="audio-convert">Convert and download</button><button class="secondary-btn" data-action="audio-listen" id="audioListen" ${audioLast ? "" : "hidden"}>Listen</button></div>
          <div class="tool-result" id="audioResult" aria-live="polite">${audioLast ? esc(audioLast.summary) : ""}</div>
          <audio id="audioPlayer" controls hidden></audio>
        </div>
      </div></section>`;
  }

  const minutes = (sec) => {
    const s = Math.round(sec);
    return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
  };

  async function convertAudio() {
    const A = window.AstraAudio;
    const out = $("#audioResult");
    if (!audioFile) return toast("Choose an audio file first");
    const format = $('input[name="audioFormat"]:checked')?.value || "ulaw";
    const volume = $('input[name="audioVolume"]:checked')?.value || "medium";
    const trim = $("#audioTrim")?.checked;
    const button = $('[data-action="audio-convert"]');
    button.disabled = true;
    out.textContent = "Converting…";
    try {
      const r = await A.convert(audioFile, {
        format,
        volume,
        phone: $("#audioPhone").checked,
        maxSeconds: trim ? A.HORIZON.seconds : 0,
      });
      const kb = r.bytes.length / 1024;
      const size = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} KB`;
      const tooLong = r.format.horizon && (r.seconds > A.HORIZON.seconds || r.bytes.length > A.HORIZON.bytes);
      const lines = [`${r.name}`, `${minutes(r.seconds)} · ${size}`];
      if (trim && r.fullSeconds > r.seconds) lines.push(`Trimmed from ${minutes(r.fullSeconds)}.`);
      if (tooLong)
        lines.push(
          `Horizon accepts up to 5 MB or 625 seconds, so this is too long for it. Tick "Trim to Horizon's 625 seconds" and convert again.`,
        );
      else if (r.format.horizon)
        lines.push("Ready for Horizon: music on hold, auto attendants and call centre announcements.");
      if (audioLast) URL.revokeObjectURL(audioLast.preview);
      audioLast = {
        summary: lines.join("\n"),
        preview: URL.createObjectURL(new Blob([r.preview], { type: "audio/wav" })),
      };
      out.textContent = audioLast.summary;
      $("#audioTrimRow").hidden = !(tooLong || trim);
      $("#audioListen").hidden = false;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(
        new Blob([r.bytes], { type: r.format.ext === "wav" ? "audio/wav" : "application/octet-stream" }),
      );
      a.download = r.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (err) {
      out.textContent = err.message || "That file could not be converted.";
    } finally {
      button.disabled = false;
    }
  }

  function listenAudio() {
    if (!audioLast) return;
    const player = $("#audioPlayer");
    player.src = audioLast.preview;
    player.hidden = false;
    player.play().catch(() => {});
  }

  function wireAudioTool() {
    const card = $("#audioTool");
    if (!card) return;
    const pick = (file) => {
      if (!file) return;
      audioFile = file;
      $("#audioFileName").textContent = file.name;
      $("#audioResult").textContent = "Ready to convert.";
    };
    $("#audioFileInput").addEventListener("change", (e) => pick(e.target.files[0]));
    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      card.classList.add("dragging");
    });
    card.addEventListener("dragleave", () => card.classList.remove("dragging"));
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      card.classList.remove("dragging");
      pick(e.dataTransfer.files[0]);
    });
  }

  function toolkitPage() {
    const stamp = `${new Date().toLocaleString("en-GB")}${esc(byline(" · "))}`;
    const tool = (title, body, result, actions) =>
      `<section class="card tool-card"><h3>${title}</h3>${body}${result}${actions ? `<div class="tool-actions">${actions}</div>` : ""}</section>`;
    const btns = (name, label = "Calculate", copyLabel = "Copy result") =>
      `<button class="primary-btn" data-action="tool" data-id="${name}">${label}</button><button class="secondary-btn" data-action="tool" data-id="copy-${name}">${copyLabel}</button>`;
    const result = (id, text) => `<div class="tool-result" id="${id}" aria-live="polite">${text}</div>`;
    const today = isoDate(new Date());

    app.innerHTML =
      pageHead("Toolkit") +
      `<div class="tool-grid">
      <section class="card tool-card wide-tool"><h3>Forms and fault reports</h3>
        <div class="form-rows">
          <div class="form-row"><b>Letter of authority (LOA)</b><span>Number porting</span><div class="row-actions"><button class="primary-btn" data-action="fill-loa">Fill an LOA</button><button class="secondary-btn" data-action="form-email" data-id="loa-request">Copy email</button><a class="secondary-btn" href="${esc(encodeURI("library/company/Customer Letter of Authority (LOA).docx"))}" download>Blank LOA</a></div></div>
          <div class="form-row"><b>Customer requirement form (CRF)</b><span>Phone system set-up</span><div class="row-actions"><a class="primary-btn" href="${esc(encodeURI("library/company/Customer Requirement Form (CRF).xlsx"))}" download>Download CRF</a><button class="secondary-btn" data-action="form-email" data-id="crf-request">Copy email</button></div></div>
          <div class="form-row"><b>Supplier fault report</b><span>What Gamma or Openreach need</span><div class="row-actions"><button class="primary-btn" data-action="raise-fault" data-id="horizon">Horizon call fault</button><button class="secondary-btn" data-action="raise-fault" data-id="line">Broadband or line</button></div></div>
          <div class="form-row"><b>Openreach engineer appointment</b><span>Calendar invite</span><div class="row-actions"><button class="secondary-btn" data-action="use-template" data-id="openreach-invite">Write the invite</button></div></div>
        </div></section>
      ${tool(
        "Cancellation notice",
        `<div class="fields cols-2"><label class="field"><span>Written notice received</span><input type="date" id="noticeDate" value="${today}"></label><label class="field"><span>Contract start (optional)</span><input type="date" id="noticeStart"></label><label class="field"><span>Minimum term, months</span><input type="number" id="noticeTerm" min="1" max="240" value="${AstraContract.DEFAULT_TERM}"></label></div>`,
        result("noticeResult", ""),
        btns("notice", "Work it out", "Copy for the customer"),
      )}
      <section class="card tool-card wide-tool" id="qrTool"><h3>QR code</h3>
        <div class="qr-layout"><div class="qr-form"><div class="segmented" role="group" aria-label="What the code holds">${QR_KINDS.map(
          ([id, name]) =>
            `<button type="button" class="${qr.kind === id ? "on" : ""}" aria-pressed="${qr.kind === id}" data-action="qr-kind" data-kind="${id}">${name}</button>`,
        ).join(
          "",
        )}</div><div id="qrFields">${qrFieldsHtml()}</div><p class="hint" id="qrCaption" aria-live="polite"></p></div>
        <div class="qr-image empty" id="qrImage" role="img" aria-label="QR code"></div></div>
        <div class="tool-actions"><button class="primary-btn" data-action="qr-copy">Copy image</button><button class="secondary-btn" data-action="qr-png">Download PNG</button><button class="secondary-btn" data-action="qr-svg">Download SVG</button></div></section>
      <section class="card tool-card" id="pwTool"><h3>Password or PIN</h3>
        <div class="segmented" role="group" aria-label="Kind">${[
          ["password", "Password"],
          ["pin", "PIN"],
        ]
          .map(
            ([id, name]) =>
              `<button type="button" class="${pw.kind === id ? "on" : ""}" aria-pressed="${pw.kind === id}" data-action="pw-kind" data-kind="${id}">${name}</button>`,
          )
          .join("")}</div>
        <div id="pwFields">${pwFieldsHtml()}</div>
        <div class="tool-result pw-result" id="pwResult" aria-live="polite"></div>
        <div class="tool-actions"><button class="primary-btn" data-action="pw-make">Make another</button><button class="secondary-btn" data-action="pw-copy">Copy</button></div></section>
      <section class="card tool-card" id="spellTool"><h3>Spell it out</h3>
        <label class="field"><span>Text to read out</span><input id="spellInput" placeholder="e.g. a MAC address, reference or postcode" autocomplete="off" spellcheck="false"></label>
        <div class="tool-result net-result" id="spellResult" aria-live="polite"></div>
        <div class="tool-actions"><button class="secondary-btn" data-action="spell-copy">Copy</button></div></section>
      ${audioToolHtml()}
      ${tool(
        "Date calculator",
        `<div class="fields cols-2"><label class="field"><span>Start date</span><input type="date" id="dateStart" value="${today}"></label><label class="field"><span>Days</span><input type="number" id="dateDays" value="5"></label><label class="field"><span>Count</span><select id="dateType"><option value="weekdays">Weekdays</option><option value="calendar">Calendar days</option></select></label><label class="field"><span>Direction</span><select id="dateDirection"><option value="add">Add</option><option value="subtract">Subtract</option></select></label></div>`,
        result("dateResult", ""),
        btns("date"),
      )}
      ${tool(
        "Days between",
        `<div class="fields cols-2"><label class="field"><span>From</span><input type="date" id="betweenA"></label><label class="field"><span>To</span><input type="date" id="betweenB"></label></div>`,
        result("betweenResult", ""),
        btns("between"),
      )}
      ${tool(
        "Text cleaner",
        `<label class="field"><span>Text</span><textarea id="cleanInput" rows="6" placeholder="Paste text here"></textarea></label>`,
        "",
        btns("clean", "Clean spacing", "Copy"),
      )}
      ${tool(
        "Ticket note stamp",
        `<label class="field"><span>Note</span><textarea id="noteInput" rows="6" placeholder="Action, outcome, owner and next step"></textarea></label>`,
        result("noteResult", stamp),
        btns("note", "Build note", "Copy"),
      )}
      ${tool(
        "UK number lookup",
        `<label class="field"><span>Number or place</span><input id="phoneInput" placeholder="e.g. 0141 404 5441 or Dumfries" autocomplete="off"></label>`,
        result("phoneResult", ""),
        btns("phone", "Look up", "Copy number"),
      )}
      ${tool(
        "Appointment window",
        `<div class="fields cols-2"><label class="field"><span>Date</span><input type="date" id="apptDate"></label><label class="field"><span>Window</span><select id="apptSlot">${SLOTS.map(
          (s) => `<option>${s}</option>`,
        ).join("")}</select></label></div>`,
        result("apptResult", ""),
        btns("appointment", "Build", "Copy"),
      )}
      ${tool(
        "MAC address",
        `<label class="field"><span>MAC address</span><input id="macInput" placeholder="e.g. 80:5E:C0:12:AB:CD" autocomplete="off" spellcheck="false"></label>`,
        '<div class="tool-result net-result" id="macResult" aria-live="polite"></div>',
        "",
      )}
      ${tool(
        "IP subnet",
        `<label class="field"><span>Address</span><input id="ipInput" placeholder="e.g. 192.168.1.45/24" autocomplete="off" spellcheck="false"></label>`,
        '<div class="tool-result net-result" id="ipResult" aria-live="polite"></div>',
        "",
      )}
      <section class="card tool-card wide-tool"><h3>SIP and cause codes</h3>
        <label class="field"><span>Code or words</span><input id="codeInput" placeholder="e.g. 486, cause 34, timeout" autocomplete="off"></label>
        <div class="code-list" id="codeResult" aria-live="polite" tabindex="0" role="region" aria-label="Codes">${codeRows("")}</div></section>
    </div>`;
    $("#macInput").addEventListener("input", (e) => paintMac(e.target.value));
    $("#ipInput").addEventListener("input", (e) => paintSubnet(e.target.value));
    $("#codeInput").addEventListener("input", (e) => ($("#codeResult").innerHTML = codeRows(e.target.value)));
    $("#spellInput").addEventListener("input", (e) => paintSpell(e.target.value));
    wireAudioTool();
    wireQr();
    wirePassword();
  }

  const copyCode = (v) =>
    `<code class="copyable" data-action="copy-code" role="button" tabindex="0" title="Click to copy">${esc(v)}</code>`;

  function paintMac(value) {
    const m = AstraNet.mac(value);
    $("#macResult").innerHTML = !value.trim()
      ? ""
      : !m
        ? "Not a MAC address: it needs 12 characters, 0-9 and A-F."
        : `<dl class="net-dl"><dt>Plain</dt><dd>${copyCode(m.plain)}</dd><dt>Colons</dt><dd>${copyCode(m.colons)}</dd><dt>Dashes</dt><dd>${copyCode(m.dashes)}</dd><dt>Cisco</dt><dd>${copyCode(m.dots)}</dd><dt>Lower case</dt><dd>${copyCode(m.lower)}</dd></dl>`;
  }

  function paintSubnet(value) {
    const s = AstraNet.subnet(value);
    $("#ipResult").innerHTML = !value.trim()
      ? ""
      : !s
        ? "Not a valid IPv4 address, prefix or mask."
        : `<dl class="net-dl"><dt>Network</dt><dd>${copyCode(s.network + "/" + s.prefix)}</dd><dt>Usable</dt><dd>${copyCode(s.first)} to ${copyCode(s.last)} <small>${s.hosts.toLocaleString("en-GB")} host${s.hosts === 1 ? "" : "s"}</small></dd><dt>Broadcast</dt><dd>${copyCode(s.broadcast)}</dd><dt>Mask</dt><dd>${copyCode(s.mask)} <small>wildcard ${esc(s.wildcard)}</small></dd><dt>Type</dt><dd>${esc(s.scope)}${s.assumed ? " <small>(/24 assumed)</small>" : ""}</dd></dl>`;
  }

  function codeRows(query) {
    const list = AstraNet.search(query);
    if (!list.length) return '<p class="muted">No code matches.</p>';
    return `<table class="code-table"><thead><tr><th>Code</th><th>Name</th><th>Usually means</th></tr></thead><tbody>${list
      .map(
        (e) =>
          `<tr><td><b>${e.kind === "SIP" ? "SIP " : "Cause "}${e.code}</b></td><td>${esc(e.name)}</td><td>${esc(e.meaning)}</td></tr>`,
      )
      .join("")}</tbody></table>`;
  }

  const isWeekday = (d) => d.getDay() !== 0 && d.getDay() !== 6;

  function runTool(name) {
    const get = (id) => $("#" + id)?.value || "";
    const show = (id, text, copyable = true) => {
      $("#" + id).textContent = text;
      toolOutput[id] = copyable ? text : "";
    };

    if (name === "date") {
      const d = dateFromInput(get("dateStart"));
      if (isNaN(d)) return show("dateResult", "Enter a valid start date.", false);
      let n = Math.abs(parseInt(get("dateDays"), 10) || 0);
      if (n > 100000) return show("dateResult", "Enter up to 100,000 days.", false);
      const dir = get("dateDirection") === "subtract" ? -1 : 1;
      if (get("dateType") === "calendar") d.setDate(d.getDate() + n * dir);
      else {
        /* Any seven days in a row hold five weekdays, so whole weeks are skipped for all but the last one to five
           weekdays, which are then counted day by day: the same answer as counting every day. */
        const weeks = n > 0 ? Math.floor((n - 1) / 5) : 0;
        d.setDate(d.getDate() + weeks * 7 * dir);
        n -= weeks * 5;
        while (n) {
          d.setDate(d.getDate() + dir);
          if (isWeekday(d)) n--;
        }
      }
      show("dateResult", longDate(d));
    } else if (name === "between") {
      const a = dateFromInput(get("betweenA"));
      const b = dateFromInput(get("betweenB"));
      if (isNaN(a) || isNaN(b)) return show("betweenResult", "Enter both dates.", false);
      const sign = b >= a ? 1 : -1;
      const calendar = Math.round(Math.abs(b - a) / 86400000);
      if (calendar > 36600)
        return show("betweenResult", "Choose dates within 100 years of each other.", false);
      /* Whole weeks hold five weekdays each; only the last few days are counted one by one. */
      const cursor = new Date(a);
      let weekdays = Math.floor(calendar / 7) * 5;
      cursor.setDate(cursor.getDate() + Math.floor(calendar / 7) * 7 * sign);
      while ((sign > 0 && cursor < b) || (sign < 0 && cursor > b)) {
        cursor.setDate(cursor.getDate() + sign);
        if (isWeekday(cursor)) weekdays++;
      }
      show(
        "betweenResult",
        `${calendar} calendar day${calendar === 1 ? "" : "s"} · ${weekdays} weekday${weekdays === 1 ? "" : "s"}`,
      );
    } else if (name === "clean") {
      const el = $("#cleanInput");
      el.value = el.value
        .replace(/[ \t]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      toast("Spacing cleaned; wording unchanged");
    } else if (name === "note") {
      show("noteResult", `${new Date().toLocaleString("en-GB")}${byline(" · ")}\n${get("noteInput").trim()}`);
    } else if (name === "phone") {
      const q = get("phoneInput").trim();
      const found = AstraNumbers.lookup(q);
      if (found) {
        show("phoneResult", AstraNumbers.describe(found), found.valid);
        toolOutput.phoneResult = found.valid ? found.national : "";
        return;
      }
      const places = AstraNumbers.areaCodes(q);
      show(
        "phoneResult",
        places.length
          ? places.map((p) => `${p.code}  ${p.name}`).join("\n")
          : q
            ? "No UK number or place matches that."
            : "Enter a number or a place.",
        places.length > 0,
      );
    } else if (name === "appointment") {
      const d = get("apptDate");
      if (!d) return show("apptResult", "Choose a date and window.", false);
      show("apptResult", `${dateUK(d)} · ${get("apptSlot")}`);
    } else if (name === "notice") {
      const C = AstraContract;
      const received = get("noticeDate");
      const end = C.noticeEnd(received);
      if (!end) return show("noticeResult", "Enter the date the written notice was received.", false);
      const lines = [
        `Notice ends: ${dateUK(end)}`,
        `${C.NOTICE_DAYS} days from ${dateUK(received)}, the day it was received (T&Cs 10.2).`,
      ];
      const start = get("noticeStart");
      const months = Number(get("noticeTerm")) || C.DEFAULT_TERM;
      const term = start ? C.termEnd(start, months) : "";
      if (start && !term)
        return show("noticeResult", "Check the contract start date and the minimum term.", false);
      if (term) {
        lines.push("", `Minimum term (${months} months) ends: ${dateUK(term)}`);
        lines.push(
          C.insideTerm(received, start, months)
            ? "The notice ends inside the minimum term: early termination fees equal to the remaining contract value apply (T&Cs 10.3)."
            : "The notice ends after the minimum term.",
        );
      }
      show("noticeResult", lines.join("\n"), false);
      toolOutput.noticeResult = `We received your written notice on ${dateUK(received)}. Your ${C.NOTICE_DAYS} days' notice ends on ${dateUK(end)}.`;
    } else if (name.startsWith("copy-")) {
      const target = {
        "copy-date": "dateResult",
        "copy-between": "betweenResult",
        "copy-note": "noteResult",
        "copy-phone": "phoneResult",
        "copy-appointment": "apptResult",
        "copy-notice": "noticeResult",
      }[name];
      if (name === "copy-clean") {
        const text = get("cleanInput");
        return text ? copy(text) : toast("Nothing to copy yet");
      }
      toolOutput[target] ? copy(toolOutput[target]) : toast("Nothing to copy yet");
    }
  }

  /* -------------------------------------------------------------- appearance */

  /* Theme and text size choices. Each theme shows a small swatch of its own page, sidebar and accent colours. */
  function appearanceHtml(prefix) {
    const now = AstraTheme.get();
    const themes = AstraTheme.THEMES.map(
      (t) =>
        `<label class="theme-choice"><input type="radio" name="${prefix}Theme" value="${t.id}" data-appearance="theme" ${
          now.theme === t.id ? "checked" : ""
        }><span class="swatch swatch-${t.id}" aria-hidden="true"><i></i><i></i><i></i></span><b>${esc(t.name)}</b></label>`,
    ).join("");
    const sizes = AstraTheme.SIZES.map(
      (z) =>
        `<label class="check-line"><input type="radio" name="${prefix}Text" value="${z.id}" data-appearance="textSize" ${
          now.textSize === z.id ? "checked" : ""
        }> <span>${esc(z.name)}</span></label>`,
    ).join("");
    return `<fieldset class="theme-choices"><legend>Theme</legend>${themes}</fieldset><fieldset class="size-choices"><legend>Text size</legend>${sizes}</fieldset>`;
  }

  document.addEventListener("change", (e) => {
    const el = e.target.closest?.("[data-appearance]");
    if (el && el.checked) AstraTheme.set({ [el.dataset.appearance]: el.value });
  });

  /* ------------------------------------------------------------ first-run setup */

  /* Three short steps on a brand-new workspace: who you are, how it looks, how it behaves. Every step can be
     skipped, and closing it counts as done so it never comes back uninvited. Settings can run it again. */
  let setupStep = 0;
  function setupFlow(step = 0) {
    setupStep = step;
    const steps = ["Your details", "Appearance", "How Astra behaves"];
    const ai = AstraAI.support().ok && !installing;
    const bodies = [
      `<p>Used to sign emails and stamp ticket notes.</p><div class="fields cols-2">
        <label class="field"><span>Name</span><input id="setupName" value="${esc(state.profile.name)}" placeholder="Your name" autocomplete="name"></label>
        <label class="field"><span>Initials</span><input id="setupInitials" maxlength="4" value="${esc(state.profile.initials)}" placeholder="Made from your name"></label>
        <label class="field"><span>Company</span><input id="setupCompany" value="${esc(state.profile.company)}" autocomplete="organization"></label></div>`,
      `${appearanceHtml("setup")}`,
      `<label class="check-line"><input type="checkbox" id="setupPrivacy" ${state.settings.privacyOnHide ? "checked" : ""}> <span><b>Privacy screen</b> whenever you switch away from Astra</span></label>
       ${
         ai
           ? `<label class="check-line"><input type="checkbox" id="setupAI" ${state.ai.model ? "disabled" : ""}> <span><b>Add the AI assistant</b>: downloads once (about 0.5 GB) in the background, then works with no internet</span></label>`
           : ""
       }
       <p class="hint">Press <kbd>Ctrl K</kbd> to search everything, <kbd>?</kbd> for every shortcut, and paste a customer email on Home to triage it.${
         extensionId
           ? ` On any other page, select a customer's email, right-click and choose <b>Triage with Astra</b>; Astra Lite in the toolbar${liteKey ? ` (<kbd>${esc(liteKey)}</kbd>)` : ""} finds replies and numbers on top of whatever you are doing.`
           : ""
       }</p>`,
    ];
    const last = step === steps.length - 1;
    openModal(
      modalHead(steps[step], `Setting up Astra · step ${step + 1} of ${steps.length}`) +
        `<div class="modal-body setup-body">${bodies[step]}</div><div class="modal-foot"><div class="foot-left"><button class="secondary-btn" data-action="setup-skip">Skip setup</button></div><div>${
          step ? '<button class="secondary-btn" data-action="setup-back">Back</button>' : ""
        }<button class="primary-btn" data-action="setup-next">${last ? "Start using Astra" : "Next"}</button></div></div>`,
    );
  }

  /* Keeps what was entered on the current step. */
  function setupKeep() {
    if (setupStep === 0) {
      const name = $("#setupName").value.trim();
      state.profile = {
        name: name || state.profile.name,
        initials:
          $("#setupInitials").value.trim().toUpperCase() ||
          name
            .split(/\s+/)
            .map((w) => w[0] || "")
            .join("")
            .slice(0, 4)
            .toUpperCase() ||
          state.profile.initials,
        company: $("#setupCompany").value.trim() || state.profile.company,
      };
    } else if (setupStep === 2) {
      state.settings.privacyOnHide = $("#setupPrivacy").checked;
      return !!$("#setupAI")?.checked;
    }
    return false;
  }

  function setupFinish(addAssistant) {
    state.settings.setupDone = true;
    save();
    closeModal();
    render();
    if (addAssistant) {
      toast("Adding the AI assistant in the background. Progress is in Settings.");
      addAI();
    } else toast(state.profile.name ? `Ready, ${state.profile.name.split(" ")[0]}.` : "All set.");
    /* A guide asked for from Astra Lite while setup was showing opens now. */
    const then = afterSetup;
    afterSetup = null;
    then?.();
  }

  /* ---------------------------------------------------------------- settings */

  const shortcutEditor = (s) =>
    `<div class="shortcut-editor" data-shortcut="${esc(s.id)}"><label class="field"><span>Name</span><input data-s-field="title" value="${esc(
      s.title,
    )}"></label><label class="field url-field"><span>HTTPS address</span><input data-s-field="url" value="${esc(
      s.url,
    )}"></label><label class="field"><span>Alt key</span><input data-s-field="key" maxlength="1" value="${esc(
      s.key || "",
    )}"></label><button class="danger-btn" data-action="remove-shortcut" data-id="${esc(s.id)}" aria-label="Remove ${esc(
      s.title,
    )}">×</button></div>`;

  const toggleRow = (key, title, hint) =>
    `<div class="switch-row"><span><b>${title}</b><small>${hint}</small></span><button class="switch ${
      state.settings[key] ? "on" : ""
    }" role="switch" aria-checked="${state.settings[key]}" data-action="toggle" data-id="${key}" aria-label="${title}"><i></i></button></div>`;

  function settingsPage() {
    app.innerHTML =
      pageHead("Settings") +
      `<div class="settings-sections">
      <section class="card setting-card"><h3>Appearance</h3>${appearanceHtml("set")}
        <div class="tool-actions"><button class="secondary-btn" data-action="setup">Run setup again</button></div></section>
      <section class="card setting-card"><h3>Privacy</h3>
        ${toggleRow("privacyOnHide", "Privacy screen when hidden", "Covers Astra when you switch tabs or minimise.")}
      </section>
      <section class="card setting-card"><h3>Quick line shortcuts</h3><p>Type a quick line's shortcut and a space, such as <kbd>;close5</kbd>, and it becomes the line. Works in every box in Astra; set them on the Templates page.</p>
        ${
          extensionId
            ? `<div class="switch-row"><span><b>In Zoho Desk too</b><small>Asks the browser for access to Zoho's pages (zoho.eu and zoho.com). Only the characters just before the cursor are read, and nothing is sent anywhere.</small></span><button class="switch ${
                state.settings.zohoShortcuts ? "on" : ""
              }" role="switch" aria-checked="${state.settings.zohoShortcuts}" data-action="zoho-shortcuts" aria-label="Quick line shortcuts in Zoho Desk"><i></i></button></div>`
            : ""
        }
      </section>
      <section class="card setting-card" id="aiSettings" hidden><h3>AI assistant</h3><p>Writes answers in Ask from your guides and documents, on this computer. Commands, links and codes are checked against the documents.</p>
        <div id="aiStatus" class="ai-status" role="status"></div>
        <div id="aiAdd" hidden>
          <div class="ai-choices">${AstraModels.CATALOG.map(
            (m, n) =>
              `<label class="check-line"><input type="radio" name="aiPick" value="${esc(m.id)}" ${n === 0 ? "checked" : ""}> <span><b>${esc(m.name)}</b> · ${esc(m.note)}</span></label>`,
          ).join("")}</div>
          <div class="tool-actions"><button class="primary-btn" data-action="add-ai">Add the AI assistant</button></div>
          <div id="aiProgress" class="ai-progress" hidden><progress id="aiBar" max="100" value="0" aria-label="Download progress"></progress><span id="aiProgressText"></span><button class="small-btn" data-action="cancel-ai">Cancel</button></div>
        </div>
        <div id="aiReady" hidden><div class="fields cols-2 mt"><label class="field"><span>Model</span><select id="aiModel"><option value="">None installed</option></select></label></div>
        <label class="check-line"><input type="checkbox" id="aiEnabled" ${state.ai.enabled ? "checked" : ""}> <span><b>Use the local AI assistant</b></span></label>
        <div class="tool-actions"><button class="primary-btn" data-action="save-ai">Save</button><button class="secondary-btn" data-action="test-ai">Check the model</button><button class="secondary-btn" data-action="remove-ai">Remove</button></div>
        <div id="aiTest" class="ai-test-result" aria-live="polite"></div></div></section>
      <section class="card setting-card" id="gapSettings"><h3>Unanswered questions</h3><p>Questions Ask could not answer or that were marked not helpful. Email addresses, phone numbers and postcodes are removed.</p>
        ${
          state.gaps.length
            ? `<ul class="gap-list">${state.gaps
                .map(
                  (g, i) =>
                    `<li><span>${esc(g.q)}</span> <small>${g.why === "unhelpful" ? "not helpful" : g.why === "weak" ? "weak match" : "no match"}${g.n > 1 ? ` · asked ${g.n} times` : ""}</small> <button class="small-btn" data-action="del-gap" data-i="${i}" aria-label="Remove: ${esc(g.q)}">Remove</button></li>`,
                )
                .join(
                  "",
                )}</ul><div class="tool-actions"><button class="secondary-btn" data-action="copy-gaps">Copy the list</button><button class="danger-btn" data-action="clear-gaps">Clear</button></div>`
            : '<p class="hint">None yet.</p>'
        }</section>
      <section class="card setting-card"><h3>Your details</h3><div class="fields cols-2"><label class="field"><span>Name</span><input id="profileName" value="${esc(
        state.profile.name,
      )}"></label><label class="field"><span>Company</span><input id="profileCompany" value="${esc(
        state.profile.company,
      )}"></label><label class="field"><span>Initials</span><input id="profileInitials" maxlength="4" value="${esc(
        state.profile.initials,
      )}"></label></div><div class="tool-actions"><button class="primary-btn" data-action="save-profile">Save details</button></div></section>
      <section class="card setting-card"><div class="section-title"><div><h3>Work shortcuts</h3><p>HTTPS links. Alt + key opens one.</p></div><button data-action="add-shortcut">Add</button></div><div id="shortcutList">${state.shortcuts
        .map(shortcutEditor)
        .join(
          "",
        )}</div><div class="tool-actions"><button class="primary-btn" data-action="save-shortcuts">Save shortcuts</button></div></section>
      <section class="card setting-card"><h3>Backup</h3><div class="actions"><button class="secondary-btn" data-action="export">Export backup</button><button class="secondary-btn" data-action="import">Import backup</button></div></section>
      <section class="card setting-card"><h3>Reset</h3><p>Restores the built-in templates, quick lines, workflows, guides and shortcuts. Export a backup first to keep your own.</p><button class="danger-btn" data-action="reset">Reset Astra</button></section>
    </div>`;
  }

  function readAIForm() {
    return normalAI({
      model: $("#aiModel").value,
      enabled: $("#aiEnabled").checked,
    });
  }

  /* The AI card: offer to add the model when none is installed, otherwise the usual settings. */
  async function fillAI() {
    const box = $("#aiStatus");
    if (!box) return;
    const support = AstraAI.support();
    const list = support.ok ? await AstraAI.installed() : [];
    if (!$("#aiStatus")) return; /* page changed while waiting */
    const select = $("#aiModel");
    select.innerHTML = list.length
      ? list
          .map(
            (m) =>
              `<option value="${esc(m.id)}">${esc(m.name || m.id)}${m.size ? " · " + esc(m.size) : ""}</option>`,
          )
          .join("")
      : '<option value="">None installed</option>';
    if (list.some((m) => m.id === state.ai.model)) select.value = state.ai.model;
    if ($("#aiEnabled")) $("#aiEnabled").checked = state.ai.enabled;
    select.disabled = !list.length;
    /* Nothing to offer where the browser cannot run a model (a page opened from a file). */
    $("#aiSettings").hidden = !support.ok;
    $("#aiReady").hidden = !list.length;
    $("#aiAdd").hidden = !!list.length;
    /* Only models added from here can be removed from here; a models folder is managed on disk. */
    const removable = () => list.find((m) => m.id === select.value)?.source === "browser";
    $('[data-action="remove-ai"]').hidden = !removable();
    select.onchange = () => ($('[data-action="remove-ai"]').hidden = !removable());
    if (installing) showInstalling();
    box.textContent = list.length
      ? "Installed on this computer. It starts on the first question after Astra opens and needs no internet."
      : "Downloads once, then works with no internet. Nothing you type is ever sent anywhere.";
  }

  /* --------------------------------------------------------------- AI install */

  let installing = null; /* { controller, loaded, total } while a download runs, kept across page changes */

  function showInstalling() {
    const bar = $("#aiBar");
    if (!bar || !installing) return;
    $("#aiProgress").hidden = false;
    $('[data-action="add-ai"]').disabled = true;
    const { loaded, total } = installing;
    bar.value = total ? Math.round((loaded / total) * 100) : 0;
    $("#aiProgressText").textContent = total
      ? `${Math.round(loaded / 1e6)} of ${Math.round(total / 1e6)} MB`
      : "Looking up the model…";
  }

  async function addAI() {
    if (installing) return;
    const pick = $('input[name="aiPick"]:checked')?.value;
    const entry = AstraModels.CATALOG.find((m) => m.id === pick) || AstraModels.CATALOG[0];
    installing = { controller: new AbortController(), loaded: 0, total: 0 };
    showInstalling();
    try {
      const record = await AstraModels.install(entry, {
        signal: installing.controller.signal,
        onProgress: (p) => {
          installing.loaded = p.loaded;
          installing.total = p.total;
          showInstalling();
        },
      });
      /* Ready to use straight away: no further settings to change. */
      state.ai = normalAI({ ...state.ai, enabled: true, model: record.id });
      save();
      toast(`${record.name} added. Ask now writes answers.`);
    } catch (err) {
      toast(err.name === "AbortError" ? "Download cancelled" : err.message || "The model could not be added");
    } finally {
      installing = null;
      if (page === "Settings") fillAI();
    }
  }

  async function removeAI() {
    const model = $("#aiModel")?.value || state.ai.model;
    if (!model || !confirm("Remove the AI model from this computer? You can add it again later.")) return;
    await AstraAI.unload();
    await AstraModels.remove(model);
    state.ai = normalAI({ ...state.ai, enabled: false, model: "" });
    save();
    render();
    toast("AI model removed");
  }

  function saveAI() {
    const ai = readAIForm();
    if ($("#aiEnabled").checked && !ai.model) return toast("Choose an installed model first");
    state.ai = ai;
    save();
    toast(ai.enabled ? "Local AI assistant on" : "Local AI assistant off");
  }

  async function testAI() {
    const ai = readAIForm();
    const out = $("#aiTest");
    if (!ai.model) return toast("Choose an installed model first");
    const button = $('[data-action="test-ai"]');
    button.disabled = true;
    out.textContent = "Loading the model… the first time can take a minute.";
    try {
      const r = await AstraAI.selfTest(ai.model, {
        onStep: (n, total) => (out.textContent = `Asking question ${n} of ${total}…`),
      });
      out.innerHTML = `<p><b>${r.passed} of ${r.total} correct.</b> Loaded in ${(r.loadMs / 1000).toFixed(1)} s on ${esc(r.device === "webgpu" ? "the graphics card (WebGPU)" : r.device === "wasm" ? "the processor (no WebGPU)" : r.device)}, about ${r.tokensPerSecond.toFixed(1)} words-pieces per second.</p><ul>${r.results
        .map(
          (x) =>
            `<li class="${x.pass ? "pass" : "fail"}">${x.pass ? "Correct" : "Wrong"}: ${esc(x.question)} → ${esc(x.answer || "(no answer)")}</li>`,
        )
        .join("")}</ul>${
        r.passed < r.total
          ? "<p>This model is not reliable enough. Try the larger one.</p>"
          : "<p>Ready to use.</p>"
      }`;
    } catch (err) {
      out.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  }

  function saveShortcuts() {
    const rows = [...document.querySelectorAll("[data-shortcut]")];
    const edited = rows.map((row) => {
      const next = { id: row.dataset.shortcut };
      row.querySelectorAll("[data-s-field]").forEach((i) => (next[i.dataset.sField] = i.value.trim()));
      return next;
    });
    if (edited.some((s) => !/^https:\/\//i.test(s.url)))
      return toast("Each shortcut must start with https://");
    state.shortcuts = edited.map(normalShortcut);
    save();
    toast("Shortcuts saved");
  }

  function exportBackup() {
    const data = {
      ...state,
      appearance: AstraTheme.get(),
      exportedAt: new Date().toISOString(),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `astra-backup-${isoDate(new Date())}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Full backup downloaded");
  }

  async function importBackup(file) {
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      if (!isObject(raw) || !Array.isArray(raw.templates) || !Array.isArray(raw.shortcuts))
        throw new Error("not a backup");
      const ai =
        state.ai; /* which model is installed depends on this device, so the assistant settings stay as they are */
      state = hydrate(raw);
      state.ai = ai;
      if (isObject(raw.appearance)) AstraTheme.set(AstraTheme.clean(raw.appearance));
      resetReplies();
      AstraTriageView.reset();
      save();
      render();
      toast("Backup imported and saved");
    } catch {
      toast("That file is not a valid Astra backup");
    }
  }

  /* ------------------------------------------------------------------ events */

  const ACTIONS = {
    page: (el) => go(el.dataset.id),
    menu: () => $("#sidebar").classList.toggle("open"),
    lock: () => {
      $("#privacyScreen").classList.add("show");
      $("#privacyScreen button").focus();
    },
    unlock: () => $("#privacyScreen").classList.remove("show"),
    "global-search": globalSearch,
    "run-search": runStartSearch,
    mode: (el) => {
      searchMode = el.dataset.id;
      for (const b of document.querySelectorAll('[data-action="mode"]')) {
        b.classList.toggle("active", b.dataset.id === searchMode);
        b.setAttribute("aria-pressed", b.dataset.id === searchMode);
      }
      const input = $("#startSearch");
      input.placeholder = searchMode === "Google" ? "Search Google" : "Find a template, workflow or guide";
      $("#searchResults").innerHTML = "";
      if (searchMode === "Astra" && input.value.trim()) showStartResults(input.value);
      input.focus();
    },
    category: (el) => {
      categoryFilter = el.dataset.id === "All" ? "" : el.dataset.id;
      if (repaint) keep(repaint);
    },
    "toggle-pin": (el) => {
      const t = state.templates.find((x) => x.id === el.dataset.id);
      if (!t) return;
      t.favourite = !t.favourite;
      save();
      if (repaint) keep(repaint);
    },
    "use-template": (el) => (closeModal(), useTemplate(el.dataset.id)),
    "edit-template": (el) => (closeModal(), editTemplate(el.dataset.id)),
    "new-template": () => editTemplate(),
    "copy-line": (el) => {
      const inSearch = !!el.closest(".modal");
      if (inSearch) closeModal();
      copyLine(el.dataset.id, inSearch ? null : el);
    },
    "edit-line": (el) => (closeModal(), editLine(el.dataset.id)),
    "new-line": () => editLine(),
    "star-line": (el) => {
      const l = state.snippets.find((x) => x.id === el.dataset.id);
      if (!l) return;
      l.favourite = !l.favourite;
      save();
      el.classList.toggle("on", l.favourite);
      el.setAttribute("aria-pressed", l.favourite);
      el.textContent = l.favourite ? "★" : "☆";
      toast(l.favourite ? "Starred: on Home and in Astra Lite" : "Unstarred");
    },
    "template-tab": (el) => {
      templateTab = el.dataset.id === "templates" ? "templates" : "lines";
      if (page !== "Templates") return go("Templates");
      filter = "";
      categoryFilter = "";
      keep(templatesPage);
    },
    "quick-lines": () => {
      templateTab = "lines";
      go("Templates");
    },
    "run-workflow": (el) => (closeModal(), runWorkflow(el.dataset.id)),
    "edit-workflow": (el) => (closeModal(), editWorkflow(el.dataset.id)),
    "new-workflow": () => editWorkflow(),
    "view-knowledge": (el) => (closeModal(), viewKnowledge(el.dataset.id)),
    "ff-more": (el) => {
      faultFinderOpen = !faultFinderOpen;
      el.closest(".fault-finder").classList.toggle("collapsed", !faultFinderOpen);
      el.setAttribute("aria-expanded", faultFinderOpen);
      el.textContent = faultFinderOpen
        ? "Fewer"
        : `${state.knowledge.filter((k) => k.quick).length - FF_SHOWN} more`;
    },
    "edit-knowledge": (el) => (closeModal(), editKnowledge(el.dataset.id)),
    "new-knowledge": () => editKnowledge(),
    close: () => {
      if (modal.querySelector(".setup-body")) return setupFinish(false);
      closeModal();
    },
    setup: () => setupFlow(0),
    "setup-skip": () => setupFinish(false),
    "setup-back": () => {
      setupKeep();
      setupFlow(setupStep - 1);
    },
    "setup-next": () => {
      const ai = setupKeep();
      if (setupStep < 2) setupFlow(setupStep + 1);
      else setupFinish(ai);
    },
    tool: (el) => runTool(el.dataset.id),
    "go-tool": (el) => {
      closeModal();
      go("Toolkit");
      const card = $("#" + el.dataset.id);
      if (!card) return;
      card.scrollIntoView({ block: "center" });
      card.querySelector("input, textarea, button")?.focus();
    },
    "qr-kind": (el) => {
      qr.kind = el.dataset.kind;
      for (const b of document.querySelectorAll('[data-action="qr-kind"]')) {
        b.classList.toggle("on", b.dataset.kind === qr.kind);
        b.setAttribute("aria-pressed", String(b.dataset.kind === qr.kind));
      }
      $("#qrFields").innerHTML = qrFieldsHtml();
      paintQr();
      $("#qrFields").querySelector("input, textarea")?.focus();
    },
    "qr-copy": async () => {
      if (!qr.last) return toast("Fill in the details first");
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": qrPng() })]);
        toast("QR code copied: paste it into the email");
      } catch {
        toast("The browser would not copy the image here. Download it instead.");
      }
    },
    "qr-png": async () => {
      if (!qr.last) return toast("Fill in the details first");
      saveBlob(await qrPng(), qrFileName("png"));
    },
    "qr-svg": () => {
      if (!qr.last) return toast("Fill in the details first");
      saveBlob(new Blob([AstraQR.svg(qr.last.code)], { type: "image/svg+xml" }), qrFileName("svg"));
    },
    "pw-kind": (el) => {
      pw.kind = el.dataset.kind;
      for (const b of document.querySelectorAll('[data-action="pw-kind"]')) {
        b.classList.toggle("on", b.dataset.kind === pw.kind);
        b.setAttribute("aria-pressed", String(b.dataset.kind === pw.kind));
      }
      $("#pwFields").innerHTML = pwFieldsHtml();
      makePassword();
    },
    "pw-make": makePassword,
    "pw-copy": () => (pw.value ? copy(pw.value, `${pw.kind === "pin" ? "PIN" : "Password"} copied`) : null),
    "spell-copy": () => {
      const v = $("#spellInput")?.value || "";
      return v ? copy(AstraPhonetic.line(v), "Copied") : toast("Nothing to copy yet");
    },
    "audio-convert": convertAudio,
    "audio-listen": listenAudio,
    toggle: (el) => {
      const key = el.dataset.id;
      state.settings[key] = !state.settings[key];
      save();
      el.classList.toggle("on", state.settings[key]);
      el.setAttribute("aria-checked", state.settings[key]);
    },
    "save-profile": () => {
      state.profile = {
        name: $("#profileName").value.trim(),
        company: $("#profileCompany").value.trim(),
        initials: $("#profileInitials").value.trim().toUpperCase(),
      };
      save();
      toast("Details saved");
    },
    "add-shortcut": () => {
      const s = { id: uid(), title: "New shortcut", url: "https://", key: "" };
      state.shortcuts.push(s);
      save();
      $("#shortcutList").insertAdjacentHTML("beforeend", shortcutEditor(s));
      $(`[data-shortcut="${s.id}"] input`).focus();
    },
    "remove-shortcut": (el) => {
      state.shortcuts = state.shortcuts.filter((x) => x.id !== el.dataset.id);
      save();
      const row = el.closest("[data-shortcut]");
      (row.nextElementSibling?.querySelector("input") || $('[data-action="add-shortcut"]'))?.focus();
      row.remove();
    },
    "copy-code": (el) => copy(el.textContent, "Copied: " + el.textContent.slice(0, 60)),
    "save-shortcuts": saveShortcuts,
    "copy-gaps": () =>
      copy(
        state.gaps.map((g) => `- ${g.q}${g.n > 1 ? ` (asked ${g.n} times)` : ""}`).join("\n"),
        "List copied",
      ),
    "clear-gaps": () => {
      if (!confirm("Clear the list of questions Astra could not answer?")) return;
      state.gaps = [];
      save();
      render();
    },
    "del-gap": (el) => {
      state.gaps.splice(Number(el.dataset.i), 1);
      save();
      render();
    },
    "open-tool": (el) => {
      const value = el.dataset.id;
      closeModal();
      go("Toolkit");
      const number = AstraNumbers.lookup(value) || AstraNumbers.areaOf(value);
      const target = AstraNet.mac(value)
        ? "macInput"
        : AstraNet.subnet(value)
          ? "ipInput"
          : number
            ? "phoneInput"
            : "codeInput";
      const input = $("#" + target);
      input.value = value;
      input.dispatchEvent(new Event("input"));
      if (number) runTool("phone");
      input.scrollIntoView({ block: "center" });
      input.focus();
    },
    keys: showKeys,
    "fill-loa": fillLoa,
    "raise-fault": (el) => showFault(el.dataset.id || ""),
    "fault-kind": (el) => {
      faultDraft(el.dataset.id);
      for (const b of modal.querySelectorAll('[data-action="fault-kind"]')) {
        b.classList.toggle("on", b.dataset.id === fault.kind);
        b.setAttribute("aria-pressed", b.dataset.id === fault.kind);
      }
      $("#faultForm").innerHTML = faultFormHtml();
      paintFault();
    },
    "fault-add": () => {
      fault.examples.push({
        when: "",
        from: "",
        to: "",
        handset: fault.examples[0]?.handset || "",
        what: "",
      });
      $("#faultForm").innerHTML = faultFormHtml();
      paintFault();
      modal.querySelector(`[data-fault-example="${fault.examples.length - 1}"]`)?.focus();
    },
    "fault-drop": (el) => {
      fault.examples.splice(Number(el.dataset.id), 1);
      $("#faultForm").innerHTML = faultFormHtml();
      paintFault();
    },
    "fault-copy": () => {
      const out = faultReport();
      copy(out.text, out.missing.length ? `Copied. Still needed: ${out.missing[0]}` : "Fault report copied");
    },
    "add-ai": addAI,
    "cancel-ai": () => installing?.controller.abort(),
    "remove-ai": removeAI,
    "form-email": (el) => formEmail(el.dataset.id),
    "open-replies": (el) => {
      closeModal();
      const [situation, stage] = String(el.dataset.id).split("|");
      openReplies(situation, el.dataset.stage || stage);
    },
    "reply-situation": (el) => {
      const s = R.situationById(el.dataset.id);
      rb.situation = s.id;
      if (el.dataset.stage) rb.stage = el.dataset.stage;
      else if (!R.stagesFor(s, rb.audience).some((x) => x.id === rb.stage))
        rb.stage = s.kind === "howto" ? "answer" : "first-reply";
      for (const b of document.querySelectorAll(".reply-item")) {
        b.classList.toggle("on", b.dataset.id === s.id);
        b.setAttribute("aria-pressed", b.dataset.id === s.id);
      }
      paintReply();
      if (window.innerWidth < 980) $("#replyWrite")?.scrollIntoView({ block: "start" });
    },
    "reply-stage": (el) => {
      rb.stage = el.dataset.id;
      keep(paintReply);
    },
    "reply-opt": (el) => {
      rb[el.dataset.name] = el.dataset.id;
      keep(paintReply);
    },
    "copy-reply": copyReply,
    "copy-subject": () => copy($("#replySubject").value, "Subject copied"),
    "save-reply": saveReplyTemplate,
    "zoho-shortcuts": async (el) => {
      const ZOHO = ["https://*.zoho.eu/*", "https://*.zoho.com/*"];
      const on = !state.settings.zohoShortcuts;
      let ok = false;
      try {
        if (on) ok = await chrome.permissions.request({ origins: ZOHO });
        else await chrome.permissions.remove({ origins: ZOHO }).catch(() => {});
        if (!on || ok) ok = await chrome.runtime.sendMessage({ type: "astra-shortcuts", on });
      } catch {
        ok = false;
      }
      state.settings.zohoShortcuts = on && ok === true;
      save();
      el.classList.toggle("on", state.settings.zohoShortcuts);
      el.setAttribute("aria-checked", state.settings.zohoShortcuts);
      toast(
        state.settings.zohoShortcuts
          ? "Shortcuts are on in Zoho Desk. Reload any Zoho tab already open."
          : on
            ? "Not allowed, so shortcuts stay off in Zoho Desk"
            : "Shortcuts are off in Zoho Desk",
      );
    },
    "close-today": () => {
      const el = $('[data-reply="close_date"]');
      if (!el) return;
      el.value = isoDate(new Date());
      el.dispatchEvent(new Event("change"));
    },
    recopy: (el) => {
      const a = state.activity.find((x) => x.id === el.dataset.id);
      if (a?.text) copy(a.text, "Copied again");
    },
    "save-ai": saveAI,
    "test-ai": testAI,
    "ask-from-search": (el) => (closeModal(), AstraAsk.ask(el.dataset.q)),
    export: exportBackup,
    import: () => $("#importFile").click(),
    reset: () => {
      if (!confirm("Reset Astra to its built-in content? Export first if you need your current work."))
        return;
      try {
        localStorage.removeItem(KEY);
      } catch {
        /* storage unavailable: the reset still applies in memory */
      }
      state = hydrate(null);
      resetReplies();
      AstraTriageView.reset();
      save();
      render();
      toast("Workspace reset");
    },
  };

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (el) ACTIONS[el.dataset.action]?.(el);
  });

  document.addEventListener("submit", (e) => {
    if (e.target.id !== "homeTriage") return;
    e.preventDefault();
    const text = $("#homeTriageInput").value;
    if (!text.trim()) return toast("Paste an email or ticket first");
    AstraTriageView.start(text);
    go("Triage");
  });

  document.addEventListener("keydown", (e) => {
    if (e.target.id === "homeTriageInput" && e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      $("#homeTriage").requestSubmit();
    }
  });

  modalLayer.addEventListener("mousedown", (e) => {
    if (e.target === modalLayer) ACTIONS.close();
  });

  $("#importFile").addEventListener("change", (e) => {
    importBackup(e.target.files[0]);
    e.target.value = "";
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.settings.privacyOnHide) $("#privacyScreen").classList.add("show");
  });

  document.addEventListener("keydown", (e) => {
    const typing = e.target.matches?.("input, textarea, select");
    const modalOpen = modalLayer.classList.contains("open");

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      globalSearch();
      return;
    }
    if (e.key === "Escape") {
      if ($("#privacyScreen").classList.contains("show")) return ACTIONS.unlock();
      /* Esc in a box on the page steps out of it, so single-key shortcuts work again. */
      if (typing && !modalOpen && app.contains(e.target)) {
        const results = $("#searchResults");
        if (e.target.id === "startSearch" && results?.classList.contains("show")) {
          results.className = "search-results";
          return;
        }
        e.target.blur();
        return;
      }
      ACTIONS.close();
      $("#sidebar").classList.remove("open");
      return;
    }
    if (e.key === "Tab" && modalOpen) {
      const focusable = [...modal.querySelectorAll("button, input, textarea, select, a[href]")].filter(
        (el) => !el.disabled && el.offsetParent !== null,
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
      else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
      return;
    }
    if ((e.key === "Enter" || e.key === " ") && e.target.matches?.('[data-action="copy-code"]')) {
      e.preventDefault();
      ACTIONS["copy-code"](e.target);
      return;
    }
    /* Alt shortcuts work while typing too: Alt and a letter types nothing in a text box. AltGr (Ctrl and Alt
       together) is left alone, as it types characters such as € on many keyboards. */
    if (e.altKey && !e.ctrlKey && !e.metaKey && !modalOpen) {
      /* e.code is layout-independent; e.key can be a symbol when Alt is held on some keyboards. */
      const pressed = e.code.replace(/^(Key|Digit)/, "").toUpperCase();
      /* Alt 1 to 9 (and 0 for the tenth) opens a page, unless a portal shortcut has claimed that number. */
      const at = pressed === "0" ? 9 : Number(pressed) - 1;
      if (/^[0-9]$/.test(pressed) && PAGES[at] && !state.shortcuts.some((x) => x.key === pressed)) {
        e.preventDefault();
        go(PAGES[at]);
        return;
      }
      const s = state.shortcuts.find((x) => x.key === pressed);
      const href = s && shortcutHref(s.url);
      if (href && href !== "#") {
        e.preventDefault();
        open(href, "_blank", "noopener,noreferrer");
      }
    }
    if (typing || modalOpen) return;
    if (e.key === "/" && page === "Home") {
      e.preventDefault();
      $("#startSearch")?.focus();
      return;
    }
    if (e.key === "?") {
      e.preventDefault();
      showKeys();
      return;
    }
  });

  /* Astra is the new-tab page, so several copies are often open. A change saved in one is taken up by the others
     quietly: after a short pause, and not while someone is typing or has a window open in this one. */
  let syncTimer = 0;
  function syncFromStorage() {
    if (document.hidden || modalLayer.classList.contains("open")) {
      syncTimer = setTimeout(syncFromStorage, 1500);
      return;
    }
    syncTimer = 0;
    const typing =
      document.activeElement &&
      /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) &&
      app.contains(document.activeElement);
    state = load();
    /* Mid-sentence, the page is left alone; it picks up the change on its next repaint. */
    if (!typing) render();
  }
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncFromStorage, 400);
  });

  setInterval(() => {
    const clock = $("#clock");
    if (page === "Home" && clock) clock.textContent = clockTime();
  }, 15000);

  AstraAsk.init({
    version: () => state.updatedAt,
    knowledge: () => state.knowledge,
    workflows: () => state.workflows,
    templates: () => state.templates,
    ai: () => state.ai,
    currentPage: () => page,
    go,
    openGuide: (id) => (closeModal(), viewKnowledge(id)),
    openWorkflow: (id) => (closeModal(), runWorkflow(id)),
    openTemplate: (id) => (closeModal(), useTemplate(id)),
    copy,
    logGap,
    gapCount: () => state.gaps.length,
  });

  AstraTriageView.init({
    version: () => state.updatedAt,
    knowledge: () => state.knowledge,
    workflows: () => state.workflows,
    templates: () => state.templates,
    profile: () => state.profile,
    stamp: () => `${stampTime()}${byline(" · ")}`,
    openGuide: (id) => viewKnowledge(id),
    openWorkflow: (id) => runWorkflow(id),
    copy: (text, message, title) => {
      if (title) {
        noteCopy(title, text);
        save();
      }
      return copy(text, message);
    },
    toast,
    onRead: () => resetReplies(),
  });

  /* Quick line shortcuts typed in any box in Astra: ;close5 and a space becomes the line. */
  let shortcutCache = { at: null, lines: {} };
  function shortcutData() {
    if (shortcutCache.at !== state.updatedAt)
      shortcutCache = { at: state.updatedAt, lines: AstraExpand.linesOf(state.snippets) };
    return { lines: shortcutCache.lines, values: lineValues() };
  }
  /* Text areas only: a shortcut typed in a search, filter or detail box is left as typed. */
  AstraExpand.attach(document, shortcutData, { skip: (el) => el.tagName !== "TEXTAREA" });

  if (savedBefore && seedChanged) save();
  render();
  /* Links from Astra Lite and emails sent from the right-click menu work on first run too: setup opens over the page
     they lead to, and a guide opens once setup is done. */
  let afterSetup = null;
  const setupShowing = () => !!document.querySelector(".setup-body");
  const showPage = (next) => {
    if (!setupShowing()) return go(next);
    page = next;
    render();
  };
  /* Automated browsers (tests) skip setup unless the address asks for it with #setup. */
  if (!state.settings.setupDone && (!navigator.webdriver || location.hash === "#setup")) setupFlow(0);
  openFromLink();

  /* #guide=<id> and #reply=<situation>|<stage> come from Astra Lite; #triage=<id> from the right-click menu or Astra
     Lite. They carry ids only, never customer details, and are cleared at once so a reload does not repeat them. */
  function openFromLink() {
    let hash = "";
    try {
      hash = decodeURIComponent(location.hash);
    } catch {
      return;
    }
    const m = hash.match(/^#(guide|reply|triage)=([\w.|-]{1,120})$/);
    if (!m) return;
    history.replaceState(null, "", location.pathname + location.search);
    const [, kind, id] = m;
    if (kind === "triage") return takeTriage(id);
    if (kind === "guide") {
      if (!state.knowledge.some((k) => k.id === id)) return;
      showPage("Knowledge");
      if (setupShowing()) afterSetup = () => viewKnowledge(id);
      else viewKnowledge(id);
      return;
    }
    const [situation, stage = ""] = id.split("|");
    const s = R.situationById(situation);
    if (!s) return;
    openReplies(situation, R.stagesFor(s).some((x) => x.id === stage) ? stage : "", showPage);
  }

  /* The email waits in session storage (memory only, readable by Astra's pages only) under its own id, so two sent
     in quick succession each reach their own tab. It is taken once, and ignored if more than two minutes old; any
     left by a tab that closed before it loaded are tidied away at the same time. */
  async function takeTriage(id) {
    const store = window.chrome?.storage?.session;
    if (!store) return;
    const KEY = "astra.triage." + id;
    const fresh = (x) => isObject(x) && Date.now() - x.at < 120000;
    let all = {};
    try {
      all = await store.get(null);
      const done = Object.keys(all).filter(
        (k) => k.startsWith("astra.triage.") && (k === KEY || !fresh(all[k])),
      );
      if (done.length) await store.remove(done);
    } catch {
      return;
    }
    const sent = all[KEY];
    if (!fresh(sent) || typeof sent.text !== "string" || !sent.text.trim()) return;
    AstraTriageView.start(sent.text.slice(0, 50000));
    showPage("Triage");
  }

  /* After the first paint: load the document text, then build the search engine while the browser is idle,
     so the first question is answered at once. Open pages that search documents refresh when it arrives. */
  KB.onIndex(() => {
    if (page === "Library" || page === "Knowledge") repaint?.();
    for (const id of ["globalSearchInput", "startSearch"]) {
      const el = document.getElementById(id);
      if (el && el.value.trim()) el.dispatchEvent(new Event("input"));
    }
  });
  const whenIdle = window.requestIdleCallback || ((fn) => setTimeout(fn, 50));
  /* Each step works in small slices while the browser is idle, so even a slow computer stays responsive. */
  setTimeout(() =>
    KB.loadIndex()
      .then(() => KB.warm())
      .then(() => AstraAssistant.prepare())
      .then(() => whenIdle(() => AstraAsk.engine())),
  );
})();
