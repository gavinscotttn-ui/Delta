import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { chromium } from "playwright";

/* The reply Triage writes never asks for what the email already said, or to try what was already done. */

let browser;
before(async () => (browser = await chromium.launch()));
after(async () => browser.close());

async function triage(text) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  await page.goto(pathToFileURL(resolve("index.html")).href);
  await page.click('.nav-btn:text-is("Triage")');
  await page.fill("#triageInput", text);
  await page.keyboard.press("Control+Enter");
  await page.waitForSelector(".triage-grid");
  return page;
}

test("a customer who already restarted the router is not asked to restart it", async () => {
  const page = await triage(`Subject: Broadband down

Hi, our broadband is down. I've already restarted the router twice and the lights are still red.

Thanks
Sarah Jones`);
  const reply = await page.inputValue("#triageReply");
  assert.match(reply, /^Hi Sarah,/);
  assert.doesNotMatch(reply, /Turn the router off at the power/);
  await page.close();
});

test("without that, the restart is still suggested", async () => {
  const page = await triage(`Subject: Broadband down

Hi, our broadband is down since this morning.

Thanks
Sarah Jones`);
  assert.match(await page.inputValue("#triageReply"), /Turn the router off at the power/);
  await page.close();
});

test("a handset email that gives the model and the screen text is not asked for them", async () => {
  const page = await triage(`Subject: Phone not working

Hi, the Yealink T46U on reception is showing Initialising and won't register.

Thanks
Sarah Jones`);
  const reply = await page.inputValue("#triageReply");
  assert.doesNotMatch(reply, /make and model/);
  assert.doesNotMatch(reply, /what the screen shows/);
  await page.close();
});

test("once read, the email folds away and the copy bar copies the reply and the note", async () => {
  const ctx = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
    viewport: { width: 1366, height: 900 },
  });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(resolve("index.html")).href);
  await page.click('.nav-btn:text-is("Triage")');
  await page.fill(
    "#triageInput",
    "Subject: Broadband down\n\nHi, our broadband is down.\n\nThanks\nSarah Jones",
  );
  await page.keyboard.press("Control+Enter");
  await page.waitForSelector(".triage-bar");
  assert.equal(await page.isVisible("#triageInput"), false, "folded");
  assert.match(await page.textContent(".triage-folded"), /(Sarah Jones|Broadband down) · \d+ lines/);
  await page.click('[data-triage="bar-reply"]');
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    await page.inputValue("#triageReply"),
  );
  await page.click('.triage-bar [data-triage="copy-note"]');
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    await page.inputValue("#triageNote"),
  );
  await page.click('[data-triage="edit"]');
  assert.equal(await page.isVisible("#triageInput"), true);
  await ctx.close();
});
