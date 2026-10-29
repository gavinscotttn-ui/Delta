import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

/* Made-up email. The phone numbers are from Ofcom's ranges reserved for fiction. */
const EMAIL = `Subject: Phones keep dropping calls

Hi there,

Since this morning our reception phone (Yealink T46U) keeps dropping calls. It happened at 09:02 when we called 01632 960123.
Our ticket ref is INC-48213. Site is BS1 4DJ.

Kind regards,
Sarah Jones
Brightwater Dental Ltd
Tel: 0117 496 0555`;

let browser;
before(async () => (browser = await chromium.launch()));
after(async () => browser.close());

async function open() {
  const ctx = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.requests = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && page.errors.push(m.text()));
  page.on("request", (r) => page.requests.push(r.url()));
  await page.goto(pathToFileURL(resolve("index.html")).href);
  return page;
}

/* A new workspace has no name until one is entered, so replies are not signed by anyone by default. */
async function signIn(page, name = "Gavin Scott", initials = "GS") {
  await page.click('.nav-btn:text-is("Settings")');
  await page.fill("#profileName", name);
  await page.fill("#profileInitials", initials);
  await page.click('[data-action="save-profile"]');
}

async function triage(page, text = EMAIL) {
  await page.click('.nav-btn:text-is("Triage")');
  await page.fill("#triageInput", text);
  await page.keyboard.press("Control+Enter");
  await page.waitForSelector(".triage-grid");
}

test("reads an email: summary, symptom, priority, details, guide and workflow", async () => {
  const page = await open();
  await triage(page);
  assert.match(await page.textContent(".triage-summary"), /Phones keep dropping calls/);
  assert.match(await page.textContent(".triage-symptoms"), /Calls dropping/);
  assert.match(await page.textContent(".triage-priority"), /P3/);
  const facts = await page.textContent(".triage-facts");
  for (const v of [
    "Sarah Jones",
    "Brightwater Dental Ltd",
    "0117 496 0555",
    "01632 960123",
    "INC-48213",
    "BS1 4DJ",
    "Yealink T46U",
  ])
    assert.ok(facts.includes(v), v);
  assert.match(await page.textContent(".triage-guide"), /calls not connecting, not ringing or dropping/);
  assert.ok(await page.locator('[data-triage="workflow"]').isVisible());
  assert.ok(
    page.requests.every((u) => u.startsWith("file:")),
    "nothing left the computer",
  );
  assert.deepEqual(page.errors, []);
});

test("the email's details fill templates and fault reports, with nothing to save", async () => {
  const page = await open();
  await triage(page);
  await page.click('[data-action="raise-fault"]');
  assert.match(
    await page.inputValue("#faultPreview"),
    /^Our reference: INC-48213\nCustomer: Brightwater Dental Ltd, BS1 4DJ/,
  );
  await page.keyboard.press("Escape");
  assert.equal(await page.locator('[data-triage="fill"], [data-case]').count(), 0);
  assert.deepEqual(page.errors, []);
});

test("copies the ticket note, and a reply that asks only for what the email did not say", async () => {
  const page = await open();
  await signIn(page);
  await triage(page);
  await page.click('[data-triage="copy-note"]');
  const note = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(note, /Issue: Phones keep dropping calls/);
  assert.match(note, /Likely guide: Horizon: calls not connecting/);
  assert.match(note, /Still needed:\n- Date and time/);
  await page.click('[data-triage="copy-reply"]');
  const reply = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(reply, /^Hi Sarah,/);
  assert.match(reply, /calls dropping \(ticket INC-48213\)/, "ticket from the email");
  assert.match(reply, /- The date and time of at least three affected calls \(I have 1 so far\)/);
  assert.match(reply, /- The number calling and the number called for each one/);
  assert.ok(!/make and model/.test(reply), "the email already said it is a Yealink T46U");
  assert.match(reply, /Gavin Scott$/);
  await page.click('.nav-btn:text-is("Home")');
  assert.match(await page.textContent("#recentCopies"), /Reply: Phones keep dropping calls/);
});

test("clicking a found value copies it; the guide opens; Clear forgets the email", async () => {
  const page = await open();
  await triage(page);
  await page.locator(".triage-facts code", { hasText: "INC-48213" }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "INC-48213");
  await page.click('[data-triage="guide"]');
  assert.match(await page.textContent("#modal h2"), /calls not connecting/);
  await page.keyboard.press("Escape");
  await page.click('.page-head [data-triage="clear"]');
  assert.equal(await page.inputValue("#triageInput"), "");
  assert.equal(await page.locator(".triage-grid").count(), 0);
});

test("an empty paste is refused politely, and the page has no accessibility violations", async () => {
  const page = await open();
  await page.click('.nav-btn:text-is("Triage")');
  await page.click('#triageForm button[type="submit"]');
  assert.match(await page.textContent("#toast"), /Paste an email/);
  await triage(page);
  await page.evaluate(readFileSync("node_modules/axe-core/axe.min.js", "utf8"));
  const v = await page.evaluate(async () =>
    (await axe.run(document, { resultTypes: ["violations"] })).violations.map(
      (x) => `${x.id}: ${x.nodes[0].target.join(" ")}`,
    ),
  );
  assert.deepEqual(v, []);
});

test("pasting on the Home page goes straight to the triage result", async () => {
  const page = await open();
  await page.fill("#homeTriageInput", EMAIL);
  await page.keyboard.press("Control+Enter");
  await page.waitForSelector(".triage-grid");
  assert.match(await page.textContent("#pageTitle"), /Triage/);
  assert.equal(await page.inputValue("#triageInput"), EMAIL);
  assert.match(await page.textContent(".triage-summary"), /Phones keep dropping calls/);
});

test("a porting request offers the LOA, filled in from the email", async () => {
  const page = await open();
  await triage(
    page,
    `From: Priya Shah <priya@harbourview-vets.co.uk>
Subject: Moving our numbers

Hi,

We'd like to port our numbers over to you from Gamma: 01632 960456 and 01632 960457.

Kind regards,
Priya Shah
Harbourview Vets Ltd`,
  );
  const card = page.locator("section", { has: page.locator('h3:text-is("For this request")') });
  await card.waitFor();
  assert.match(await card.textContent(), /Number port/);
  await card.locator('[data-action="fill-loa"]').click();
  await page.waitForSelector("#loaProvider");
  assert.equal(await page.inputValue("#loaProvider"), "gamma");
  assert.equal(await page.inputValue("#loaCurrentEmail"), "porting@gamma.com");
  assert.match(await page.inputValue("#loaNumbers"), /01632 960456[\s\S]*01632 960457/);
  assert.deepEqual(page.errors, []);
});
