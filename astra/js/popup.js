/* Astra Lite: the toolbar popup. One search box finds replies, templates, guides, systems, UK numbers and SIP or ISDN
   cause codes; Enter copies or opens. It reads the workspace the new-tab page saves (the same extension storage) and
   never writes to it, so the two can never overwrite each other's changes. */
(function () {
  "use strict";

  const KEY = "astra.offline.fresh.v1";
  const R = window.AstraReplies;
  const SLOTS = ["AM 08:00–13:00", "PM 13:00–18:00"];
  /* Built-in content, loaded only on a computer where Astra itself has never been opened (nothing saved yet).
     Keep in step with index.html: tests/popup.test.mjs checks it. */
  const SEED_FILES = [
    "templates",
    "snippets",
    "shortcuts",
    "profile",
    "knowledge",
    "knowledge-horizon",
    "knowledge-horizon-admin",
    "knowledge-handsets",
    "knowledge-voxone",
    "knowledge-public",
    "knowledge-gamma",
    "knowledge-network-orders",
    "company",
  ];
  const PLACEHOLDER = /\{\s*([^}]+?)\s*\}/g;
  /* {date}, {port_date}, {close_date}: a date box. Not {update_time}, which is a time. */
  const isDateKey = (k) => k === "date" || k.endsWith("_date");
  const STAGE_GROUPS = ["Start", "Updates", "Engineer", "Finish"];
  const PER_KIND = 4;

  const $ = (selector) => document.querySelector(selector);
  const view = $("#liteView");
  const input = $("#liteSearch");
  const count = $("#liteCount");

  const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" };
  const esc = (s) => String(s ?? "").replace(/[&<>'"]/g, (c) => ESCAPES[c]);
  const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const asList = (v) => (Array.isArray(v) ? v : []);
  const asText = (v, fallback = "") => (typeof v === "string" ? v : fallback);

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
  /* "2026-10-14" from a date box -> "Wednesday 14 October 2026", the way Astra writes dates. */
  const dateUK = (value) => {
    const d = value ? new Date(value + "T12:00:00") : new Date(NaN);
    return isNaN(d) ? "" : `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  };

  const httpsUrl = (url) => {
    try {
      const u = new URL(url);
      return u.protocol === "https:" ? u.href : "";
    } catch {
      return "";
    }
  };
  const host = (url) => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  };

  /* ---------------------------------------------------------------- workspace */

  function readSaved() {
    try {
      const x = JSON.parse(localStorage.getItem(KEY) || "null");
      return isObject(x) ? x : null;
    } catch {
      return null;
    }
  }

  /* Only the fields the popup shows, as text, whatever was stored. */
  function workspace(saved) {
    const seed = window.AstraSeed;
    const from = (kind) => asList(saved ? saved[kind] : seed[kind]).filter(isObject);
    const profile = saved && isObject(saved.profile) ? saved.profile : seed.profile;
    return {
      templates: from("templates")
        .map((t) => ({
          id: asText(t.id),
          title: asText(t.title, "Untitled template"),
          category: asText(t.category, "General"),
          tags: asList(t.tags).map(String),
          body: asText(t.body),
          favourite: t.favourite === true,
        }))
        .filter((t) => t.id && t.body),
      snippets: from("snippets")
        .map((l) => ({
          id: asText(l.id),
          text: asText(l.text).slice(0, 2000),
          title: "",
          category: asText(l.category, "My lines"),
          tags: [],
          favourite: l.favourite === true,
        }))
        .filter((l) => l.id && l.text.trim()),
      knowledge: from("knowledge")
        .map((k) => ({
          id: asText(k.id),
          title: asText(k.title, "Untitled guide"),
          category: asText(k.category, "General"),
          type: asText(k.type, "Guide"),
          tags: asList(k.tags).map(String),
          summary: asText(k.summary),
          quick: asText(k.quick),
        }))
        .filter((k) => k.id),
      shortcuts: from("shortcuts")
        .map((s) => ({
          id: asText(s.id),
          title: asText(s.title, "Link"),
          url: httpsUrl(asText(s.url)),
          key: /^[a-z0-9]$/i.test(asText(s.key)) ? s.key.toUpperCase() : "",
        }))
        .filter((s) => s.url),
      sender: asText(profile?.name).slice(0, 80),
      company: asText(profile?.company).slice(0, 80),
    };
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = false; /* run in the order added */
      s.onload = resolve;
      s.onerror = () => reject(new Error(src));
      document.head.appendChild(s);
    });
  }

  let ws = null;

  /* ------------------------------------------------------------------ actions */

  function toast(text) {
    const el = $("#toast");
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), 1800);
  }

  async function copy(text, message = "Copied") {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.className = "offscreen";
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    toast(message);
  }

  const inExtension = !!(window.chrome && chrome.tabs && chrome.runtime?.getURL);
  const astraUrl = (hash = "") => (inExtension ? chrome.runtime.getURL("index.html") : "index.html") + hash;
  /* The same page runs as the toolbar popup and in the side panel (panel.html), which stays open while you work. */
  const inPanel = document.body.classList.contains("panel");

  /* Opens a tab. The popup then closes, as the browser's own menus do; the side panel stays. */
  function openTab(url) {
    if (!url) return;
    if (window.PraxisLite) return window.PraxisLite.open(url);
    const done = () => inPanel || window.close();
    if (inExtension) chrome.tabs.create({ url }).then(done, done);
    else window.open(url, "_blank", "noopener,noreferrer");
  }

  /* --------------------------------------------------------------- the search */

  const words = (q) => q.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (x, q) => {
    const text = [x.title, x.text, x.category, x.tags.join(" "), x.body, x.summary, x.quick]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return words(q).every((w) => text.includes(w));
  };
  /* Words in the title count most, then the quick label and tags. */
  const score = (x, q) => {
    const title = (x.title || x.text).toLowerCase();
    const extra = `${x.quick || ""} ${x.tags.join(" ")}`.toLowerCase();
    let n = 0;
    for (const w of words(q)) {
      if (new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(title)) n += 4;
      else if (title.includes(w)) n += 2;
      if (extra.includes(w)) n += 1;
    }
    return n;
  };
  const best = (list, q) =>
    list
      .filter((x) => matches(x, q))
      .sort((a, b) => score(b, q) - score(a, q))
      .slice(0, PER_KIND);

  /* Everything that matches, most specific first: a number or code, then systems, replies, templates and guides. */
  function search(query) {
    const q = query.trim();
    const rows = [];
    const number = window.AstraNumbers?.lookup(q);
    if (number)
      rows.push({
        type: "Number",
        title: number.national,
        sub: number.valid
          ? [number.kind, number.area, number.network && `range given to ${number.network}`]
              .filter(Boolean)
              .join(" · ")
          : "Not a valid UK number",
        go: "Copy",
        run: () => copy(number.national, `Copied ${number.national}`),
      });
    const place = window.AstraNumbers?.areaOf(q);
    if (place)
      rows.push({
        type: "Code",
        title: `${q} is ${place}`,
        sub: "UK dialling code",
        go: "Copy",
        run: () => copy(place, `Copied ${place}`),
      });
    for (const e of window.AstraNet?.lookup(q) || [])
      rows.push({
        type: "Code",
        title: `${e.kind} ${e.code} · ${e.name}`,
        sub: e.meaning,
        go: "Copy",
        run: () => copy(`${e.kind} ${e.code} ${e.name}: ${e.meaning}`, `Copied ${e.kind} ${e.code}`),
      });
    const lower = q.toLowerCase();
    for (const s of ws.shortcuts
      .filter((s) => `${s.title} ${host(s.url)}`.toLowerCase().includes(lower))
      .slice(0, PER_KIND))
      rows.push({
        type: "System",
        title: s.title,
        sub: host(s.url),
        go: "Open",
        run: () => openTab(s.url),
      });
    for (const l of best(ws.snippets, q))
      rows.push({
        type: "Line",
        title: l.text,
        sub: l.category,
        go: "Copy",
        line: true,
        run: () => copyLine(l),
      });
    for (const r of R.search(q, PER_KIND)) {
      const stage = r.stage || defaultStage(r.situation);
      rows.push({
        type: "Reply",
        title: r.situation.title,
        sub: R.stageById(stage)?.name || r.situation.group,
        go: "Write",
        run: () => showReply(r.situation.id, stage),
      });
    }
    for (const t of best(ws.templates, q))
      rows.push({
        type: "Template",
        title: t.title,
        sub: t.category,
        go: "Fill",
        run: () => showTemplate(t.id),
      });
    for (const k of best(ws.knowledge, q))
      rows.push({
        type: k.type === "Fault" ? "Fault" : "Guide",
        title: k.title,
        sub: k.summary || k.category,
        go: "Open",
        run: () => openTab(astraUrl("#guide=" + encodeURIComponent(k.id))),
      });
    /* A place name: "Dumfries" -> 01387. Last, so a word that happens to start a place name does not crowd out the rest. */
    if (/^[a-z][a-z\s'-]{3,}$/i.test(q))
      for (const a of window.AstraNumbers?.areaCodes(q, 2) || [])
        rows.push({
          type: "Code",
          title: `${a.code} · ${a.name}`,
          sub: "UK dialling code",
          go: "Copy",
          run: () => copy(a.code, `Copied ${a.code}`),
        });
    return rows;
  }

  const defaultStage = (s) => (s.kind === "howto" ? "answer" : R.stagesFor(s)[0]?.id || "first-reply");

  /* ------------------------------------------------------------------- views */

  let mode = "home";
  let rows = [];
  let active = 0;
  /* An email selected on the page underneath when the popup opened (see readSelection). */
  let picked = "";

  function setCombo(expanded) {
    input.setAttribute("aria-expanded", String(expanded));
    input.setAttribute("aria-controls", expanded ? "liteResults" : "liteView");
    if (expanded && rows.length) input.setAttribute("aria-activedescendant", "opt-" + active);
    else input.removeAttribute("aria-activedescendant");
  }

  function showHome() {
    mode = "home";
    rows = [];
    setCombo(false);
    count.textContent = "";
    const pinned = ws.templates.filter((t) => t.favourite).slice(0, 6);
    const starred = ws.snippets.filter((l) => l.favourite).slice(0, 8);
    view.innerHTML =
      selectionHtml() +
      (starred.length
        ? `<section class="lite-section"><h2>Quick lines</h2><div class="lite-list">${starred
            .map(
              (l) =>
                `<button class="lite-row is-line" type="button" data-line="${esc(l.id)}"><span class="lite-main"><b>${esc(
                  l.text,
                )}</b><small>${esc(l.category)}</small></span><span class="lite-go">Copy</span></button>`,
            )
            .join("")}</div></section>`
        : "") +
      (ws.shortcuts.length
        ? `<section class="lite-section"><h2>Systems</h2><div class="lite-systems">${ws.shortcuts
            .map(
              (s) =>
                `<button class="lite-system" type="button" data-open="${esc(s.id)}"><span><b>${esc(s.title)}</b><small>${esc(
                  host(s.url),
                )}</small></span>${s.key ? `<kbd>Alt ${esc(s.key)}</kbd>` : ""}</button>`,
            )
            .join("")}</div></section>`
        : "") +
      (pinned.length
        ? `<section class="lite-section"><h2>Pinned templates</h2><div class="lite-list">${pinned
            .map(
              (t) =>
                `<button class="lite-row" type="button" data-template="${esc(t.id)}"><span class="lite-main"><b>${esc(
                  t.title,
                )}</b><small>${esc(t.category)}</small></span><span class="lite-go">Fill</span></button>`,
            )
            .join("")}</div></section>`
        : "");
  }

  function showResults(keepPlace = false) {
    if (!ws) return; /* still loading: drawn once ready */
    const q = input.value.trim();
    if (!q) return showHome();
    mode = "results";
    rows = search(q);
    active = keepPlace ? Math.max(0, Math.min(active, rows.length - 1)) : 0;
    view.innerHTML = rows.length
      ? `<div class="lite-list" role="listbox" id="liteResults" aria-label="Results">${rows
          .map(
            (r, i) =>
              `<div class="lite-row ${i === active ? "active" : ""} ${r.line ? "is-line" : ""}" role="option" id="opt-${i}" aria-selected="${i === active}" data-i="${i}"><span class="lite-type">${esc(
                r.type,
              )}</span><span class="lite-main"><b>${esc(r.title)}</b><small>${esc(r.sub)}</small></span><span class="lite-go">${esc(r.go)}</span></div>`,
          )
          .join("")}</div>`
      : `<div class="lite-empty"><p>Nothing matches. Try fewer words.</p><button class="secondary-btn" type="button" data-astra>Search the documents in Praxis</button></div>`;
    count.textContent = rows.length ? `${rows.length} result${rows.length === 1 ? "" : "s"}` : "No match";
    setCombo(rows.length > 0);
  }

  function move(by) {
    if (!rows.length) return;
    const old = document.getElementById("opt-" + active);
    active = (active + by + rows.length) % rows.length;
    const el = document.getElementById("opt-" + active);
    old?.classList.remove("active");
    old?.setAttribute("aria-selected", "false");
    el.classList.add("active");
    el.setAttribute("aria-selected", "true");
    /* Scrolled into view below the sticky search, whatever its height at the chosen text size. */
    const top = document.querySelector(".lite-top").getBoundingClientRect().bottom;
    const box = el.getBoundingClientRect();
    if (box.top < top) scrollBy(0, box.top - top - 6);
    else if (box.bottom > innerHeight) scrollBy(0, box.bottom - innerHeight + 6);
    setCombo(true);
  }

  /* ------------------------------------------------------- updates promised */

  /* For an email selected on the page: the replies it most likely needs, and the full triage in Astra. */
  function selectionHtml() {
    if (!picked) return "";
    const hit = R.suggest({ body: picked });
    const replies = hit ? [hit.situation, ...hit.others].slice(0, 3) : [];
    return `<section class="lite-section"><h2>From the text you selected</h2><div class="lite-list">${replies
      .map(
        (s, i) =>
          `<button class="lite-row" type="button" data-reply="${esc(s.id)}"><span class="lite-main"><b>${esc(
            s.title,
          )}</b><small>${i ? "Also possible" : "Best match"} · ${esc(R.stageById(defaultStage(s))?.name || "")}</small></span><span class="lite-go">Write</span></button>`,
      )
      .join(
        "",
      )}<button class="lite-row" type="button" data-triage><span class="lite-main"><b>Triage it in Praxis</b><small>${
      replies.length
        ? "Details, guide, ticket note and reply"
        : "No reply matched here: Praxis reads it in full"
    }</small></span><span class="lite-go">Open</span></button></div></section>`;
  }

  /* Hands the selected email to a new Astra tab, the same way the right-click menu does. */
  async function triageInAstra() {
    const id = crypto.randomUUID();
    try {
      await chrome.storage.session.set({ ["astra.triage." + id]: { text: picked, at: Date.now() } });
    } catch {
      return toast("Praxis could not be opened");
    }
    openTab(astraUrl("#triage=" + id));
  }

  /* The details a panel asks for. */
  const fieldHtml = (key, label, value = "", attrs = "") =>
    `<label class="field"><span>${esc(label)}</span><input data-v="${esc(key)}" value="${esc(value)}" ${attrs}></label>`;
  const slotHtml = (key) =>
    `<label class="field"><span>Time slot</span><select data-v="${esc(key)}"><option value="">Select</option>${SLOTS.map(
      (s) => `<option>${s}</option>`,
    ).join("")}</select></label>`;
  const valueOf = (el) => (el.type === "date" ? dateUK(el.value) : el.value.trim());
  const panelHead = (tag, title) =>
    `<div class="lite-panel-head"><button class="small-btn" type="button" data-back><span aria-hidden="true">‹</span> Back</button><div><span class="tag">${esc(
      tag,
    )}</span><h2 id="litePanelTitle">${esc(title)}</h2></div></div>`;

  /* A reply from the reply library: choose the stage, add the name, copy. */
  function showReply(situationId, stageId) {
    const s = R.situationById(situationId);
    if (!s) return;
    mode = "panel";
    setCombo(false);
    let length = "email";
    const stages = R.stagesFor(s);
    let stage = stages.some((x) => x.id === stageId) ? stageId : defaultStage(s);
    const values = { contact: "", ticket: "" };
    /* Date boxes hold the date in their own form; the email gets it written out. Both survive a redraw. */
    const raw = {};

    function paint(focus) {
      const extra =
        stage === "raised" || stage === "escalated"
          ? fieldHtml("supplier_ref", `${s.supplier || "Supplier"} reference`, values.supplier_ref)
          : stage === "engineer-booked"
            ? fieldHtml("date", "Date", "", 'type="date"') + slotHtml("timeslot")
            : stage === "no-reply-final"
              ? fieldHtml("close_date", "Close the ticket on", "", 'type="date"')
              : "";
      view.innerHTML = `<section class="lite-panel" aria-labelledby="litePanelTitle">${panelHead(s.group, s.title)}
        <label class="field"><span>Stage</span><select id="liteStage">${STAGE_GROUPS.map((g) => {
          const here = stages.filter((x) => x.group === g);
          return here.length
            ? `<optgroup label="${g}">${here
                .map(
                  (x) =>
                    `<option value="${esc(x.id)}" ${x.id === stage ? "selected" : ""}>${esc(x.name)}</option>`,
                )
                .join("")}</optgroup>`
            : "";
        }).join("")}</select></label>
        <div class="segmented" role="group" aria-label="Length">${[
          ["email", "Email"],
          ["short", "Short message"],
        ]
          .map(
            ([id, name]) =>
              `<button type="button" class="${id === length ? "on" : ""}" aria-pressed="${id === length}" data-length="${id}">${name}</button>`,
          )
          .join("")}</div>
        <div class="fields cols-2">${fieldHtml("contact", "Contact name", values.contact, 'placeholder="First name"')}${fieldHtml(
          "ticket",
          "Ticket",
          values.ticket,
          'placeholder="Reference"',
        )}${extra}</div>
        <p class="hint warn" id="liteMissing" hidden></p>
        ${length === "email" ? '<label class="field"><span>Subject</span><input id="liteSubject"></label>' : ""}
        <label class="field"><span>${length === "email" ? "Email" : "Message"}</span><textarea id="liteBody" rows="9"></textarea></label>
        <div class="lite-actions"><button class="primary-btn" type="button" id="liteCopy">Copy ${
          length === "email" ? "email" : "message"
        }</button>${
          length === "email"
            ? '<button class="secondary-btn" type="button" id="liteCopySubject">Copy subject</button>'
            : ""
        }<button class="link-btn quiet" type="button" id="liteFull">Open in Praxis</button></div></section>`;
      for (const el of view.querySelectorAll("[data-v]")) {
        const key = el.dataset.v;
        if (el.type === "date") el.value = raw[key] || "";
        else if (el.tagName === "SELECT") el.value = values[key] || "";
        el.addEventListener(el.type === "date" || el.tagName === "SELECT" ? "change" : "input", () => {
          if (el.type === "date") raw[key] = el.value;
          values[key] = valueOf(el);
          update();
        });
      }
      $("#liteStage").addEventListener("change", (e) => {
        stage = e.target.value;
        paint("#liteStage");
      });
      for (const b of view.querySelectorAll("[data-length]"))
        b.addEventListener("click", () => {
          length = b.dataset.length;
          paint(`[data-length="${length}"]`);
        });
      $("#liteCopy").addEventListener("click", () => {
        const out = compose();
        if (out.missing.length) return toast("Add the details above first");
        copy($("#liteBody").value, length === "email" ? "Email copied" : "Message copied");
      });
      $("#liteCopySubject")?.addEventListener("click", () => copy($("#liteSubject").value, "Subject copied"));
      $("#liteFull").addEventListener("click", () =>
        openTab(astraUrl("#reply=" + encodeURIComponent(`${s.id}|${stage}`))),
      );
      update();
      /* Redrawn for a new stage or length: keep the keyboard where it was. */
      $(focus || "#liteStage")?.focus();
    }

    function compose() {
      return R.compose({
        situation: s,
        stage,
        length,
        values: {
          ...values,
          sender: ws.sender,
        },
      });
    }

    function update() {
      const out = compose();
      const subject = $("#liteSubject");
      if (subject) subject.value = out.subject;
      $("#liteBody").value = out.body;
      const missing = $("#liteMissing");
      missing.hidden = !out.missing.length;
      missing.textContent = out.missing.length
        ? `Add the ${out.missing
            .map(
              (m) =>
                ({ date: "date", timeslot: "time slot", close_date: "closing date" })[m] ||
                m.replaceAll("_", " "),
            )
            .join(" and ")} above.`
        : "";
    }

    paint();
  }

  /* Fills in a template or a quick line, then copies it. Details already known are used as they are; the rest are
     asked for here. */
  function showFill({
    tag,
    title,
    body,
    known = {},
    ask = null,
    copyLabel = "Copy reply",
    copied = "Reply copied",
  }) {
    mode = "panel";
    setCombo(false);
    const keys = ask || [...new Set([...body.matchAll(PLACEHOLDER)].map((m) => m[1]))];
    view.innerHTML = `<section class="lite-panel" aria-labelledby="litePanelTitle">${panelHead(tag, title)}
      ${
        keys.length
          ? `<div class="fields cols-2">${keys
              .map((k) =>
                k === "timeslot"
                  ? slotHtml(k)
                  : fieldHtml(
                      k,
                      LABELS[k] || k.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()),
                      "",
                      isDateKey(k) ? 'type="date"' : "",
                    ),
              )
              .join("")}</div>`
          : ""
      }
      <label class="field"><span>Preview</span><textarea id="liteBody" rows="${Math.min(9, Math.max(4, body.split("\n").length + 2))}" readonly></textarea></label>
      <div class="lite-actions"><button class="primary-btn" type="button" id="liteCopy">${esc(copyLabel)}</button></div></section>`;
    const inputs = [...view.querySelectorAll("[data-v]")];
    const update = () => {
      const v = { ...known, ...Object.fromEntries(inputs.map((el) => [el.dataset.v, valueOf(el)])) };
      $("#liteBody").value = body.replace(PLACEHOLDER, (_, k) => v[k] || `[${k.replaceAll("_", " ")}]`);
    };
    for (const el of inputs)
      el.addEventListener(el.type === "date" || el.tagName === "SELECT" ? "change" : "input", () => {
        el.classList.remove("invalid");
        update();
      });
    $("#liteCopy").addEventListener("click", () => {
      const empty = inputs.filter((el) => !el.value.trim());
      if (empty.length) {
        empty.forEach((el) => el.classList.add("invalid"));
        empty[0].focus();
        return toast("Complete the highlighted detail first");
      }
      copy($("#liteBody").value, copied);
    });
    update();
    (inputs[0] || $("#liteCopy")).focus();
  }
  const LABELS = { my_name: "Your name", supplier_ref: "Supplier reference", update_time: "Update by" };

  /* One of your templates: fill in its details, copy. */
  function showTemplate(id) {
    const t = ws.templates.find((x) => x.id === id);
    if (t) showFill({ tag: t.category, title: t.title, body: t.body });
  }

  /* A quick line: copied in one click with what is known (your name, today's date). Only a
     detail that cannot be known is asked for. */
  function copyLine(l) {
    const d = new Date();
    const known = {
      my_name: ws.sender,
      company: ws.company,
      today: `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
    };
    const missing = [...new Set([...l.text.matchAll(PLACEHOLDER)].map((m) => m[1]))].filter((k) => !known[k]);
    if (!missing.length)
      return copy(
        l.text.replace(PLACEHOLDER, (_, k) => known[k]),
        "Copied",
      );
    showFill({
      tag: l.category,
      title: "Fill in the details",
      body: l.text,
      known,
      ask: missing,
      copyLabel: "Copy",
      copied: "Copied",
    });
  }

  function back() {
    showResults();
    input.focus();
  }

  /* ------------------------------------------------------------------ wiring */

  /* Each change of the search is drawn once per frame, from the top result. */
  let frame = 0;
  input.addEventListener("input", () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      showResults();
    });
  });
  /* A key pressed before that frame acts on what is in the box now, not on the previous search. */
  function catchUp() {
    if (!frame && mode === "results") return;
    cancelAnimationFrame(frame);
    frame = 0;
    showResults();
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!ws) return;
      catchUp();
      if (mode !== "results") return;
      e.preventDefault();
      move(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      if (!ws) return;
      catchUp();
      if (mode === "results") rows[active]?.run();
    }
  });

  view.addEventListener("click", (e) => {
    const option = e.target.closest("[data-i]");
    if (option) return rows[Number(option.dataset.i)]?.run();
    const site = e.target.closest("[data-open]");
    if (site) return openTab(ws.shortcuts.find((s) => s.id === site.dataset.open)?.url || "");
    const template = e.target.closest("[data-template]");
    if (template) return showTemplate(template.dataset.template);
    const line = e.target.closest("[data-line]");
    if (line) {
      const l = ws.snippets.find((x) => x.id === line.dataset.line);
      return l && copyLine(l);
    }
    const reply = e.target.closest("[data-reply]");
    if (reply) {
      const s = R.situationById(reply.dataset.reply);
      return s && showReply(s.id, defaultStage(s));
    }
    if (e.target.closest("[data-triage]")) return triageInAstra();
    if (e.target.closest("[data-back]")) return back();
    if (e.target.closest("[data-astra]")) return openTab(astraUrl());
  });

  document.addEventListener("keydown", (e) => {
    if (!ws) return;
    /* Alt + letter opens a system, as on the Astra new tab. */
    if (e.altKey && !e.ctrlKey && !e.metaKey && /^Key[A-Z]$|^Digit\d$/.test(e.code)) {
      const key = e.code.slice(-1);
      const s = ws.shortcuts.find((x) => x.key === key);
      if (s) {
        e.preventDefault();
        openTab(s.url);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (mode === "panel") back();
      else if (input.value) {
        input.value = "";
        showHome();
        input.focus();
      } else if (!inPanel) window.close();
    }
  });

  $("#openAstra").addEventListener("click", () => openTab(astraUrl()));

  /* "Keep open": moves Astra Lite into the side panel of this window. Shown only where the browser has one. */
  const keepOpen = $("#keepOpen");
  if (inPanel || !inExtension || !chrome.sidePanel?.open || !chrome.windows?.getCurrent) keepOpen.remove();
  else {
    let windowId = null;
    chrome.windows.getCurrent().then(
      (w) => (windowId = w.id),
      () => keepOpen.remove(),
    );
    /* Called straight from the click: the browser opens a side panel only in answer to one. */
    keepOpen.addEventListener("click", () => {
      if (windowId === null) return;
      chrome.sidePanel.open({ windowId }).then(
        () => window.close(),
        () => toast("The side panel could not be opened here"),
      );
    });
  }

  /* The side panel keeps the times current, and shows a promise made in Astra within the minute. */

  /* The side panel stays open for hours: when Astra saves a change (a new template, your name), show it. Not while
     a reply or template is being filled in, so nothing typed is lost. */
  addEventListener("storage", (e) => {
    if (e.key !== KEY || !ws) return;
    ws = workspace(readSaved());
    if (mode === "home") showHome();
    else if (mode === "results") showResults(true);
  });

  /* Opened from the toolbar button or its key, the popup may read what is selected on the page underneath: the
     browser allows it for that one page, at that moment (activeTab). A number, code or short phrase goes straight
     into the search; an email gets its likely replies. The side panel never reads the page. */
  async function readSelection() {
    if (inPanel || !inExtension || !chrome.scripting?.executeScript) return "";
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !(tab.id >= 0)) return "";
      const frames = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        injectImmediately: true /* a page still loading does not hold up the popup */,
        func: () => String(getSelection()),
      });
      const text = frames?.[0]?.result;
      return typeof text === "string" ? text.trim().slice(0, 50000) : "";
    } catch {
      return ""; /* the browser's own pages, the PDF viewer, or no access */
    }
  }

  /* Astra opened at least once: its saved workspace, straight away. Otherwise the built-in content, loaded now. */
  const saved = readSaved();
  const ready = saved
    ? Promise.resolve()
    : Promise.all(SEED_FILES.map((f) => loadScript(`js/seed/${f}.js`))).catch(() => {});
  /* A number goes into the search box; an email is kept for its suggestions. False if nothing was used. */
  function useSelection(selected) {
    if (!selected || input.value.trim()) return false;
    if (selected.length <= 80 && !/\n/.test(selected)) {
      input.value = selected;
      input.select(); /* typing replaces it */
    } else picked = selected;
    return true;
  }

  /* The selection is waited for briefly, so the popup opens on the answer rather than flicking to it; a slow page
     does not hold the popup up, and its selection still arrives if nothing has been typed meanwhile. */
  const selection = readSelection();
  const soon = Promise.race([selection, new Promise((r) => setTimeout(() => r(null), 250))]);
  Promise.all([ready, soon]).then(([, selected]) => {
    ws = workspace(saved);
    if (selected !== null) useSelection(selected);
    if (input.value.trim()) showResults();
    else showHome();
    if (selected === null)
      selection.then((late) => {
        if (mode !== "home" || !useSelection(late)) return;
        if (input.value.trim()) showResults();
        else showHome();
      });
  });
})();
