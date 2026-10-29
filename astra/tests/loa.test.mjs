import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

/* Made-up customer details; phone numbers are from Ofcom's ranges reserved for fiction. */
const TEMPLATE = resolve("library/company/Customer Letter of Authority (LOA).docx");
let browser;
before(async () => (browser = await chromium.launch()));
after(async () => browser.close());

/* Reads a .docx with Python's zipfile (a separate implementation from Astra's), returning every part. */
function readDocx(path) {
  const out = execFileSync(
    "python3",
    [
      "-I",
      "-c",
      `import zipfile,json,sys,base64,xml.dom.minidom as m
z=zipfile.ZipFile(sys.argv[1]); parts={}
for n in z.namelist():
    d=z.read(n)
    if n.endswith('.xml') or n.endswith('.rels'): m.parseString(d)  # every XML part must be well formed
    parts[n]=base64.b64encode(d).decode()
print(json.dumps(parts))`,
      path,
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  return Object.fromEntries(Object.entries(JSON.parse(out)).map(([k, v]) => [k, Buffer.from(v, "base64")]));
}
const cellText = (xml) =>
  [...xml.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((r) =>
    [...r[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((c) =>
      [...c[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(" "),
    ),
  );

async function open() {
  const ctx = await browser.newContext({
    acceptDownloads: true,
    permissions: ["clipboard-read", "clipboard-write"],
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(pathToFileURL(resolve("index.html")).href);
  return page;
}

test("the LOA filler produces a valid Word file with every value in the right cell", async () => {
  const page = await open();
  await page.click('.nav-btn:text-is("Toolkit")');
  await page.click('[data-action="fill-loa"]');
  await page.fill("#loaCompany", "Harbour Lane Surgery Ltd");
  await page.selectOption("#loaProvider", "voip-unlimited");
  assert.equal(await page.inputValue("#loaCurrentEmail"), "provisioning@voip-unlimited.net");
  await page.fill("#loaBuilding", "Unit 4, Harbour Court");
  await page.fill("#loaStreet", "12 Harbour Lane");
  await page.fill("#loaTown", "Glasgow");
  await page.fill("#loaPostcode", "g2 4ab");
  await page.fill("#loaNumbers", "01632960123\n0141 496 0000\n12345");
  assert.match(await page.textContent("#loaNumberCheck"), /3 numbers\. Check: 12345/);
  await page.fill("#loaNumbers", "01632960123\n0141 496 0000");
  await page.fill("#loaRegNo", "SC123456");
  await page.fill("#loaRequester", "Sarah Jones");
  await page.fill("#loaDate", "2026-06-18");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#loaDownload")]);
  assert.equal(dl.suggestedFilename(), "LOA - Harbour Lane Surgery Ltd.docx");
  const dir = mkdtempSync(join(tmpdir(), "astra-loa-"));
  const out = join(dir, "loa.docx");
  await dl.saveAs(out);

  const filled = readDocx(out);
  const original = readDocx(TEMPLATE);
  assert.deepEqual(Object.keys(filled), Object.keys(original), "same parts, same order");
  for (const name of Object.keys(original))
    if (name !== "word/document.xml") assert.ok(filled[name].equals(original[name]), `${name} is unchanged`);

  const xml = filled["word/document.xml"].toString("utf8");
  for (const placeholder of [
    "RANGE HOLDER NAME",
    "CUSTOMER ADDRESS HERE",
    "LIST ALL NUMBERS",
    "COMPANY REG NUMBER",
    "Example:",
  ])
    assert.ok(!xml.includes(placeholder), `placeholder gone: ${placeholder}`);
  const rows = cellText(xml);
  const row = (label, n = 0) => rows.filter((r) => r[0] && r[0].replace(/\s+/g, " ").startsWith(label))[n];
  assert.equal(row("Name")[1], "VOIP Unlimited");
  assert.equal(row("Name")[3], "Gamma", "the new retailer is untouched");
  assert.equal(row("Address:")[1], "6 Albany Business Park, Cabot Lane, Poole, BH17 7BX");
  assert.equal(row("Building")[1], "Unit 4, Harbour Court");
  assert.equal(row("Street Name")[1], "12 Harbour Lane", "each value beside its own label");
  assert.equal(row("Post Code")[1], "G2 4AB");
  assert.match(row("Building")[2], /01632 960123.*0141 496 0000/, "numbers formatted, one per line");
  assert.equal(row("Company Name")[1], "Harbour Lane Surgery Ltd");
  assert.equal(
    row("Billing Address")[1],
    "Unit 4, Harbour Court, 12 Harbour Lane",
    "billing address same as site",
  );
  assert.equal(row("Company Registration")[1], "SC123456");
  assert.equal(row("Print Name")[1], "Sarah Jones");
  assert.equal(row("Print Name", 1)[1], "Sarah Jones", "page 2 too");
  assert.equal(row("Date")[1], "18/06/2026");
  assert.deepEqual([row("Page Number")[1], row("Page Number")[3]], ["1", "2"]);
  assert.deepEqual([row("Page Number", 1)[1], row("Page Number", 1)[3]], ["2", "2"]);
  assert.equal(row("Customer Company Name")[1], "Harbour Lane Surgery Ltd");
  assert.deepEqual(page.errors, []);
});

test("numbers beyond page 1 go on the continuation sheet, beside the site address", async () => {
  const page = await open();
  await page.click('.nav-btn:text-is("Toolkit")');
  await page.click('[data-action="fill-loa"]');
  await page.fill("#loaCompany", "Harbour Lane Surgery Ltd");
  await page.fill("#loaBuilding", "Unit 4");
  await page.fill("#loaStreet", "12 Harbour Lane");
  await page.fill("#loaTown", "Glasgow");
  await page.fill("#loaPostcode", "G2 4AB");
  const numbers = Array.from({ length: 13 }, (_, i) => `01632 9601${String(i).padStart(2, "0")}`);
  await page.fill("#loaNumbers", numbers.join("\n"));
  assert.match(
    await page.textContent("#loaNumberCheck"),
    /first 6 go on page 1, the rest on the continuation sheet/,
  );
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#loaDownload")]);
  const out = join(mkdtempSync(join(tmpdir(), "astra-loa-")), "loa.docx");
  await dl.saveAs(out);
  const rows = cellText(readDocx(out)["word/document.xml"].toString("utf8"));
  const page1 = rows.find((r) => r[0]?.startsWith("Building"))[2];
  assert.equal(page1, numbers.slice(0, 6).join(" "));
  const at = rows.findIndex((r) => r[0]?.startsWith("Site Address(es)"));
  const site = "Unit 4, 12 Harbour Lane, Glasgow, G2 4AB";
  assert.deepEqual(rows[at + 1], [site, numbers.slice(6, 11).join(" ")]);
  assert.deepEqual(rows[at + 2], [site, numbers.slice(11).join(" ")]);
  assert.deepEqual(rows[at + 3], ["", ""], "unused boxes stay blank");
  assert.deepEqual(page.errors, []);
});

test("the LOA needs a company name, and Copy email fills the customer's name", async () => {
  const page = await open();
  await page.click('.nav-btn:text-is("Toolkit")');
  await page.click('[data-action="fill-loa"]');
  await page.click("#loaDownload");
  assert.match(await page.textContent("#toast"), /Enter the company name/);
  await page.keyboard.press("Escape");
  /* The CRF email asks for the contact's name, as nothing is kept about customers. */
  await page.click('[data-action="form-email"][data-id="crf-request"]');
  await page.fill('[data-fill="contact"]', "Harbour Lane Surgery Ltd");
  await page.click("#copyBuilt");
  const email = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(
    email,
    /^Hi Harbour Lane Surgery Ltd,\n\nI hope you’re doing well\.\n\nWhen you get a moment, could you fill out the attached CRF/,
  );
});

test("the CRF and blank LOA download, and the CRF carries no personal details", async () => {
  const page = await open();
  await page.click('.nav-btn:text-is("Toolkit")');
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("text=Download CRF")]);
  assert.equal(dl.suggestedFilename(), "Customer Requirement Form (CRF).xlsx");
  const dir = mkdtempSync(join(tmpdir(), "astra-crf-"));
  const out = join(dir, "crf.xlsx");
  await dl.saveAs(out);
  const parts = readDocx(out);
  const all = Object.entries(parts)
    .filter(([n]) => /\.(xml|vml)$/.test(n))
    .map(([, b]) => b.toString("utf8"))
    .join(" ");
  for (const s of ["Hammond", "7973563167", "1702461199"]) assert.ok(!all.includes(s), `no ${s}`);
  assert.ok(all.includes("Staff users first and last name"), "the form itself is intact");
});

test("Ctrl K offers the LOA filler", async () => {
  const page = await open();
  await page.keyboard.press("Control+k");
  await page.fill("#globalSearchInput", "loa");
  await page.click('#globalResults [data-action="fill-loa"]');
  await page.waitForSelector("#loaCompany");
  assert.match(await page.textContent("#modal h2"), /Letter of authority/);
});

test("control characters pasted from elsewhere are dropped, so the LOA always opens in Word", async () => {
  const page = await open();
  await page.addScriptTag({ url: "js/forms/loa-template.js" });
  const bytes = await page.evaluate(async () => {
    const blob = await AstraLOA.build({
      company: "Harbour\u0007 Lane\u000b Surgery\u0000 Ltd￾",
      currentName: "Old\u001b Provider \uD800",
      numbers: ["01632\u0008 960000"],
      requesterName: "Alex\u000c Example",
    });
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  const file = join(mkdtempSync(join(tmpdir(), "astra-loa-")), "LOA.docx");
  writeFileSync(file, Buffer.from(bytes));
  const xml = readDocx(file)["word/document.xml"].toString("utf8");
  const cells = cellText(xml).flat().join("|");
  assert.match(cells, /Harbour Lane Surgery Ltd/);
  assert.match(cells, /Old Provider/);
  assert.match(cells, /01632 960000/);
  assert.match(cells, /Alex Example/);
  assert.ok(!/[\x00-\x08\x0b\x0c\x0e-\x1f￾]/.test(xml), "no character Word cannot read");
  assert.deepEqual(page.errors, []);
});
