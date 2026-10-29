/* The Triage page: paste a customer email or ticket; Astra reads it the way an engineer would on first look.
   The pasted text stays in this tab's memory only. Nothing is sent anywhere. */
window.AstraTriageView = (function () {
  "use strict";

  const T = window.AstraTriage;
  const A = window.AstraAssistant;

  let ctx = null;
  let text = "";
  let result = null; /* { t, search, guide, workflow, template } */
  let folded = false; /* the pasted email, folded to one line once it has been read */

  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>'"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c],
    );

  const getEngine = () => window.AstraAsk.engine();

  function analyse(input) {
    text = input;
    const t = T.read(input);
    const best = T.bestSearch(t.queries, getEngine());
    const search = best ? best.r : null;
    const top = search && search.confidence !== "none" ? search.guides[0] : null;
    /* The situation the reply is written for is the surest reading of the email: unless the guide search is
       confident, its guide is the one to show. A weak guess is offered quietly and kept out of the ticket note. */
    const reply = window.AstraReplies ? window.AstraReplies.suggest(t) : null;
    const fromReply = reply && ctx.knowledge().find((k) => k.id === reply.situation.guide);
    const useReply = fromReply && (!search || search.confidence !== "strong");
    const guide = useReply ? fromReply : top ? top.item : null;
    const weak = !useReply && !!guide && search.confidence === "weak";
    /* A workflow written for that guide first, otherwise the best-matching workflow. */
    const workflow =
      (guide && ctx.workflows().find((w) => w.guide === guide.id)) ||
      (search && search.workflows[0] && search.workflows[0].coverage >= 0.5
        ? search.workflows[0].item
        : null);
    result = { t, search, guide, workflow, weak, fromReply: useReply, reply, query: best ? best.q : "" };
    /* A new email is a new customer: the reply builder starts afresh. */
    ctx.onRead?.();
  }

  /* --------------------------------------------------------------- views */

  const code = (v) =>
    `<code class="copyable" data-action="copy-code" role="button" tabindex="0" title="Click to copy">${esc(v)}</code>`;

  function detailsHtml(t) {
    const f = t.facts;
    const s = t.sender;
    const rows = [
      ["From", [s.name, s.email].filter(Boolean)],
      ["Company", s.company ? [s.company] : []],
      ["Email domain", s.domain && !s.company ? [s.domain] : []],
      ["Contact number", f.contactPhones],
      ["Numbers mentioned", f.phones],
      ["Ticket refs", f.tickets],
      ["Site postcode", f.postcodes],
      ["Equipment", f.models],
      ["Services", f.services],
      ["When", [...f.days, ...f.times]],
      ["IP addresses", f.ips.map((x) => x.ip + (x.private ? " (private)" : " (public)"))],
      ["MAC addresses", f.macs],
    ].filter(([, v]) => v.length);
    if (!rows.length)
      return '<p class="muted">No names, numbers, addresses or equipment found in the text.</p>';
    return `<dl class="triage-facts">${rows
      .map(
        ([k, v]) =>
          `<dt>${k}</dt><dd>${v.map((x) => (k === "IP addresses" ? code(x.split(" ")[0]) + ` <small>${esc(x.split(" ")[1])}</small>` : code(x))).join(" ")}</dd>`,
      )
      .join("")}</dl>`;
  }

  function priorityHtml(p) {
    return `<div class="triage-priority p${p.level}"><b>${esc(p.label)}</b><span>${esc(p.note)}</span>${
      p.reasons.length
        ? `<small>Because it says: ${p.reasons.map((r) => `“${esc(r)}”`).join(", ")}</small>`
        : ""
    }</div>`;
  }

  function guideHtml(r) {
    const s = r.search;
    if (!r.guide)
      return `<p class="muted">No guide matches this well enough.</p><div class="tool-actions"><button class="secondary-btn" data-triage="ask">Ask Astra about it</button></div>`;
    const others = (s ? s.guides : []).filter((g) => g.item.id !== r.guide.id).slice(0, 2);
    const also = others.length
      ? `<p class="hint">Also: ${others.map((g) => `<button class="link-btn" data-triage="guide" data-id="${esc(g.item.id)}">${esc(g.item.title)}</button>`).join(" · ")}</p>`
      : "";
    if (r.weak)
      return `<p class="muted">No guide matches this closely. This one might help:</p><p><button class="link-btn" data-triage="guide" data-id="${esc(r.guide.id)}">${esc(r.guide.title)}</button></p><div class="tool-actions"><button class="secondary-btn" data-triage="ask">Ask Astra about it</button></div>${also}`;
    const label = r.fromReply
      ? "Matches the email"
      : { strong: "Good match", possible: "Possible match" }[s.confidence] || "";
    return `<p class="ask-label">${label}</p><h4 class="triage-guide">${esc(r.guide.title)}</h4><p>${esc(r.guide.summary || "")}</p>
      <div class="tool-actions"><button class="primary-btn" data-triage="guide" data-id="${esc(r.guide.id)}">Open the guide</button>${
        r.workflow
          ? `<button class="secondary-btn" data-triage="workflow" data-id="${esc(r.workflow.id)}">Start “${esc(r.workflow.title)}”</button>`
          : ""
      }<button class="secondary-btn" data-triage="ask">Ask Astra</button></div>${also}`;
  }

  function checksHtml(t) {
    if (!t.checks.length) return "";
    const guideTitle = (id) => ctx.knowledge().find((k) => k.id === id)?.title || "";
    return t.checks
      .map(
        (c) =>
          `<div class="triage-check"><h4>${esc(c.title)}</h4><ul>${c.items
            .map((i) => {
              const state = i.have ? "have" : i.partial ? "part" : "need";
              const mark = i.have ? "✓" : i.partial ? "◐" : "✗";
              const who = i.have
                ? "found in the text"
                : i.partial
                  ? i.partial + ", need more"
                  : i.who === "you"
                    ? "for you to do"
                    : "ask the customer";
              return `<li class="${state}"><span aria-hidden="true">${mark}</span> ${esc(i.label)} <small>${esc(who)}</small></li>`;
            })
            .join("")}</ul>${
            guideTitle(c.guide)
              ? `<p class="hint">From <button class="link-btn" data-triage="guide" data-id="${esc(c.guide)}">${esc(guideTitle(c.guide))}</button></p>`
              : ""
          }</div>`,
      )
      .join("");
  }

  /* Forms and standard emails for what the customer is asking for. Buttons use the page's own actions. */
  const crfFile = encodeURI("library/company/Customer Requirement Form (CRF).xlsx");
  const REQUEST_HTML = {
    port: `<div class="form-row"><b>Number port</b><span>Letter of authority</span><div class="row-actions"><button class="primary-btn" data-action="fill-loa">Fill an LOA</button><button class="secondary-btn" data-action="form-email" data-id="loa-request">Copy LOA email</button></div></div>`,
    "new-system": `<div class="form-row"><b>New phone system</b><span>Customer requirement form</span><div class="row-actions"><a class="secondary-btn" href="${crfFile}" download>Download CRF</a><button class="secondary-btn" data-action="form-email" data-id="crf-request">Copy CRF email</button></div></div>`,
    rma: `<div class="form-row"><b>Faulty equipment</b><span>RMA confirmation</span><div class="row-actions"><button class="secondary-btn" data-action="use-template" data-id="rma-raised">Write the RMA email</button></div></div>`,
    openreach: `<div class="form-row"><b>Engineer visit</b><span>Calendar invite, with the £180 aborted visit charge</span><div class="row-actions"><button class="secondary-btn" data-action="use-template" data-id="openreach-invite">Write the invite</button></div></div>`,
  };

  function requestsHtml(t) {
    const rows = (t.requests || []).map((id) => REQUEST_HTML[id]).filter(Boolean);
    return rows.length
      ? `<section class="card card-pad"><h3>For this request</h3><div class="form-rows">${rows.join("")}</div></section>`
      : "";
  }

  /* The reply this email most likely needs, written from the reply builder with what was found in it. */
  function replyHtml(t) {
    const R = window.AstraReplies;
    const sug = R && result.reply;
    if (!sug) return "";
    /* For a call fault, ask only for the evidence the email did not already give, plus anything the situation
       needs on top (such as which side could not hear). */
    let ask = null;
    const calls = t.checks.find((x) => x.id === "calls");
    if (calls && sug.situation.ask?.some((x) => R.CALL_EVIDENCE.includes(x)))
      ask = [
        /* The checklist is written for us; the customer gets the same request in the reply's own words. */
        ...new Set(
          calls.items
            .filter((i) => !i.have && i.who === "customer")
            .map((i) => {
              if (/^Date and time/.test(i.label))
                return i.partial
                  ? `the date and time of at least three affected calls (I have ${i.partial.replace(/ found$/, "")} so far)`
                  : R.CALL_EVIDENCE[0];
              if (/^(Calling|Destination) number/.test(i.label)) return R.CALL_EVIDENCE[1];
              if (/^Handset/.test(i.label)) return R.CALL_EVIDENCE[2];
              if (/^What happened/.test(i.label)) return R.CALL_EVIDENCE[3];
              return i.label[0].toLowerCase() + i.label.slice(1);
            }),
        ),
        ...sug.situation.ask.filter((x) => !R.CALL_EVIDENCE.includes(x)),
      ];
    /* Never ask for what the email already says, or to try what the customer has already done. */
    const said = t.body || "";
    const gaveModel = t.facts.models.length > 0;
    const gaveScreen =
      /\b(shows?|showing|says|saying|display(s|ing)?|screen)\b[^.?!]{0,40}\b(initiali[sz]ing|url calling disabled|dhcp|no service|registration|error|failed|searching)/i.test(
        said,
      );
    const asked = (ask || sug.situation.ask || []).filter(
      (x) =>
        !(gaveModel && /\b(make and model|model of the (handset|phone))\b/i.test(x)) &&
        !(gaveScreen && /^what the screen shows/i.test(x)),
    );
    const restarted =
      /\b(re-?boot(ed|ing)?|restart(ed|ing)?|power[- ]?cycl\w*|(turn|switch)(ed)? (it|them|the \w+) off and (back )?on|unplugg?ed\b[^.?!]{0,40}\bback in)\b/i.test(
        said,
      );
    const out = R.compose({
      situation: sug.situation,
      stage: sug.stage,
      ask: asked,
      skip: restarted ? /\b(turn the router off|restart|reboot)/i : null,
      values: {
        contact: t.sender.name,
        ticket: t.facts.tickets[0] || "",
        sender: ctx.profile().name,
      },
    });
    const others = sug.others.length
      ? `<p class="hint">Or: ${sug.others
          .map(
            (o) =>
              `<button class="link-btn" data-action="open-replies" data-id="${esc(o.id)}">${esc(o.title)}</button>`,
          )
          .join(" · ")}</p>`
      : "";
    return `<section class="card card-pad"><h3>Reply</h3><p class="ask-label">${esc(sug.situation.title)} · ${esc(
      R.stageById(sug.stage).name.toLowerCase(),
    )}</p><label class="field"><span class="sr-only">Suggested reply</span><textarea id="triageReply" rows="${rowsFor(out.body, 52)}">${esc(
      out.body,
    )}</textarea></label><div class="tool-actions"><button class="primary-btn" data-triage="copy-reply" data-subject="${esc(
      out.subject,
    )}" data-situation="${esc(sug.situation.id)}">Copy reply</button><button class="secondary-btn" data-action="open-replies" data-id="${esc(
      sug.situation.id,
    )}">Other stages and tones</button></div>${others}</section>`;
  }

  /* Tall enough to show the whole text without scrolling inside the box. */
  const rowsFor = (s, width = 0) =>
    Math.max(
      6,
      String(s)
        .split("\n")
        .reduce((n, line) => n + (width ? Math.max(1, Math.ceil(line.length / width)) : 1), 1),
    );

  function resultsHtml() {
    const r = result;
    const t = r.t;
    const ask = T.askForDetails(t, { from: ctx.profile().name });
    const note = T.ticketNote(t, {
      guide: r.guide && !r.weak ? r.guide.title : "",
      workflow: r.workflow ? r.workflow.title : "",
      stamp: ctx.stamp(),
    });
    const kind = { fault: "Fault", request: "Request", unclear: "Not clear" }[t.kind];
    const reply = replyHtml(t);
    /* The copies most often wanted, kept in view while the rest scrolls. */
    const bar = `<div class="triage-bar" role="toolbar" aria-label="Copy from this email">${
      reply ? '<button class="primary-btn" data-triage="bar-reply">Copy reply</button>' : ""
    }<button class="${reply ? "secondary-btn" : "primary-btn"}" data-triage="copy-note">Copy ticket note</button>${
      ask && !reply
        ? '<button class="secondary-btn" data-triage="copy-ask">Copy request for details</button>'
        : ""
    }${
      r.guide && !r.weak
        ? `<button class="secondary-btn" data-triage="guide" data-id="${esc(r.guide.id)}">Open the guide</button>`
        : ""
    }</div>`;
    return `${bar}<div class="triage-grid">
      <div class="grid">
        <section class="card card-pad"><div class="item-meta"><span class="tag">${kind}</span></div><h3 class="triage-summary">${esc(t.summary || "No summary found")}</h3>${t.symptoms.length ? `<p class="triage-symptoms">${t.symptoms.map((x) => `<span class="tag">${esc(x)}</span>`).join(" ")}</p>` : ""}${priorityHtml(t.priority)}</section>
        <section class="card card-pad"><h3>Details found</h3>${detailsHtml(t)}</section>
        <section class="card card-pad"><h3>Ticket note</h3><label class="field"><span class="sr-only">Ticket note</span><textarea id="triageNote" rows="${rowsFor(note)}">${esc(note)}</textarea></label><div class="tool-actions"><button class="primary-btn" data-triage="copy-note">Copy note</button></div></section>
      </div>
      <aside class="grid">
        ${reply}
        ${requestsHtml(t)}
        <section class="card card-pad"><h3>${t.kind === "fault" ? "Likely fault" : "Best guide"}</h3>${guideHtml(r)}</section>
        ${
          t.checks.length
            ? `<section class="card card-pad"><h3>Evidence</h3>${checksHtml(t)}<div class="tool-actions"><button class="secondary-btn" data-action="raise-fault" data-id="${
                t.checks.some((c) => c.id === "calls" || c.id === "quality") ? "horizon" : "line"
              }">Build the fault report</button></div></section>`
            : ""
        }
        ${
          ask && !reply
            ? `<section class="card card-pad"><h3>Ask the customer for</h3><label class="field"><span class="sr-only">Message asking for the missing details</span><textarea id="triageAsk" rows="${rowsFor(ask)}">${esc(ask)}</textarea></label><div class="tool-actions"><button class="primary-btn" data-triage="copy-ask">Copy message</button></div></section>`
            : ""
        }
      </aside>
    </div>`;
  }

  function formHtml() {
    const fold = folded && result;
    const lines = text.trim().split(/\n/).length;
    return `<form class="card card-pad triage-input${fold ? " folded" : ""}" id="triageForm">${
      fold
        ? `<div class="triage-folded"><span><b>${esc(result.t.sender.name || result.t.summary || "Email")}</b> · ${lines} line${lines === 1 ? "" : "s"}</span><button type="button" class="secondary-btn" data-triage="edit">Show the email</button></div>`
        : ""
    }<label class="field"><span>Email or ticket text</span><textarea id="triageInput" rows="9" placeholder="Paste the whole email, including the signature. Quoted replies are ignored." spellcheck="false">${esc(text)}</textarea></label>
        <div class="tool-actions"><button class="primary-btn" type="submit">Triage <kbd>Ctrl Enter</kbd></button></div></form>`;
  }

  function paintForm() {
    const form = document.getElementById("triageForm");
    if (form) form.outerHTML = formHtml();
  }

  function render(container) {
    container.innerHTML = `<div class="page-head"><h2>Triage</h2><div class="actions"><button class="secondary-btn" data-triage="clear"${text ? "" : " hidden"}>Clear</button></div></div>
      ${formHtml()}
      <div id="triageResults" aria-live="polite">${result ? resultsHtml() : ""}</div>`;
    if (!text) document.getElementById("triageInput").focus();
  }

  function paintResults() {
    const box = document.getElementById("triageResults");
    if (box) box.innerHTML = result ? resultsHtml() : "";
    document.querySelector('[data-triage="clear"]')?.toggleAttribute("hidden", !text);
  }

  /* -------------------------------------------------------------- events */

  function submit() {
    const input = document.getElementById("triageInput");
    if (!input) return;
    if (!input.value.trim()) {
      ctx.toast("Paste an email or ticket first");
      input.focus();
      return;
    }
    analyse(input.value);
    folded = true;
    paintForm();
    paintResults();
    document.getElementById("triageResults").scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function clear() {
    text = "";
    result = null;
    folded = false;
    paintForm();
    const input = document.getElementById("triageInput");
    if (input) {
      input.value = "";
      input.focus();
    }
    paintResults();
  }

  document.addEventListener("submit", (e) => {
    if (e.target.id !== "triageForm") return;
    e.preventDefault();
    submit();
  });

  document.addEventListener("keydown", (e) => {
    if (e.target.id === "triageInput" && e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  });

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-triage]");
    if (!el) return;
    const act = el.dataset.triage;
    if (act === "clear") clear();
    else if (act === "bar-reply") document.querySelector('[data-triage="copy-reply"]')?.click();
    else if (act === "edit") {
      folded = false;
      paintForm();
      document.getElementById("triageInput")?.focus();
    } else if (act === "guide") ctx.openGuide(el.dataset.id);
    else if (act === "workflow") ctx.openWorkflow(el.dataset.id);
    else if (act === "ask") window.AstraAsk.ask(result?.query || result?.t.summary || "");
    else if (act === "copy-note")
      ctx.copy(document.getElementById("triageNote").value, "Ticket note copied", `Ticket note: ${about()}`);
    else if (act === "copy-ask")
      ctx.copy(document.getElementById("triageAsk").value, "Message copied", `Message: ${about()}`);
    else if (act === "copy-reply")
      ctx.copy(document.getElementById("triageReply").value, "Reply copied", `Reply: ${about()}`);
  });

  /* What the email is about, to name a copy in Recent copies. */
  const about = () => result?.t.summary || "email";

  function init(context) {
    ctx = context;
  }

  /* Forgets the email, such as after a backup is imported or Astra is reset. */
  function reset() {
    text = "";
    result = null;
    folded = false;
  }

  /* From the Home page: read the text now, show it when the page opens. */
  const start = (input) => {
    analyse(input);
    folded = true;
  };

  /* The last email read, for the templates, lines and forms that reuse its details. */
  const latest = () =>
    result
      ? {
          name: result.t.sender.name,
          email: result.t.sender.email,
          company: result.t.sender.company,
          postcode: result.t.facts.postcodes[0] || "",
          numbers: result.t.facts.phones,
          contactPhones: result.t.facts.contactPhones,
          tickets: result.t.facts.tickets,
          times: result.t.facts.times,
          models: result.t.facts.models,
          summary: result.t.summary,
          provider: result.t.losingProvider,
        }
      : null;

  return { init, render, reset, start, latest };
})();
