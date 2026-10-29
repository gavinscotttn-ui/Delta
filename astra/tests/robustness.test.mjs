import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

/* Regression tests for defects found in review: each reproduces the original failure. */
const URL_ = pathToFileURL(resolve("index.html")).href;
let browser;
before(async () => (browser = await chromium.launch()));
after(async () => browser.close());

async function open(ctx) {
  const context =
    ctx ||
    (await browser.newContext({
      locale: "en-GB",
      permissions: ["clipboard-read", "clipboard-write"],
      viewport: { width: 1280, height: 900 },
    }));
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(URL_);
  return page;
}
const clip = (page) => page.evaluate(() => navigator.clipboard.readText());
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("astra.offline.fresh.v1")));

test("Replies: the first click on Copy works straight after typing, and a typed date is a real date", async () => {
  const page = await open();
  await page.evaluate(() => navigator.clipboard.writeText("OLD CLIPBOARD"));
  await page.click('.nav-btn:text-is("Replies")');
  await page.click('.reply-item:text-is("Broadband down")');
  await page.click('[data-action="reply-stage"][data-id="engineer-booked"]');
  await page.click('[data-reply="contact"]');
  await page.keyboard.type("Sarah");
  await page.click('[data-reply="date"]');
  await page.keyboard.type("15102026");
  await page.selectOption('[data-reply="timeslot"]', { index: 1 });
  /* Typed digit by digit (the box's order follows the browser's language): the year must come out as 2026. */
  assert.match(await page.inputValue('[data-reply="date"]'), /^2026-/);
  assert.match(await page.inputValue("#replyBody"), /^Hi Sarah,[\s\S]*on \w+ \d{1,2} \w+ 2026, AM/);
  await page.click('[data-action="copy-reply"]');
  assert.match(await clip(page), /^Hi Sarah,/, "copied on the first click");
});

test("a new email clears the reply builder, and Copy refuses while a date is missing", async () => {
  const page = await open();
  await page.click('.nav-btn:text-is("Replies")');
  await page.click('.reply-item:text-is("Calls dropping")');
  await page.click('[data-action="reply-stage"][data-id="raised"]');
  await page.fill('[data-reply="contact"]', "Sarah");
  await page.fill('[data-reply="supplier_ref"]', "GAMMA-12345");
  await page.click('.nav-btn:text-is("Triage")');
  await page.fill("#triageInput", "Subject: Broadband down\n\nOur internet is down.\n\nPriya");
  await page.keyboard.press("Control+Enter");
  await page.waitForSelector(".triage-grid");
  await page.click('.nav-btn:text-is("Replies")');
  await page.click('.reply-item:text-is("Calls dropping")');
  await page.click('[data-action="reply-stage"][data-id="raised"]');
  const body = await page.inputValue("#replyBody");
  assert.ok(!/Sarah|GAMMA-12345/.test(body), body);
  await page.click('.reply-item:text-is("Broadband down")');
  await page.click('[data-action="reply-stage"][data-id="engineer-booked"]');
  await page.click('[data-action="copy-reply"]');
  assert.match(await page.textContent("#toast"), /Add the date and time slot/);
});

test("importing an old backup with customer cases keeps none of them", async () => {
  const page = await open();
  const file = join(mkdtempSync(join(tmpdir(), "astra-")), "backup.json");
  writeFileSync(
    file,
    JSON.stringify({
      templates: [],
      shortcuts: [],
      settings: { rememberCase: true },
      recentCases: [{ id: "c1", closedAt: new Date().toISOString(), customer: "Harbour Lane", log: [] }],
    }),
  );
  await page.click('.nav-btn:text-is("Settings")');
  await page.setInputFiles("#importFile", file);
  await page.waitForFunction(() => /Backup imported/.test(document.querySelector("#toast").textContent));
  const saved = await stored(page);
  assert.equal(saved.recentCases, undefined);
  assert.equal(saved.closedCases, undefined);
  assert.equal(saved.cases, undefined);
  assert.equal(saved.currentCase, undefined);
});

test("stored or imported data of the wrong type cannot break a form", async () => {
  const page = await open();
  await page.evaluate(() =>
    localStorage.setItem(
      "astra.offline.fresh.v1",
      JSON.stringify({
        templates: [],
        shortcuts: [],
        currentCase: { site: 42 },
        profile: { name: 7 },
        settings: { rememberCase: true },
      }),
    ),
  );
  await page.reload();
  await page.click('.nav-btn:text-is("Toolkit")');
  await page.click('[data-action="fill-loa"]');
  await page.waitForSelector("#loaProvider");
  assert.deepEqual(page.errors, []);
});

test("the LOA's Copy email leaves the form and what was typed in it", async () => {
  const page = await open();
  await page.click('.nav-btn:text-is("Toolkit")');
  await page.click('[data-action="fill-loa"]');
  await page.fill("#loaCompany", "Harbour Lane Surgery Ltd");
  await page.fill("#loaRequester", "Priya Shah");
  await page.click("#loaEmail");
  assert.match(await clip(page), /^Hi Priya,/);
  assert.equal(await page.inputValue("#loaCompany"), "Harbour Lane Surgery Ltd");
});

test("Settings and Home keep what was typed when part of the page changes", async () => {
  const page = await open();
  await page.click('.nav-btn:text-is("Settings")');
  await page.fill("#profileName", "Alex Morgan");
  await page.click('[data-action="add-shortcut"]');
  await page.click('[data-action="toggle"][data-id="privacyOnHide"]');
  assert.equal(await page.inputValue("#profileName"), "Alex Morgan");
  await page.click('.nav-btn:text-is("Home")');
  await page.fill("#homeTriageInput", "Our calls keep dropping");
  await page.fill("#startSearch", "sip alg");
  await page.click('[data-action="mode"][data-id="Astra"]');
  assert.equal(await page.inputValue("#homeTriageInput"), "Our calls keep dropping");
  assert.equal(await page.inputValue("#startSearch"), "sip alg");
});

test("keyboard focus stays put when a page or a stage is chosen", async () => {
  const page = await open();
  await page.focus('.nav-btn:text-is("Replies")');
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => document.activeElement.dataset.id), "Replies");
  await page.focus('[data-action="reply-stage"] >> nth=1');
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), "reply-stage");
});

test("a mistyped huge number of days does not freeze the page", async () => {
  const page = await open();
  await page.click('.nav-btn:text-is("Toolkit")');
  await page.fill("#dateDays", "99999");
  const t = Date.now();
  await page.click('[data-id="date"]');
  assert.ok(Date.now() - t < 2000);
  await page.fill("#dateDays", "1000000000");
  await page.click('[data-id="date"]');
  assert.match(await page.textContent("#dateResult"), /up to 100,000/);
});

test("two Astra tabs: an edit in one is not lost to a change in the other", async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const a = await open(ctx);
  const b = await open(ctx);
  /* Tab B starts editing a template while tab A changes another one. */
  await b.click('.nav-btn:text-is("Templates")');
  await b.click('[data-action="template-tab"][data-id="templates"]');
  await b.click('[data-action="edit-template"] >> nth=0');
  await b.fill("#tTitle", "Edited in tab B");
  await a.click('.nav-btn:text-is("Templates")');
  await a.click('[data-action="template-tab"][data-id="templates"]');
  await a.click('[data-action="toggle-pin"] >> nth=1');
  await b.waitForTimeout(600);
  await b.click("#editForm .primary-btn");
  await b.waitForFunction(() =>
    JSON.parse(localStorage.getItem("astra.offline.fresh.v1")).templates.some(
      (t) => t.title === "Edited in tab B",
    ),
  );
  await ctx.close();
});
