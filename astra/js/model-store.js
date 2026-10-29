/* Installs the AI model into the browser, once, from Hugging Face; afterwards it is read from the browser's own
   storage and never downloaded again. Every large file is checked against the SHA-256 Hugging Face publishes.
   This is the only code in Astra that uses the network, and only when someone presses "Add the AI assistant". */
window.AstraModels = (function () {
  "use strict";

  /* Where the runtime looks for model files. The worker reads from the same cache with downloads switched off. */
  const CACHE = "transformers-cache";
  const RECORD = "astra.models.v1";
  let hub = "https://huggingface.co/";

  /* Models Astra can install, smallest first. The first suitable one is the default. */
  const CATALOG = [
    {
      id: "qwen2.5-0.5b-instruct",
      repo: "onnx-community/Qwen2.5-0.5B-Instruct",
      name: "Qwen2.5 0.5B Instruct",
      licence: "Apache-2.0",
      note: "Quick on any recent computer.",
    },
    {
      id: "qwen2.5-1.5b-instruct",
      repo: "onnx-community/Qwen2.5-1.5B-Instruct",
      name: "Qwen2.5 1.5B Instruct",
      licence: "Apache-2.0",
      note: "Better answers. Best with a graphics card (WebGPU).",
    },
  ];

  /* Weight files by precision, as named in onnx-community repositories. Preference order per device. */
  const WEIGHTS = {
    q4f16: "onnx/model_q4f16.onnx",
    q4: "onnx/model_q4.onnx",
    q8: "onnx/model_quantized.onnx",
    int8: "onnx/model_int8.onnx",
    fp16: "onnx/model_fp16.onnx",
    fp32: "onnx/model.onnx",
  };
  const PREFER = { webgpu: ["q4f16", "q4", "fp16"], wasm: ["q4", "q8", "int8", "fp32"] };
  const CONFIG = ["config.json", "generation_config.json", "tokenizer.json", "tokenizer_config.json"];

  const fileUrl = (repo, path) => `${hub}${repo}/resolve/main/${path}`;

  async function hasWebGPU() {
    try {
      return !!(navigator.gpu && (await navigator.gpu.requestAdapter()));
    } catch {
      return false;
    }
  }

  /* Which files to fetch for this device, from a repository listing (the Hub's tree API). Pure, so it can be tested. */
  function choose(tree, device) {
    const files = new Map(tree.filter((f) => f.type === "file").map((f) => [f.path, f]));
    const missing = CONFIG.filter((c) => !files.has(c));
    if (missing.length) return { error: `The model is missing ${missing.join(", ")}.` };
    const dtype = (PREFER[device] || PREFER.wasm).find((d) => files.has(WEIGHTS[d]));
    if (!dtype) return { error: "No weights suitable for this computer were found." };
    const weight = WEIGHTS[dtype];
    const extra = [...files.keys()].filter((p) => p.startsWith(weight + "_data"));
    const picked = [...CONFIG, weight, ...extra].map((p) => files.get(p));
    /* Nothing is downloaded that cannot be checked: every file needs its size, and either the SHA-256 Hugging Face
       publishes for large files or the git object id it lists for small ones. */
    const unchecked = picked.filter(
      (f) =>
        !(f.size > 0) ||
        !(/^[0-9a-f]{64}$/.test(f.lfs?.oid || "") || (!f.lfs && /^[0-9a-f]{40}$/.test(f.oid || ""))),
    );
    if (unchecked.length)
      return { error: `The model's files cannot be checked (${unchecked.map((f) => f.path).join(", ")}).` };
    if (picked.some((f) => f.path.startsWith("onnx/") && !f.lfs?.oid))
      return { error: "The model's weights have no published checksum." };
    return { dtype, device, files: picked, bytes: picked.reduce((n, f) => n + f.size, 0) };
  }

  /* Looks up the repository and decides what to download. */
  async function plan(entry, { signal } = {}) {
    const device = (await hasWebGPU()) ? "webgpu" : "wasm";
    const res = await fetch(`${hub}api/models/${entry.repo}/tree/main?recursive=true`, { signal });
    if (!res.ok)
      throw new Error(`Could not look up the model (${res.status}). Check the internet connection.`);
    const chosen = choose(await res.json(), device);
    if (chosen.error) throw new Error(chosen.error);
    return { ...chosen, entry };
  }

  /* SHA-256 fed as the bytes arrive. Web Crypto only hashes a whole buffer, which would mean holding a second copy of
     a file of several hundred megabytes in memory just to check it. */
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  function sha256() {
    const H = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    const W = new Uint32Array(64);
    const block = new Uint8Array(64);
    let fill = 0;
    let length = 0;
    function compress(b, o) {
      for (let i = 0; i < 16; i++)
        W[i] = (b[o + i * 4] << 24) | (b[o + i * 4 + 1] << 16) | (b[o + i * 4 + 2] << 8) | b[o + i * 4 + 3];
      for (let i = 16; i < 64; i++) {
        const x = W[i - 15];
        const y = W[i - 2];
        const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
      }
      let a = H[0],
        bb = H[1],
        c = H[2],
        d = H[3],
        e = H[4],
        f = H[5],
        g = H[6],
        h = H[7];
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const t2 = (S0 + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
        h = g;
        g = f;
        f = e;
        e = (d + t1) | 0;
        d = c;
        c = bb;
        bb = a;
        a = (t1 + t2) | 0;
      }
      H[0] += a;
      H[1] += bb;
      H[2] += c;
      H[3] += d;
      H[4] += e;
      H[5] += f;
      H[6] += g;
      H[7] += h;
    }
    return {
      update(data) {
        let i = 0;
        length += data.length;
        if (fill) {
          const take = Math.min(64 - fill, data.length);
          block.set(data.subarray(0, take), fill);
          fill += take;
          i = take;
          if (fill < 64) return;
          compress(block, 0);
          fill = 0;
        }
        for (; i + 64 <= data.length; i += 64) compress(data, i);
        block.set(data.subarray(i), 0);
        fill = data.length - i;
      },
      hex() {
        const bits = length * 8;
        const tail = new Uint8Array(fill < 56 ? 64 : 128);
        tail.set(block.subarray(0, fill));
        tail[fill] = 0x80;
        const view = new DataView(tail.buffer);
        view.setUint32(tail.length - 8, Math.floor(bits / 2 ** 32));
        view.setUint32(tail.length - 4, bits >>> 0);
        for (let o = 0; o < tail.length; o += 64) compress(tail, o);
        return [...H].map((x) => x.toString(16).padStart(8, "0")).join("");
      },
    };
  }

  /* Git's id for a small file: SHA-1 of "blob <size>\0" followed by the bytes. */
  async function gitBlobId(bytes) {
    const head = new TextEncoder().encode(`blob ${bytes.length}\0`);
    const all = new Uint8Array(head.length + bytes.length);
    all.set(head);
    all.set(bytes, head.length);
    return [...new Uint8Array(await crypto.subtle.digest("SHA-1", all))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  /* Downloads one file straight into the browser's storage, checking its size and fingerprint as it streams, so a
     large file is never held in memory. A file that fails is deleted, never used. */
  async function fetchFile(repo, f, cache, onBytes, signal) {
    const url = fileUrl(repo, f.path);
    const res = await fetch(url, { signal });
    if (!res.ok || !res.body) throw new Error(`${f.path} could not be downloaded (${res.status}).`);
    const fail = async (message) => {
      await cache.delete(url);
      throw new Error(message);
    };
    if (!f.lfs) {
      /* Small files (settings and tokenizer): read whole, checked against the git id before they are stored. */
      const bytes = new Uint8Array(await res.arrayBuffer());
      onBytes(bytes.length);
      if (bytes.length !== f.size) return fail(`${f.path} was cut short. Try again.`);
      if ((await gitBlobId(bytes)) !== f.oid)
        return fail(`${f.path} failed its integrity check, so it was not used.`);
      await cache.put(url, new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } }));
      return bytes.length;
    }
    const hash = sha256();
    let got = 0;
    const counted = res.body.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          hash.update(chunk);
          got += chunk.length;
          onBytes(chunk.length);
          controller.enqueue(chunk);
        },
      }),
    );
    await cache.put(
      url,
      new Response(counted, {
        headers: { "Content-Type": "application/octet-stream", "Content-Length": String(f.size) },
      }),
    );
    if (got !== f.size) return fail(`${f.path} was cut short. Try again.`);
    if (hash.hex() !== f.lfs.oid) return fail(`${f.path} failed its integrity check, so it was not used.`);
    return got;
  }

  /* Files that downloaded and passed their check, by address, so an interrupted install resumes without trusting
     anything it did not verify. */
  const CHECKED = "astra.models.checked.v1";
  const readChecked = () => {
    try {
      const x = JSON.parse(localStorage.getItem(CHECKED) || "{}");
      return x && typeof x === "object" ? x : {};
    } catch {
      return {};
    }
  };
  const writeChecked = (x) => {
    try {
      localStorage.setItem(CHECKED, JSON.stringify(x));
    } catch {
      /* storage blocked: an interrupted install starts again from the beginning */
    }
  };

  const readRecord = () => {
    try {
      const list = JSON.parse(localStorage.getItem(RECORD) || "[]");
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  };
  const writeRecord = (list) => {
    try {
      localStorage.setItem(RECORD, JSON.stringify(list));
    } catch {
      /* storage blocked: the model still loads from the cache this session */
    }
  };

  /* Installs a model. onProgress({ loaded, total, file }). Resolves to the installed record. */
  /* A dropped connection shows up as a bare TypeError ("Failed to fetch"); say what it means instead. */
  const plainError = (err) =>
    err instanceof TypeError
      ? new Error(
          "The download stopped. Check the internet connection and press Add again: finished files are kept.",
        )
      : err;

  async function install(entry, options = {}) {
    try {
      return await installModel(entry, options);
    } catch (err) {
      throw plainError(err);
    }
  }

  async function installModel(entry, { onProgress, signal } = {}) {
    if (typeof caches === "undefined") throw new Error("This browser cannot store the model.");
    const p = await plan(entry, { signal });
    try {
      await navigator.storage?.persist?.();
    } catch {
      /* the extension's unlimitedStorage permission covers it anyway */
    }
    try {
      const { quota, usage } = (await navigator.storage?.estimate?.()) || {};
      if (quota && quota - usage < p.bytes * 1.05)
        throw new RangeError(
          `There is not enough free space for the model: it needs ${Math.ceil(p.bytes / 1e6)} MB. Free some disk space and try again.`,
        );
    } catch (err) {
      /* Only our own "not enough space" stops it; if the estimate is unavailable, the browser decides. */
      if (err instanceof RangeError) throw err;
    }
    const cache = await caches.open(CACHE);
    let loaded = 0;
    const passed = readChecked();
    for (const f of p.files) {
      const id = f.lfs?.oid || f.oid;
      if (passed[fileUrl(entry.repo, f.path)] === id && (await cache.match(fileUrl(entry.repo, f.path)))) {
        loaded += f.size || 0;
        onProgress?.({ loaded, total: p.bytes, file: f.path });
        continue;
      }
      await fetchFile(
        entry.repo,
        f,
        cache,
        (n) => {
          loaded += n;
          onProgress?.({ loaded, total: p.bytes, file: f.path });
        },
        signal,
      );
      passed[fileUrl(entry.repo, f.path)] = id;
      writeChecked(passed);
    }
    const record = {
      id: entry.id,
      repo: entry.repo,
      name: entry.name,
      dtype: p.dtype,
      device: p.device,
      bytes: p.bytes,
      files: p.files.map((f) => f.path),
      hub,
      installedAt: new Date().toISOString(),
    };
    writeRecord([...readRecord().filter((r) => r.id !== entry.id), record]);
    return record;
  }

  /* Installed models whose files are all still in the browser's storage. */
  async function installed() {
    if (typeof caches === "undefined") return [];
    const cache = await caches.open(CACHE);
    const out = [];
    for (const r of readRecord()) {
      const present = await Promise.all(
        r.files.map((p) => cache.match(`${r.hub}${r.repo}/resolve/main/${p}`)),
      );
      if (present.every(Boolean)) out.push(r);
    }
    return out;
  }

  async function remove(id) {
    const r = readRecord().find((x) => x.id === id);
    if (r && typeof caches !== "undefined") {
      const cache = await caches.open(CACHE);
      await Promise.all(r.files.map((p) => cache.delete(`${r.hub}${r.repo}/resolve/main/${p}`)));
    }
    writeRecord(readRecord().filter((x) => x.id !== id));
  }

  /* Tests point this at a stand-in for Hugging Face. */
  const configure = ({ hub: h } = {}) => {
    if (h) hub = h.endsWith("/") ? h : h + "/";
  };

  return { CATALOG, choose, sha256, plan, install, installed, remove, configure, hub: () => hub };
})();
