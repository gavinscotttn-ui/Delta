import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const sandbox = {};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync("js/audio.js", "utf8"), sandbox);
const A = sandbox.AstraAudio;
const FIX = resolve("tests/fixtures/audio");
const AstraAudioName = (n) => A.safeName(n.replace(/\.[^.]+$/, ""));
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

/* A tone mix with a slow swell, like speech or music. */
function signal(rate, seconds = 2) {
  const x = new Float32Array(rate * seconds);
  for (let i = 0; i < x.length; i++) {
    const t = i / rate;
    x[i] =
      0.6 *
      (0.5 + 0.5 * Math.sin(2 * Math.PI * 1.3 * t)) *
      (0.6 * Math.sin(2 * Math.PI * 440 * t) + 0.4 * Math.sin(2 * Math.PI * 1250 * t));
  }
  return x;
}
const header = (b) => ({
  riff: Buffer.from(b.slice(0, 4)).toString(),
  wave: Buffer.from(b.slice(8, 12)).toString(),
  format: b[20] | (b[21] << 8),
  channels: b[22],
  rate: Buffer.from(b).readUInt32LE(24),
  byteRate: Buffer.from(b).readUInt32LE(28),
  bits: b[34],
});

test("μ-law is the Horizon format: 8 kHz, mono, CCITT μ-law WAV with a fact chunk", () => {
  const bytes = A.encode("ulaw", signal(8000));
  assert.deepEqual(header(bytes), {
    riff: "RIFF",
    wave: "WAVE",
    format: 7,
    channels: 1,
    rate: 8000,
    byteRate: 8000,
    bits: 8,
  });
  assert.equal(Buffer.from(bytes.slice(38, 42)).toString(), "fact");
  assert.equal(Buffer.from(bytes.slice(50, 54)).toString(), "data");
  assert.equal(Buffer.from(bytes).readUInt32LE(54), 16000, "one byte per sample");
  assert.equal(A.ulaw(0), 0xff, "silence is 0xFF in μ-law");
  assert.equal(A.alaw(0), 0xd5, "silence is 0xD5 in A-law");
  for (let b = 0; b < 256; b++) assert.equal(A.alaw(A.alawDecode(b)), b);
  assert.deepEqual(header(A.encode("alaw", signal(8000))).format, 6);
  assert.deepEqual(header(A.encode("pcm16hd", signal(16000))).rate, 16000);
  assert.equal(A.encode("g722", signal(16000)).length, 16000, "G.722 is one byte per two samples: 64 kbit/s");
  assert.equal(A.encode("sln", signal(8000)).length, 32000, "raw is 16-bit samples with no header");
});

test(
  "every format decodes correctly in ffmpeg, an independent implementation",
  { skip: !hasFfmpeg && "ffmpeg not installed" },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "astra-audio-"));
    const s16 = (file) => {
      const b = readFileSync(file);
      return new Int16Array(b.buffer, b.byteOffset, b.length >> 1);
    };
    const snr = (ref, got, lag = 0) => {
      let s = 0;
      let e = 0;
      for (let i = 1000; i < ref.length - 1000; i++) {
        const r = ref[i] * 32767;
        const d = r - (got[i + lag] ?? 0);
        s += r * r;
        e += d * d;
      }
      return 10 * Math.log10(s / e);
    };
    const expect = {
      ulaw: ["pcm_mulaw", 30],
      alaw: ["pcm_alaw", 30],
      pcm8: ["pcm_u8", 30],
      pcm16: ["pcm_s16le", 60],
      pcm16hd: ["pcm_s16le", 60],
    };
    for (const [id, [codec, min]] of Object.entries(expect)) {
      const f = A.FORMATS.find((x) => x.id === id);
      const x = signal(f.rate);
      writeFileSync(join(dir, `${id}.wav`), A.encode(id, x));
      const probe = execFileSync("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_name,sample_rate,channels",
        "-of",
        "csv=p=0",
        join(dir, `${id}.wav`),
      ])
        .toString()
        .trim();
      assert.equal(probe, `${codec},${f.rate},1`, id);
      execFileSync("ffmpeg", [
        "-v",
        "error",
        "-y",
        "-i",
        join(dir, `${id}.wav`),
        "-f",
        "s16le",
        join(dir, `${id}.raw`),
      ]);
      assert.ok(snr(x, s16(join(dir, `${id}.raw`))) > min, `${id} decodes faithfully`);
    }
    const hd = signal(16000);
    writeFileSync(join(dir, "x.g722"), A.encode("g722", hd));
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "g722",
      "-i",
      join(dir, "x.g722"),
      "-f",
      "s16le",
      "-ar",
      "16000",
      join(dir, "g722.raw"),
    ]);
    const got = s16(join(dir, "g722.raw"));
    let lag = 0;
    let best = -Infinity;
    for (let l = 0; l < 64; l++) {
      let c = 0;
      for (let i = 1000; i < 5000; i++) c += hd[i] * (got[i + l] || 0);
      if (c > best) [best, lag] = [c, l];
    }
    assert.ok(snr(hd, got, lag) > 25, "G.722 decodes faithfully");
    for (const [id, fmt, dec] of [
      ["ulaw", "mulaw", A.ulawDecode],
      ["alaw", "alaw", A.alawDecode],
    ]) {
      writeFileSync(
        join(dir, `all.${id}`),
        Uint8Array.from({ length: 256 }, (_, i) => i),
      );
      execFileSync("ffmpeg", [
        "-v",
        "error",
        "-y",
        "-f",
        fmt,
        "-ar",
        "8000",
        "-ac",
        "1",
        "-i",
        join(dir, `all.${id}`),
        "-f",
        "s16le",
        join(dir, `all-${id}.raw`),
      ]);
      const ref = s16(join(dir, `all-${id}.raw`));
      for (let i = 0; i < 256; i++)
        assert.equal(dec(i), ref[i], `${id} byte ${i}: the preview plays what callers hear`);
    }
  },
);

let browser;
before(async () => (browser = await chromium.launch()));
after(async () => browser.close());

async function toolkit() {
  const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(pathToFileURL(resolve("index.html")).href);
  await page.click('.nav-btn:text-is("Toolkit")');
  return page;
}

test("an MP3 becomes a Horizon μ-law WAV in one click, and Listen plays it", async () => {
  const page = await toolkit();
  await page.setInputFiles("#audioFileInput", join(FIX, "tones.mp3"));
  assert.match(await page.textContent("#audioFileName"), /tones\.mp3/);
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.click('[data-action="audio-convert"]'),
  ]);
  assert.equal(dl.suggestedFilename(), "tones (u-law, 8 kHz).wav");
  assert.equal(AstraAudioName("Café hold music.mp3"), "Cafe hold music");
  const bytes = new Uint8Array(readFileSync(await dl.path()));
  assert.deepEqual(header(bytes), {
    riff: "RIFF",
    wave: "WAVE",
    format: 7,
    channels: 1,
    rate: 8000,
    byteRate: 8000,
    bits: 8,
  });
  const samples = Buffer.from(bytes).readUInt32LE(54);
  assert.ok(Math.abs(samples - 16000) < 400, `two seconds of audio (${samples} samples)`);
  assert.match(await page.textContent("#audioResult"), /Ready for Horizon/);
  await page.click('[data-action="audio-listen"]');
  assert.ok(await page.isVisible("#audioPlayer"));
  assert.match(await page.getAttribute("#audioPlayer", "src"), /^blob:/);
  assert.deepEqual(page.errors, []);
});

test("high notes do not fold back as false tones, and the volume levels are what they say", async () => {
  const page = await toolkit();
  await page.setInputFiles("#audioFileInput", join(FIX, "tones.mp3"));
  const r = await page.evaluate(async () => {
    const file = document.querySelector("#audioFileInput").files[0];
    const read = async (options) => {
      const out = await AstraAudio.convert(file, { format: "pcm16", ...options });
      const v = new DataView(out.bytes.buffer);
      return Float32Array.from(
        { length: (out.bytes.length - 44) / 2 },
        (_, i) => v.getInt16(44 + i * 2, true) / 32768,
      );
    };
    const power = (x, f) => {
      const k = 2 * Math.cos((2 * Math.PI * f) / 8000);
      let s1 = 0;
      let s2 = 0;
      for (let i = 2000; i < x.length - 2000; i++) [s1, s2] = [x[i] + k * s1 - s2, s1];
      return s1 * s1 + s2 * s2 - k * s1 * s2;
    };
    const peak = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    const medium = await read({});
    return {
      alias: 10 * Math.log10(power(medium, 2000) / power(medium, 440)),
      medium: 20 * Math.log10(peak(medium)),
      max: 20 * Math.log10(peak(await read({ volume: "max" }))),
      quiet: 20 * Math.log10(peak(await read({ volume: "quiet" }))),
    };
  });
  /* The file is 440 Hz on the left and 6 kHz on the right at equal level; at 8 kHz, 6 kHz would fold to 2 kHz. */
  assert.ok(r.alias < -40, `6 kHz folded back at ${r.alias.toFixed(1)} dB`);
  assert.ok(
    Math.abs(r.medium + 6) < 0.2 && Math.abs(r.max + 1) < 0.2 && Math.abs(r.quiet + 15) < 0.2,
    JSON.stringify(r),
  );
});

test("files too long for Horizon are flagged, and trimming fits them to 625 seconds", async () => {
  const page = await toolkit();
  await page.evaluate(() => {
    /* 630 seconds of quiet tone as an 8 kHz WAV, built in the page. */
    const n = 630 * 8000;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / 8000);
    const file = new File([AstraAudio.encode("pcm8", x)], "long hold music.wav", { type: "audio/wav" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.querySelector("#audioFileInput");
    input.files = dt.files;
    input.dispatchEvent(new Event("change"));
  });
  await Promise.all([page.waitForEvent("download"), page.click('[data-action="audio-convert"]')]);
  assert.match(await page.textContent("#audioResult"), /10 min 30 s[\s\S]*too long for it/);
  assert.ok(await page.isVisible("#audioTrimRow"));
  await page.check("#audioTrim");
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.click('[data-action="audio-convert"]'),
  ]);
  const bytes = readFileSync(await dl.path());
  assert.equal(bytes.readUInt32LE(54), 625 * 8000, "exactly 625 seconds");
  assert.ok(bytes.length < 5 * 1024 * 1024, "under 5 MB");
  assert.match(
    await page.textContent("#audioResult"),
    /10 min 25 s[\s\S]*Trimmed from 10 min 30 s[\s\S]*Ready for Horizon/,
  );
});

test("a file that is not audio gets a plain message", async () => {
  const page = await toolkit();
  await page.setInputFiles("#audioFileInput", resolve("README.md"));
  await page.click('[data-action="audio-convert"]');
  await page.waitForFunction(() =>
    /could not be read as audio/.test(document.querySelector("#audioResult").textContent),
  );
  assert.deepEqual(page.errors, []);
});
