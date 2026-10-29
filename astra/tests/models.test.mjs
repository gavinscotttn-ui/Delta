import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";
import { createHash, randomBytes } from "node:crypto";
import { selectFiles, safeId } from "../tools/get-model.mjs";

/* The listing below is made up to look like a Hugging Face tree response. It tests the selection rules only; it is
   not a record of what any real repository contains. */
const f = (path, size = 10) =>
  path.startsWith("onnx/")
    ? { type: "file", path, size, oid: "1".repeat(40), lfs: { oid: "a".repeat(64), size } }
    : { type: "file", path, size, oid: "1".repeat(40) };
const tree = [
  f("config.json"),
  f("generation_config.json"),
  f("tokenizer.json"),
  f("tokenizer_config.json"),
  f("README.md"),
  f("vocab.json"),
  f("onnx/model.onnx"),
  f("onnx/model_fp16.onnx"),
  f("onnx/model_q4.onnx"),
  f("onnx/model_q4.onnx_data"),
  f("onnx/model_q4f16.onnx"),
  f("onnx/model_quantized.onnx"),
  { type: "directory", path: "onnx" },
];

test("installer picks the config files and only the wanted precisions", () => {
  const { files, missing } = selectFiles(tree, ["q4f16", "q4"]);
  assert.deepEqual(missing, []);
  assert.deepEqual(files.map((x) => x.path).sort(), [
    "config.json",
    "generation_config.json",
    "onnx/model_q4.onnx",
    "onnx/model_q4.onnx_data",
    "onnx/model_q4f16.onnx",
    "tokenizer.json",
    "tokenizer_config.json",
  ]);
  const cpu = selectFiles(tree, ["q4"]).files.map((x) => x.path);
  assert.ok(!cpu.includes("onnx/model_q4f16.onnx") && !cpu.includes("onnx/model_fp16.onnx"));
});

test("installer reports a repository that lacks what Astra needs", () => {
  const { missing } = selectFiles([f("config.json"), f("onnx/model_q4.onnx")], ["q4"]);
  assert.deepEqual(missing.sort(), ["generation_config.json", "tokenizer.json", "tokenizer_config.json"]);
  assert.deepEqual(selectFiles(tree, ["q8"]).missing, ["onnx/model_q8.onnx"]);
});

test("model names cannot escape the models folder", () => {
  assert.ok(safeId("qwen2.5-0.5b-instruct"));
  for (const bad of ["../x", "a/b", "", "..", "a b", "x".repeat(81)]) assert.ok(!safeId(bad), bad);
});

test("every model in the manifest names a repository and the precisions the page asks for", () => {
  const { models } = JSON.parse(readFileSync("models/manifest.json", "utf8"));
  assert.ok(models.length >= 1);
  for (const m of models) {
    assert.ok(safeId(m.id));
    assert.match(m.repo, /^[\w.-]+\/[\w.-]+$/);
    assert.ok(m.dtypeGPU && m.dtypeCPU && m.licence);
  }
});

test("the only address the page may reach is Hugging Face, for the one-time model download", () => {
  const html = readFileSync("index.html", "utf8");
  const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
  for (const csp of [
    html.match(/Content-Security-Policy" content="([^"]+)"/)[1],
    manifest.content_security_policy.extension_pages,
  ]) {
    assert.match(
      csp,
      /connect-src 'self' https:\/\/huggingface\.co https:\/\/\*\.huggingface\.co https:\/\/\*\.hf\.co;/,
    );
    assert.match(csp, /script-src 'self' 'wasm-unsafe-eval';/);
    const addresses = csp.match(/https?:\/\/[^\s;]+/g) || [];
    assert.deepEqual(
      addresses,
      ["https://huggingface.co", "https://*.huggingface.co", "https://*.hf.co"],
      csp,
    );
  }
  assert.match(html, /worker-src 'self'/);
  const sources = [
    "index.html",
    "manifest.json",
    ...readdirSync("js", { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => "js/" + d.name),
  ];
  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    assert.ok(
      !/api\.openai|apiKey|Authorization["':]|["'`]Bearer ["'`$]/.test(text),
      `${file} still mentions a cloud API`,
    );
  }
});

/* The in-browser installer, loaded the way the page loads it. */
const store = (() => {
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync("js/model-store.js", "utf8"), sandbox);
  return sandbox.AstraModels;
})();

test("the in-browser installer picks the best weights for the device, with the files they need", () => {
  const gpu = store.choose(tree, "webgpu");
  assert.equal(gpu.dtype, "q4f16");
  assert.deepEqual(
    [...gpu.files].map((x) => x.path),
    [
      "config.json",
      "generation_config.json",
      "tokenizer.json",
      "tokenizer_config.json",
      "onnx/model_q4f16.onnx",
    ],
  );
  const cpu = store.choose(tree, "wasm");
  assert.equal(cpu.dtype, "q4");
  assert.ok(
    [...cpu.files].some((x) => x.path === "onnx/model_q4.onnx_data"),
    "external weights come too",
  );
  assert.equal(cpu.bytes, 60);
  assert.match(store.choose(tree.slice(1), "wasm").error, /config\.json/);
  assert.match(store.choose(tree.slice(0, 4), "wasm").error, /No weights/);
});

test("the in-browser installer refuses files it cannot check", () => {
  const without = (path, change) => tree.map((x) => (x.path === path ? change({ ...x }) : x));
  const noId = without("tokenizer.json", (x) => (delete x.oid, x));
  assert.match(store.choose(noId, "wasm").error, /cannot be checked \(tokenizer\.json\)/);
  const noSize = without("config.json", (x) => ((x.size = 0), x));
  assert.match(store.choose(noSize, "wasm").error, /cannot be checked \(config\.json\)/);
  const noHash = without("onnx/model_q4.onnx", (x) => (delete x.lfs, x));
  assert.match(store.choose(noHash, "wasm").error, /no published checksum/);
  const badHash = without("onnx/model_q4.onnx_data", (x) => ((x.lfs = { oid: "not-a-hash" }), x));
  assert.match(store.choose(badHash, "wasm").error, /cannot be checked/);
});

test("the download check computes SHA-256 correctly however the bytes arrive", () => {
  for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 128, 1000, 70000]) {
    const data = randomBytes(n);
    const h = store.sha256();
    for (let i = 0; i < n; ) {
      const k = Math.min(n - i, 1 + ((i * 7919) % 131));
      h.update(data.subarray(i, i + k));
      i += k;
    }
    assert.equal(h.hex(), createHash("sha256").update(data).digest("hex"), `length ${n}`);
  }
});
