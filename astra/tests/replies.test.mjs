import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

/* The reply builder, plus the guides it cites, loaded as the page loads them. */
const sandbox = { structuredClone };
sandbox.window = sandbox;
vm.createContext(sandbox);
const seeds = [...readFileSync("index.html", "utf8").matchAll(/<script src="(js\/seed\/[^"]+\.js)"/g)]
  .map((m) => m[1])
  .filter((f) => !f.endsWith("/history.js"));
for (const f of [
  ...seeds,
  "js/library/docs.js",
  "js/library/index.js",
  "js/kb-core.js",
  "js/assistant-core.js",
  "js/replies.js",
  "js/triage-core.js",
])
  vm.runInContext(readFileSync(f, "utf8"), sandbox, { filename: f });
const { AstraReplies: R, AstraSeed: seed, AstraTriage: T, AstraAssistant: A, AstraLibrary: lib } = sandbox;
const guides = new Map(seed.knowledge.map((k) => [k.id, k]));
const templates = seed.templates.map((t) => t.body).join("\n");

const FULL = {
  contact: "Sarah Jones",
  ticket: "INC-48213",
  update_time: "3pm today",
  sender: "Alex Morgan",
  supplier_ref: "GAM-778812",
  date: "Tuesday 20 October 2026",
  timeslot: "AM 08:00–13:00",
  close_date: "Friday 23 October 2026",
  site: "BS1 4DJ",
};
const every = R.all();
const write = (r, values = FULL) => R.compose({ ...r, values });

test("well over a thousand distinct replies", () => {
  assert.ok(every.length >= 1500, `${every.length} replies`);
  const bodies = new Set(every.map((r) => write(r).body));
  assert.ok(bodies.size >= every.length * 0.99, `${bodies.size} distinct of ${every.length}`);
});

test("every reply reads cleanly: greeting, full sentences, sign-off, nothing left unfilled", () => {
  const problems = [];
  for (const r of every) {
    const { body, subject, missing } = write(r);
    const id = `${r.situation}/${r.stage}/${r.audience}/${r.length}/${r.tone}`;
    const bad = (why) => problems.push(`${id}: ${why}`);
    if (!subject) bad("no subject");
    if (/undefined|null|NaN|\[object|\{\w+\}|\[(date|time slot)\]/.test(body)) bad("unfilled text");
    if (/ {2,}|\s[,;:]|\s\.(?!wav)|\.\.|,,|\?\.|\.\?/.test(body.replace(/\n+/g, " ").replace(/ - /g, " ")))
      bad("spacing or punctuation");
    if (missing.length) bad("missing " + missing);
    if (r.length === "email") {
      if (!/^(Hi|Dear) Sarah,\n\n/.test(body)) bad("greeting");
      if (!body.endsWith("Kind regards,\nAlex Morgan")) bad("sign-off");
      for (const line of body.split("\n").filter((l) => l.startsWith("- ")))
        if (!/^- [A-Z0-9*]/.test(line)) bad("list item not capitalised: " + line);
    } else {
      if (!/^Hi Sarah, ([a-z]|I[ '])/.test(body) || !body.endsWith("Thanks, Alex"))
        bad("short message shape");
      if (body.includes("\n")) bad("short message has line breaks");
      if (/\bi\b|\bi'/.test(body)) bad("lower-case I");
      if (body.length > 900) bad(`short message too long (${body.length})`);
    }
    /* After a full stop, question mark or colon-ended heading, the next sentence starts with a capital. */
    for (const m of body.matchAll(/[.?!]\s+([a-z])/g))
      bad(`lower-case sentence start "${body.slice(m.index - 20, m.index + 10)}"`);
    /* A contraction cannot end a phrase: "which group it's" is wrong, "which group it is" is right. */
    if (/\b(it's|that's|they're|you're|we're)(?=\s*[.,;:)\n]|$)/im.test(body))
      bad("contraction at the end of a phrase");
    if (
      r.tone === "formal" &&
      r.length === "email" &&
      /n't\b|\bI'(m|ll|ve)\b|\b(it|that|they|you)'(s|re)\b/.test(body)
    )
      bad("contraction in a formal email");
  }
  assert.deepEqual(problems.slice(0, 20), []);
});

test("every stage sits in one of the groups the page shows, so none is hidden", () => {
  const shown = new Set(
    readFileSync("js/app.js", "utf8")
      .match(/STAGE_GROUPS = (\[[^\]]+\])/)[1]
      .match(/"\w+"/g)
      .map((x) => JSON.parse(x)),
  );
  assert.deepEqual([...shown], ["Start", "Updates", "Engineer", "Finish"]);
  for (const stage of R.STAGES) assert.ok(shown.has(stage.group), `${stage.id} has group ${stage.group}`);
});

test("UK spelling throughout", () => {
  const US =
    /\b(color|favorite|organiz\w*|recogniz\w*|authoriz\w*|customiz\w*|center|license[sd]?|canceled|gray|behavior|analyz\w*|prioritiz\w*|initializing|minimiz\w*|catalog|program(?!me))\b/i;
  const hits = new Set();
  for (const r of every) {
    const m = US.exec(write(r).body);
    if (m) hits.add(m[0]);
  }
  assert.deepEqual([...hits], []);
});

test("no fact appears that is not in the guides or the team's own templates", () => {
  const text = every.map((r) => write(r).body).join("\n");
  const sources = [...guides.values()].map((k) => k.body).join("\n") + "\n" + templates;
  /* Prices */
  for (const p of new Set(text.match(/£\d[\d,]*(?:\.\d{2})?/g))) {
    const n = p.slice(1);
    assert.ok(sources.includes(p) || sources.includes(`GBP ${n}`), `price ${p} has no source`);
  }
  /* Phone numbers */
  for (const n of new Set(text.match(/\b0\d{3,4} ?\d{3} ?\d{3,4}\b|\b17070\b/g)))
    assert.ok(sources.includes(n), `number ${n} has no source`);
  /* Dial codes */
  for (const c of new Set(text.match(/(?:##)?\*\d{1,3}\b|##\*\d/g)))
    assert.ok(sources.includes(c), `code ${c} has no source`);
  /* IP addresses and networks */
  for (const ip of new Set(text.match(/\b\d{1,3}(?:\.\d{1,3}){3}(?:\/\d+)?\b/g)))
    assert.ok(sources.includes(ip), `address ${ip} has no source`);
});

test("each situation cites a guide that exists, and has what its kind needs", () => {
  const ids = new Set();
  for (const s of R.SITUATIONS) {
    assert.ok(!ids.has(s.id), `duplicate ${s.id}`);
    ids.add(s.id);
    assert.ok(guides.has(s.guide), `${s.id} cites missing guide ${s.guide}`);
    if (s.kind === "howto") assert.ok(s.answer?.length, `${s.id} has no answer`);
    if (s.kind === "request") assert.ok(s.ask?.length && s.done, `${s.id} needs ask and done`);
    if (s.kind === "fault")
      assert.ok(s.ask?.length || s.steps?.length || s.it?.length, `${s.id} has nothing to say`);
    if (s.engineer) assert.ok(s.supplier, `${s.id}: an engineer comes via a supplier`);
  }
});

test("details that are not known are left out, not shown as blanks", () => {
  const r = R.compose({ situation: "calls-dropping", stage: "raised", values: {} });
  assert.match(r.body, /^Hi there,/);
  assert.ok(!/\(ticket|reference|undefined/.test(r.body), r.body);
  assert.match(r.body, /as soon as I have news/);
  const booked = R.compose({ situation: "broadband-down", stage: "engineer-booked", values: {} });
  assert.deepEqual([...booked.missing], ["date", "timeslot"], "the builder asks for what the stage needs");
});

test("a pasted email picks the right situation", () => {
  const cases = [
    ["Our calls keep dropping after about 30 seconds", "calls-dropping"],
    ["Reception phone just says Initialising and won't register", "handset-not-registering"],
    ["We have no internet at all since this morning", "broadband-down"],
    ["The broadband is really slow in the afternoons", "broadband-slow"],
    ["Customers say they can't hear us but we can hear them, one way audio", "one-way-audio"],
    ["We have a new starter on Monday, can you add a user for her?", "new-user"],
    ["Please can you divert our calls to my mobile", "divert-setup"],
    ["Webex calls don't show on my Samsung", "webex-android"],
    ["How do I transfer a call to a colleague?", "transfer-howto"],
    ["We'd like to change our music on hold", "hold-music"],
    ["Can we block this nuisance number please", "block-nuisance"],
    ["The cordless says searching for base", "cordless-pairing"],
  ];
  const misses = [];
  for (const [text, want] of cases) {
    const got = R.suggest(T.read(text));
    if (got?.situation.id !== want) misses.push(`${text} -> ${got?.situation.id}`);
  }
  assert.deepEqual(misses, []);
});

test("searching finds the situation and the stage", () => {
  const top = (q) => R.search(q)[0];
  assert.equal(top("chase customer calls dropping").situation.id, "calls-dropping");
  assert.equal(top("chase customer calls dropping").stage, "no-reply");
  assert.equal(top("engineer charges broadband down").stage, "engineer-needed");
  assert.equal(top("new starter").situation.id, "new-user");
  assert.equal(top("voicemail full").situation.id, "voicemail-full");
});

/* The text of a library document, as Astra indexed it from the PDF. */
const docText = (id) => {
  const at = lib.docs.findIndex((d) => d.id === id);
  return lib.index
    .filter((p) => p[0] === at)
    .map((p) => p[2])
    .join(" ");
};

test("every price, phone number, percentage and time period in every reply has a written source", () => {
  const sources = A.facts([...guides.values()].map((k) => k.body).join("\n") + "\n" + templates);
  const missing = new Set();
  for (const r of every)
    for (const [key, shown] of A.facts(write(r).body))
      if (!sources.has(key)) missing.add(`${shown} (${r.situation}/${r.stage})`);
  assert.deepEqual([...missing], []);
});

test("the only charges a reply can quote are the ones in our Terms & Conditions", () => {
  /* Clause for each: 4.2 call-out from £85 per hour, 4.2 aborted visit £180.00, 10.3 cease £45, 7.3 upwards of £300. */
  const allowed = new Set(["money:85", "money:180", "money:45", "money:300"]);
  const seen = new Set();
  for (const r of every)
    for (const [key, shown] of A.facts(write(r).body))
      if (key.startsWith("money:")) {
        assert.ok(allowed.has(key), `${shown} in ${r.situation}/${r.stage}`);
        seen.add(key);
      }
  assert.deepEqual([...seen].sort(), [...allowed].sort());
  /* A missed or aborted visit is always £180, and only ever £180. */
  for (const r of every) {
    const body = write(r).body.replace(/\s+/g, " ");
    for (const m of body.matchAll(/[^.;]*\b(aborted|missed)\b[^.;]*[.;]/gi)) {
      assert.match(m[0], /£180\b/, `${r.situation}/${r.stage}: "${m[0].trim()}"`);
      assert.ok(!/£(?!180\b)\d/.test(m[0]), `another price next to a missed visit: "${m[0].trim()}"`);
    }
  }
});

test("the Terms & Conditions guide matches the Terms & Conditions document, figure for figure", () => {
  const pdf = A.facts(docText("terms-conditions"));
  assert.ok(pdf.size > 10, "the document text is indexed");
  const guide = guides.get("kb-company-terms").body;
  for (const [key, shown] of A.facts(guide)) assert.ok(pdf.has(key), `${shown} is not in the T&Cs`);
  for (const key of [
    "money:180",
    "money:85",
    "money:45",
    "money:300",
    "money:10",
    "time:90:day",
    "time:30:day",
    "percent:20",
  ])
    assert.ok(pdf.has(key), `the T&Cs no longer say ${key}`);
  assert.match(docText("terms-conditions"), /Aborted visit charge £180\.00/);
  assert.ok(!/£150/.test(docText("terms-conditions")), "the old £150 charge has gone");
  assert.match(docText("terms-conditions"), /By the Customer: 90 days. written notice/);
  /* The first line checks guide quotes the same clause. */
  for (const [key, shown] of A.facts(guides.get("kb-first-line-checks").body))
    assert.ok(pdf.has(key), `${shown} (first line checks) is not in the T&Cs`);
});

test("no document anywhere gives a different missed-visit charge", () => {
  for (const p of lib.index) {
    const text = p[2].replace(/\s+/g, " ");
    for (const m of text.matchAll(/(aborted|abortive|missed) (engineer )?visit[^.]{0,60}/gi)) {
      const prices = m[0].match(/£\s?\d[\d,.]*/g) || [];
      for (const price of prices)
        assert.match(price, /£\s?180/, `${lib.docs[p[0]].title}, page ${p[1]}: ${m[0]}`);
    }
  }
});

test("a customer leaving us and a member of staff leaving them are never confused", () => {
  const pick = (text) => R.suggest(T.read(text))?.situation.id;
  for (const text of [
    "Please accept this as our notice to cancel our contract.",
    "We are moving to another provider and want to end our service.",
    "We'd like to terminate the broadband contract.",
    "Please treat this email as us giving notice.",
  ])
    assert.equal(pick(text), "cancel-service", text);
  for (const text of [
    "John is leaving on Friday, please remove the user.",
    "One of our employees has left, can you remove the user?",
    "We have a leaver next week.",
  ])
    assert.equal(pick(text), "leaver", text);
  for (const text of ["Can we cancel the engineer appointment?", "Please cancel the divert on reception."])
    assert.notEqual(pick(text), "cancel-service", text);
  const reply = write({
    situation: "cancel-service",
    stage: "first-reply",
    audience: "customer",
    length: "email",
    tone: "formal",
  }).body;
  assert.match(reply, /90 days' written notice/);
  assert.match(reply, /address on your bill/);
  assert.match(reply, /count from the day we receive it/);
  /* Clause 10.3: the cease charge is not tied to the minimum period, so it must not share a sentence with it. */
  for (const r of R.all().filter((x) => x.situation === "cancel-service")) {
    const text = write(r).body;
    for (const sentence of text.split(/(?<=\.)\s+/))
      if (/minimum period/.test(sentence))
        assert.ok(
          !/£45|cease/.test(sentence.split(/,(?= broadband)/)[0]),
          `cease charge tied to the minimum period: ${sentence}`,
        );
  }
  const leaver = R.all()
    .filter((r) => r.situation === "leaver")
    .map((r) => write(r).body)
    .join(" ");
  assert.ok(!/90 days|notice/.test(leaver), "removing a user says nothing about the 90 days' notice");
});

test("call forwarding replies say forwarding is to UK numbers, and who pays when it goes to a mobile", () => {
  const body = write({
    situation: "divert-setup",
    stage: "first-reply",
    audience: "customer",
    length: "email",
    tone: "friendly",
  }).body;
  assert.match(body, /any UK number/);
  assert.match(
    body,
    /to a mobile, your callers pay nothing extra, but the forwarded calls are charged to you/,
  );
});

test("realistic emails get the right reply, or none rather than a wrong one", () => {
  /* [email, situation id] where null means no reply should be offered and "!id" means anything but that one. */
  const cases = JSON.parse(readFileSync("tests/fixtures/reply-cases.json", "utf8"));
  const misses = [];
  for (const [text, want] of cases) {
    const got = R.suggest(T.read(text))?.situation.id ?? null;
    const ok = want === null ? got === null : want.startsWith("!") ? got !== want.slice(1) : got === want;
    if (!ok) misses.push(`${text} -> ${got} (want ${want})`);
  }
  assert.deepEqual(misses, []);
});

test("stage wording fits every situation, and fixes are only reported where we make them", () => {
  for (const s of R.SITUATIONS) {
    const stages = R.stagesFor(s).map((x) => x.id);
    for (const id of stages) {
      const body = R.compose({ situation: s, stage: id, values: { contact: "Sarah", ticket: "T1" } }).body;
      assert.ok(
        !/(that|As) (the|your|there|getting|ending|changing|setting|blocking|bringing|ringing) [^.]* is (taking|not resolved)/.test(
          body.replace(/(your|the) ticket about [^.]*/g, ""),
        ),
        `${s.id}/${id}: ${body}`,
      );
      assert.ok(!/To fix (getting|there|your|the)\b/.test(body), `${s.id}/${id}`);
    }
    const customerFix = [
      "cordless-battery",
      "cordless-pairing",
      "cordless-signal",
      "voicemail-full",
      "webex-android",
      "webex-iphone",
      "headset",
      "app-video",
      "app-mobile-data",
      "desk-phone-no-power",
      "voxone-firewall",
      "sip-alg",
      "app-sign-in",
    ];
    if (customerFix.includes(s.id))
      assert.ok(!stages.includes("resolved-check"), `${s.id} has no fix of ours to report`);
  }
  const faulty = R.compose({ situation: "handset-faulty", stage: "first-reply", values: {} }).body;
  assert.match(faulty, /first checks the phone is faulty/);
  assert.match(faulty, /damage to equipment, whatever the cause, is charged/);
});
