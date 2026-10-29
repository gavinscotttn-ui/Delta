import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { chromium } from "playwright";

const URL_ = pathToFileURL(resolve("index.html")).href;
const KEY = "astra.offline.fresh.v1";
let browser;

before(async () => {
  browser = await chromium.launch();
});
after(async () => browser.close());

/** Fresh page with clipboard access, error capture and a record of every request. */
async function open(seed) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.requests = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && page.errors.push(m.text()));
  page.on("request", (r) => page.requests.push(r.url()));
  if (seed)
    await page.addInitScript(
      ([k, v]) =>
        !sessionStorage.getItem("seeded") &&
        (localStorage.setItem(k, v), sessionStorage.setItem("seeded", "1")),
      [KEY, JSON.stringify(seed)],
    );
  await page.goto(URL_);
  return page;
}
const state = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
const nav = (page, name) => page.click(`.nav-btn:text-is("${name}")`);

test("loads with built-in content, no errors and no network requests", async () => {
  const page = await open();
  assert.deepEqual(page.errors, []);
  assert.ok(
    page.requests.every((u) => u.startsWith("file:")),
    "unexpected request: " + page.requests.filter((u) => !u.startsWith("file:")),
  );
  await nav(page, "Templates");
  await page.click('[data-action="template-tab"][data-id="templates"]');
  assert.equal(await page.locator("#itemList .item-row").count(), 18);
  await nav(page, "Workflows");
  assert.equal(await page.locator("#itemList .item-row").count(), 23);
  await nav(page, "Knowledge");
  assert.equal(await page.locator("#itemList .item-row").count(), 111);
});

test("template fill: dollar patterns in names are kept literally, copy is logged", async () => {
  const page = await open();
  await page.click('#app [data-action="use-template"][data-id="reboot"]');
  await page.fill('[data-fill="contact"]', "Ca$&h $1 Ltd");
  const preview = await page.inputValue("#templatePreview");
  assert.match(preview, /^Hi Ca\$&h \$1 Ltd,/);
  await page.click("#copyBuilt");
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), preview);
  const s = await state(page);
  assert.equal(s.activity[0].title, "Router restart");
  assert.equal(s.templates.find((t) => t.id === "reboot").useCount, 1);
});

test("copy is blocked and fields highlighted while details are missing", async () => {
  const page = await open();
  await page.click('#app [data-action="use-template"][data-id="install"]');
  await page.click("#copyBuilt");
  assert.ok((await page.locator(".invalid").count()) >= 3);
  assert.equal((await state(page))?.activity?.length ?? 0, 0);
});

test("create, edit, pin and delete a template", async () => {
  const page = await open();
  await nav(page, "Templates");
  await page.click('[data-action="template-tab"][data-id="templates"]');
  await page.click('[data-action="new-template"]');
  assert.equal(await page.inputValue("#tTitle"), "");
  await page.fill("#tTitle", "Test <b>one</b>");
  await page.fill("#tCategory", "Zzz");
  await page.fill("#tBody", "Hello {customer}");
  await page.click("#editForm .primary-btn");
  assert.equal(
    await page.locator("#itemList .item-row h3", { hasText: "Test <b>one</b>" }).count(),
    1,
    "title is escaped, not parsed as HTML",
  );
  await page.fill("#filterInput", "zzz");
  assert.equal(await page.locator("#itemList .item-row").count(), 1);
  await page.click('#itemList [data-action="toggle-pin"]');
  assert.equal((await state(page)).templates[0].favourite, true);
  await page.click('#itemList [data-action="edit-template"]');
  page.once("dialog", (d) => d.accept());
  await page.click("#deleteItem");
  assert.equal(await page.locator("#itemList .item-row").count(), 0);
});

test("workflow run produces a run note", async () => {
  const page = await open();
  await page.click('#app [data-action="run-workflow"][data-id="wf-offline"]');
  await page.locator('[data-step="0"]').check();
  await page.locator('[data-step="1"]').check();
  assert.match(await page.textContent(".modal-head p"), /^2 of 7 complete/);
  await page.fill("#workflowNote", "Ref ABC123");
  await page.click("#copyWorkflow");
  const note = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(
    note,
    /^Broadband completely offline\n\[x\] Confirm whether every device is affected\n\[x\] Check power/,
  );
  assert.match(note, /\[ \] Restart the router/);
  assert.ok(note.endsWith("Ref ABC123"));
});

test("global search via keyboard shortcut", async () => {
  const page = await open();
  await page.keyboard.press("Control+k");
  await page.fill("#globalSearchInput", "supplier escalation");
  await page.waitForSelector("#globalResults .result-row >> nth=1");
  await page.click("#globalResults .result-row");
  assert.ok(await page.locator(".modal-head h2").isVisible());
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#modalLayer.open").count(), 0);
});

test("toolkit: dates and UK phone formats", async () => {
  const page = await open();
  await nav(page, "Toolkit");
  await page.fill("#dateStart", "2026-10-08");
  await page.fill("#dateDays", "3");
  await page.click('[data-id="date"]');
  assert.equal(await page.textContent("#dateResult"), "Tuesday 13 October 2026");
  await page.fill("#betweenA", "2026-10-01");
  await page.fill("#betweenB", "2026-10-08");
  await page.click('[data-id="between"]');
  assert.equal(await page.textContent("#betweenResult"), "7 calendar days · 5 weekdays");
  /* Number lookup: type, place and formatting come from libphonenumber's UK data. */
  const cases = [
    ["0141 404 5441", /^0141 404 5441\nLandline · Glasgow\nInternational: \+44 141 404 5441$/],
    ["+44 (0)20 7946 0000", /^020 7946 0000\nLandline · London/],
    ["07400123456", /^07400 123456\nMobile\nRange given to Three\. Numbers can move network/],
    ["0300 123 4567", /^0300 123 4567\nUK-wide number \(03\)/],
    ["0800 123 4567", /^0800 123 4567\nFreephone \(080\)/],
    ["07700 900123", /^07700 900123\nNot a valid UK number/],
    ["07624 412345", /Mobile \(Isle of Man\)\nRange given to Manx Telecom/],
    ["Langholm", /^013873 {2}Langholm$/],
  ];
  for (const [input, want] of cases) {
    await page.fill("#phoneInput", input);
    await page.click('[data-id="phone"]');
    assert.match(await page.textContent("#phoneResult"), want, input);
  }
  await page.fill("#phoneInput", "+441414045441");
  await page.click('[data-id="phone"]');
  await page.click('[data-id="copy-phone"]');
});

test("backup round trip, and bad files are rejected without damage", async () => {
  const page = await open();
  await nav(page, "Settings");
  const [download] = await Promise.all([page.waitForEvent("download"), page.click('[data-action="export"]')]);
  const path = await download.path();
  const { readFileSync, writeFileSync } = await import("node:fs");
  const backup = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(backup.templates.length, 18);

  writeFileSync("/tmp/astra-bad.json", JSON.stringify({ templates: [{ title: 1 }], shortcuts: "no" }));
  await page.setInputFiles("#importFile", "/tmp/astra-bad.json");
  await page.waitForFunction(() =>
    /not a valid Astra backup/.test(document.querySelector("#toast").textContent),
  );

  backup.templates = [{ id: "x", title: "Only one", category: "C", body: "b" }, null, 5];
  backup.workflows = [{ id: "w", title: "Broken workflow" }];
  writeFileSync("/tmp/astra-ok.json", JSON.stringify(backup));
  await page.setInputFiles("#importFile", "/tmp/astra-ok.json");
  await nav(page, "Workflows");
  assert.ok(
    await page.locator("#itemList .item-row", { hasText: "Broken workflow" }).count(),
    "malformed workflow is tolerated",
  );
  await nav(page, "Templates");
  assert.deepEqual(page.errors, []);
});

test("existing workspaces gain new built-in items once, and deletions stay deleted", async () => {
  const fresh = await open();
  await nav(fresh, "Settings");
  await fresh.click('[data-action="save-profile"]');
  const base = await state(fresh);
  assert.ok(base.seenSeed.includes("templates:install"));

  /* A workspace from before seed tracking: no seenSeed, one template deleted by the user. */
  const legacy = { ...base, templates: base.templates.filter((t) => t.id !== "install") };
  delete legacy.seenSeed;
  const a = await open(legacy);
  await nav(a, "Templates");
  await a.click('[data-action="template-tab"][data-id="templates"]');
  assert.equal(await a.locator("#itemList .item-row").count(), 17, "deleted built-in is not resurrected");

  /* A tracked workspace that has not yet seen one built-in: it is added exactly once. */
  const tracked = {
    ...base,
    templates: base.templates.filter((t) => t.id !== "divert"),
    seenSeed: base.seenSeed.filter((k) => k !== "templates:divert"),
  };
  const b = await open(tracked);
  await nav(b, "Templates");
  await b.click('[data-action="template-tab"][data-id="templates"]');
  assert.equal(await b.locator("#itemList .item-row").count(), 18);
});

test("shortcut validation, and nothing about customers is stored", async () => {
  const page = await open();
  await nav(page, "Settings");
  await page.click('[data-action="add-shortcut"]');
  await page.locator('[data-s-field="url"]').last().fill("http://insecure.example");
  await page.click('[data-action="save-shortcuts"]');
  assert.match(await page.textContent("#toast"), /https/);
  await page.locator('[data-s-field="url"]').last().fill("https://ok.example");
  await page.click('[data-action="save-shortcuts"]');
  assert.match(await page.textContent("#toast"), /Shortcuts saved/);

  const stored = await state(page);
  assert.equal(stored.cases, undefined);
  assert.equal(stored.currentCase, undefined);
});

test("privacy screen covers and releases the page", async () => {
  const page = await open();
  await page.click('[data-action="lock"]');
  assert.ok(await page.locator("#privacyScreen.show").isVisible());
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#privacyScreen.show").count(), 0);
});

test("narrow screens: menu button opens the sidebar", async () => {
  const page = await open();
  await page.setViewportSize({ width: 390, height: 800 });
  await page.click(".mobile-menu");
  assert.ok(await page.locator("#sidebar.open").count());
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 391, "no horizontal scroll");
});

test("fault finder opens a guide with sources, and codes copy on click", async () => {
  const page = await open();
  await nav(page, "Knowledge");
  assert.ok((await page.locator(".fault-finder button").count()) >= 10);
  assert.equal(
    await page.locator(".fault-finder button:visible").count(),
    9,
    "the commonest eight, and More",
  );
  await page.click(".ff-toggle");
  assert.equal(await page.getAttribute(".ff-toggle", "aria-expanded"), "true");
  await page.click('.fault-finder button:text-is("Reprovision a Yealink")');
  assert.match(await page.textContent(".modal-head h2"), /reprovision a handset/i);
  assert.equal(
    await page.evaluate(() => document.querySelector(".modal").scrollTop),
    0,
    "guide opens at the top",
  );
  const code = page.locator(".kb-body code.copyable", { hasText: "Yealink_W73P" }).first();
  await code.click();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    "http://xsp.unlimitedhorizon.co.uk/dms/Yealink_W73P",
  );
  const href = await page.getAttribute(".kb-links a", "href");
  assert.match(href, /^library\/yealink\/.*\.pdf(#page=\d+)?$/);
  assert.ok(
    (await page.locator(".kb-links .small-btn").count()) >= 3,
    "sources and related guides are linked",
  );
  await page.click('.kb-links [data-action="view-knowledge"]');
  assert.ok(await page.locator(".modal-head h2").isVisible(), "related guide opens");
  assert.deepEqual(page.errors, []);
});

test("knowledge search also surfaces pages inside the documents", async () => {
  const page = await open();
  await nav(page, "Knowledge");
  await page.fill("#filterInput", "ttl 3720");
  assert.ok((await page.locator("#itemList .item-row").count()) >= 1, "guide found");
  assert.match(await page.textContent("#extraList"), /Also in the library/);
  assert.ok((await page.locator('#extraList a[href*="Voxone%20Firewall"]').count()) >= 1);
});

test("library lists every document with open and download links", async () => {
  const page = await open();
  await nav(page, "Library");
  assert.equal(await page.locator("#libraryList .item-row").count(), 77);
  const first = page.locator("#libraryList .item-row").first();
  assert.match(
    await first.locator('a:text-is("Open")').getAttribute("href"),
    /^library\/horizon\/Horizon%20Administrator/,
  );
  assert.ok(await first.locator("a[download]").count());
  assert.ok(
    (await page.locator('#libraryList a[download$=".docx"]').count()) >= 10,
    "Word originals are downloadable",
  );
  await page.click('.chip:text-is("Voxone")');
  assert.equal(
    await page.locator("#libraryList .item-row").count(),
    6,
    "three guides and VOIP Unlimited's help articles",
  );
  /* the download link really delivers the file */
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#libraryList a[download$='.pdf']").first().click(),
  ]);
  assert.match(download.suggestedFilename(), /\.pdf$/);
  const { statSync } = await import("node:fs");
  assert.ok(statSync(await download.path()).size > 10000);
});

test("library search finds pages inside documents and links to the page", async () => {
  const page = await open();
  await nav(page, "Library");
  await page.fill("#filterInput", "registration mode base pin");
  /* the document text loads just after the page opens */
  await page.waitForFunction(() =>
    /Inside the documents/.test(document.getElementById("libraryList").textContent),
  );
  const hit = page
    .locator("#libraryList .doc-row", { hasText: "Yealink W73P User Guide" })
    .locator('a[href*="#page="]')
    .first();
  assert.match(await hit.getAttribute("href"), /#page=\d+$/);
  assert.ok((await page.locator("#libraryList mark").count()) >= 1, "matches are highlighted");
  await page.fill("#filterInput", "qqqzzzxxx");
  assert.match(await page.textContent("#libraryList"), /Nothing found/);
});

test("global search covers documents, and workflows link to their guide", async () => {
  const page = await open();
  await page.keyboard.press("Control+k");
  await page.fill("#globalSearchInput", "sip alg");
  /* Results appear on the next frame, and document pages once the page text has loaded. */
  await page.waitForFunction(() => /Doc|Page/.test(document.querySelector("#globalResults").textContent));
  const text = await page.textContent("#globalResults");
  assert.match(text, /Fault|Guide/);
  assert.match(text, /Doc|Page/);
  await page.keyboard.press("Escape");
  await nav(page, "Workflows");
  await page.click('#itemList [data-action="run-workflow"][data-id="wf-sip-alg-check"]');
  await page.click('.modal-foot [data-action="view-knowledge"]');
  assert.match(await page.textContent(".modal-head h2"), /SIP ALG/);
});

test("a workspace saved before the knowledge base existed receives the new guides, and keeps its own", async () => {
  const fresh = await open();
  await nav(fresh, "Settings");
  await fresh.click('[data-action="save-profile"]');
  const base = await state(fresh);
  /* Codex's original file: no seenSeed, only the first-release content, one guide deleted, one edited. */
  const first = base.knowledge.filter((k) => !k.rich && !k.id.startsWith("kb-"));
  assert.equal(first.length, 10);
  const legacy = {
    ...base,
    knowledge: first
      .filter((k) => k.id !== "k-close")
      .map((k) => (k.id === "k-slow" ? { ...k, title: "My slow broadband notes" } : k)),
    workflows: base.workflows.filter(
      (w) =>
        !w.id.startsWith("wf-") ||
        ["wf-offline", "wf-slow", "wf-intermittent", "wf-voice", "wf-install", "wf-escalate"].includes(w.id),
    ),
  };
  delete legacy.seenSeed;
  const page = await open(legacy);
  await nav(page, "Knowledge");
  assert.equal(
    await page.locator("#itemList .item-row").count(),
    9 + 101,
    "new guides added; deleted guide not resurrected",
  );
  assert.equal(
    await page.locator("#itemList .item-row h3", { hasText: "My slow broadband notes" }).count(),
    1,
    "edited guide kept",
  );
  await nav(page, "Workflows");
  assert.equal(await page.locator("#itemList .item-row").count(), 23);
});
