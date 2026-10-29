import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

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

test("Replies: find a situation, pick a stage, fill the details and copy", async () => {
  const page = await open();
  await page.click('.nav-btn:text-is("Replies")');
  assert.equal(await page.textContent(".page-head h2"), "Replies");
  await page.fill("#replySearch", "chase calls dropping");
  await page.click('.reply-item:text-is("Calls dropping")');
  assert.equal(
    await page.getAttribute('[data-action="reply-stage"].on', "data-id"),
    "no-reply",
    "chase picks the stage",
  );
  await page.fill('[data-reply="contact"]', "Sarah Jones");
  await page.fill('[data-reply="ticket"]', "INC-48213");
  await page.press('[data-reply="ticket"]', "Tab");
  const body = await page.inputValue("#replyBody");
  assert.match(
    body,
    /^Hi Sarah,\n\nI'm just following up on my last email about your calls dropping \(ticket INC-48213\)\./,
  );
  assert.equal(await page.inputValue("#replySubject"), "Calls dropping [INC-48213]");

  await page.click('[data-action="reply-opt"][data-name="tone"][data-id="formal"]');
  assert.match(await page.inputValue("#replyBody"), /^Dear Sarah,\n\nI am just following up/);
  await page.click('[data-action="reply-opt"][data-name="length"][data-id="short"]');
  assert.match(await page.inputValue("#replyBody"), /^Hi Sarah, I'm just following up/);
  assert.equal(await page.locator("#replySubject").count(), 0, "no subject for a short message");

  await page.click('[data-action="reply-opt"][data-name="length"][data-id="email"]');
  await page.click('[data-action="copy-reply"]');
  assert.match(await clip(page), /^Dear Sarah,/);
  await page.click('.nav-btn:text-is("Home")');
  assert.match(await page.textContent("#recentCopies"), /Calls dropping: no reply: chase/);
  assert.deepEqual(page.errors, []);
});

test("an engineer booking asks for the date and slot, and writes them out", async () => {
  const page = await open();
  await page.click('.nav-btn:text-is("Replies")');
  await page.click('.reply-item:text-is("Broadband down")');
  await page.click('[data-action="reply-stage"][data-id="engineer-booked"]');
  assert.match(await page.textContent("#replyWrite"), /Add the date and time slot above/);
  await page.fill('[data-reply="date"]', "2026-10-20");
  await page.dispatchEvent('[data-reply="date"]', "change");
  await page.selectOption('[data-reply="timeslot"]', { index: 1 });
  const body = await page.inputValue("#replyBody");
  assert.match(body, /visit on Tuesday 20 October 2026, AM 08:00–13:00/);
  assert.match(body, /£180/);
  assert.ok(!/\[date\]|\[time slot\]/.test(body));
  assert.equal(
    await page.inputValue('[data-reply="date"]'),
    "2026-10-20",
    "the picked date stays in the box",
  );
});

test("a reply can be saved as your own template, and Ctrl K finds replies", async () => {
  const page = await open();
  await page.click('.nav-btn:text-is("Replies")');
  await page.click('.reply-item:text-is("New user or starter")');
  await page.click('[data-action="save-reply"]');
  await page.click('.nav-btn:text-is("Templates")');
  await page.click('[data-action="template-tab"][data-id="templates"]');
  assert.match(await page.textContent("#itemList"), /New user or starter: first reply/);

  await page.keyboard.press("Control+k");
  await page.fill("#globalSearchInput", "voicemail full");
  await page.click('.result-row:has(.result-type:text-is("Reply"))');
  assert.match(await page.textContent("#pageTitle"), /Replies/);
  assert.match(await page.textContent(".reply-head h3"), /Voicemail full/);
  assert.deepEqual(page.errors, []);
});
