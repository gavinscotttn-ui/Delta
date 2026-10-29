import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { chromium } from "playwright";

/* Quick lines: the built-in library, and copying in one click. */

/* The seed files, loaded as the page loads them. */
const sandbox = { structuredClone };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const [, f] of readFileSync("index.html", "utf8").matchAll(/<script src="(js\/seed\/[^"]+\.js)"/g))
  if (!f.endsWith("/history.js")) vm.runInContext(readFileSync(f, "utf8"), sandbox, { filename: f });
const seed = sandbox.AstraSeed;
const lines = seed.snippets;
const sources = [...seed.knowledge.map((k) => k.body), ...seed.templates.map((t) => t.body)].join("\n");

/* Filled in by Astra itself, or asked for when the line is copied. */
const KNOWN = [
  "customer",
  "contact",
  "ticket",
  "site",
  "mobile",
  "supplier_ref",
  "update_time",
  "my_name",
  "company",
  "today",
];
const ASKED = ["date", "timeslot", "port_date"];

test("a big library of quick lines, each with a unique id and a group", () => {
  assert.ok(lines.length >= 150, `${lines.length} lines`);
  assert.equal(new Set(lines.map((l) => l.id)).size, lines.length);
  for (const l of lines) {
    assert.ok(l.text.trim() && l.category, l.id);
    assert.equal(l.text, l.text.trimStart(), `${l.id} starts with a space`);
    assert.doesNotMatch(l.text, / {2}/, `${l.id} has a double space`);
  }
  /* The line asked for, word for word. */
  assert.ok(
    lines.some(
      (l) =>
        l.text === "As we have not received a response, this ticket is now scheduled to close at 5pm today.",
    ),
  );
  assert.ok(lines.filter((l) => l.favourite).length >= 6, "some are starred to start with");
});

test("every detail in braces is one Astra fills in or asks for", () => {
  for (const l of lines)
    for (const [, k] of l.text.matchAll(/\{\s*([^}]+?)\s*\}/g))
      assert.ok(KNOWN.includes(k) || ASKED.includes(k), `${l.id}: {${k}}`);
});

test("no quick line states a figure, charge, number or period that is not in the T&Cs or guides", () => {
  for (const l of lines) {
    for (const p of l.text.match(/£\d[\d,]*(?:\.\d{2})?/g) || [])
      assert.ok(sources.includes(p), `${l.id}: price ${p} has no source`);
    for (const n of l.text.match(/\b0\d{3,4} ?\d{3} ?\d{3,4}\b/g) || [])
      assert.ok(sources.includes(n), `${l.id}: number ${n} has no source`);
    for (const d of l.text.match(/\b\d+(?:\.\d+)? ?(?:hours?|days?|minutes?|seconds?|weeks?|months?|%)/g) ||
      [])
      assert.ok(
        sources.includes(d.replace(" ", " ")) || sources.includes(d),
        `${l.id}: "${d}" has no source`,
      );
  }
  /* The figures customers are held to, exactly as the T&Cs put them. */
  const text = (id) => lines.find((l) => l.id === id).text;
  assert.match(text("line-bill-notice-90"), /90 days' written notice, counted from the day we receive it/);
  assert.match(text("line-eng-aborted"), /aborted visit charge of £180\./);
  assert.match(text("line-eng-no-fault"), /starting from £85 per hour/);
  assert.doesNotMatch(
    lines.map((l) => l.text).join("\n"),
    /\b30 days\b/,
    "30 days is our notice, never the customer's",
  );
});

test("UK spelling, and none of the stock phrases nobody says", () => {
  const all = lines.map((l) => l.text).join("\n");
  const US =
    /\b(color|favorite|organiz\w*|recogniz\w*|authoriz\w*|customiz\w*|center|license[sd]?|canceled|gray|behavior|analyz\w*|prioritiz\w*|program(?!me))\b/i;
  assert.doesNotMatch(all, US);
  assert.doesNotMatch(
    all,
    /\b(delve|seamless|rest assured|finds you well|reach out|circle back|touch base|kindly|do the needful)\b/i,
  );
});

/* ------------------------------------------------------------------- in Astra */

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
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && page.errors.push(m.text()));
  await page.goto(pathToFileURL(resolve("index.html")).href);
  return page;
}
const clip = (page) => page.evaluate(() => navigator.clipboard.readText());
const nav = (page, name) => page.click(`.nav-btn:text-is("${name}")`);
const CLOSE = "As we have not received a response, this ticket is now scheduled to close at 5pm today.";

test("one click copies a quick line, and says so where you clicked", async () => {
  const page = await open();
  await nav(page, "Templates");
  assert.equal(
    await page.getAttribute('[data-action="template-tab"][data-id="lines"]', "aria-pressed"),
    "true",
  );
  const row = page.locator(".line-copy", { hasText: CLOSE }).first();
  await row.click();
  assert.equal(await clip(page), CLOSE);
  assert.match(await row.getAttribute("class"), /copied/);
  /* It shows on Home as a recent copy. */
  await nav(page, "Home");
  assert.match(await page.textContent("#recentCopies"), /As we have not received a response/);
  assert.deepEqual(page.errors, []);
});

test("starred lines sit on Home, one click from the clipboard", async () => {
  const page = await open();
  assert.ok((await page.locator(".home-line").count()) > 0, "starred lines are on Home");
  /* Star another: it joins them. */
  await nav(page, "Templates");
  await page.fill("#filterInput", "speed test");
  await page.click('[data-action="star-line"] >> nth=0');
  await nav(page, "Home");
  await page.locator(".home-line", { hasText: "speed test" }).click();
  assert.match(await clip(page), /^Could you run a speed test/);
  assert.match(await page.textContent("#recentCopies"), /speed test/);
  /* Typing in the box above finds any line; Enter copies the first. */
  await page.fill("#homeLineFilter", "will close at 5pm today");
  assert.match(await page.textContent("#homeLines"), /As this is now working/);
  assert.deepEqual(page.errors, []);
});

test("a line fills in the ticket from the email triaged, and asks only when it cannot know", async () => {
  const page = await open();
  await nav(page, "Templates");
  await page.fill("#filterInput", "raised ticket");
  await page.locator(".line-copy").first().click();
  /* No email triaged yet: asked for. */
  await page.waitForSelector("#copyLineFilled");
  await page.click("#copyLineFilled");
  assert.match(await page.textContent("#toast"), /Complete the highlighted detail/);
  await page.fill('[data-fill="ticket"]', "INC-48213");
  assert.match(await page.inputValue("#linePreview"), /raised ticket INC-48213 for this/);
  await page.click("#copyLineFilled");
  assert.match(await clip(page), /I've raised ticket INC-48213 for this/);
  /* Once an email with a ticket ref is triaged, a line needing it copies at once. */
  await nav(page, "Home");
  await page.fill(
    "#homeTriageInput",
    "Subject: Broadband down [INC-50001]\n\nHi, the broadband is down.\n\nSarah Jones",
  );
  await page.keyboard.press("Control+Enter");
  await page.waitForSelector(".triage-grid");
  await nav(page, "Templates");
  await page.fill("#filterInput", "will close at 5pm today");
  await page.locator(".line-copy", { hasText: "As this is now working" }).first().click();
  assert.equal(await clip(page), "As this is now working, ticket INC-50001 will close at 5pm today.");
  assert.equal(await page.locator("#copyLineFilled").count(), 0, "nothing asked");
});

test("your own quick lines: add, edit, delete, and find them with Ctrl K", async () => {
  const page = await open();
  await nav(page, "Templates");
  await page.click('[data-action="new-line"]');
  await page.fill("#lineText", "I've booked your callback for this afternoon.");
  await page.fill("#lineGroup", "My lines");
  await page.click("#editForm .primary-btn");
  await page.fill("#filterInput", "callback for this afternoon");
  await page.locator(".line-copy").first().click();
  assert.equal(await clip(page), "I've booked your callback for this afternoon.");

  await page.click('[data-action="edit-line"] >> nth=0');
  await page.fill("#lineText", "I've booked your callback for this afternoon, {contact}.");
  await page.click("#editForm .primary-btn");
  await nav(page, "Home");
  await page.fill(
    "#homeTriageInput",
    "Subject: Callback please\n\nHi, could someone ring me back?\n\nThanks\nPriya Shah",
  );
  await page.keyboard.press("Control+Enter");
  await page.waitForSelector(".triage-grid");
  await page.keyboard.press("Control+k");
  await page.fill("#globalSearchInput", "callback afternoon");
  await page.click('#globalResults [data-action="copy-line"]');
  assert.equal(await clip(page), "I've booked your callback for this afternoon, Priya.");
  assert.equal(await page.locator(".modal-layer.open").count(), 0, "search closes once copied");

  await nav(page, "Templates");
  await page.fill("#filterInput", "callback for this afternoon");
  await page.click('[data-action="edit-line"] >> nth=0');
  page.once("dialog", (d) => d.accept());
  await page.click("#deleteItem");
  await page.waitForFunction(() => !document.querySelector(".line-copy"));
  assert.deepEqual(page.errors, []);
});

test("quick lines are kept in backups and the workspace", async () => {
  const page = await open();
  await nav(page, "Templates");
  await page.click('[data-action="star-line"] >> nth=1');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("astra.offline.fresh.v1")));
  assert.equal(saved.snippets.length, lines.length);
  assert.equal(saved.snippets.filter((l) => l.favourite).length, lines.filter((l) => l.favourite).length + 1);
  assert.ok(saved.seenSeed.includes("snippets:line-chase-close-5pm"));
});
