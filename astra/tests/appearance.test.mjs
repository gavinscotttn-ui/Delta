import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const URL_ = pathToFileURL(resolve("index.html")).href;
const axeSource = readFileSync("node_modules/axe-core/axe.min.js", "utf8");
let browser;
before(async () => (browser = await chromium.launch()));
after(async () => browser.close());

async function open(hash = "", options = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...options });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(URL_ + hash);
  return page;
}

test("first-run setup: details, appearance and behaviour, then it never comes back", async () => {
  const page = await open("#setup");
  await page.waitForSelector(".setup-body");
  assert.match(await page.textContent("#modalTitle"), /Your details/);
  await page.fill("#setupName", "Alex Morgan");
  await page.fill("#setupInitials", "");
  await page.click('[data-action="setup-next"]');
  assert.match(await page.textContent("#modalTitle"), /Appearance/);
  await page.click('.theme-choice:has(input[value="light"])');
  assert.equal(await page.getAttribute("html", "data-theme"), "light", "applies straight away");
  await page.click('[data-action="setup-back"]');
  assert.equal(await page.inputValue("#setupName"), "Alex Morgan", "Back keeps what was typed");
  await page.click('[data-action="setup-next"]');
  await page.click('[data-action="setup-next"]');
  assert.match(await page.textContent("#modalTitle"), /How Praxis behaves/);
  await page.check("#setupPrivacy");
  await page.click('[data-action="setup-next"]');
  await page.waitForSelector(".setup-body", { state: "detached" });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("astra.offline.fresh.v1")));
  assert.equal(saved.profile.name, "Alex Morgan");
  assert.equal(saved.profile.initials, "AM", "initials made from the name when left blank");
  assert.equal(saved.settings.privacyOnHide, true);
  assert.equal(saved.settings.setupDone, true);
  await page.reload();
  await page.waitForTimeout(200);
  assert.equal(await page.locator(".setup-body").count(), 0, "not shown again");
  assert.equal(await page.getAttribute("html", "data-theme"), "light", "theme kept");
  assert.deepEqual(page.errors, []);
});

test("closing setup with Escape counts as done; an existing workspace never sees it", async () => {
  const page = await open("#setup");
  await page.waitForSelector(".setup-body");
  await page.keyboard.press("Escape");
  await page.reload();
  await page.waitForTimeout(200);
  assert.equal(await page.locator(".setup-body").count(), 0);

  const existing = await open();
  await existing.evaluate(() =>
    localStorage.setItem(
      "astra.offline.fresh.v1",
      JSON.stringify({ templates: [], shortcuts: [], settings: { privacyOnHide: false } }),
    ),
  );
  await existing.goto(URL_ + "#setup");
  await existing.waitForTimeout(200);
  assert.equal(await existing.locator(".setup-body").count(), 0, "set up before setup existed");
});

test("the theme is applied before the page draws, follows the computer, and is in backups", async () => {
  const page = await open("", { colorScheme: "light" });
  assert.equal(await page.getAttribute("html", "data-theme"), "light", "Match this computer: light");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark", null, {
    timeout: 2000,
  });
  await page.click('.nav-btn:text-is("Settings")');
  await page.click('.theme-choice:has(input[value="contrast"])');
  await page.check('input[name="setText"][value="large"]');
  /* theme.js runs in <head>, before the body exists, so the first paint already has the right colours. */
  const html = readFileSync("index.html", "utf8");
  assert.ok(html.indexOf('src="js/theme.js"') < html.indexOf("<body>"));
  const second = await page.context().newPage();
  await second.goto(URL_, { waitUntil: "domcontentloaded" });
  const early = await second.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    text: document.documentElement.dataset.text,
  }));
  assert.deepEqual(early, { theme: "contrast", text: "large" });
  const backup = await page.evaluate(() => {
    let data;
    const realCreate = URL.createObjectURL;
    URL.createObjectURL = (blob) => {
      data = blob;
      return realCreate(blob);
    };
    document.querySelector('[data-action="export"]').click();
    return data.text();
  });
  assert.deepEqual(JSON.parse(backup).appearance, { theme: "contrast", textSize: "large" });
  assert.deepEqual(page.errors, []);
});

for (const theme of ["light", "contrast", "dark"])
  test(`the ${theme} theme passes the accessibility checks, colour contrast included`, async () => {
    const page = await open();
    await page.evaluate((t) => AstraTheme.set({ theme: t }), theme);
    await page.evaluate(axeSource);
    const problems = [];
    for (const name of [
      "Home",
      "Triage",
      "Replies",
      "Ask",
      "Templates",
      "Knowledge",
      "Toolkit",
      "Settings",
    ]) {
      await page.click(`.nav-btn:text-is("${name}")`);
      if (name === "Ask") {
        await page.fill("#askInput", "gamma broadband order option");
        await page.keyboard.press("Enter");
        await page.waitForTimeout(300);
      }
      const v = await page.evaluate(async () => {
        const r = await axe.run(document, {
          resultTypes: ["violations"],
          rules: { "heading-order": { enabled: false } },
        });
        return r.violations.map(
          (x) =>
            `${x.id}: ${x.nodes
              .map((n) => n.target.join(" "))
              .slice(0, 3)
              .join(", ")}`,
        );
      });
      problems.push(...v.map((x) => `${name} · ${x}`));
    }
    assert.deepEqual(problems, []);
  });
