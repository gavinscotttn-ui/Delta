#!/usr/bin/env node
/* Downloads a language model into models/<id>/ so Astra's assistant can run it with no connection.
   This is the only time Astra's tooling touches the internet, and it is run by you, on purpose.

   npm run model                      lists the models it knows
   npm run model -- <id>              installs one (both GPU and CPU files)
   npm run model -- <id> --cpu-only   installs only the CPU file (smaller download)
   npm run model -- --remove <id>     deletes one

   Needs Node 18+ and access to huggingface.co. Files are checked against the sizes and SHA-256 hashes Hugging Face lists. */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const HERE = dirname(fileURLToPath(import.meta.url));
const MODELS = resolve(HERE, "..", "models");
const HUB = "https://huggingface.co";

const SMALL = new Set(["config.json", "generation_config.json", "tokenizer.json", "tokenizer_config.json"]);

/* Which files of a repository listing to fetch: the small config files, and the .onnx (and .onnx_data) files for the
   wanted precisions only. `tree` is the array returned by the Hub's tree API. */
export function selectFiles(tree, dtypes) {
  const wanted = (path) => {
    if (SMALL.has(path)) return true;
    const m = /^onnx\/model_([a-z0-9]+)\.onnx(_data(_\d+)?)?$/.exec(path);
    return !!m && dtypes.includes(m[1]);
  };
  const files = tree.filter((f) => f.type === "file" && wanted(f.path));
  const missing = [];
  for (const need of [...SMALL]) if (!files.some((f) => f.path === need)) missing.push(need);
  for (const d of dtypes)
    if (!files.some((f) => f.path === `onnx/model_${d}.onnx`)) missing.push(`onnx/model_${d}.onnx`);
  return { files, missing };
}

export const safeId = (id) => /^[\w.-]{1,80}$/.test(id) && !id.includes("..");

async function sha256(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

async function getJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "astra-model-installer" },
  });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

async function download(entry, repo, dir) {
  const target = join(dir, entry.path);
  const expected = entry.lfs?.oid;
  try {
    const have = await stat(target);
    if (have.size === entry.size && (!expected || (await sha256(target)) === expected)) {
      console.log(`  have  ${entry.path}`);
      return;
    }
  } catch {
    /* not there yet */
  }
  await mkdir(dirname(target), { recursive: true });
  const part = target + ".part";
  const res = await fetch(`${HUB}/${repo}/resolve/main/${entry.path}`, {
    headers: { "User-Agent": "astra-model-installer" },
  });
  if (!res.ok || !res.body) throw new Error(`${entry.path}: download answered ${res.status}`);
  let got = 0;
  const tick = setInterval(
    () =>
      process.stdout.write(
        `\r  get   ${entry.path}  ${(got / 1e6).toFixed(0)} / ${(entry.size / 1e6).toFixed(0)} MB   `,
      ),
    500,
  );
  const source = Readable.fromWeb(res.body);
  source.on("data", (c) => (got += c.length));
  try {
    await pipeline(source, createWriteStream(part));
  } finally {
    clearInterval(tick);
  }
  process.stdout.write(`\r  get   ${entry.path}  ${(entry.size / 1e6).toFixed(0)} MB   \n`);
  if ((await stat(part)).size !== entry.size)
    throw new Error(`${entry.path}: size does not match (download cut short?)`);
  if (expected && (await sha256(part)) !== expected)
    throw new Error(`${entry.path}: checksum does not match`);
  await rename(part, target);
}

async function readInstalled() {
  try {
    const list = JSON.parse(await readFile(join(MODELS, "installed.json"), "utf8"));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

const writeInstalled = (list) =>
  writeFile(join(MODELS, "installed.json"), JSON.stringify(list, null, 2) + "\n");

async function main(argv) {
  const manifest = JSON.parse(await readFile(join(MODELS, "manifest.json"), "utf8"));
  const cpuOnly = argv.includes("--cpu-only");
  const remove = argv.includes("--remove");
  const id = argv.find((a) => !a.startsWith("--"));
  if (!id) {
    console.log("Models available:\n");
    for (const m of manifest.models) console.log(`  ${m.id.padEnd(24)} ${m.name}, ${m.size}, ${m.licence}`);
    console.log("\nInstall one with:  npm run model -- <id>");
    return;
  }
  if (!safeId(id)) throw new Error("That is not a valid model name.");
  if (remove) {
    await rm(join(MODELS, id), { recursive: true, force: true });
    await writeInstalled((await readInstalled()).filter((m) => m.id !== id));
    console.log(`Removed ${id}.`);
    return;
  }
  const m = manifest.models.find((x) => x.id === id);
  if (!m) throw new Error(`Unknown model "${id}". Run "npm run model" to see the list.`);
  const dtypes = cpuOnly ? [m.dtypeCPU] : [...new Set([m.dtypeGPU, m.dtypeCPU])];
  console.log(`Looking up ${m.repo} ...`);
  const tree = await getJson(`${HUB}/api/models/${m.repo}/tree/main?recursive=true`);
  const { files, missing } = selectFiles(tree, dtypes);
  if (missing.length)
    throw new Error(`The repository does not have the expected files: ${missing.join(", ")}`);
  const total = files.reduce((a, f) => a + f.size, 0);
  console.log(`Installing ${m.name}: ${files.length} files, ${(total / 1e6).toFixed(0)} MB`);
  const dir = join(MODELS, id);
  for (const f of files) await download(f, m.repo, dir);
  const list = (await readInstalled()).filter((x) => x.id !== id);
  list.push({
    id,
    name: m.name,
    size: `${Math.round(total / 1e6)} MB`,
    dtypeGPU: cpuOnly ? m.dtypeCPU : m.dtypeGPU,
    dtypeCPU: m.dtypeCPU,
    webgpu: !cpuOnly,
    licence: m.licence,
  });
  await writeInstalled(list);
  console.log(`\nDone. Reload Astra, open Settings > Local AI assistant, and press "Check the model".`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error("\nFailed: " + err.message);
    if (/fetch failed|ENOTFOUND|ECONN|answered 403/.test(err.message + (err.cause?.message || "")))
      console.error(
        "Could not reach huggingface.co. Check the connection, or download the files by hand (see models/README.md).",
      );
    process.exit(1);
  });
}
