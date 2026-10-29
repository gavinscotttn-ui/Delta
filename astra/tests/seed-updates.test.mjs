import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import vm from "node:vm";
import { chromium } from "playwright";
import { collect } from "../tools/seed-history.mjs";

const KEY = "astra.offline.fresh.v1";
const URL_ = pathToFileURL(resolve("index.html")).href;
const BEFORE = "70b924e"; /* a commit whose built-in guides carried notes that have since been removed */

/* The built-in items as they were at a past commit. */
function seedAt(commit) {
  const git = (...a) => execFileSync("git", a, { encoding: "utf8" });
  const html = git("show", `${commit}:index.html`);
  const sandbox = { structuredClone, URL };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const [, f] of html.matchAll(/<script src="(js\/seed\/[^"]+)"/g))
    vm.runInContext(git("show", `${commit}:${f}`), sandbox);
  return JSON.parse(JSON.stringify(sandbox.AstraSeed));
}

let browser;
before(async () => (browser = await chromium.launch()));
after(async () => browser.close());

async function openWith(workspace) {
  const page = await browser.newPage();
  await page.addInitScript(
    ([k, v]) =>
      !sessionStorage.getItem("s") && (localStorage.setItem(k, v), sessionStorage.setItem("s", "1")),
    [KEY, JSON.stringify(workspace)],
  );
  await page.goto(URL_);
  return page;
}

test("unedited built-ins take the new wording; edited ones and personal fields are kept; retired ones go", async () => {
  const old = seedAt(BEFORE);
  const shortcodes = old.knowledge.find((k) => k.id === "kb-horizon-shortcodes");
  assert.match(shortcodes.body, /prints `\*78` for activate/, "the old version had the note");
  const editedYealink = { ...old.knowledge.find((k) => k.id === "kb-yealink-desk-basics") };
  editedYealink.body += "\nMy own note.";
  const retired = old.knowledge.find((k) => k.id === "kb-gamma-official-guides");
  const template = { ...old.templates[0], favourite: true, useCount: 12 };
  const workspace = {
    version: 2,
    templates: [template, ...old.templates.slice(1)],
    workflows: old.workflows,
    knowledge: old.knowledge.map((k) => (k.id === editedYealink.id ? editedYealink : k)),
    shortcuts: old.shortcuts,
    seenSeed: [
      ...["templates", "workflows", "knowledge", "shortcuts"].flatMap((kind) =>
        old[kind].map((i) => `${kind}:${i.id}`),
      ),
    ],
  };
  const page = await openWith(workspace);
  const s = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
  const now = (id) => s.knowledge.find((k) => k.id === id);

  assert.doesNotMatch(now("kb-horizon-shortcodes").body, /prints `\*78`|Click a code/, "note removed");
  assert.match(now("kb-horizon-shortcodes").body, /`\*77`/);
  assert.match(now("kb-yealink-desk-basics").body, /My own note\./, "an edited guide is left alone");
  assert.ok(!now(retired.id), "an untouched retired guide is removed");
  assert.ok(now("kb-gamma-ethernet-down"), "new guides are added");
  const t = s.templates.find((x) => x.id === template.id);
  assert.equal(t.favourite, true);
  assert.equal(t.useCount, 12);
  await page.close();
});

test("an edited retired guide is kept", async () => {
  const old = seedAt(BEFORE);
  const retired = {
    ...old.knowledge.find((k) => k.id === "kb-gamma-official-guides"),
    title: "My Gamma links",
  };
  const page = await openWith({
    version: 2,
    knowledge: [retired],
    seenSeed: [`knowledge:${retired.id}`],
  });
  const s = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
  assert.ok(s.knowledge.some((k) => k.title === "My Gamma links"));
  await page.close();
});

test("js/seed/history.js holds every committed version (run npm run seeds before committing a seed change)", () => {
  const sandbox = { window: { AstraSeed: {} } };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync("js/seed/history.js", "utf8"), sandbox);
  const stored = sandbox.window.AstraSeed.history;
  /* Fingerprints of the working copy are allowed to be missing: they are the current version. */
  const cur = {};
  const s2 = { structuredClone, URL };
  s2.window = s2;
  vm.createContext(s2);
  vm.runInContext(readFileSync("js/seed-fingerprint.js", "utf8"), s2);
  const html = readFileSync("index.html", "utf8");
  for (const [, f] of html.matchAll(/<script src="(js\/seed\/[^"]+)"/g))
    if (!f.endsWith("history.js")) vm.runInContext(readFileSync(f, "utf8"), s2);
  for (const kind of ["templates", "workflows", "knowledge", "shortcuts"])
    for (const item of s2.AstraSeed[kind]) cur[`${kind}:${item.id}`] = s2.AstraFingerprint.of(kind, item);
  const missing = [];
  for (const [key, fps] of Object.entries(collect()))
    for (const fp of fps)
      if (!(stored[key] || []).includes(fp) && cur[key] !== fp) missing.push(`${key} ${fp}`);
  assert.deepEqual(missing, []);
});
