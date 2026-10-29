import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

/* The extension, tested the way the browser runs it: Astra is loaded unpacked, and its pages (the new tab, Astra Lite
   in the toolbar and side panel) and its background script (right-click triage, update reminders) are used as
   installed. Made-up details throughout;
   phone numbers are from Ofcom's ranges reserved for fiction. */

const EXT = resolve(".");
/* Chrome names an unpacked extension after its folder: the SHA-256 of the path, first 32 hex digits written a to p. */
const ID = [...createHash("sha256").update(EXT).digest("hex").slice(0, 32)]
  .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
  .join("");
const BASE = `chrome-extension://${ID}/`;
const axeSource = readFileSync("node_modules/axe-core/axe.min.js", "utf8");

/* asPerson: the browser does not say it is automated, so Astra shows first-run setup as it would to a person. */
async function launch({ colorScheme = "dark", asPerson = false } = {}) {
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "astra-lite-")), {
    ...(asPerson ? { ignoreDefaultArgs: ["--enable-automation"] } : {}),
    channel: "chromium" /* the full browser in headless mode: the headless shell cannot load extensions */,
    headless: true,
    viewport: { width: 380, height: 600 },
    colorScheme,
    permissions: ["clipboard-read", "clipboard-write"],
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      /* Nothing may reach the internet in tests: every outside address fails to resolve. */
      "--host-resolver-rules=MAP * ~NOTFOUND",
      ...(asPerson ? ["--disable-blink-features=AutomationControlled"] : []),
    ],
  });
  return ctx;
}

async function popup(ctx) {
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && page.errors.push(m.text()));
  await page.goto(BASE + "popup.html");
  await page.waitForSelector(".lite-system");
  return page;
}

const clip = (page) => page.evaluate(() => navigator.clipboard.readText());
/* Types a search and waits for the frame in which the popup draws its results. */
async function find(page, text) {
  await page.fill("#liteSearch", text);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}
const typesShown = (page) => page.$$eval(".lite-row .lite-type", (els) => els.map((e) => e.textContent));

test("the toolbar button opens Astra Lite, with a keyboard shortcut; no access to any website", () => {
  const m = JSON.parse(readFileSync("manifest.json", "utf8"));
  assert.equal(m.action.default_popup, "popup.html");
  assert.equal(m.side_panel.default_path, "panel.html");
  assert.equal(m.commands._execute_action.suggested_key.default, "Alt+Q");
  /* Each one is explained in the README. */
  assert.deepEqual(m.permissions.toSorted(), [
    "activeTab",
    "contextMenus",
    "scripting",
    "sidePanel",
    "storage",
    "unlimitedStorage",
  ]);
  const readme = readFileSync("README.md", "utf8");
  for (const p of m.permissions) assert.match(readme, new RegExp("`" + p + "`"), `README explains ${p}`);
  assert.ok(!m.host_permissions && !m.content_scripts, "no access to any website");
  /* Zoho's pages only, and only if asked for in Settings. */
  assert.deepEqual(m.optional_host_permissions, ["https://*.zoho.eu/*", "https://*.zoho.com/*"]);
  assert.match(readme, /`optional_host_permissions`/);
  for (const f of Object.values(m.action.default_icon)) assert.ok(existsSync(f), f);
  const html = readFileSync("popup.html", "utf8");
  assert.match(html, /connect-src 'none'/, "the popup never uses the network");
  assert.doesNotMatch(html, /<script>|style="/, "no inline script or style");
});

test("the popup loads every built-in content file that Astra loads", () => {
  const index = readFileSync("index.html", "utf8");
  const popupJs = readFileSync("js/popup.js", "utf8");
  const listed = popupJs
    .match(/const SEED_FILES = \[([^\]]+)\]/)[1]
    .match(/"([\w-]+)"/g)
    .map((x) => JSON.parse(x));
  for (const [, name] of index.matchAll(/src="js\/seed\/([\w-]+)\.js"/g)) {
    const text = readFileSync(`js/seed/${name}.js`, "utf8");
    if (/\b(templates|knowledge|shortcuts)\.push\(|seed\.profile\s*=/.test(text))
      assert.ok(listed.includes(name), `popup.js SEED_FILES is missing ${name}`);
  }
});

test("on a computer where Astra was never opened, the popup still has the systems, templates and guides", async (t) => {
  const ctx = await launch();
  t.after(() => ctx.close());
  const page = await popup(ctx);
  assert.equal(await page.locator(".lite-system").count(), 10);
  assert.match(await page.textContent(".lite-system"), /Gamma portal.*Alt G/s);
  assert.ok(await page.locator("[data-template]").count(), "pinned templates");
  await find(page, "terms notice");
  assert.ok((await typesShown(page)).includes("Guide"));
  assert.deepEqual(page.errors, []);
});

test("numbers and codes: one keypress copies, and nothing is guessed", async (t) => {
  const ctx = await launch();
  t.after(() => ctx.close());
  const page = await popup(ctx);
  await find(page, "01632 960 000");
  assert.equal(await page.textContent("#opt-0 .lite-type"), "Number");
  await find(page, "0141 496 0000");
  assert.match(await page.textContent("#opt-0"), /0141 496 0000.*Landline · Glasgow/s);
  await page.keyboard.press("Enter");
  assert.equal(await clip(page), "0141 496 0000");
  await find(page, "sip 486");
  assert.match(await page.textContent("#opt-0"), /SIP 486 · Busy Here/);
  await page.keyboard.press("Enter");
  assert.match(await clip(page), /^SIP 486 Busy Here: /);
  await find(page, "dumfries");
  assert.match(await page.textContent("#liteResults"), /01387 · Dumfries/);
  await find(page, "zzqx nothing like this");
  assert.match(await page.textContent(".lite-empty"), /Nothing matches/);
  assert.equal(await page.textContent("#liteCount"), "No match");
  assert.deepEqual(page.errors, []);
});

test("replies use the workspace Astra saved: your name signs them, and they copy as shown", async (t) => {
  const ctx = await launch();
  t.after(() => ctx.close());
  const astra = await ctx.newPage();
  await astra.setViewportSize({ width: 1280, height: 900 });
  await astra.goto(BASE + "index.html");
  await astra.click('.nav-btn:text-is("Settings")');
  await astra.fill("#profileName", "Sam Example");
  await astra.click('[data-action="save-profile"]');
  await astra.close();

  const page = await popup(ctx);
  await find(page, "broadband down");
  assert.equal(await page.textContent("#opt-0 .lite-type"), "Reply");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".lite-panel");
  await page.fill('[data-v="contact"]', "Priya Shah");
  await page.fill('[data-v="ticket"]', "TN-48213");
  const body = await page.inputValue("#liteBody");
  assert.match(body, /^Hi Priya,/);
  assert.match(body, /Sam Example\s*$/);
  assert.match(await page.inputValue("#liteSubject"), /TN-48213/);
  await page.click("#liteCopy");
  assert.equal(await clip(page), body);
  await page.click("#liteCopySubject");
  assert.equal(await clip(page), await page.inputValue("#liteSubject"));

  /* A short message for chat or SMS. */
  await page.click('[data-length="short"]');
  assert.ok(await page.isHidden("#liteSubject"));
  assert.ok((await page.inputValue("#liteBody")).length < body.length);

  /* Escape goes back to the results, with the search as it was. */
  await page.keyboard.press("Escape");
  await page.waitForSelector("#liteResults");
  assert.equal(await page.inputValue("#liteSearch"), "broadband down");
  assert.deepEqual(page.errors, []);
});

test("a reply that needs a date will not copy until it has one", async (t) => {
  const ctx = await launch();
  t.after(() => ctx.close());
  const page = await popup(ctx);
  await find(page, "broadband down");
  await page.keyboard.press("Enter");
  await page.selectOption("#liteStage", "engineer-booked");
  await page.evaluate(() => navigator.clipboard.writeText("before"));
  await page.click("#liteCopy");
  assert.match(await page.textContent("#toast"), /Add the details above first/);
  assert.equal(await clip(page), "before", "nothing was copied");
  assert.match(await page.textContent("#liteMissing"), /date and time slot/);
  await page.fill('[data-v="date"]', "2026-10-21");
  await page.selectOption('[data-v="timeslot"]', "AM 08:00–13:00");
  assert.ok(await page.isHidden("#liteMissing"));
  await page.click("#liteCopy");
  const copied = await clip(page);
  assert.match(copied, /Wednesday 21 October 2026/);
  assert.match(copied, /08:00–13:00/);

  /* Another stage and back: the date box still shows the date the email uses, and the keyboard stays on the stage. */
  await page.selectOption("#liteStage", "progress");
  assert.equal(await page.evaluate(() => document.activeElement.id), "liteStage");
  await page.selectOption("#liteStage", "engineer-booked");
  assert.equal(await page.inputValue('[data-v="date"]'), "2026-10-21");
  assert.equal(await page.inputValue('[data-v="timeslot"]'), "AM 08:00–13:00");
  assert.match(await page.inputValue("#liteBody"), /Wednesday 21 October 2026/);
});

test("templates fill in, and never copy with {braces} left in", async (t) => {
  const ctx = await launch();
  t.after(() => ctx.close());
  const page = await popup(ctx);
  await page.click('[data-template="install"]');
  await page.waitForSelector(".lite-panel");
  assert.match(await page.inputValue("#liteBody"), /\[contact\]/, "the gaps are shown in the preview");
  await page.evaluate(() => navigator.clipboard.writeText("before"));
  await page.click("#liteCopy");
  assert.equal(await clip(page), "before");
  assert.ok(await page.locator(".invalid").count());
  for (const el of await page.$$('.lite-panel input[data-v]:not([type="date"])'))
    await el.fill("Harbour Lane Surgery");
  for (const el of await page.$$('.lite-panel input[type="date"]')) await el.fill("2026-10-21");
  for (const el of await page.$$(".lite-panel select[data-v]")) await el.selectOption({ index: 1 });
  await page.click("#liteCopy");
  const copied = await clip(page);
  assert.doesNotMatch(copied, /[{}[\]]/);
  assert.match(copied, /Wednesday 21 October 2026/);
});

test("a guide or reply opens in full Astra, at that guide or stage, and the address is then cleared", async (t) => {
  const ctx = await launch();
  t.after(() => ctx.close());
  const page = await popup(ctx);
  await find(page, "terms notice");
  const guideRow = page.locator(".lite-row", { has: page.locator('.lite-type:text-is("Guide")') }).first();
  const title = await guideRow.locator("b").textContent();
  const [astra] = await Promise.all([ctx.waitForEvent("page"), guideRow.click()]);
  await astra.waitForSelector(".modal-head h2");
  assert.equal(await astra.textContent(".modal-head h2"), title);
  assert.equal(new URL(astra.url()).hash, "", "a reload will not open it again");

  const page2 = await popup(ctx);
  await find(page2, "broadband down");
  await page2.keyboard.press("Enter");
  await page2.selectOption("#liteStage", "progress");
  const [replies] = await Promise.all([ctx.waitForEvent("page"), page2.click("#liteFull")]);
  await replies.waitForSelector('.stage-btn[aria-pressed="true"]');
  assert.equal(await replies.textContent("#pageTitle"), "Replies");
  assert.equal(await replies.getAttribute('.stage-btn[aria-pressed="true"]', "data-id"), "progress");
  assert.equal(await replies.textContent(".reply-head h3"), "Broadband down");
});

test("Alt + key opens a system in a new tab, as on the Astra new tab", async (t) => {
  const ctx = await launch();
  t.after(() => ctx.close());
  const page = await popup(ctx);
  /* Opening a real tab is covered above; here, record which address the key asks Chrome to open. */
  await page.evaluate(() => {
    chrome.tabs.create = (options) => {
      window.opened = options.url;
      return new Promise(() => {});
    };
  });
  await page.keyboard.press("Alt+G");
  assert.equal(await page.evaluate(() => window.opened), "https://www.gamma-portal.com/framework/home.jspa");
  await page.keyboard.press("Alt+Z");
  assert.equal(
    await page.evaluate(() => window.opened),
    "https://www.gamma-portal.com/framework/home.jspa",
    "a key with no system does nothing",
  );
});

for (const scheme of ["dark", "light"]) {
  test(`Astra Lite has no accessibility violations (${scheme}), colour contrast included`, async (t) => {
    const ctx = await launch({ colorScheme: scheme });
    t.after(() => ctx.close());
    const page = await popup(ctx);
    await page.evaluate(axeSource);
    const check = () =>
      page.evaluate(async () => {
        const r = await axe.run(document, { resultTypes: ["violations"] });
        return r.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0].target.join(" ")}`);
      });
    assert.deepEqual(await check(), [], "home");
    await find(page, "broadband down");
    await page.keyboard.press("ArrowDown");
    assert.deepEqual(await check(), [], "results");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    await page.waitForSelector(".lite-panel");
    assert.deepEqual(await check(), [], "reply");
    await page.keyboard.press("Escape");
    await page.fill("#liteSearch", "");
    await page.waitForSelector('[data-template="install"]');
    await page.click('[data-template="install"]');
    assert.deepEqual(await check(), [], "template");
  });
}

test("installed as an extension, Astra is what every new tab shows", async (t) => {
  const ctx = await launch();
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("chrome://newtab");
  await page.waitForSelector("#pageTitle");
  assert.equal(await page.title(), "Astra");
  assert.equal(await page.textContent("#pageTitle"), "Home");
  /* The shortcut list names the key the browser actually has for Astra Lite. */
  await page.click('[data-action="keys"]');
  await page.waitForSelector(".keys-table");
  assert.match(await page.textContent(".keys-table"), /Alt Q\s*Praxis Lite, on top of any page/);
});

/* ------------------------------------------------------------------ side panel */

test("the side panel is the same page as the popup", () => {
  const popupHtml = readFileSync("popup.html", "utf8");
  const panelHtml = readFileSync("panel.html", "utf8");
  assert.equal(panelHtml, popupHtml.replace('<body class="lite">', '<body class="lite panel">'));
});

test("the side panel fills its width, and stays open when it opens a tab or Escape is pressed", async (t) => {
  const ctx = await launch();
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 520, height: 800 });
  await page.goto(BASE + "panel.html");
  await page.waitForSelector(".lite-system");
  assert.equal(await page.evaluate(() => document.body.getBoundingClientRect().width), 520);
  assert.equal(await page.locator("#keepOpen").count(), 0, "no Keep open button in the panel itself");
  await page.evaluate(() => {
    chrome.tabs.create = (options) => {
      window.opened = options.url;
      return Promise.resolve({});
    };
  });
  await page.keyboard.press("Alt+G");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.opened), "https://www.gamma-portal.com/framework/home.jspa");
  assert.ok(!page.isClosed(), "the panel is still open");
});

test("Keep open moves Astra Lite into the side panel of this window", async (t) => {
  const ctx = await launch();
  t.after(() => ctx.close());
  const page = await popup(ctx);
  assert.ok(await page.isVisible("#keepOpen"));
  await page.evaluate(() => {
    chrome.sidePanel.open = (options) => {
      window.panelFor = options;
      return new Promise(() => {}); /* the real one closes the popup: keep it to read the result */
    };
  });
  await page.waitForFunction(() => true);
  const windowId = await page.evaluate(() => chrome.windows.getCurrent().then((w) => w.id));
  await page.click("#keepOpen");
  assert.deepEqual(await page.evaluate(() => window.panelFor), { windowId });
});

test("the side panel shows what Astra saves while it is open", async (t) => {
  const ctx = await launch();
  t.after(() => ctx.close());
  const astra = await ctx.newPage();
  await astra.setViewportSize({ width: 1280, height: 900 });
  await astra.goto(BASE + "index.html");
  const panel = await ctx.newPage();
  await panel.goto(BASE + "panel.html");
  await panel.waitForSelector(".lite-system");
  await astra.click('.nav-btn:text-is("Settings")');
  await astra.fill('[data-shortcut="gamma"] [data-s-field="title"]', "Gamma (main)");
  await astra.click('[data-action="save-shortcuts"]');
  await panel.waitForFunction(() => document.querySelector(".lite-system b").textContent === "Gamma (main)");
  /* A theme chosen in Astra reaches the open panel too. */
  const before = await panel.evaluate(() => document.documentElement.dataset.theme);
  const other = before === "light" ? "dark" : "light";
  await astra.click(`label.theme-choice:has(input[value="${other}"])`);
  await panel.waitForFunction((t) => document.documentElement.dataset.theme === t, other);
});

/* ------------------------------------------------------------- right-click */

const EMAIL = `Subject: Phones keep dropping calls

Hi there,

Since this morning our reception phone (Yealink T46U) keeps dropping calls.
Our ticket ref is INC-48213. Site is BS1 4DJ.

Kind regards,
Sarah Jones
Brightwater Dental Ltd
Tel: 0117 496 0555`;

/* The tab an Astra page is in, found the way Astra itself finds it: the browser hides tab addresses. */
const tabOf = (sw, file) =>
  sw.evaluate(
    (file) =>
      chrome.runtime
        .getContexts({ contextTypes: ["TAB"] })
        .then((all) => all.find((c) => new URL(c.documentUrl).pathname === "/" + file)?.tabId),
    file,
  );

/* The background script, once it is running. Its start can race the test's first look, so the test looks a few
   times, and if it has gone idle, a message from one of Astra's pages wakes it. */
async function worker(ctx) {
  const sw = await findWorker(ctx);
  /* Under load the worker can be found before its script has finished running: wait until it has. */
  await sw.evaluate(async () => {
    for (let i = 0; i < 100 && typeof self.astraTriage !== "function"; i++)
      await new Promise((r) => setTimeout(r, 50));
  });
  return sw;
}

async function findWorker(ctx) {
  for (let i = 0; i < 30; i++) {
    const [sw] = ctx.serviceWorkers();
    if (sw) return sw;
    await new Promise((r) => setTimeout(r, 100));
  }
  const waiting = ctx.waitForEvent("serviceworker");
  const page = await ctx.newPage();
  await page.goto(BASE + "popup.html");
  await page.evaluate(() => chrome.runtime.sendMessage({ type: "astra-wake" }).catch(() => {}));
  const sw = ctx.serviceWorkers()[0] || (await waiting);
  await page.close();
  return sw;
}

test("Triage with Astra: right-clicked text opens Astra with it triaged, once", async (t) => {
  const ctx = await launch();
  t.after(() => ctx.close());
  const sw = await worker(ctx);
  /* The menu item exists (updating an item that is not there fails), once the install has run. */
  await sw.evaluate(async () => {
    for (let i = 0; i < 50; i++) {
      try {
        await chrome.contextMenus.update("astra-triage", { title: "Triage with Astra" });
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    throw new Error("The Triage with Astra menu item was never added");
  });
  const [astra] = await Promise.all([
    ctx.waitForEvent("page"),
    sw.evaluate((text) => self.astraTriage({ selectionText: text, frameId: 0 }), EMAIL),
  ]);
  await astra.setViewportSize({ width: 1280, height: 900 });
  await astra.waitForSelector(".triage-summary");
  assert.equal(await astra.textContent("#pageTitle"), "Triage");
  assert.match(await astra.textContent(".triage-summary"), /Phones keep dropping calls/);
  assert.match(await astra.textContent(".triage-symptoms"), /Calls dropping/);
  assert.equal(new URL(astra.url()).hash, "", "the address carries nothing");
  const leftover = () =>
    sw.evaluate(() =>
      chrome.storage.session
        .get(null)
        .then((x) => Object.keys(x).filter((k) => k.startsWith("astra.triage"))),
    );
  assert.deepEqual(await leftover(), [], "the text was removed once read");
  await astra.reload();
  await astra.waitForSelector("#pageTitle");
  assert.equal(await astra.textContent("#pageTitle"), "Home", "a reload does not triage it again");
});

test("Triage with Astra uses the menu's copy where a page cannot be read, and ignores old or empty text", async (t) => {
  const ctx = await launch();
  t.after(() => ctx.close());
  const sw = await worker(ctx);
  const page = await popup(ctx);
  /* An extension page cannot be read by a script, as with the browser's own pages and the PDF viewer. */
  const tab = await sw.evaluate((id) => chrome.tabs.get(id), await tabOf(sw, "popup.html"));
  assert.ok(tab && tab.id >= 0, "a real tab");
  await sw.evaluate(() => {
    const real = chrome.scripting.executeScript;
    chrome.scripting.executeScript = (options) => {
      self.tried = (self.tried || 0) + 1;
      return real(options);
    };
  });
  const [astra] = await Promise.all([
    ctx.waitForEvent("page"),
    sw.evaluate(([text, tab]) => self.astraTriage({ selectionText: text, frameId: 0 }, tab), [EMAIL, tab]),
  ]);
  assert.equal(await sw.evaluate(() => self.tried), 1, "it tried to read the page first");
  await astra.waitForSelector(".triage-summary");
  assert.match(await astra.textContent(".triage-summary"), /Phones keep dropping calls/);

  const pages = ctx.pages().length;
  await sw.evaluate(() => self.astraTriage({ selectionText: "   ", frameId: 0 }));
  assert.equal(ctx.pages().length, pages, "nothing opens for an empty selection");

  await sw.evaluate(() =>
    chrome.storage.session.set({
      "astra.triage.old": { text: "Calls dropping", at: Date.now() - 10 * 60000 },
    }),
  );
  const stale = await ctx.newPage();
  await stale.goto(BASE + "index.html#triage=old");
  await stale.waitForSelector("#pageTitle");
  await stale.waitForTimeout(200);
  assert.equal(await stale.textContent("#pageTitle"), "Home", "text left over from earlier is not used");
  assert.deepEqual(
    await sw.evaluate(() => chrome.storage.session.get(null).then((x) => Object.keys(x))),
    [],
    "and it is tidied away",
  );
  await page.close();
});

/* -------------------------------------------------- the selection underneath */

/* The browser lets the popup read the page only when it was opened from the toolbar or its key, which a test cannot
   do: these stand in for the tab and the page's selection. */
async function popupOver(ctx, selected, path = "popup.html") {
  const page = await ctx.newPage();
  await page.addInitScript((text) => {
    window.readFrom = [];
    chrome.tabs.query = async () => [{ id: 7, index: 0 }];
    chrome.scripting.executeScript = async (options) => {
      window.readFrom.push(options.target.tabId);
      return [{ result: text }];
    };
  }, selected);
  await page.goto(BASE + path);
  await page.waitForSelector(".lite-system, #liteResults, .lite-empty");
  return page;
}

test("opened over a selected number, Astra Lite already shows it", async (t) => {
  const ctx = await launch();
  t.after(() => ctx.close());
  const page = await popupOver(ctx, "  0141 496 0000 ");
  await page.waitForSelector("#liteResults");
  assert.equal(await page.inputValue("#liteSearch"), "0141 496 0000");
  assert.match(await page.textContent("#opt-0"), /Landline · Glasgow/);
  /* Typing replaces it rather than adding to it. */
  await page.keyboard.type("sip 486");
  assert.equal(await page.inputValue("#liteSearch"), "sip 486");
});

test("opened over a selected email, Astra Lite suggests the reply and can hand it to Astra", async (t) => {
  const ctx = await launch();
  t.after(() => ctx.close());
  const page = await popupOver(ctx, EMAIL);
  await page.waitForSelector("[data-triage]");
  assert.equal(await page.inputValue("#liteSearch"), "", "an email is not put in the search box");
  const first = page.locator("[data-reply]").first();
  assert.match(await first.textContent(), /Calls dropping.*Best match/s);
  await first.click();
  await page.waitForSelector(".lite-panel");
  assert.equal(await page.textContent("#litePanelTitle"), "Calls dropping");
  await page.keyboard.press("Escape");
  await page.waitForSelector("[data-triage]");
  const [astra] = await Promise.all([ctx.waitForEvent("page"), page.click("[data-triage]")]);
  await astra.setViewportSize({ width: 1280, height: 900 });
  await astra.waitForSelector(".triage-summary");
  assert.match(await astra.textContent(".triage-summary"), /Phones keep dropping calls/);
});

test("the side panel never reads the page", async (t) => {
  const ctx = await launch();
  t.after(() => ctx.close());
  const page = await popupOver(ctx, "0141 496 0000", "panel.html");
  await page.waitForTimeout(400);
  assert.equal(await page.inputValue("#liteSearch"), "");
  assert.deepEqual(await page.evaluate(() => window.readFrom), []);
});

/* ----------------------------------------------------- found in review */

test("two emails right-clicked in quick succession each reach their own tab", async (t) => {
  const ctx = await launch();
  t.after(() => ctx.close());
  const sw = await worker(ctx);
  const second = EMAIL.replace("Phones keep dropping calls", "Broadband down since lunch");
  const opened = [];
  ctx.on("page", (p) => opened.push(p));
  await sw.evaluate(
    ([a, b]) =>
      Promise.all([
        self.astraTriage({ selectionText: a, frameId: 0 }),
        self.astraTriage({ selectionText: b, frameId: 0 }),
      ]),
    [EMAIL, second],
  );
  for (let i = 0; i < 50 && opened.length < 2; i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(opened.length, 2);
  const summaries = [];
  for (const p of opened) {
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.waitForSelector(".triage-summary");
    summaries.push(await p.textContent(".triage-summary"));
  }
  assert.ok(summaries.some((x) => /Phones keep dropping calls/.test(x)));
  assert.ok(summaries.some((x) => /Broadband down since lunch/.test(x)));
});

test("Enter acts on the search as typed, however fast, and the chosen result is outlined", async (t) => {
  const ctx = await launch();
  t.after(() => ctx.close());
  const page = await popup(ctx);
  /* Moving down, then typing more: Enter takes the new best match, not the old position. */
  await find(page, "gamma");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type(" portal");
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  assert.equal(await page.getAttribute("#liteSearch", "aria-activedescendant"), "opt-0");
  assert.equal(
    await page.$eval(".lite-row.active", (el) => getComputedStyle(el).outlineStyle),
    "solid",
    "visible in Windows contrast themes too",
  );
  /* Typed and Enter pressed within one frame: the new search is used. */
  await find(page, "0141 496 0000");
  await page.evaluate(() => {
    const box = document.querySelector("#liteSearch");
    box.value = "sip 486";
    box.dispatchEvent(new Event("input"));
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector("#toast").textContent.includes("SIP 486"));
  assert.match(await clip(page), /^SIP 486 Busy Here/);
});

test("a template's {update_time} is a time, not a date", async (t) => {
  const ctx = await launch();
  t.after(() => ctx.close());
  const astra = await ctx.newPage();
  await astra.setViewportSize({ width: 1280, height: 900 });
  await astra.goto(BASE + "index.html");
  /* A workspace is saved once something in it changes. */
  await astra.click('.nav-btn:text-is("Settings")');
  await astra.fill("#profileName", "Sam Example");
  await astra.click('[data-action="save-profile"]');
  await astra.evaluate(() => {
    const key = "astra.offline.fresh.v1";
    const x = JSON.parse(localStorage.getItem(key));
    x.templates.push({
      id: "update-by",
      title: "Update by",
      category: "General",
      tags: [],
      favourite: true,
      body: "Hi {customer},\n\nI will update you by {update_time} on {date}.",
    });
    localStorage.setItem(key, JSON.stringify(x));
  });
  const page = await popup(ctx);
  await find(page, "update by");
  await page.click('.lite-row:has(.lite-type:text-is("Template")):has-text("Update by")');
  await page.waitForSelector(".lite-panel");
  assert.equal(await page.getAttribute('[data-v="update_time"]', "type"), null, "a plain text box");
  assert.equal(await page.getAttribute('[data-v="date"]', "type"), "date");
  await page.fill('[data-v="customer"]', "Priya");
  await page.fill('[data-v="update_time"]', "14:30");
  await page.fill('[data-v="date"]', "2026-10-21");
  await page.click("#liteCopy");
  assert.match(await clip(page), /update you by 14:30 on Wednesday 21 October 2026\./);
});

test("on first run, a link from Astra Lite opens beneath setup, and a guide once setup is done", async (t) => {
  const ctx = await launch({ asPerson: true });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(BASE + "index.html#reply=" + encodeURIComponent("broadband-down|progress"));
  await page.waitForSelector(".setup-body");
  assert.equal(await page.textContent("#pageTitle"), "Replies", "the reply is waiting under setup");
  await page.click('[data-action="setup-skip"]');
  await page.waitForSelector('.stage-btn[aria-pressed="true"]');
  assert.equal(await page.getAttribute('.stage-btn[aria-pressed="true"]', "data-id"), "progress");

  const fresh = await launch({ asPerson: true });
  t.after(() => fresh.close());
  const guide = await fresh.newPage();
  await guide.setViewportSize({ width: 1280, height: 900 });
  await guide.goto(BASE + "index.html#guide=kb-company-terms");
  await guide.waitForSelector(".setup-body");
  await guide.click('[data-action="setup-skip"]');
  await guide.waitForSelector(".modal-head h2");
  assert.match(await guide.textContent(".modal-head h2"), /Terms/);
  assert.equal(new URL(guide.url()).hash, "");
});

test("Astra Lite: starred quick lines copy in one click, and any line is found by typing", async (t) => {
  const ctx = await launch();
  t.after(() => ctx.close());
  const page = await popup(ctx);
  const first = page.locator("[data-line]").first();
  const text = await first.locator("b").textContent();
  await first.click();
  assert.equal(await clip(page), text);

  await find(page, "scheduled to close at 5pm");
  assert.equal(await page.textContent("#opt-0 .lite-type"), "Line");
  await page.keyboard.press("Enter");
  assert.equal(
    await clip(page),
    "As we have not received a response, this ticket is now scheduled to close at 5pm today.",
  );

  /* A line needing a detail Astra cannot know asks for just that. */
  await find(page, "raised ticket");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".lite-panel");
  assert.deepEqual(await page.$$eval("[data-v]", (els) => els.map((e) => e.dataset.v)), ["ticket"]);
  await page.fill('[data-v="ticket"]', "INC-48213");
  await page.click("#liteCopy");
  assert.match(await clip(page), /I've raised ticket INC-48213 for this/);
  assert.deepEqual(page.errors, []);
});

test("Zoho Desk shortcuts: on in Settings registers the script for Zoho's pages only; off removes it and its data", async (t) => {
  const ctx = await launch();
  t.after(() => ctx.close());
  const sw = await worker(ctx);
  /* The browser's permission prompt cannot be answered in a test, so it stands in as granted. */
  await sw.evaluate(() => (chrome.permissions.contains = async () => true));
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    chrome.permissions.request = async () => true;
    chrome.permissions.remove = async () => true;
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(BASE + "index.html");
  await page.click('.nav-btn:text-is("Settings")');
  const toggle = '[data-action="zoho-shortcuts"]';
  assert.equal(await page.getAttribute(toggle, "aria-checked"), "false", "off unless switched on");
  await page.click(toggle);
  await page.waitForFunction(
    (s) => document.querySelector(s).getAttribute("aria-checked") === "true",
    toggle,
  );
  const scripts = await sw.evaluate(() => chrome.scripting.getRegisteredContentScripts());
  assert.deepEqual(
    scripts.map((x) => [x.id, x.matches.toSorted(), x.js, x.allFrames]),
    [
      [
        "astra-shortcuts",
        ["https://*.zoho.com/*", "https://*.zoho.eu/*"],
        ["js/expand.js", "js/expand-content.js"],
        true,
      ],
    ],
  );
  const shared = (await sw.evaluate(() => chrome.storage.local.get("astra.shortcuts")))["astra.shortcuts"];
  assert.match(shared.lines[";close5"], /close at 5pm today/);
  assert.match(shared.values.today, /\d{4}$/, "today's date fills in");
  await page.click(toggle);
  await page.waitForFunction(
    (s) => document.querySelector(s).getAttribute("aria-checked") === "false",
    toggle,
  );
  assert.deepEqual(await sw.evaluate(() => chrome.scripting.getRegisteredContentScripts()), []);
  assert.deepEqual(await sw.evaluate(() => chrome.storage.local.get("astra.shortcuts")), {});
});
