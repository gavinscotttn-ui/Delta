import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

/* These tests drive the Ask page with a stand-in engine plugged into AstraAI.useEngine, so they check Astra's own
   behaviour (prompt, streaming, checking, settings) without a real model. The real worker and ONNX runtime are
   exercised in local-ai.test.mjs, with a tiny test model. */

const URL_ = pathToFileURL(resolve("index.html")).href;
let browser;

before(async () => {
  browser = await chromium.launch();
});
after(async () => browser.close());

async function open() {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    permissions: ["clipboard-read", "clipboard-write"],
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.requests = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && page.errors.push(m.text()));
  page.on("request", (r) => page.requests.push(r.url()));
  await page.goto(URL_);
  return page;
}

/* Plugs in a fake model. window.__calls records each conversation it was given; window.__reply is what it says. */
async function fakeModel(page) {
  await page.evaluate(() => {
    window.__calls = [];
    window.__reply = "Fine [1].";
    window.__fail = "";
    let stopped = false;
    AstraAI.useEngine({
      load: async () => {},
      stop: () => (stopped = true),
      generate: async ({ messages, onDelta }) => {
        window.__calls.push(messages);
        stopped = false;
        if (window.__fail) throw new Error(window.__fail);
        const pieces = window.__reply.match(/.{1,18}/gs);
        for (const p of pieces) {
          if (stopped) break;
          onDelta(p);
          await new Promise((r) => setTimeout(r, window.__delay || 5));
        }
        return { stats: { tokens: pieces.length, seconds: 0.5 } };
      },
    });
    AstraAI.installed = async () => [{ id: "mock-model", name: "Mock model", size: "1 MB" }];
  });
}

async function enableAI(page) {
  await fakeModel(page);
  await page.click('.nav-btn:text-is("Settings")');
  await page.waitForSelector('#aiModel option[value="mock-model"]', {
    state: "attached",
  });
  await page.setChecked("#aiEnabled", true);
  await page.click('[data-action="save-ai"]');
}

async function ask(page, q) {
  await page.click('.nav-btn:text-is("Ask")');
  await page.fill("#askInput", q);
  await page.keyboard.press("Enter");
}

test("works with the assistant off: no AI block, no requests, nothing outside the file", async () => {
  const page = await open();
  const outside = [];
  page.on("request", (r) => !r.url().startsWith("file:") && outside.push(r.url()));
  await ask(page, "phone shows initialising and won't register");
  await page.waitForSelector(".ask-card");
  assert.match(await page.textContent(".ask-card h3"), /handset will not register/);
  assert.equal(await page.locator(".ask-ai").count(), 0);
  assert.deepEqual(outside, []);
  assert.deepEqual(page.errors, []);
});

test("answers a lookup straight from the table, with a click-to-copy code", async () => {
  const page = await open();
  await ask(page, "what is the shortcode for do not disturb");
  await page.waitForSelector(".ask-quick");
  await page.locator(".ask-quick code.copyable", { hasText: "*78" }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "*78");
});

test("a weak or unknown question is said to be weak, not answered confidently", async () => {
  const page = await open();
  await ask(page, "how do I reset my gmail password");
  await page.waitForSelector(".ask-turn");
  assert.match(await page.textContent(".ask-turn"), /weak match|Nothing in the guides/);
  await ask(page, "what is the capital of france");
  await page.waitForFunction(() => document.querySelectorAll(".ask-turn").length === 2);
  assert.match(
    await page.locator(".ask-turn").nth(1).textContent(),
    /Nothing in the guides or documents matches/,
  );
});

test("AI on: streams a cited answer from small sources and checks its commands", async () => {
  const page = await open();
  await enableAI(page);
  await page.evaluate(() => {
    window.__reply =
      "Check Health Check first [1]. Dial `*78` for Do Not Disturb [1]. If it is still stuck run `sys wipe everything` [2]. Profile is described on page 14 [5].";
  });
  await ask(page, "phone shows initialising and won't register");
  await page.waitForSelector(".ask-answer .cite", { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector(".verify"));
  assert.match(await page.textContent(".ask-answer"), /Health Check first/);
  assert.ok((await page.locator(".ask-answer button.cite").count()) >= 1);

  const warn = await page.textContent(".verify.warn");
  assert.match(warn, /sys wipe everything/);
  assert.ok(!/\*78/.test(warn));

  /* what the model was given: rules, a few small numbered sources, the question */
  const calls = await page.evaluate(() => window.__calls);
  assert.equal(calls.length, 1);
  const user = calls[0].at(-1).content;
  assert.match(calls[0][0].content, /ONLY from the numbered SOURCES/);
  assert.match(user, /\[1\] Horizon: handset will not register/);
  assert.match(user, /QUESTION: phone shows initialising and won't register$/);
  assert.ok(user.length < 6500, `sized for a small model, was ${user.length}`);
  assert.ok(!/customer:|ticket:/.test(user), "no case details unless asked for");
  assert.ok(
    page.requests.every((u) => u.startsWith("file:")),
    "no network request was made",
  );
  assert.deepEqual(page.errors, []);
});

test("a question the library cannot answer is never given to the model", async () => {
  const page = await open();
  await enableAI(page);
  await ask(page, "what is the capital of france");
  await page.waitForSelector(".ask-turn");
  await page.waitForTimeout(300);
  assert.equal((await page.evaluate(() => window.__calls)).length, 0);
});

test("a model failure is shown plainly and can be retried; the offline answer stays", async () => {
  const page = await open();
  await enableAI(page);
  await page.evaluate(() => (window.__fail = "The device ran out of memory."));
  await ask(page, "phone shows initialising and won't register");
  await page.waitForSelector(".ask-ai.err");
  assert.match(await page.textContent(".ask-ai.err"), /ran out of memory/);
  assert.ok(await page.locator(".ask-card").isVisible());
  await page.evaluate(() => {
    window.__fail = "";
    window.__reply = "Now it works [1].";
  });
  await page.click('[data-ask="retry"]');
  await page.waitForSelector(".ask-answer");
  assert.match(await page.textContent(".ask-answer"), /Now it works/);
});

test("Stop keeps what has been written so far", async () => {
  const page = await open();
  await enableAI(page);
  /* slow enough that Stop always lands mid-answer, even on a busy machine */
  await page.evaluate(() => {
    window.__reply = "Word ".repeat(400) + "[1]";
    window.__delay = 40;
  });
  await ask(page, "phone shows initialising and won't register");
  await page.waitForSelector(".ask-answer");
  await page.click('[data-ask="stop"]');
  await page.waitForFunction(() => !document.querySelector('[data-ask="stop"]'));
  const text = await page.textContent(".ask-answer");
  assert.ok(text.length > 0 && text.length < 2000);
  assert.ok(await page.locator('[data-ask="copy-answer"]').isVisible());
});

test("follow-up questions carry the earlier conversation", async () => {
  const page = await open();
  await enableAI(page);
  await page.evaluate(() => (window.__reply = "First answer [1]."));
  await ask(page, "webex not ringing on iphone");
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".ask-answer").length === 1 && !document.querySelector('[data-ask="stop"]'),
  );
  await page.evaluate(() => (window.__reply = "Second answer [1]."));
  await page.fill("#askInput", "what about android?");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".ask-answer").length === 2 && !document.querySelector('[data-ask="stop"]'),
  );
  const second = (await page.evaluate(() => window.__calls)).at(-1);
  assert.deepEqual(
    second.slice(1, 3).map((m) => m.role),
    ["user", "assistant"],
  );
  assert.match(second[1].content, /webex not ringing on iphone/);
  assert.match(second[2].content, /First answer/);
  assert.match(await page.locator(".ask-card h3").last().textContent(), /Android|iPhone/);
});

test("settings: the AI section stays out of sight until a model is installed", async () => {
  const page = await open();
  await page.click('.nav-btn:text-is("Settings")');
  await page.waitForTimeout(200);
  assert.equal(await page.locator("#aiSettings").isVisible(), false, "nothing to set up, so nothing shown");
  assert.doesNotMatch(await page.textContent("#app"), /npm|README|models folder|file opened directly/);
  await fakeModel(page);
  await page.click('.nav-btn:text-is("Home")');
  await page.click('.nav-btn:text-is("Settings")');
  await page.waitForSelector("#aiSettings:not([hidden])");
});

test("settings: 'Check the model' runs three questions and reports the result", async () => {
  const page = await open();
  await fakeModel(page);
  await page.evaluate(() => (window.__reply = "The code is *78, port 5060, wait 20 minutes [1]."));
  await page.click('.nav-btn:text-is("Settings")');
  await page.waitForSelector('#aiModel option[value="mock-model"]', {
    state: "attached",
  });
  await page.click('[data-action="test-ai"]');
  await page.waitForSelector(".ai-test-result li");
  assert.match(await page.textContent(".ai-test-result p"), /3 of 3 correct/);
  assert.equal(await page.locator(".ai-test-result li.pass").count(), 3);
  await page.evaluate(() => (window.__reply = "I do not know."));
  await page.click('[data-action="test-ai"]');
  await page.waitForFunction(() => /0 of 3/.test(document.querySelector(".ai-test-result").textContent));
  assert.equal(await page.locator(".ai-test-result li.fail").count(), 3);
});

test("old cloud settings in a backup are ignored and cannot turn anything on", async () => {
  const page = await open();
  await page.click('.nav-btn:text-is("Settings")');
  const [download] = await Promise.all([page.waitForEvent("download"), page.click('[data-action="export"]')]);
  const backup = JSON.parse(readFileSync(await download.path(), "utf8"));
  assert.ok(!("apiKey" in backup.ai) && !("baseUrl" in backup.ai));
  backup.ai = {
    enabled: true,
    consent: true,
    apiKey: "sk-x",
    baseUrl: "https://evil.example/v1",
    model: "x",
  };
  writeFileSync("/tmp/astra-ai-backup.json", JSON.stringify(backup));
  await page.setInputFiles("#importFile", "/tmp/astra-ai-backup.json");
  await page.waitForFunction(() => /imported/.test(document.querySelector("#toast").textContent));
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("astra.offline.fresh.v1")).ai);
  assert.deepEqual(stored, { enabled: false, model: "" });
});

test("Ctrl K offers to ask Astra, and the Ask page has no accessibility violations", async () => {
  const page = await open();
  await page.keyboard.press("Control+k");
  await page.fill("#globalSearchInput", "webex not ringing on iphone");
  await page.click('[data-action="ask-from-search"]');
  await page.waitForSelector(".ask-card");
  assert.match(await page.textContent(".ask-q"), /webex not ringing on iphone/);
  const axe = readFileSync("node_modules/axe-core/axe.min.js", "utf8");
  await page.evaluate(axe);
  const v = await page.evaluate(async () =>
    (await axe.run(document, { resultTypes: ["violations"] })).violations.map(
      (x) => `${x.id}: ${x.nodes[0].target.join(" ")}`,
    ),
  );
  assert.deepEqual(v, []);
});

const gaps = (page) =>
  page.evaluate(
    () => (JSON.parse(localStorage.getItem("astra.offline.fresh.v1") || "null") || {}).gaps || [],
  );

test("questions Astra cannot answer are kept as gaps, once each, without personal details", async () => {
  const page = await open();
  await ask(page, "what is the capital of france, from bob@acme.co.uk");
  await page.waitForSelector(".ask-turn");
  await ask(page, "What is the capital of France, from bob@acme.co.uk?");
  await page.waitForFunction(() => document.querySelectorAll(".ask-turn").length === 2);
  const list = await gaps(page);
  assert.equal(list.length, 1, "the same question is counted, not listed twice");
  assert.equal(list[0].n, 2);
  assert.ok(!/bob@acme/.test(list[0].q) && /\[email\]/.test(list[0].q));
  assert.equal(list[0].why, "none");
});

test("'Not what I needed' adds a gap; a good answer adds nothing by itself", async () => {
  const page = await open();
  await ask(page, "phone shows initialising and won't register");
  await page.waitForSelector(".ask-card");
  assert.deepEqual(await gaps(page), []);
  await page.click('[data-ask="unhelpful"]');
  assert.match(await page.textContent(".ask-feedback"), /Noted/);
  const list = await gaps(page);
  assert.equal(list.length, 1);
  assert.equal(list[0].why, "unhelpful");
});

test("Settings lists the gaps, and they can be copied, removed and cleared", async () => {
  const page = await open();
  await ask(page, "what is the capital of france");
  await ask(page, "how do I reset my gmail password");
  await page.waitForFunction(() => document.querySelectorAll(".ask-turn").length === 2);
  await page.click('.nav-btn:text-is("Settings")');
  assert.equal(await page.locator(".gap-list li").count(), 2);
  await page.click('[data-action="copy-gaps"]');
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /^- /);
  await page.locator('[data-action="del-gap"]').first().click();
  assert.equal(await page.locator(".gap-list li").count(), 1);
  page.once("dialog", (d) => d.accept());
  await page.click('[data-action="clear-gaps"]');
  assert.match(await page.textContent("#gapSettings"), /None yet/);
  assert.deepEqual(await gaps(page), []);
});

test("the document text loads after the first paint, and a question asked at once still finds document pages", async () => {
  assert.ok(
    !readFileSync("index.html", "utf8").includes("library/index.js"),
    "not loaded before the first paint",
  );
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL_, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => AstraAsk.ask("voxone firewall ports"));
  await page.waitForSelector(".ask-card", { timeout: 15000 });
  assert.ok(await page.evaluate(() => AstraKB.indexReady()));
  assert.ok((await page.locator(".ask-more .doc-row").count()) > 0, "document pages are part of the answer");
  assert.deepEqual(errors, []);
  await ctx.close();
});
