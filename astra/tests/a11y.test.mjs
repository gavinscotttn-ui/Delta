import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const axeSource = readFileSync("node_modules/axe-core/axe.min.js", "utf8");
let browser, page;

before(async () => {
  browser = await chromium.launch();
  page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await page.goto(pathToFileURL(resolve("index.html")).href);
  await page.evaluate(axeSource);
});
after(async () => browser.close());

async function violations(options) {
  return page.evaluate(async (o) => {
    const r = await axe.run(document, { resultTypes: ["violations"], ...o });
    return r.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0].target.join(" ")}`);
  }, options);
}

for (const name of ["Replies", "Templates", "Workflows", "Knowledge", "Library", "Toolkit", "Settings"]) {
  test(`${name} page has no accessibility violations`, async () => {
    await page.click(`.nav-btn:text-is("${name}")`);
    assert.deepEqual(await violations(), []);
  });
}

test("Home has no accessibility violations (heading order is inherited from the original layout)", async () => {
  await page.click('.nav-btn:text-is("Home")');
  assert.deepEqual(await violations({ rules: { "heading-order": { enabled: false } } }), []);
});

test("an open guide and library search results have no accessibility violations", async () => {
  await page.click('.nav-btn:text-is("Knowledge")');
  await page.click(".fault-finder button >> nth=0");
  assert.deepEqual(await violations(), []);
  await page.keyboard.press("Escape");
  await page.click('.nav-btn:text-is("Library")');
  await page.fill("#filterInput", "sip alg");
  assert.deepEqual(await violations(), []);
});

test("Triage results, the request forms, the LOA form and Ask answers have no accessibility violations", async () => {
  await page.click('.nav-btn:text-is("Triage")');
  await page.fill(
    "#triageInput",
    "Hi,\n\nWe'd like to port our numbers over from BT: 01632 960456. We're also getting a new phone system.\n\nKind regards,\nPriya Shah\nHarbourview Vets Ltd",
  );
  await page.keyboard.press("Control+Enter");
  await page.waitForSelector(".triage-grid");
  assert.deepEqual(await violations(), []);
  await page.click('.triage-grid [data-action="fill-loa"]');
  await page.waitForSelector("#loaProvider");
  assert.deepEqual(await violations(), []);
  await page.keyboard.press("Escape");
  await page.click('.nav-btn:text-is("Ask")');
  await page.fill("#askInput", "gamma broadband order option");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".ask-turn, .ask-answer, .quick-table, table");
  assert.deepEqual(await violations(), []);
});

test("the phone-sized layout has no accessibility violations, with the menu closed or open", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('[data-action="menu"]');
  await page.click('.nav-btn:text-is("Home")');
  assert.deepEqual(await violations({ rules: { "heading-order": { enabled: false } } }), []);
  await page.click('[data-action="menu"]');
  assert.deepEqual(await violations({ rules: { "heading-order": { enabled: false } } }), []);
  await page.setViewportSize({ width: 1280, height: 900 });
});
