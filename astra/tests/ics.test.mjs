import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import { chromium } from "playwright";

const sandbox = { TextEncoder };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync("js/ics.js", "utf8"), sandbox);
const ICS = sandbox.AstraICS;

/* Unfolds and splits an .ics file the way calendar programs read it. */
const unfold = (text) => text.replace(/\r\n /g, "").split("\r\n");

test("an engineer slot becomes a timed event; a port date an all-day one", () => {
  const timed = ICS.build({
    title: "Openreach engineer appointment: Harbour Lane Surgery Ltd",
    date: "2026-10-20",
    slot: "AM 08:00–13:00",
    location: "G2 4AB",
    description: "Line one\nLine two; with, punctuation \\ and £180",
    now: new Date(Date.UTC(2026, 9, 13, 9, 5, 0)),
    uid: "test@astra.invalid",
  });
  const lines = unfold(timed);
  assert.ok(timed.endsWith("\r\n"));
  assert.equal(lines[0], "BEGIN:VCALENDAR");
  assert.ok(lines.includes("DTSTART:20261020T080000"));
  assert.ok(lines.includes("DTEND:20261020T130000"));
  assert.ok(lines.includes("DTSTAMP:20261013T090500Z"));
  assert.ok(lines.includes("SUMMARY:Openreach engineer appointment: Harbour Lane Surgery Ltd"));
  assert.ok(lines.includes("LOCATION:G2 4AB"));
  assert.ok(lines.includes(String.raw`DESCRIPTION:Line one\nLine two\; with\, punctuation \\ and £180`));
  for (const raw of timed.split("\r\n"))
    assert.ok(new TextEncoder().encode(raw).length <= 75, `folded to 75 bytes: ${raw}`);

  const allDay = unfold(ICS.build({ title: "Number port date", date: "2026-12-31" }));
  assert.ok(allDay.includes("DTSTART;VALUE=DATE:20261231"));
  assert.ok(allDay.includes("DTEND;VALUE=DATE:20270101"), "ends the next day, across the year end");
  assert.equal(ICS.build({ title: "x", date: "31/12/2026" }), "", "only a real date makes an invite");
});

test("long text folds without splitting a character", () => {
  const description = "£".repeat(200) + "é".repeat(100);
  const text = ICS.build({ title: "t", date: "2026-01-02", description });
  assert.ok(unfold(text).includes(`DESCRIPTION:${description}`));
});

let browser;
before(async () => (browser = await chromium.launch()));
after(async () => browser.close());

test("the Openreach invite downloads as a calendar file with the wording and the slot", async () => {
  const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(resolve("index.html")).href);
  await page.click('.nav-btn:text-is("Toolkit")');
  await page.click('[data-action="use-template"][data-id="openreach-invite"]');
  if (await page.locator('[data-fill="contact"]').count()) await page.fill('[data-fill="contact"]', "Sam");
  await page.click("#icsBuilt");
  assert.match(await page.textContent("#toast"), /Complete the highlighted detail/);
  await page.fill('[data-fill="date"]', "2026-10-20");
  await page.selectOption('[data-fill="timeslot"]', { index: 2 });
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#icsBuilt")]);
  assert.equal(dl.suggestedFilename(), "Openreach engineer appointment 2026-10-20.ics");
  const text = readFileSync(await dl.path(), "utf8");
  const lines = unfold(text);
  assert.ok(lines.includes("DTSTART:20261020T130000"));
  assert.ok(lines.includes("DTEND:20261020T180000"));
  assert.ok(lines.includes("SUMMARY:Openreach engineer appointment"));
  assert.ok(
    lines.some((l) => l.startsWith("DESCRIPTION:") && /20 October 2026/.test(l) && l.includes("£180")),
  );
  assert.deepEqual(errors, []);
});
