import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { chromium } from "playwright";

/* Fault reports, workflows, the contract dates from the T&Cs, and the cancellation reply's end date. */

const sandbox = {};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync("js/faults.js", "utf8"), sandbox);
vm.runInContext(readFileSync("js/contract.js", "utf8"), sandbox);
const F = sandbox.AstraFaults;
const C = sandbox.AstraContract;
const knowledge =
  readFileSync("js/seed/knowledge-horizon.js", "utf8") + readFileSync("js/seed/knowledge-gamma.js", "utf8");
const terms =
  readFileSync("js/seed/company.js", "utf8") + readFileSync("js/seed/knowledge-network-orders.js", "utf8");

test("a Horizon fault report asks for exactly what Gamma's guide lists, and at least three calls", () => {
  /* The guide's own words for each detail. */
  for (const words of ["Date and time", "Calling number", "Destination number", "Handset make and model"])
    assert.ok(knowledge.includes(words), words);
  assert.ok(knowledge.includes("at least 3"));
  assert.equal(F.MIN_EXAMPLES, 3);

  const call = (n) => ({
    when: `14/10/2026 09:0${n}`,
    from: "0117 496 0555",
    to: "01632 960123",
    handset: "Yealink T46U",
    what: "Dropped after 30 seconds",
  });
  let r = F.horizon({ ref: "INC-1", problem: "Calls drop", examples: [call(1), call(2)] });
  assert.match(r.missing.join(), /1 more complete call example/);
  r = F.horizon({
    ref: "INC-1",
    customer: "Acme Ltd",
    site: "BS1 4DJ",
    problem: "Calls drop",
    examples: [call(1), call(2), call(3)],
  });
  assert.equal(r.missing.length, 0);
  assert.match(
    r.text,
    /^Our reference: INC-1\nCustomer: Acme Ltd, BS1 4DJ\nFault: Calls drop\n\nCall examples:\n1\. Date and time: 14\/10\/2026 09:01; Calling number: 0117 496 0555; Destination number: 01632 960123; Handset make and model: Yealink T46U; What happened: Dropped after 30 seconds\n/,
  );
  /* A quality fault also needs the access investigation and the codec. */
  r = F.horizon({ problem: "Choppy audio", quality: true, examples: [call(1), call(2), call(3)] });
  assert.match(r.missing.join(), /access investigation.*codec/);
  /* An example missing a detail does not count. */
  r = F.horizon({ problem: "x", examples: [call(1), call(2), { ...call(3), to: "" }] });
  assert.equal(r.complete, 2);
  assert.match(r.text, /Destination number: \[missing\]/);
});

test("a line fault report needs the customer to accept the call-out charges first (T&Cs 4.2)", () => {
  assert.ok(terms.includes("starting from £85 per hour"));
  assert.ok(terms.includes("£180"));
  assert.match(F.CHARGES, /starting from £85 per hour; aborted visit £180/);
  let r = F.line({ problem: "No dial tone", checks: ["power", "reboot"] });
  assert.match(r.missing.join(), /call-out charges/);
  assert.match(r.text, /Not yet confirmed: the customer accepts that call-out charges apply/);
  r = F.line({
    ref: "INC-2",
    problem: "No dial tone",
    checks: ["power", "reboot", "quiet-line"],
    charges: true,
    lights: "Sync on",
  });
  assert.equal(r.missing.length, 0);
  assert.match(r.text, /- Router rebooted\n- Quiet line test \(17070, option 2\)\nRouter lights: Sync on/);
  assert.match(
    r.text,
    /The customer accepts that call-out charges apply if no fault is found \(starting from £85 per hour; aborted visit £180\)\.$/,
  );
  /* Every check is one from Gamma's guide. */
  for (const words of ["master socket", "test socket", "17070", "option 2"])
    assert.ok(knowledge.includes(words), words);
});

/* ------------------------------------------------------------ contract dates */

test("the customer's 90 days' notice ends 90 days after the day it is received", () => {
  assert.equal(C.NOTICE_DAYS, 90);
  assert.equal(C.noticeEnd("2026-10-14"), "2027-01-12");
  assert.equal(C.noticeEnd("2026-03-01"), "2026-05-30", "across the spring clock change");
  assert.equal(C.noticeEnd("2026-09-01"), "2026-11-30", "across the autumn clock change");
  assert.equal(C.noticeEnd("2027-12-01"), "2028-02-29", "into a leap year");
  assert.equal(C.noticeEnd("2026-12-31"), "2027-03-31");
  for (const bad of ["", "2026-02-30", "14/10/2026", "2026-13-01", null]) assert.equal(C.noticeEnd(bad), "");
  /* Every day of a year, checked against plain day counting. */
  for (let d = new Date(2026, 0, 1, 12); d.getFullYear() === 2026; d.setDate(d.getDate() + 1)) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const end = new Date(C.noticeEnd(iso) + "T12:00:00");
    assert.equal(Math.round((end - d) / 86400000), 90, iso);
  }
});

test("the minimum term (12 months unless stated) and early termination", () => {
  assert.equal(C.DEFAULT_TERM, 12);
  assert.equal(C.termEnd("2026-03-01"), "2027-03-01");
  assert.equal(C.termEnd("2026-01-31", 1), "2026-02-28", "a 31st ends on the last day of a shorter month");
  assert.equal(C.termEnd("2024-02-29", 12), "2025-02-28");
  assert.equal(C.termEnd("2026-03-01", 36), "2029-03-01");
  assert.equal(C.termEnd("2026-03-01", 0), "");
  assert.equal(C.termEnd("not a date", 12), "");
  /* Notice ending before the term does: early termination fees apply (10.3). */
  assert.equal(C.insideTerm("2026-10-14", "2026-03-01", 12), true);
  assert.equal(C.insideTerm("2027-01-14", "2026-03-01", 12), false);
  /* Notice ending on the very day the term ends is not inside it. */
  assert.equal(C.noticeEnd("2026-12-01"), "2027-03-01");
  assert.equal(C.insideTerm("2026-12-01", "2026-03-01", 12), false);
  assert.equal(C.insideTerm("2026-11-30", "2026-03-01", 12), true);
});

/* ---------------------------------------------------------------- the rules */

/* ------------------------------------------------------------------ in Astra */

let browser;
before(async () => (browser = await chromium.launch()));
after(async () => browser.close());

async function open() {
  const ctx = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
    viewport: { width: 1366, height: 900 },
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(pathToFileURL(resolve("index.html")).href);
  return page;
}
const clip = (page) => page.evaluate(() => navigator.clipboard.readText());

test("Raise a fault: filled from the email triaged, and copied", async () => {
  const page = await open();
  await page.fill(
    "#homeTriageInput",
    "Subject: Phones keep dropping calls (INC-48213)\n\nHi, our reception phone (Yealink T46U) keeps dropping calls after about 30 seconds. It happened at 09:02 and 09:10.\n\nSarah Jones\nTel: 0117 496 0555",
  );
  await page.keyboard.press("Control+Enter");
  await page.waitForSelector(".triage-grid");
  await page.click('.triage-grid [data-action="raise-fault"]');
  await page.waitForSelector("#faultPreview");
  assert.equal(await page.inputValue('[data-fault-example="0"][data-key="handset"]'), "Yealink T46U");
  assert.equal(await page.inputValue('[data-fault-example="1"][data-key="when"]'), "09:10");
  assert.match(await page.textContent("#faultMissing"), /complete call examples/);
  await page.fill('[data-fault-example="0"][data-key="what"]', "Dropped after 30 seconds");
  assert.match(await page.inputValue("#faultPreview"), /^Our reference: INC-48213/);
  assert.match(await page.inputValue("#faultPreview"), /What happened: Dropped after 30 seconds/);
  await page.click('[data-action="fault-copy"]');
  assert.equal(await clip(page), await page.inputValue("#faultPreview"));
  assert.equal(await page.locator('[data-action="fault-ref"]').count(), 0);
  await page.keyboard.press("Escape");
  /* The line fault form, from the Toolkit: copying before the charges are accepted says so. */
  await page.click('.nav-btn:text-is("Toolkit")');
  await page.click('[data-action="raise-fault"][data-id="line"]');
  await page.fill('[data-fault="problem"]', "No dial tone");
  assert.equal(await page.getAttribute('[data-action="fault-kind"][data-id="line"]', "aria-pressed"), "true");
  await page.click('[data-action="fault-copy"]');
  await page.waitForFunction(() =>
    /Still needed: the customer's acceptance of the call-out charges/.test(
      document.getElementById("toast").textContent,
    ),
  );
  await page.check('[data-fault="charges"]');
  assert.doesNotMatch(await page.inputValue("#faultPreview"), /Not yet confirmed/);
  assert.match(await page.inputValue("#faultPreview"), /aborted visit £180/);
  assert.deepEqual(page.errors, []);
});

test("there is no call panel or case to keep", async () => {
  const page = await open();
  for (const sel of [
    '[data-action="start-call"]',
    ".call-panel",
    "#caseCard",
    "#caseLog",
    '[data-case="ticket"]',
  ])
    assert.equal(await page.locator(sel).count(), 0, sel);
  assert.deepEqual(page.errors, []);
});

test("a workflow's ticks and note stay while Astra is open", async () => {
  const page = await open();
  await page.click('.nav-btn:text-is("Workflows")');
  await page.click('[data-action="run-workflow"] >> nth=0');
  await page.check('[data-step="0"]');
  await page.check('[data-step="1"]');
  await page.fill("#workflowNote", "Router replaced");
  await page.keyboard.press("Escape");
  await page.click('[data-action="run-workflow"] >> nth=0');
  assert.equal(await page.isChecked('[data-step="1"]'), true, "kept after Esc");
  assert.equal(await page.inputValue("#workflowNote"), "Router replaced");
  await page.click("#restartWorkflow");
  assert.equal(await page.isChecked('[data-step="0"]'), false);
  assert.equal(await page.inputValue("#workflowNote"), "");
  assert.deepEqual(page.errors, []);
});

test("the cancellation notice tool works out the end date and the minimum term", async () => {
  const page = await open();
  await page.click('.nav-btn:text-is("Toolkit")');
  await page.fill("#noticeDate", "2026-10-14");
  await page.fill("#noticeStart", "2026-03-01");
  await page.click('[data-action="tool"][data-id="notice"]');
  const result = await page.textContent("#noticeResult");
  assert.match(result, /Notice ends: Tuesday 12 January 2027/);
  assert.match(result, /90 days from Wednesday 14 October 2026, the day it was received \(T&Cs 10\.2\)/);
  assert.match(result, /Minimum term \(12 months\) ends: Monday 1 March 2027/);
  assert.match(result, /early termination fees equal to the remaining contract value apply \(T&Cs 10\.3\)/);
  await page.click('[data-action="tool"][data-id="copy-notice"]');
  assert.equal(
    await clip(page),
    "We received your written notice on Wednesday 14 October 2026. Your 90 days' notice ends on Tuesday 12 January 2027.",
  );
  await page.fill("#noticeStart", "2025-09-01");
  await page.click('[data-action="tool"][data-id="notice"]');
  assert.match(await page.textContent("#noticeResult"), /The notice ends after the minimum term\./);
  assert.doesNotMatch(await page.textContent("#noticeResult"), /30 days/);
});

test("the cancellation reply gives the date the 90 days' notice ends", async () => {
  const page = await open();
  await page.click('.nav-btn:text-is("Replies")');
  await page.fill("#replySearch", "cancel");
  await page.click('.reply-item:has-text("Customer cancelling")');
  await page.click('[data-action="reply-stage"][data-id="progress"]');
  assert.match(
    await page.inputValue("#replyBody"),
    /your 90-day notice period runs from the day we received it/,
  );
  await page.fill('[data-reply="notice_received"]', "2026-10-14");
  await page.dispatchEvent('[data-reply="notice_received"]', "change");
  const body = await page.inputValue("#replyBody");
  assert.match(
    body,
    /We received it on Wednesday 14 October 2026, so your 90 days' notice ends on Tuesday 12 January 2027\./,
  );
  assert.doesNotMatch(body, /30 days/);
});
