import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { chromium } from "playwright";
import jsQR from "jsqr";

/* QR codes, passwords and PINs, and spelling things out. Every QR code made here is read back by jsQR, a
   separate QR reader, so a code that a phone could not scan fails the test. */

const sandbox = { TextEncoder, Uint32Array, crypto: globalThis.crypto };
sandbox.self = sandbox;
vm.createContext(sandbox);
for (const f of ["js/qr.js", "js/passwords.js", "js/phonetic.js"])
  vm.runInContext(readFileSync(f, "utf8"), sandbox, { filename: f });
const { AstraQR: Q, AstraPasswords: P, AstraPhonetic: S } = sandbox;

/* Draws the code at 4 pixels a module with the quiet zone, as an RGBA image, and reads it. */
function scan(dark) {
  const n = dark.length + 8;
  const px = 4;
  const w = n * px;
  const rgba = new Uint8ClampedArray(w * w * 4).fill(255);
  dark.forEach((row, y) =>
    row.forEach((on, x) => {
      if (!on) return;
      for (let dy = 0; dy < px; dy++)
        for (let dx = 0; dx < px; dx++) {
          const i = (((y + 4) * px + dy) * w + (x + 4) * px + dx) * 4;
          rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
        }
    }),
  );
  return jsQR(rgba, w, w, { inversionAttempts: "dontInvert" });
}
const bytes = (s) => Array.from(new TextEncoder().encode(s));

test("a QR code reads back exactly, at every size and level", () => {
  /* The longest text each version holds, so every version from 1 to 40 is made and read. */
  for (const level of ["L", "M", "Q", "H"])
    for (let ver = 1; ver <= 40; ver += level === "M" ? 1 : 3) {
      const len = Q.capacity(ver, level);
      let text = "";
      for (let i = 0; i < len; i++) text += String.fromCharCode(33 + ((i * 31 + ver) % 94));
      const code = Q.encode(text, { level });
      assert.equal(code.version, ver, `${level} ${ver}: the smallest code that fits`);
      assert.equal(code.size, ver * 4 + 17);
      const read = scan(code.dark);
      assert.ok(read, `${level} version ${ver} could not be read`);
      assert.deepEqual(Array.from(read.binaryData), bytes(text), `${level} version ${ver}`);
      assert.equal(read.version, ver);
    }
  /* One character more than the largest code holds is refused, not cut short. */
  assert.throws(() => Q.encode("x".repeat(Q.capacity(40, "M") + 1)), /Too long/);
});

test("every mask reads back, and the text keeps £, accents and other scripts", () => {
  for (const text of [
    "https://www.telecomnetworks.co.uk",
    "£180 aborted visit, café, 漢字",
    "",
    "WIFI:T:WPA;S:a;;",
  ])
    for (let mask = 0; mask < 8; mask++) {
      const code = Q.encode(text, { mask });
      assert.equal(code.mask, mask);
      const read = scan(code.dark);
      assert.ok(read, `mask ${mask}`);
      assert.deepEqual(Array.from(read.binaryData), bytes(text));
    }
});

test("the format information matches the standard's own table", () => {
  /* ISO/IEC 18004 table C.1: level M with mask 0 is 101010000010010, read along row 8 from the left. */
  const code = Q.encode("A", { level: "M", mask: 0 });
  const row = [0, 1, 2, 3, 4, 5, 7, 8].map((x) => code.dark[8][x]);
  const col = [7, 5, 4, 3, 2, 1, 0].map((y) => code.dark[y][8]);
  const bits = [...row, ...col].map((b) => (b ? 1 : 0)).join("");
  assert.equal(bits, "101010000010010");
  /* The dark module is always there. */
  assert.equal(code.dark[code.size - 8][8], true);
});

test("Wi-Fi, phone and email codes are written the way phones read them", () => {
  assert.equal(Q.wifi({ ssid: "Office", password: "p4ss", security: "WPA" }), "WIFI:T:WPA;S:Office;P:p4ss;;");
  /* Characters with a meaning in the format are escaped. */
  assert.equal(
    Q.wifi({ ssid: 'My;Net,"1"', password: "a:b\\c" }),
    'WIFI:T:WPA;S:My\\;Net\\,\\"1\\";P:a\\:b\\\\c;;',
  );
  assert.equal(Q.wifi({ ssid: "Guest", password: "" }), "WIFI:T:nopass;S:Guest;;");
  assert.equal(Q.wifi({ ssid: "Guest", password: "x", security: "nopass" }), "WIFI:T:nopass;S:Guest;;");
  assert.equal(
    Q.wifi({ ssid: "Hid", password: "x", security: "WEP", hidden: true }),
    "WIFI:T:WEP;S:Hid;P:x;H:true;;",
  );
  assert.equal(Q.tel("0117 496 0555"), "tel:01174960555");
  assert.equal(Q.tel("+44 (0)117 496 0555"), "tel:+4401174960555");
  assert.equal(Q.tel("call me"), "");
  assert.equal(
    Q.mailto({ to: "help@example.co.uk", subject: "Router & Wi-Fi", body: "Hi" }),
    "mailto:help@example.co.uk?subject=Router%20%26%20Wi-Fi&body=Hi",
  );
  assert.equal(Q.mailto({ to: "" }), "");
});

test("passwords: the length asked for, every kind of character, no look-alikes unless allowed", () => {
  for (let i = 0; i < 300; i++) {
    const p = P.password({ length: 12 });
    assert.equal(p.length, 12);
    assert.match(p, /[a-z]/);
    assert.match(p, /[A-Z]/);
    assert.match(p, /[0-9]/);
    assert.match(p, /[!#$%*+\-=?@_]/);
    assert.doesNotMatch(p, /[lIO01]/, p);
    assert.doesNotMatch(p, /["'`\\/ &<>;,:()[\]{}]/, "no characters that break SIP or forms");
  }
  const plain = P.password({ length: 20, symbols: false });
  assert.match(plain, /^[A-Za-z0-9]{20}$/);
  assert.equal(P.password({ length: 3 }).length, 8, "never shorter than 8");
  assert.equal(P.password({ length: 500 }).length, 64);
  /* Look-alikes do turn up when allowed. */
  let seen = "";
  for (let i = 0; i < 200; i++) seen += P.password({ length: 64, clear: false });
  assert.match(seen, /[lIO01]/);
});

test("a random number is never biased towards some values", () => {
  /* Values in the last partial range are thrown away and drawn again. */
  const draws = [0xffffffff, 0xfffffffe, 7];
  let k = 0;
  const fake = (buf) => {
    buf[0] = draws[k++];
    return buf;
  };
  assert.equal(P.randomBelow(10, fake), 7);
  assert.equal(k, 3, "two draws above the last whole range were refused");
});

test("PINs: digits only, never 1111, 1234, 9876 or 1212", () => {
  for (const weak of ["1111", "000000", "1234", "0123", "9876", "3210", "1212", "989898", "56789"])
    assert.equal(P.weakPin(weak), true, weak);
  for (const fine of ["4927", "1123", "1243", "903471", "2468"]) assert.equal(P.weakPin(fine), false, fine);
  for (let i = 0; i < 2000; i++) {
    const pin = P.pin({ length: 4 });
    assert.match(pin, /^\d{4}$/);
    assert.equal(P.weakPin(pin), false, pin);
  }
  assert.match(P.pin({ length: 8 }), /^\d{8}$/);
  assert.match(P.pin({ length: 2 }), /^\d{4}$/, "never shorter than 4");
});

test("spelling out: the phonetic alphabet, digits and symbols, with case only when it matters", () => {
  assert.equal(S.line("BS1 4DJ"), "Bravo, Sierra, One, space, Four, Delta, Juliet");
  assert.equal(S.line("80:5e"), "Eight, Zero, colon, Five, Echo");
  assert.equal(S.line("aB-x"), "small alpha, capital BRAVO, dash, small x-ray");
  assert.equal(S.line("£@"), "pound sign, at");
  assert.equal(S.line("é"), '"é"');
  assert.equal(Object.keys(S.LETTERS).length, 26);
});

/* ------------------------------------------------------------------ in Astra */

let browser;
before(async () => (browser = await chromium.launch()));
after(async () => browser.close());

async function open() {
  const ctx = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
    viewport: { width: 1366, height: 900 },
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && page.errors.push(m.text()));
  await page.goto(pathToFileURL(resolve("index.html")).href);
  return page;
}

/* The code on screen, read back from its SVG. */
async function scanShown(page) {
  const { d, size } = await page.evaluate(() => {
    const svg = document.querySelector("#qrImage svg");
    return { d: svg.querySelector("path").getAttribute("d"), size: svg.viewBox.baseVal.width };
  });
  const n = size - 8;
  const dark = Array.from({ length: n }, () => new Array(n).fill(false));
  for (const [, x, y] of d.matchAll(/M(\d+),(\d+)h1v1h-1z/g)) dark[y - 4][x - 4] = true;
  return scan(dark);
}

test("the QR code tool: Wi-Fi, a web link and a phone number, read back from the screen", async () => {
  const page = await open();
  await page.click('.nav-btn:text-is("Toolkit")');
  assert.match(await page.textContent("#qrCaption"), /Fill in the details/);
  await page.click('[data-action="qr-copy"]');
  assert.match(await page.textContent("#toast"), /Fill in the details first/);

  await page.fill('[data-qr="url"]', "www.telecomnetworks.co.uk");
  assert.equal(
    (await scanShown(page)).data,
    "https://www.telecomnetworks.co.uk",
    "https:// added so it opens",
  );

  await page.click('[data-action="qr-kind"][data-kind="wifi"]');
  await page.fill('[data-qr="ssid"]', "Acme Office");
  await page.fill('[data-qr="password"]', "Sunny;Day:42");
  assert.equal((await scanShown(page)).data, "WIFI:T:WPA;S:Acme Office;P:Sunny\\;Day\\:42;;");
  assert.match(await page.textContent("#qrCaption"), /^Scans as: WIFI:T:WPA;S:Acme Office;/);
  await page.selectOption('[data-qr="security"]', "nopass");
  assert.equal((await scanShown(page)).data, "WIFI:T:nopass;S:Acme Office;;");

  /* Switching kinds keeps what was typed for each, while Astra is open. */
  await page.click('[data-action="qr-kind"][data-kind="phone"]');
  await page.fill('[data-qr="phone"]', "0117 496 0555");
  assert.equal((await scanShown(page)).data, "tel:01174960555");
  await page.click('[data-action="qr-kind"][data-kind="wifi"]');
  assert.equal(await page.inputValue('[data-qr="ssid"]'), "Acme Office");

  /* Downloads: a PNG and an SVG, named after what the code holds. */
  const [png] = await Promise.all([page.waitForEvent("download"), page.click('[data-action="qr-png"]')]);
  assert.equal(png.suggestedFilename(), "QR - Wi-Fi Acme Office.png");
  const file = readFileSync(await png.path());
  assert.deepEqual([...file.subarray(1, 4)], [0x50, 0x4e, 0x47], "a PNG file");
  assert.ok(file.readUInt32BE(16) >= 600, "large enough to print");
  const [svg] = await Promise.all([page.waitForEvent("download"), page.click('[data-action="qr-svg"]')]);
  assert.equal(svg.suggestedFilename(), "QR - Wi-Fi Acme Office.svg");
  assert.match(readFileSync(await svg.path(), "utf8"), /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);

  await page.click('[data-action="qr-copy"]');
  await page.waitForFunction(() =>
    /QR code copied|would not copy/.test(document.getElementById("toast").textContent),
  );
  /* Nothing typed here is saved. */
  const stored = await page.evaluate(() => localStorage.getItem("astra.offline.fresh.v1") || "");
  assert.doesNotMatch(stored, /Sunny|Acme Office/);
  assert.deepEqual(page.errors, []);
});

test("password and PIN maker, and spelling it out", async () => {
  const page = await open();
  await page.click('.nav-btn:text-is("Toolkit")');
  const value = () => page.textContent(".pw-value");
  const first = await value();
  assert.equal(first.length, 16);
  /* It is read out too, so it can be given over the phone. */
  assert.equal(await page.textContent(".pw-said"), await page.evaluate((v) => AstraPhonetic.line(v), first));
  await page.click('[data-action="pw-make"]');
  assert.notEqual(await value(), first);
  await page.fill("#pwLength", "24");
  await page.dispatchEvent("#pwLength", "change");
  assert.equal((await value()).length, 24);
  await page.uncheck("#pwSymbols");
  assert.match(await value(), /^[A-Za-z0-9]{24}$/);
  await page.click('[data-action="pw-copy"]');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), await value());

  await page.click('[data-action="pw-kind"][data-kind="pin"]');
  assert.match(await value(), /^\d{6}$/);
  assert.match(await page.textContent("#pwTool"), /No repeats or runs/);

  await page.fill("#spellInput", "BS1 4DJ");
  assert.equal(await page.locator(".spell-list li").count(), 7);
  assert.match(await page.textContent(".spell-list"), /Juliet/);
  await page.click('[data-action="spell-copy"]');
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    "Bravo, Sierra, One, space, Four, Delta, Juliet",
  );
  assert.deepEqual(page.errors, []);
});

test("Ctrl K finds the new tools", async () => {
  const page = await open();
  for (const [query, card] of [
    ["qr", "#qrTool"],
    ["wifi code", "#qrTool"],
    ["make a password", "#pwTool"],
    ["phonetic", "#spellTool"],
  ]) {
    await page.keyboard.press("Control+k");
    await page.fill("#globalSearchInput", query);
    await page.click('#globalResults [data-action="go-tool"]');
    assert.match(await page.textContent("#pageTitle"), /Toolkit/);
    assert.ok(
      await page.evaluate((sel) => document.querySelector(sel).contains(document.activeElement), card),
      query,
    );
  }
  assert.deepEqual(page.errors, []);
});
