import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { chromium } from "playwright";

/* Quick line shortcuts: ;close5 and a space becomes the line, in Astra and (when allowed) in Zoho Desk. */

const sandbox = {};
sandbox.window = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync("js/expand.js", "utf8"), sandbox);
for (const f of ["js/seed/registry.js", "js/seed/snippets.js"])
  vm.runInContext(readFileSync(f, "utf8"), sandbox);
const X = sandbox.AstraExpand;
const lines = sandbox.AstraSeed.snippets;

test("a shortcut is a semicolon and a short word, typed and followed by a space", () => {
  assert.equal(X.shortcutAt("Hi ;close5 "), ";close5");
  assert.equal(X.shortcutAt(";ack "), ";ack");
  assert.equal(X.shortcutAt("text;ack "), "", "not in the middle of a word");
  assert.equal(X.shortcutAt("Hi ;close5"), "", "only once the space is typed");
  assert.equal(X.shortcutAt("a ; "), "");
  assert.equal(X.valid(";close5"), true);
  assert.equal(X.valid("close5"), false);
  assert.equal(X.valid(";this-is-far-too-long-a-shortcut"), false);
  const data = {
    lines: { ";up": "I'll update you by {update_time} on {ticket}." },
    values: { ticket: "INC-1" },
  };
  const r = X.expansion("Thanks. ;up ", data);
  assert.equal(r.remove, 4);
  assert.equal(
    r.text,
    "I'll update you by [update time] on INC-1.",
    "an unknown detail is left to type over",
  );
  assert.equal(X.expansion("Thanks. ;nope ", data), null);
});

test("the built-in shortcuts are unique, valid and on the lines they name", () => {
  const withKey = lines.filter((l) => l.shortcut);
  assert.ok(withKey.length >= 20, `${withKey.length} shortcuts`);
  assert.equal(new Set(withKey.map((l) => l.shortcut)).size, withKey.length);
  for (const l of withKey) assert.ok(X.valid(l.shortcut), l.id);
  const map = X.linesOf(lines);
  assert.equal(
    map[";close5"],
    "As we have not received a response, this ticket is now scheduled to close at 5pm today.",
  );
  assert.match(map[";notice"], /90 days' written notice, counted from the day we receive it/);
});

/* ------------------------------------------------------------------ in Astra */

let browser;
before(async () => (browser = await chromium.launch()));
after(async () => browser.close());

async function open() {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(pathToFileURL(resolve("index.html")).href);
  return page;
}

test("in Astra, a shortcut typed in a reply becomes the line, with the triaged email's details", async () => {
  const page = await open();
  await page.fill(
    "#homeTriageInput",
    "Subject: Broadband down (INC-48213)\n\nHi, our broadband is down.\n\nSarah Jones",
  );
  await page.keyboard.press("Control+Enter");
  await page.waitForSelector(".triage-grid");
  await page.click('.nav-btn:text-is("Replies")');
  await page.click('.reply-item:text-is("Broadband down")');
  await page.click("#replyBody");
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n;working ");
  assert.match(
    await page.inputValue("#replyBody"),
    /As this is now working, ticket INC-48213 will close at 5pm today\.$/,
  );
  /* Undo takes it back to what was typed. */
  await page.keyboard.press("Control+z");
  assert.match(await page.inputValue("#replyBody"), /;working $/);
  /* Search and filter boxes are left as typed. */
  await page.fill("#replySearch", "");
  await page.click("#replySearch");
  await page.keyboard.type(";working ");
  assert.equal(await page.inputValue("#replySearch"), ";working ");
  assert.deepEqual(page.errors, []);
});

test("a shortcut can be set, changed and shown on a quick line; one already taken moves", async () => {
  const page = await open();
  await page.click('.nav-btn:text-is("Templates")');
  await page.fill("#filterInput", "close at 5pm today");
  assert.match(await page.textContent(".item-list"), /;close5/);
  await page.click('[data-action="new-line"]');
  await page.fill("#lineText", "I've booked your callback for this afternoon.");
  await page.fill("#lineGroup", "My lines");
  await page.fill("#lineShortcut", ";close5");
  await page.click("#editForm .primary-btn");
  await page.goto(pathToFileURL(resolve("index.html")).href);
  await page.click('.nav-btn:text-is("Workflows")');
  await page.click('[data-action="run-workflow"] >> nth=0');
  await page.click("#workflowNote");
  await page.keyboard.type(";close5 ");
  assert.equal(await page.inputValue("#workflowNote"), "I've booked your callback for this afternoon.");
  await page.keyboard.press("Escape");
  /* An invalid shortcut is refused by the form. */
  await page.click('.nav-btn:text-is("Templates")');
  await page.click('[data-action="new-line"]');
  await page.fill("#lineText", "x");
  await page.fill("#lineGroup", "My lines");
  await page.fill("#lineShortcut", "close");
  await page.click("#editForm .primary-btn");
  assert.equal(await page.locator("#lineShortcut").count(), 1, "still open");
});

/* -------------------------------------------- the script on Zoho Desk's pages */

test("on a Zoho page, shortcuts work in a text box, a rich editor and an editor in a frame", async () => {
  const page = await browser.newPage();
  const shared = {
    lines: { ";close5": "Ticket {ticket} closes at 5pm today.\nThanks" },
    values: { ticket: "INC-9" },
  };
  await page.setContent(
    `<textarea id="t"></textarea><div id="rich" contenteditable="true"></div><iframe id="f" srcdoc="<body contenteditable=true></body>"></iframe>`,
  );
  /* Stands in for the extension's storage, which the script reads the lines from. */
  await page.evaluate((shared) => {
    window.chrome = {
      storage: { local: { get: async (k) => ({ [k]: shared }) }, onChanged: { addListener() {} } },
    };
  }, shared);
  for (const f of ["js/expand.js", "js/expand-content.js"]) await page.addScriptTag({ path: f });
  await page.waitForTimeout(50);
  await page.click("#t");
  await page.keyboard.type("Hello ;close5 ");
  assert.equal(await page.inputValue("#t"), "Hello Ticket INC-9 closes at 5pm today.\nThanks");
  await page.click("#rich");
  await page.keyboard.type("Hi ;close5 ");
  assert.match(await page.textContent("#rich"), /^Hi Ticket INC-9 closes at 5pm today\./);
  /* The frame: the same script runs in it, as the extension runs it in every frame. */
  const frame = page.frame({ url: /about:srcdoc/ }) || page.frames()[1];
  await frame.evaluate(() => {
    window.chrome = {
      storage: {
        local: {
          get: async () => ({ "astra.shortcuts": { lines: { ";ack": "Thanks, logged." }, values: {} } }),
        },
        onChanged: { addListener() {} },
      },
    };
  });
  for (const f of ["js/expand.js", "js/expand-content.js"]) await frame.addScriptTag({ path: f });
  await frame.waitForTimeout(50);
  await frame.click("body");
  await page.keyboard.type(";ack ");
  assert.match(await frame.textContent("body"), /Thanks, logged\./);
  await page.close();
});
