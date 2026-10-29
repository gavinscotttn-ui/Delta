import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { chromium } from "playwright";

/* Made-up details throughout; phone numbers are from Ofcom's ranges reserved for fiction. */
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

test("nothing says Offline: no label in the sidebar or the title", async () => {
  const page = await open();
  assert.equal(await page.title(), "Astra");
  assert.doesNotMatch(await page.textContent(".sidebar"), /offline/i);
  assert.doesNotMatch(await page.textContent(".topbar"), /offline|on this device/i);
});

test("Toolkit: MAC formats, subnet and code lookup update as you type", async () => {
  const page = await open();
  await nav(page, "Toolkit");
  await page.fill("#macInput", "805e.c012.abcd");
  await page.locator("#macResult code", { hasText: "80:5E:C0:12:AB:CD" }).click();
  assert.equal(await clip(page), "80:5E:C0:12:AB:CD");
  await page.fill("#macInput", "12345");
  assert.match(await page.textContent("#macResult"), /Not a MAC address/);
  await page.fill("#ipInput", "10.20.30.40 255.255.252.0");
  const ip = await page.textContent("#ipResult");
  assert.match(ip, /10\.20\.28\.0\/22/);
  assert.match(ip, /1,022 hosts/);
  assert.match(ip, /Private/);
  await page.fill("#codeInput", "486");
  assert.equal(await page.locator("#codeResult tbody tr").count(), 1);
  assert.match(await page.textContent("#codeResult"), /Busy Here/);
  await page.fill("#codeInput", "timeout");
  assert.ok((await page.locator("#codeResult tbody tr").count()) >= 2);
  assert.deepEqual(page.errors, []);
});

test("Ctrl K: a SIP code, a MAC or an IP goes straight to the right tool", async () => {
  const page = await open();
  await page.keyboard.press("Control+k");
  await page.fill("#globalSearchInput", "sip 488");
  const row = page.locator('#globalResults [data-action="open-tool"]').first();
  assert.match(await row.textContent(), /SIP 488 · Not Acceptable Here/);
  await row.click();
  assert.match(await page.textContent("#pageTitle"), /Toolkit/);
  assert.equal(await page.inputValue("#codeInput"), "sip 488");
  assert.match(await page.textContent("#codeResult"), /codec/);
  await page.keyboard.press("Control+k");
  await page.fill("#globalSearchInput", "80-5E-C0-12-AB-CD");
  await page.click('#globalResults [data-action="open-tool"]');
  assert.equal(await page.inputValue("#macInput"), "80-5E-C0-12-AB-CD");
  assert.match(await page.textContent("#macResult"), /805EC012ABCD/);
});

test("Ask answers a cause code from the standard table, and does not log it as a gap", async () => {
  const page = await open();
  await nav(page, "Ask");
  await page.fill("#askInput", "the carrier says cause 34 on outbound calls");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".ask-turn .code-table");
  assert.match(await page.textContent(".ask-turn .code-table"), /No circuit\/channel available/);
  assert.match(await page.textContent(".ask-turn"), /ITU-T Q\.850/);
  const gaps = await page.evaluate(
    () => (JSON.parse(localStorage.getItem("astra.offline.fresh.v1") || "null") || {}).gaps || [],
  );
  assert.deepEqual(gaps, []);
});

test("keyboard: Alt and a number opens a page, ? lists the shortcuts", async () => {
  const page = await open();
  await page.keyboard.press("Alt+2");
  assert.match(await page.textContent("#pageTitle"), /Triage/);
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Alt+9");
  assert.match(await page.textContent("#pageTitle"), /Toolkit/);
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Alt+0");
  assert.match(await page.textContent("#pageTitle"), /Settings/, "Alt 0 is the tenth page");
  await page.locator("h2").first().click();
  await page.keyboard.press("?");
  await page.waitForSelector(".keys-table");
  const keys = await page.textContent(".keys-table");
  assert.match(keys, /Ctrl K.*Search everything/s);
  assert.match(keys, /Alt G.*Gamma portal/s, "portal shortcuts are listed");
  assert.match(keys, /Alt 3.*Replies/s);
  assert.match(keys, /Alt 0.*Settings/s);
});

test("after a triage, templates fill in the contact from that email", async () => {
  const page = await open();
  await nav(page, "Triage");
  await page.fill(
    "#triageInput",
    "Subject: Phones keep dropping calls\n\nHi, our ticket ref is INC-48213. Site is BS1 4DJ.\n\nKind regards,\nSarah Jones\nBrightwater Dental Ltd\nTel: 0117 496 0555",
  );
  await page.keyboard.press("Control+Enter");
  await page.waitForSelector(".triage-grid");
  await nav(page, "Templates");
  await page.click('[data-action="template-tab"][data-id="templates"]');
  await page.fill("#filterInput", "fault raised with supplier");
  await page.locator('#itemList [data-action="use-template"]').first().click();
  assert.equal(await page.inputValue('[data-fill="contact"]'), "Sarah");
  assert.match(await page.inputValue("#templatePreview"), /^Hi Sarah,/);
});

test("company emails fill in: Openreach invite date and slot, RMA order number", async () => {
  const page = await open();
  page.setDefaultTimeout(5000);
  await nav(page, "Templates");
  await page.click('[data-action="template-tab"][data-id="templates"]');
  await page.fill("#filterInput", "openreach");
  await page.locator('#itemList [data-action="use-template"]').first().click();
  if (await page.locator('[data-fill="contact"]').count()) await page.fill('[data-fill="contact"]', "Sam");
  await page.fill('[data-fill="date"]', "2026-06-18");
  await page.selectOption('[data-fill="timeslot"]', { index: 1 });
  const preview = await page.inputValue("#templatePreview");
  assert.match(preview, /on Thursday 18 June 2026, AM 08:00–13:00, to install your new broadband service/);
  assert.match(preview, /£180/);
  await page.click("#copyBuilt");
  assert.match(await clip(page), /^This is a calendar invitation/);

  await nav(page, "Templates");
  await page.click('[data-action="template-tab"][data-id="templates"]');
  await page.fill("#filterInput", "rma raised");
  await page
    .locator("#itemList .item-row", { hasText: "RMA raised: replacement on its way" })
    .locator('[data-action="use-template"]')
    .click();
  await page.fill('[data-fill="contact"]', "Harbour Lane Surgery");
  await page.fill('[data-fill="order_number"]', "SO628426");
  assert.match(
    await page.inputValue("#templatePreview"),
    /^Hi Harbour Lane Surgery,\n\nI have raised SO628426, which will be delivered/,
  );
});

test("Ask answers Gamma menu options and our account numbers from the table", async () => {
  const page = await open();
  await nav(page, "Ask");
  await page.fill("#askInput", "gamma option for webex faults");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".ask-quick");
  assert.match(await page.locator(".ask-quick tbody tr").first().textContent(), /Webex faults.*316/);
  await page.fill("#askInput", "what is our new reseller account number");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelectorAll(".ask-turn").length === 2);
  assert.match(
    await page.locator(".ask-turn").nth(1).locator(".ask-quick tbody tr").first().textContent(),
    /44005215/,
  );
});

test("the page name is shown once: in the top bar only after the page's own heading scrolls away", async () => {
  const page = await open();
  const titleShown = () =>
    page.evaluate(() => document.querySelector("#pageTitle").getBoundingClientRect().width > 1);
  assert.equal(await titleShown(), true, "Home has no page heading, so the top bar names it");
  await nav(page, "Templates");
  assert.equal(await titleShown(), false, "the page heading is on screen");
  assert.equal(await page.textContent("#pageTitle"), "Templates", "screen readers still have the heading");
  await page.mouse.wheel(0, 600);
  await page.waitForFunction(() => document.querySelector(".topbar").classList.contains("titled"));
  assert.equal(await titleShown(), true);
  await page.mouse.wheel(0, -2000);
  await page.waitForFunction(() => !document.querySelector(".topbar").classList.contains("titled"));
  assert.deepEqual(page.errors, []);
});

test("triage results scroll into view below the top bar, not under it", async () => {
  const page = await open();
  await nav(page, "Triage");
  await page.fill(
    "textarea",
    "Hi, our broadband has been down since this morning. Ticket TN-48213. Thanks, Sam Example, Harbour Lane Surgery, 01632 960123",
  );
  await page.keyboard.press("Control+Enter");
  await page.waitForSelector("#triageResults .card, #triageResults section", { state: "attached" });
  await page.waitForFunction(() => scrollY > 0);
  await page.waitForTimeout(400); /* smooth scrolling settles */
  const r = await page.evaluate(() => ({
    top: document.querySelector("#triageResults").getBoundingClientRect().top,
    bar: document.querySelector(".topbar").getBoundingClientRect().bottom,
  }));
  assert.ok(r.top >= r.bar, `results start at ${r.top}px, top bar ends at ${r.bar}px`);
});
