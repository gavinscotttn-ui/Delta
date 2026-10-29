/* The Ask page: a conversation with the guides and documents.
   Always works offline. If the local AI assistant is switched on in Settings, a written answer from the on-device
   model is added on top of the same sources. */
window.AstraAsk = (function () {
  "use strict";

  const KB = window.AstraKB;
  const A = window.AstraAssistant;
  const AI = window.AstraAI;

  const EXAMPLES = [
    "Phone shows Initialising and won't register",
    "What is the shortcode for Do Not Disturb?",
    "Webex not ringing on an iPhone",
    "Voxone handsets drop registration after an hour",
    "Call centre agent isn't getting calls",
    "What do I need to give Gamma when raising a fault?",
  ];

  let ctx = null;
  let thread = [];
  let engineKey = "";
  let engine = null;
  let everything = "";
  let nextId = 1;

  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>'"]/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          "'": "&#39;",
          '"': "&quot;",
        })[c],
    );

  /* One engine for Ask and Triage. Rebuilt when the workspace changes, or once the document text has loaded. */
  function getEngine() {
    const key = ctx.version() + (KB.indexReady() ? "+docs" : "");
    if (!engine || key !== engineKey) {
      engine = A.create({
        knowledge: ctx.knowledge(),
        workflows: ctx.workflows(),
        templates: ctx.templates(),
      });
      engineKey = key;
      everything = null;
    }
    return engine;
  }

  /* Everything a guide or document says, for checking whether a command in an AI answer really exists. */
  function corpus() {
    getEngine();
    if (everything === null) {
      const lib = (window.AstraLibrary && window.AstraLibrary.index) || [];
      everything =
        ctx
          .knowledge()
          .map((k) => (k.rich ? KB.plain(k.body) : k.body))
          .join("\n") +
        "\n" +
        lib.map((p) => p[2]).join("\n");
    }
    return everything;
  }

  const aiReady = () => {
    const ai = ctx.ai();
    return ai.enabled && String(ai.model).trim() !== "" && AI.support().ok;
  };

  /* ----------------------------------------------------------- the thread */

  function ask(question) {
    const q = question.trim();
    if (!q) return;
    /* Answers include document pages: wait for their text if a question comes in the first moment after opening. */
    if (!KB.indexReady()) {
      KB.loadIndex().then(() => ask(question));
      return;
    }
    const previous = thread[thread.length - 1];
    /* A short follow-up that sounds like one ("what about Android?") is searched together with the question before it. */
    const followUp =
      /^(and|also|so|then|ok|okay|what about|how about|what if|same|same for)\b|\b(it|that|this|they|them|those|there)\b/i;
    const short = A.tokens(q).length < 4 && followUp.test(q);
    const search = previous && short ? `${previous.question} ${q}` : q;
    const result = getEngine().search(search);
    const codes = window.AstraNet ? window.AstraNet.lookup(q) : [];
    const turn = {
      id: nextId++,
      question: q,
      search,
      result,
      codes,
      answer: "",
      status: "offline",
      error: "",
      sources: [],
      check: null,
    };
    thread.push(turn);
    if (
      !result.quick.length &&
      !codes.length &&
      (result.confidence === "none" || result.confidence === "weak")
    )
      ctx.logGap(q, result.confidence);
    if (ctx.currentPage() !== "Ask") ctx.go("Ask");
    else paint();
    if (aiReady()) {
      if (result.confidence === "strong" || result.confidence === "possible") runAI(turn);
      else {
        turn.status = "skipped";
        paintTurn(turn);
      }
    }
    scrollToEnd();
  }

  async function runAI(turn) {
    const ai = ctx.ai();
    turn.sources = A.pickSources(turn.result, { query: turn.search });
    const history = thread
      .filter((t) => t !== turn && t.status === "answered" && t.answer)
      .map((t) => ({ question: t.question, answer: t.answer }));
    const messages = A.buildMessages(turn.question, history, turn.sources);
    turn.status = AI.status().model === ai.model ? "thinking" : "loading";
    turn.answer = "";
    turn.progress = 0;
    /* Each answer has its own Stop: stopping one never stops another. */
    const controller = new AbortController();
    turn.controller = controller;
    paintTurn(turn);
    let frame = 0;
    try {
      await AI.chat({
        model: ai.model,
        messages,
        signal: controller.signal,
        onProgress: (p) => {
          turn.progress = p.total ? Math.round((p.loaded / p.total) * 100) : 0;
          if (turn.status === "loading") paintTurn(turn);
        },
        onDelta: (_, full) => {
          turn.answer = full;
          turn.status = "writing";
          if (!frame)
            frame = requestAnimationFrame(() => {
              frame = 0;
              paintAnswer(turn);
            });
        },
      });
      turn.status = turn.answer.trim() ? "answered" : "error";
      if (turn.status === "error") turn.error = "The model returned no answer.";
      else turn.check = A.verify(turn.answer, turn.sources, corpus());
    } catch (err) {
      turn.status = "error";
      turn.error = err.message || "Something went wrong.";
      if (turn.answer.trim() && err.message === "Stopped.") {
        turn.status = "answered";
        turn.error = "";
        turn.check = A.verify(turn.answer, turn.sources, corpus());
      }
    } finally {
      turn.controller = null;
      paintTurn(turn);
    }
  }

  /* -------------------------------------------------------------- views */

  const note = (text) => `<p class="ask-note">${text}</p>`;

  function matchedWords(turn) {
    const rarity = new Map((turn.result.guides[0]?.matched || []).map((m) => [m.t, m.idf]));
    const words = turn.search.toLowerCase().match(/[a-z0-9*#][a-z0-9.*#'-]*/g) || [];
    const scored = new Map();
    for (const w of words) {
      const best = Math.max(0, ...A.tokens(w).map((t) => rarity.get(t) ?? 0));
      if (best > 0) scored.set(w, Math.max(scored.get(w) || 0, best));
    }
    return [...scored]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 4)
      .map(([w]) => w);
  }

  function citeLinks(html, turn) {
    return html.replace(/\[(\d{1,2})\]/g, (m, n) => {
      const s = turn.sources.find((x) => x.n === Number(n));
      if (!s) return m;
      return s.kind === "guide"
        ? `<button class="cite" data-ask="guide" data-id="${esc(s.id)}" title="${esc(s.title)}">${n}</button>`
        : `<a class="cite" href="${esc(KB.docHref(s.doc, s.page))}" target="_blank" rel="noopener noreferrer" title="${esc(s.title)}">${n}</a>`;
    });
  }

  function answerHtml(turn) {
    /* Models sometimes fence code; the guide renderer has no fences, so turn them into plain lines. */
    const text = turn.answer.replace(/```[a-z]*\n?([\s\S]*?)```/g, (_, code) =>
      code
        .trim()
        .split("\n")
        .map((l) => "`" + l.trim() + "`")
        .join("\n"),
    );
    return citeLinks(KB.render(text), turn);
  }

  function checkHtml(turn) {
    const c = turn.check;
    if (!c) return "";
    const total = c.verified.length + c.elsewhere.length + c.unverified.length;
    const code = (items) => items.map((i) => `<code>${esc(i)}</code>`).join(" ");
    let out = "";
    if (c.unverified.length)
      out += `<p class="verify warn"><strong>Not found in your guides or documents:</strong> ${code(c.unverified)}<br>Do not give ${c.unverified.length === 1 ? "this" : "these"} to a customer until you have checked ${c.unverified.length === 1 ? "it" : "them"} against the source.</p>`;
    if (c.elsewhere.length)
      out += `<p class="verify">Found in your documents, but not in the sources used for this answer: ${code(c.elsewhere)}</p>`;
    if (total && !c.unverified.length && !c.elsewhere.length)
      out += `<p class="verify ok">Checked: ${total === 1 ? "the command, code, price, number or time period" : `all ${total} commands, codes, prices, numbers and time periods`} in this answer appear in the sources.</p>`;
    return out;
  }

  function aiBlock(turn) {
    const st = turn.status;
    if (st === "offline") return "";
    if (st === "skipped")
      return note(
        "No AI answer: nothing in your guides or documents matches this well enough to answer from.",
      );
    if (st === "loading")
      return `<div class="ask-ai" id="ai-${turn.id}"><p class="ask-note">Starting the model on this device${turn.progress ? ` (${turn.progress}%)` : ""}. The first question takes longest. <button class="small-btn" data-ask="stop" data-id="${turn.id}">Stop</button></p></div>`;
    if (st === "thinking")
      return `<div class="ask-ai" id="ai-${turn.id}"><p class="ask-note">Reading the guides… <button class="small-btn" data-ask="stop" data-id="${turn.id}">Stop</button></p></div>`;
    if (st === "error")
      return `<div class="ask-ai err" id="ai-${turn.id}"><p>${esc(turn.error)}</p><button class="small-btn" data-ask="retry" data-id="${turn.id}">Try again</button></div>`;
    const writing = st === "writing";
    return `<div class="ask-ai" id="ai-${turn.id}"><div class="ask-answer kb-body">${answerHtml(turn)}</div>${
      writing
        ? `<p class="ask-note"><button class="small-btn" data-ask="stop" data-id="${turn.id}">Stop</button></p>`
        : ""
    }${writing ? "" : checkHtml(turn)}${writing ? "" : `<p class="ask-note">Written on this device by a small AI model from the sources below. It can be wrong: check the steps against the guide. <button class="small-btn" data-ask="copy-answer" data-id="${turn.id}">Copy</button></p>`}</div>`;
  }

  /* Rows that came from the same table are shown together as one table. */
  function quickHtml(turn) {
    const groups = [];
    for (const q of turn.result.quick) {
      const last = groups[groups.length - 1];
      if (last && last.guide === q.row.guide && last.heading === q.row.heading) last.rows.push(q.row);
      else
        groups.push({
          guide: q.row.guide,
          heading: q.row.heading,
          header: q.row.header,
          rows: [q.row],
        });
    }
    return groups
      .map((g) => {
        const header = g.header.length
          ? `| ${g.header.join(" | ")} |\n|${g.header.map(() => "---").join("|")}|\n`
          : "";
        const md = header + g.rows.map((r) => `| ${r.cells.join(" | ")} |`).join("\n");
        return `<div class="ask-quick">${KB.render(md)}<p class="ask-from">From <button class="link-btn" data-ask="guide" data-id="${esc(g.guide.id)}">${esc(g.guide.title)}</button></p></div>`;
      })
      .join("");
  }

  function guideCard(turn) {
    const r = turn.result;
    const top = r.guides[0];
    if (!top) return "";
    const g = top.item;
    const steps = A.stepsOf(g);
    const label =
      r.confidence === "strong"
        ? "Best match"
        : r.confidence === "possible"
          ? "Closest match"
          : "Closest guide (weak match)";
    const words = matchedWords(turn);
    const doc = (g.docs || [])
      .map((d) => {
        const dc = KB.docById(d.id);
        if (!dc) return "";
        const page = d.page || KB.locate(d.id, d.find);
        return `<a class="small-btn" href="${esc(KB.docHref(dc, page))}" target="_blank" rel="noopener noreferrer">${esc(d.label || dc.title)}${page > 1 ? ", p." + page : ""}</a>`;
      })
      .join("");
    return `<section class="card ask-card"><p class="ask-label">${label}${words.length ? ` <span>matched on ${words.map((w) => `<em>${esc(w)}</em>`).join(", ")}</span>` : ""}</p>
      <h3>${esc(g.title)}</h3><p class="ask-summary">${esc(g.summary || "")}</p>
      ${steps ? `<div class="kb-body">${KB.render(steps)}</div>` : ""}
      <div class="ask-actions"><button class="primary-btn" data-ask="guide" data-id="${esc(g.id)}">Open the full guide</button>${doc}</div></section>`;
  }

  function moreHtml(turn) {
    const r = turn.result;
    const guides = r.guides.slice(1, 4);
    const wf = r.workflows.filter((w) => w.coverage >= 0.5);
    const tp = r.templates;
    const pages = r.pages.filter((p) => p.coverage >= 0.5).slice(0, 4);
    let out = "";
    if (guides.length || wf.length || tp.length) {
      out += `<div class="ask-more"><h4>Also relevant</h4><div class="item-list">${guides
        .map(
          (g) =>
            `<article class="item-row"><div class="item-meta"><span class="tag">${esc(g.item.type)}</span><span class="steps-count">${esc(g.item.category)}</span></div><h3>${esc(g.item.title)}</h3><p>${esc(g.item.summary)}</p><div class="row-actions"><button class="secondary-btn" data-ask="guide" data-id="${esc(g.item.id)}">Open</button></div></article>`,
        )
        .join("")}${wf
        .map(
          (w) =>
            `<article class="item-row"><div class="item-meta"><span class="tag">Workflow</span><span class="steps-count">${w.item.steps.length} steps</span></div><h3>${esc(w.item.title)}</h3><p>${esc(w.item.steps.slice(0, 2).join(" · "))}</p><div class="row-actions"><button class="secondary-btn" data-ask="workflow" data-id="${esc(w.item.id)}">Start</button></div></article>`,
        )
        .join("")}${tp
        .map(
          (t) =>
            `<article class="item-row"><div class="item-meta"><span class="tag">Template</span><span class="steps-count">${esc(t.item.category)}</span></div><h3>${esc(t.item.title)}</h3><p>${esc(t.item.body.replace(/\n+/g, " "))}</p><div class="row-actions"><button class="secondary-btn" data-ask="template" data-id="${esc(t.item.id)}">Use</button></div></article>`,
        )
        .join("")}</div></div>`;
    }
    if (pages.length)
      out += `<div class="ask-more"><h4>In the documents</h4><div class="item-list">${pages
        .map(
          (p) =>
            `<article class="item-row doc-row"><div class="item-meta"><span class="tag">Page ${p.page}</span><span class="steps-count">${esc(p.doc.category)}</span></div><h3>${esc(p.doc.title)}</h3><p class="snippet">${esc(p.text.slice(0, 240))}…</p><div class="row-actions"><a class="secondary-btn" href="${esc(KB.docHref(p.doc, p.page))}" target="_blank" rel="noopener noreferrer">Open page</a></div></article>`,
        )
        .join("")}</div></div>`;
    return out;
  }

  /* "Not what I needed" adds the question to the list of gaps in Settings. Weak and empty answers are added already. */
  function feedbackHtml(turn, none) {
    if (none || turn.result.confidence === "weak") return "";
    return `<p class="ask-note ask-feedback" id="fb-${turn.id}">${
      turn.flagged
        ? "Noted. It is on the list of gaps in Settings."
        : `<button class="small-btn" data-ask="unhelpful" data-id="${turn.id}">Not what I needed</button>`
    }</p>`;
  }

  /* SIP responses and cause codes mentioned in the question, answered from the standard tables. */
  function codesHtml(turn) {
    if (!turn.codes.length) return "";
    return `<div class="ask-quick"><table class="code-table"><thead><tr><th>Code</th><th>Name</th><th>Usually means</th></tr></thead><tbody>${turn.codes
      .map(
        (e) =>
          `<tr><td><b>${e.kind === "SIP" ? "SIP " : "Cause "}${e.code}</b></td><td>${esc(e.name)}</td><td>${esc(e.meaning)}</td></tr>`,
      )
      .join(
        "",
      )}</tbody></table><p class="ask-from">${turn.codes.some((e) => e.kind === "SIP") ? "SIP responses: RFC 3261" : ""}${
      turn.codes.some((e) => e.kind === "SIP") && turn.codes.some((e) => e.kind !== "SIP") ? " · " : ""
    }${turn.codes.some((e) => e.kind !== "SIP") ? "Cause values: ITU-T Q.850" : ""}</p></div>`;
  }

  function turnHtml(turn) {
    const r = turn.result;
    const answered = r.quick.length || turn.codes.length;
    const none = r.confidence === "none" && !answered;
    return `<article class="ask-turn" id="turn-${turn.id}"><p class="ask-q">${esc(turn.question)}</p>
      <div class="ask-ai-slot" id="slot-${turn.id}">${aiBlock(turn)}</div>
      ${r.mixed ? note("Guides for both Horizon and Voxone match. Check which system the customer is on, or name it in the question.") : ""}
      ${codesHtml(turn)}${quickHtml(turn)}
      ${
        none
          ? note("Nothing in the guides or documents matches that. Try other words, or search the Library.")
          : r.confidence === "weak" && !answered
            ? note("This is a weak match. The guide below may not answer your question.")
            : ""
      }
      ${none ? "" : guideCard(turn)}${moreHtml(turn)}${feedbackHtml(turn, none)}</article>`;
  }

  function emptyHtml() {
    return `<div class="ask-empty"><div class="ask-examples">${EXAMPLES.map((e) => `<button class="secondary-btn" data-ask="example" data-q="${esc(e)}">${esc(e)}</button>`).join("")}</div></div>`;
  }

  function paintTurn(turn) {
    const el = document.getElementById("turn-" + turn.id);
    if (!el) return;
    const slot = document.getElementById("slot-" + turn.id);
    if (slot) slot.innerHTML = aiBlock(turn);
  }

  function paintAnswer(turn) {
    const el = document.querySelector(`#ai-${turn.id} .ask-answer`);
    if (el) el.innerHTML = answerHtml(turn);
    else paintTurn(turn);
  }

  function paint() {
    const box = document.getElementById("askThread");
    if (!box) return;
    box.innerHTML = thread.length ? thread.map(turnHtml).join("") : emptyHtml();
  }

  function scrollToEnd() {
    requestAnimationFrame(() => {
      const last = thread[thread.length - 1];
      document
        .getElementById("turn-" + (last && last.id))
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }

  function render(container) {
    container.innerHTML = `<div class="page-head"><h2>Ask</h2><div class="actions"><button class="secondary-btn" data-ask="clear"${thread.length ? "" : " hidden"}>Clear</button></div></div>
      <div id="askThread" class="ask-thread"></div>
      <form class="ask-bar" id="askForm"><label class="sr-only" for="askInput">Your question</label><textarea id="askInput" rows="2" placeholder="e.g. phone shows Initialising and won't register" autocomplete="off"></textarea><button class="primary-btn" type="submit">Ask</button></form>`;
    paint();
    document.getElementById("askInput").focus();
  }

  /* ------------------------------------------------------------- events */

  function onClick(e) {
    const el = e.target.closest("[data-ask]");
    if (!el) return;
    const act = el.dataset.ask;
    if (act === "example") ask(el.dataset.q);
    else if (act === "clear") {
      for (const t of thread) t.controller?.abort();
      thread = [];
      paint();
      document.querySelector('[data-ask="clear"]')?.setAttribute("hidden", "");
    } else if (act === "unhelpful") {
      const turn = thread.find((t) => t.id === Number(el.dataset.id));
      if (turn && !turn.flagged) {
        turn.flagged = true;
        ctx.logGap(turn.question, "unhelpful");
        const fb = document.getElementById("fb-" + turn.id);
        if (fb) fb.textContent = "Noted. It is on the list of gaps in Settings.";
      }
    } else if (act === "stop") thread.find((t) => t.id === Number(el.dataset.id))?.controller?.abort();
    else if (act === "guide") ctx.openGuide(el.dataset.id);
    else if (act === "workflow") ctx.openWorkflow(el.dataset.id);
    else if (act === "template") ctx.openTemplate(el.dataset.id);
    else if (act === "retry") {
      const turn = thread.find((t) => t.id === Number(el.dataset.id));
      if (turn) runAI(turn);
    } else if (act === "copy-answer") {
      const turn = thread.find((t) => t.id === Number(el.dataset.id));
      if (turn) ctx.copy(KB.plain(turn.answer), "Answer copied");
    }
  }

  document.addEventListener("submit", (e) => {
    if (e.target.id !== "askForm") return;
    e.preventDefault();
    const input = document.getElementById("askInput");
    const q = input.value;
    input.value = "";
    ask(q);
    document.querySelector('[data-ask="clear"]')?.removeAttribute("hidden");
  });

  document.addEventListener("keydown", (e) => {
    if (e.target.id === "askInput" && e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      document.getElementById("askForm").requestSubmit();
    }
  });

  document.addEventListener("click", onClick);

  function init(context) {
    ctx = context;
  }

  return { init, render, ask, aiReady, engine: () => getEngine() };
})();
