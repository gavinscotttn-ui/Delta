import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync, existsSync } from "node:fs";

/* Load the seed, library and kb-core scripts the same way the page does, without a browser. */
/* The seed files come from index.html, in its order, so a new seed file is checked as soon as the page loads it. */
const scripts = [
  ...[...readFileSync("index.html", "utf8").matchAll(/<script src="(js\/seed\/[^"]+\.js)"/g)]
    .map((m) => m[1])
    .filter((f) => !f.endsWith("/history.js")),
  "js/library/docs.js",
  "js/library/index.js",
  "js/kb-core.js",
];
const sandbox = { structuredClone };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of scripts) vm.runInContext(readFileSync(f, "utf8"), sandbox, { filename: f });
const { AstraSeed: seed, AstraKB: KB, AstraLibrary: lib } = sandbox;

test("seed ids are unique within each list", () => {
  for (const kind of ["templates", "snippets", "workflows", "knowledge", "shortcuts"]) {
    const ids = seed[kind].map((x) => x.id);
    assert.equal(
      new Set(ids).size,
      ids.length,
      `duplicate id in ${kind}: ${ids.filter((x, i) => ids.indexOf(x) !== i)}`,
    );
  }
});

test("every library file exists and every document has a page count", () => {
  for (const d of lib.docs) {
    assert.ok(existsSync(d.file), `missing ${d.file}`);
    if (d.original) assert.ok(existsSync(d.original), `missing ${d.original}`);
    assert.ok(d.pages > 0, `${d.id} has no pages`);
    assert.ok(lib.categories.includes(d.category), `${d.id}: unknown category ${d.category}`);
  }
});

test("every guide source is found word for word on a page of its document", () => {
  const problems = [];
  for (const k of seed.knowledge) {
    for (const s of k.docs || []) {
      const doc = KB.docById(s.id);
      if (!doc) {
        problems.push(`${k.id}: unknown document ${s.id}`);
        continue;
      }
      if (s.page) continue;
      if (!KB.hasExact(s.id, s.find)) problems.push(`${k.id}: "${s.find}" is not on any page of ${s.id}`);
    }
  }
  assert.deepEqual(problems, []);
});

test("related guides, workflow guides and fault-finder labels are valid", () => {
  const ids = new Set(seed.knowledge.map((k) => k.id));
  const problems = [];
  for (const k of seed.knowledge)
    for (const r of k.related || []) if (!ids.has(r)) problems.push(`${k.id} -> missing related ${r}`);
  for (const w of seed.workflows)
    if (w.guide && !ids.has(w.guide)) problems.push(`${w.id} -> missing guide ${w.guide}`);
  assert.deepEqual(problems, []);
  const quick = seed.knowledge.filter((k) => k.quick).map((k) => k.quick);
  assert.equal(new Set(quick).size, quick.length, "duplicate fault-finder labels");
});

test("every rich guide renders, and no raw markup leaks through", () => {
  for (const k of seed.knowledge.filter((x) => x.rich)) {
    const html = KB.render(k.body);
    assert.ok(html.length > 50, `${k.id} rendered empty`);
    assert.ok(!/\*\*|^## |\n## /.test(html.replace(/<[^>]+>/g, "")), `${k.id} has unrendered markup`);
    assert.ok(!/<script|onerror=|javascript:/i.test(html), `${k.id} contains active markup`);
  }
});

test("rendering escapes HTML in guide text", () => {
  const html = KB.render(
    "## <img src=x onerror=alert(1)>\n- **b** `<b>x</b>`\n| a | b |\n|---|---|\n| <i>1</i> | 2 |",
  );
  assert.ok(!html.includes("<img") && !html.includes("<i>1</i>") && !html.includes("<b>x</b>"));
  assert.match(html, /&lt;img/);
});

test("searching inside documents finds the right pages", () => {
  const top = (q, id) => KB.searchPages(q, { limit: 15 }).some((h) => h.doc.id === id);
  assert.ok(top("sip alg telnet", "horizon-tech-support"));
  assert.ok(top("registration mode base pin", "yealink-w73p-guide"));
  assert.ok(top("blind transfer attended", "voxone-android"));
  assert.ok(top("TTL 3720", "voxone-firewall"));
  assert.ok(top("port reference number CRM", "pragma-port-guide"));
  assert.ok(
    top("Premium Managed Install", "install-types"),
    "image-only PDFs are searchable through their transcripts",
  );
  assert.ok(top("front desk AI-Receptionist", "webex-gamma-overview"));
  assert.equal(KB.searchPages("zzzzqqqq").length, 0);
});

test("document links open the right page and are URL-safe", () => {
  const d = KB.docById("horizon-tech-support");
  assert.match(KB.docHref(d, 1), /^library\/horizon\/Horizon%20Technical%20Support%20Guide%20v4\.4\.pdf$/);
  assert.match(KB.docHref(d, 28), /#page=28$/);
  const page = KB.locate("horizon-tech-support", "SIP ALG stands for Application Layer Gateway");
  assert.equal(page, 28);
});

test("every copyable code, URL and command in a guide appears word for word in the documents", () => {
  /* Anything a user can click to copy must come from a source, not from memory. The few exceptions
     were checked by eye against the page and are listed here with the reason. */
  const checkedByEye = new Set([
    "*0",
    "##*3",
    "##" /* Yealink T46U key sequences, shown as key icons in the PDF */,
    "telnet <router IP>" /* the guide says "Telnet followed by the IP address of your router" */,
  ]);
  const norm = (s) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ");
  const corpus = norm(lib.index.map((p) => p[2]).join(" \n "));
  const compact = corpus.replace(/\s+/g, "");
  const missing = [];
  /* Guides marked owner: "company" hold the team's own facts (account numbers, phone options), which no supplier
     document contains. Those were supplied by the team directly. */
  for (const k of seed.knowledge.filter((x) => x.rich && x.owner !== "company")) {
    for (const m of k.body.matchAll(/`([^`]+)`/g)) {
      const c = norm(m[1]);
      if (checkedByEye.has(m[1])) continue;
      if (!corpus.includes(c) && !compact.includes(c.replace(/\s+/g, ""))) missing.push(`${k.id}: ${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("document search highlights words without breaking the text around them", () => {
  for (const q of ["phone mark", "router ar", "user ark", "calls mark", "amp router"]) {
    for (const h of KB.searchPages(q).slice(0, 10)) {
      const bare = h.snippet.replace(/<\/?mark>/g, "");
      assert.ok(!/[<>]/.test(bare), `stray markup for "${q}": ${h.snippet}`);
      assert.ok(!/&(?!amp;|lt;|gt;|quot;|#39;)/.test(bare), `broken character for "${q}": ${h.snippet}`);
      assert.equal(h.snippet.match(/<mark>/g)?.length, h.snippet.match(/<\/mark>/g)?.length);
    }
  }
});
