import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { extname, join, normalize, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

/* Runs the real thing: the module worker, Transformers.js, ONNX Runtime Web (WebAssembly) and the tokenizer, under the
   same Content Security Policy as the extension. The model is a tiny hand-made one (tools/make-tiny-model.py) that
   always says the same sentence. This proves the plumbing works. It says nothing about the quality or speed of a
   real model: use "Check the model" in Settings for that, on the machine that will run it. */

const ROOT = resolve(".");
const FIXTURES = resolve("tests/fixtures/models");
const CSP = JSON.parse(readFileSync("manifest.json", "utf8")).content_security_policy.extension_pages;
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
  ".png": "image/png",
};
let server, browser, origin;
const hubHits = [];

/* A stand-in for Hugging Face: its tree API and file downloads, serving the tiny model as "test/tiny-lm". */
async function listing(dir, base = "") {
  const out = [];
  for (const d of await readdir(join(dir, base), { withFileTypes: true })) {
    const path = base ? `${base}/${d.name}` : d.name;
    if (d.isDirectory()) {
      out.push({ type: "directory", path }, ...(await listing(dir, path)));
      continue;
    }
    const body = await readFile(join(dir, path));
    const entry = { type: "file", path, size: (await stat(join(dir, path))).size };
    if (path.endsWith(".onnx"))
      entry.lfs = { oid: createHash("sha256").update(body).digest("hex"), size: body.length };
    else entry.oid = createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
    out.push(entry);
  }
  return out;
}
async function hub(path, res) {
  hubHits.push(path);
  const dir = join(FIXTURES, "tiny-lm");
  const cors = { "Access-Control-Allow-Origin": "*" };
  try {
    if (path === "api/models/test/tiny-lm/tree/main") {
      res.writeHead(200, { ...cors, "Content-Type": "application/json" });
      return res.end(JSON.stringify(await listing(dir)));
    }
    const prefix = "test/tiny-lm/resolve/main/";
    if (!path.startsWith(prefix)) throw new Error("not found");
    const body = await readFile(join(dir, normalize(path.slice(prefix.length))));
    res.writeHead(200, { ...cors, "Content-Type": "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, cors).end("not found");
  }
}

before(async () => {
  server = http.createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path.startsWith("/hub/")) return hub(path.slice(5), res);
    const file = path.startsWith("/models/")
      ? join(FIXTURES, normalize(path.slice(8)))
      : join(ROOT, normalize(path === "/" ? "/index.html" : path));
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        "Content-Type": TYPES[extname(file)] || "application/octet-stream",
        "Content-Security-Policy": CSP /* the same policy the extension enforces */,
      });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => {
  await browser.close();
  server.close();
});

async function open() {
  const page = await browser.newPage();
  page.errors = [];
  page.requests = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && page.errors.push(m.text()));
  page.on("request", (r) => page.requests.push(r.url()));
  await page.goto(origin + "/index.html");
  return page;
}

test("the page can see which models are installed", async () => {
  const page = await open();
  const r = await page.evaluate(async () => ({
    support: AstraAI.support(),
    models: (await AstraAI.installed()).map((m) => m.id),
  }));
  assert.equal(r.support.ok, true);
  assert.deepEqual(r.models, ["tiny-lm", "tiny-loop"]);
});

test("a model runs in the worker, streams text, and nothing leaves the origin", async () => {
  const page = await open();
  const r = await page.evaluate(async () => {
    const pieces = [];
    const out = await AstraAI.chat({
      model: "tiny-lm",
      messages: [
        { role: "system", content: "be brief" },
        { role: "user", content: "hello there" },
      ],
      onDelta: (p) => pieces.push(p),
    });
    return { out, pieces, status: AstraAI.status() };
  });
  assert.equal(r.out.text.trim(), "Tiny test model: plumbing works [1].");
  assert.ok(r.pieces.length >= 2, "arrived in pieces, not all at once");
  assert.equal(r.status.state, "ready");
  assert.equal(r.status.device, "wasm");
  assert.ok(r.out.stats.tokens >= 6);
  assert.ok(
    page.requests.every((u) => u.startsWith(origin)),
    "no request left the origin: " + page.requests.filter((u) => !u.startsWith(origin)),
  );
  assert.deepEqual(page.errors, []);
});

test("Stop interrupts a model that would never finish, and keeps what it said", async () => {
  const page = await open();
  const r = await page.evaluate(async () => {
    const controller = new AbortController();
    let seen = 0;
    const started = performance.now();
    const out = await AstraAI.chat({
      model: "tiny-loop",
      messages: [{ role: "user", content: "go" }],
      maxNewTokens: 100000,
      signal: controller.signal,
      onDelta: () => {
        if (++seen === 5) controller.abort();
      },
    });
    return {
      text: out.text,
      seen,
      seconds: (performance.now() - started) / 1000,
    };
  });
  assert.match(r.text, /Going and going/);
  assert.ok(r.seen >= 5 && r.seen < 5000, `stopped promptly (${r.seen} pieces)`);
  assert.ok(r.seconds < 20);
});

test("asking for a model that is not installed gives a plain message", async () => {
  const page = await open();
  const message = await page.evaluate(() =>
    AstraAI.chat({
      model: "not-there",
      messages: [{ role: "user", content: "hi" }],
    }).then(
      () => "no error",
      (e) => e.message,
    ),
  );
  assert.match(message, /not installed/);
});

test("'Check the model' runs end to end in the browser and reports what it found", async () => {
  const page = await open();
  await page.click('.nav-btn:text-is("Settings")');
  await page.waitForSelector('#aiModel option[value="tiny-lm"]', {
    state: "attached",
  });
  await page.selectOption("#aiModel", "tiny-lm");
  await page.click('[data-action="test-ai"]');
  await page.waitForFunction(
    () => /of 3 correct/.test(document.querySelector(".ai-test-result")?.textContent || ""),
    null,
    { timeout: 60000 },
  );
  const text = await page.textContent(".ai-test-result");
  assert.match(text, /0 of 3 correct/, "the tiny model cannot answer, and the test says so");
  assert.match(text, /the processor/);
  assert.deepEqual(page.errors, []);
});

test("enabling the assistant makes Ask write a checked answer with the real worker", async () => {
  const page = await open();
  await page.click('.nav-btn:text-is("Settings")');
  await page.waitForSelector('#aiModel option[value="tiny-lm"]', {
    state: "attached",
  });
  await page.selectOption("#aiModel", "tiny-lm");
  await page.setChecked("#aiEnabled", true);
  await page.click('[data-action="save-ai"]');
  await page.click('.nav-btn:text-is("Ask")');
  await page.fill("#askInput", "phone shows initialising and won't register");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".ask-answer", { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('[data-ask="stop"]'), null, { timeout: 60000 });
  assert.match(await page.textContent(".ask-answer"), /Tiny test model: plumbing works/);
  assert.ok(await page.locator(".ask-answer button.cite").count());
  assert.deepEqual(page.errors, []);
});

test("the AI installs from the hub in one go, checks every file, then runs with the hub unreachable", async () => {
  const page = await open();
  const installed = await page.evaluate(async (hubUrl) => {
    AstraModels.configure({ hub: hubUrl });
    const progress = [];
    const record = await AstraModels.install(
      { id: "tiny-hub", repo: "test/tiny-lm", name: "Tiny test model from the hub" },
      { onProgress: (p) => progress.push(p.loaded) },
    );
    return { record, progress, ids: (await AstraAI.installed()).map((m) => m.id) };
  }, origin + "/hub/");
  assert.equal(installed.record.dtype, "fp32");
  assert.ok(installed.progress.length >= 5 && installed.progress.at(-1) === installed.record.bytes);
  assert.ok(installed.ids.includes("tiny-hub"));

  /* From here on the hub is gone: the model must come from the browser's own storage. */
  hubHits.length = 0;
  await page.route("**/hub/**", (route) => route.abort());
  await page.reload();
  const r = await page.evaluate(async () => {
    const out = await AstraAI.chat({ model: "tiny-hub", messages: [{ role: "user", content: "hello" }] });
    return out.text.trim();
  });
  assert.equal(r, "Tiny test model: plumbing works [1].");
  assert.deepEqual(hubHits, [], "nothing was fetched from the hub after installing");

  const removed = await page.evaluate(async () => {
    await AstraModels.remove("tiny-hub");
    return (await AstraAI.installed()).map((m) => m.id);
  });
  assert.ok(!removed.includes("tiny-hub"));
  assert.deepEqual(
    page.errors.filter((e) => !/net::ERR_FAILED/.test(e)),
    [],
  );
});

test("an altered file fails the integrity check and is not kept", async () => {
  const page = await open();
  await page.route("**/hub/test/tiny-lm/resolve/main/onnx/model.onnx", (route) =>
    route.fulfill({
      status: 200,
      body: Buffer.alloc(readFileSync(join(FIXTURES, "tiny-lm/onnx/model.onnx")).length),
    }),
  );
  const r = await page.evaluate(async (hubUrl) => {
    AstraModels.configure({ hub: hubUrl });
    try {
      await AstraModels.install({ id: "tiny-bad", repo: "test/tiny-lm", name: "Bad" });
      return "installed";
    } catch (e) {
      return { message: e.message, ids: (await AstraAI.installed()).map((m) => m.id) };
    }
  }, origin + "/hub/");
  assert.match(r.message, /integrity check/);
  assert.ok(!r.ids.includes("tiny-bad"));
});

test("on a computer with no model, one click in Settings adds the AI and Ask uses it straight away", async () => {
  const page = await open();
  await page.route("**/models/installed.json", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.evaluate((hubUrl) => {
    AstraModels.configure({ hub: hubUrl });
    AstraModels.CATALOG.unshift({
      id: "tiny-hub",
      repo: "test/tiny-lm",
      name: "Tiny test model",
      note: "For tests.",
    });
  }, origin + "/hub/");
  await page.click('.nav-btn:text-is("Settings")');
  await page.waitForSelector("#aiAdd:not([hidden])");
  assert.ok(await page.isHidden("#aiReady"));
  await page.click('[data-action="add-ai"]');
  await page.waitForSelector("#aiReady:not([hidden])", { timeout: 30000 });
  assert.ok(await page.isHidden("#aiAdd"));
  assert.equal(await page.inputValue("#aiModel"), "tiny-hub");
  assert.ok(await page.isChecked("#aiEnabled"));
  assert.ok(await page.isVisible('[data-action="remove-ai"]'));

  await page.click('.nav-btn:text-is("Ask")');
  await page.fill("#askInput", "phone shows initialising and won't register");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".ask-answer", { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('[data-ask="stop"]'), null, { timeout: 60000 });
  assert.match(await page.textContent(".ask-answer"), /Tiny test model: plumbing works/);
  assert.deepEqual(page.errors, []);
});

test("a dropped connection during the download gives a plain message", async () => {
  const page = await open();
  await page.route("**/hub/test/tiny-lm/resolve/main/onnx/model.onnx", (route) =>
    route.abort("internetdisconnected"),
  );
  const message = await page.evaluate(async (hubUrl) => {
    AstraModels.configure({ hub: hubUrl });
    try {
      await AstraModels.install({ id: "tiny-cut", repo: "test/tiny-lm", name: "Cut" });
      return "installed";
    } catch (e) {
      return e.message;
    }
  }, origin + "/hub/");
  assert.match(message, /download stopped.*internet connection/);
});

test("an altered settings file fails its check too, and nothing is installed", async () => {
  const page = await open();
  await page.route("**/hub/test/tiny-lm/resolve/main/tokenizer_config.json", async (route) => {
    const real = readFileSync(join(FIXTURES, "tiny-lm/tokenizer_config.json"), "utf8");
    route.fulfill({ status: 200, body: real.replace(/.$/s, " ") });
  });
  const r = await page.evaluate(async (hubUrl) => {
    AstraModels.configure({ hub: hubUrl });
    try {
      await AstraModels.install({ id: "tiny-bad-config", repo: "test/tiny-lm", name: "Bad" });
      return "installed";
    } catch (e) {
      const cache = await caches.open("transformers-cache");
      return {
        message: e.message,
        ids: (await AstraAI.installed()).map((m) => m.id),
        kept: !!(await cache.match(hubUrl + "test/tiny-lm/resolve/main/tokenizer_config.json")),
      };
    }
  }, origin + "/hub/");
  assert.match(r.message, /tokenizer_config\.json failed its integrity check/);
  assert.ok(!r.ids.includes("tiny-bad-config"));
  assert.equal(r.kept, false, "the altered file was not kept");
});

test("a listing without checksums is refused before anything downloads", async () => {
  const page = await open();
  await page.route("**/hub/api/models/test/tiny-lm/tree/main*", async (route) => {
    const res = await route.fetch();
    const list = (await res.json()).map(({ oid, lfs, ...rest }) => rest);
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(list) });
  });
  hubHits.length = 0;
  const message = await page.evaluate(async (hubUrl) => {
    AstraModels.configure({ hub: hubUrl });
    try {
      await AstraModels.install({ id: "tiny-unchecked", repo: "test/tiny-lm", name: "Unchecked" });
      return "installed";
    } catch (e) {
      return e.message;
    }
  }, origin + "/hub/");
  assert.match(message, /cannot be checked/);
  assert.ok(
    hubHits.every((p) => p.startsWith("api/")),
    "no file was downloaded: " + hubHits,
  );
});

test("Stop pressed while the model loads means no answer is written", async () => {
  const page = await open();
  const r = await page.evaluate(async () => {
    await AstraAI.unload();
    const controller = new AbortController();
    const pieces = [];
    const out = AstraAI.chat({
      model: "tiny-lm",
      messages: [{ role: "user", content: "hello" }],
      signal: controller.signal,
      onDelta: (p) => pieces.push(p),
      onProgress: () => controller.abort(),
    });
    controller.abort();
    return out.then(
      () => ({ result: "answered", pieces: pieces.length }),
      (e) => ({ result: e.message, pieces: pieces.length }),
    );
  });
  assert.equal(r.result, "Stopped.");
  assert.equal(r.pieces, 0);
});

test("unloading the model ends an answer that is still being written", async () => {
  const page = await open();
  const r = await page.evaluate(async () => {
    let first;
    const started = new Promise((resolve) => (first = resolve));
    const out = AstraAI.chat({
      model: "tiny-loop",
      messages: [{ role: "user", content: "go" }],
      maxNewTokens: 100000,
      onDelta: () => first(),
    }).then(
      () => "finished",
      (e) => e.message,
    );
    await started;
    await AstraAI.unload();
    return { message: await out, state: AstraAI.status().state };
  });
  assert.equal(r.message, "Stopped.");
  assert.equal(r.state, "idle");
});

test("after a dropped connection, pressing Add again fetches only what is still missing", async () => {
  const page = await open();
  await page.route("**/hub/test/tiny-lm/resolve/main/onnx/model.onnx", (route) =>
    route.abort("internetdisconnected"),
  );
  await page.evaluate(async (hubUrl) => {
    AstraModels.configure({ hub: hubUrl });
    await AstraModels.install({ id: "tiny-resume", repo: "test/tiny-lm", name: "Resume" }).catch(() => {});
  }, origin + "/hub/");
  await page.unroute("**/hub/test/tiny-lm/resolve/main/onnx/model.onnx");
  hubHits.length = 0;
  const ids = await page.evaluate(async () => {
    await AstraModels.install({ id: "tiny-resume", repo: "test/tiny-lm", name: "Resume" });
    return (await AstraAI.installed()).map((m) => m.id);
  });
  assert.ok(ids.includes("tiny-resume"));
  assert.deepEqual(
    hubHits.filter((p) => !p.startsWith("api/")),
    ["test/tiny-lm/resolve/main/onnx/model.onnx"],
  );
});
