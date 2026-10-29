import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { chromium } from "playwright";

/* Getting around quickly: Ctrl K with arrows, Esc out of a box, copying again. */

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
const nav = (page, name) => page.click(`.nav-btn:text-is("${name}")`);

test("Ctrl K: the first letter typed is kept, arrows choose a result and Enter opens it", async () => {
  const page = await open();
  await page.keyboard.press("Control+k");
  await page.keyboard.type("voxone", { delay: 0 });
  assert.equal(await page.inputValue("#globalSearchInput"), "voxone");
  await page.fill("#globalSearchInput", "closing 5pm");
  await page.waitForSelector("#globalResults .result-row");
  assert.match(
    await page.textContent("#globalResults"),
    /this ticket is now scheduled to/,
    '"closing" finds "close"',
  );
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.getAttribute("#globalSearchInput", "aria-activedescendant"), "globalResults-0");
  assert.match(await page.getAttribute("#globalResults-0", "class"), /active/);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  /* The first result was a quick line: copied, and the search closed. */
  await page.waitForFunction(() => !document.querySelector(".modal-layer.open"));
  assert.match(await clip(page), /5pm/);
  assert.deepEqual(page.errors, []);
});

test("Esc steps out of a box, so single-key shortcuts work again", async () => {
  const page = await open();
  await page.click("#homeLineFilter");
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => document.activeElement.tagName), "BODY");
  await page.keyboard.press("?");
  assert.match(await page.textContent("#modalTitle"), /Keyboard shortcuts/);
});

test("recent copies copy again in one click", async () => {
  const page = await open();
  await page.locator(".home-line").first().click();
  const first = await clip(page);
  await page.evaluate(() => navigator.clipboard.writeText("something else"));
  await page.click('#recentCopies [data-action="recopy"]');
  assert.equal(await clip(page), first);
});

test("the last chaser can close the ticket at 5pm today in one click", async () => {
  const page = await open();
  await nav(page, "Replies");
  await page.click('.reply-item:text-is("Calls dropping")');
  await page.click('[data-action="reply-stage"][data-id="no-reply-final"]');
  await page.click('[data-action="close-today"]');
  assert.match(await page.inputValue("#replyBody"), /so I('ll| will) close the ticket at 5pm today\./);
  await page.fill('[data-reply="close_date"]', "2099-01-02");
  await page.dispatchEvent('[data-reply="close_date"]', "change");
  assert.match(await page.inputValue("#replyBody"), /close the ticket on Friday 2 January 2099\./);
});
