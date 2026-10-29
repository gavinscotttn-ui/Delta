import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

/* Triage against the real knowledge base: does a realistic (made-up) email lead to the right guide? */
/* The seed files the page loads, in its order (history.js is only used for updating saved workspaces). */
const seedFiles = [...readFileSync("index.html", "utf8").matchAll(/<script src="js\/seed\/([^"]+)\.js"/g)]
  .map((m) => m[1])
  .filter((f) => f !== "registry" && f !== "history");
const sandbox = { structuredClone };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of [
  "js/seed/registry.js",
  ...seedFiles.map((f) => `js/seed/${f}.js`),
  "js/library/docs.js",
  "js/library/index.js",
  "js/kb-core.js",
  "js/assistant-core.js",
  "js/triage-core.js",
])
  vm.runInContext(readFileSync(f, "utf8"), sandbox, { filename: f });
const { AstraTriage: T, AstraAssistant: A, AstraSeed: seed } = sandbox;
const engine = A.create({ knowledge: seed.knowledge, workflows: seed.workflows, templates: seed.templates });

const CASES = [
  [
    "Subject: Phones keep dropping calls\n\nHi, since this morning our reception phone (Yealink T46U) keeps dropping calls after about 30 seconds.\n\nThanks\nSam",
    ["kb-horizon-calls-not-connecting"],
    ["Calls dropping"],
  ],
  [
    "Hello, Dave's handset shows Initialising on the screen and won't register. Can you help? Regards, Jo",
    ["kb-horizon-handset-not-registering"],
    ["Handset not registering"],
  ],
  [
    "Morning, we can only hear one side of the call on outbound calls, the other person can't hear us.",
    ["kb-sip-alg", "kb-call-quality"],
    ["One-way or no audio"],
  ],
  [
    "Hi team, calls sound robotic and choppy on our Polycom VVX 450 phones since yesterday.",
    ["kb-call-quality"],
    ["Poor call quality"],
  ],
  [
    "Webex is not ringing on my iPhone when people call me, it works on the desktop app.",
    ["kb-webex-calls-iphone"],
    ["Calls not ringing"],
  ],
];

for (const [email, expected, symptoms] of CASES) {
  test(`triage finds the right guide: ${email.slice(0, 60)}`, () => {
    const t = T.read(email);
    assert.deepEqual(JSON.parse(JSON.stringify(t.symptoms)), symptoms);
    const best = T.bestSearch(t.queries, engine);
    const top = best.r.guides.slice(0, 2).map((g) => g.item.id);
    assert.ok(
      expected.some((e) => top.includes(e)),
      `got ${top.join(", ")} (${best.r.confidence}) from "${best.q}"`,
    );
    assert.notEqual(best.r.confidence, "weak");
  });
}

test("every guide a checklist points to exists", () => {
  for (const c of T.CHECKLISTS)
    assert.ok(
      seed.knowledge.some((k) => k.id === c.guide),
      c.guide,
    );
});
