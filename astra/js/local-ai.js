/* Astra's on-device assistant: talks to a language model running in a background thread (js/local-llm.worker.js).
   Nothing here touches the network. Model files are read from this extension's own models/ folder.
   No DOM, no state. */
window.AstraAI = (function () {
  "use strict";

  const WORKER_URL = "js/local-llm.worker.js";
  let engine = null; /* replaceable, so tests can stand in for the real model */
  let worker = null;
  let nextId = 1;
  const waiting = new Map(); /* id -> handlers */
  let status = { state: "idle", model: "", device: "", loadedMs: 0 };
  let listeners = [];

  const notify = () => listeners.forEach((fn) => fn({ ...status }));
  const setStatus = (patch) => {
    status = { ...status, ...patch };
    notify();
  };

  /* ---------------------------------------------------------- support */

  function support() {
    if (engine) return { ok: true, reason: "" };
    if (location.protocol === "file:")
      return {
        ok: false,
        reason: "The AI assistant runs in the Astra browser extension, not in a page opened from a file.",
      };
    if (typeof Worker === "undefined" || typeof WebAssembly === "undefined")
      return {
        ok: false,
        reason: "This browser cannot run WebAssembly workers.",
      };
    return { ok: true, reason: "" };
  }

  const modelBase = () => new URL("models/", document.baseURI).href;

  /* models/installed.json is written by tools/get-model.mjs and lists what is actually on disk. */
  /* Models shipped in Astra's models/ folder (listed in models/installed.json), plus models installed into the
     browser from Settings. */
  async function installed() {
    let folder = [];
    try {
      const res = await fetch(modelBase() + "installed.json", { cache: "no-store" });
      if (res.ok) {
        const list = await res.json();
        folder = Array.isArray(list)
          ? list.filter((m) => m && typeof m.id === "string" && /^[\w.-]+$/.test(m.id))
          : [];
      }
    } catch {
      /* no models folder: fine */
    }
    let browser = [];
    try {
      browser = (await window.AstraModels?.installed()) || [];
    } catch {
      /* storage unavailable */
    }
    const ids = new Set(folder.map((m) => m.id));
    return [
      ...folder,
      ...browser
        .filter((r) => !ids.has(r.id))
        .map((r) => ({
          id: r.id,
          name: r.name,
          size: `${Math.round(r.bytes / 1e6)} MB`,
          repo: r.repo,
          hub: r.hub,
          dtype: r.dtype,
          webgpu: r.device === "webgpu",
          source: "browser",
        })),
    ];
  }

  /* --------------------------------------------------------- worker */

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(WORKER_URL, { type: "module" });
    worker.onmessage = (e) => {
      const m = e.data || {};
      const h = waiting.get(m.id);
      if (m.type === "progress") h?.onProgress?.(m);
      else if (m.type === "delta") h?.onDelta?.(m.text);
      else if (m.type === "ready" || m.type === "done" || m.type === "unloaded") {
        waiting.delete(m.id);
        h?.resolve(m);
      } else if (m.type === "error") {
        waiting.delete(m.id);
        h?.reject(new Error(friendly(m.message)));
      }
    };
    worker.onerror = (e) => {
      const err = new Error(
        "The local AI could not start" +
          (e && e.message ? ` (${e.message})` : "") +
          ". Check the model files.",
      );
      for (const h of waiting.values()) h.reject(err);
      waiting.clear();
      worker?.terminate();
      worker = null;
      setStatus({ state: "idle", model: "", device: "" });
    };
    return worker;
  }

  function friendly(message) {
    const m = String(message || "");
    if (/Could not locate file|404|not found|Failed to fetch|Unsupported model type/i.test(m))
      return "The AI model's files are incomplete. Ask your administrator to reinstall the model.";
    if (/memory|allocation|out of memory|OOM/i.test(m))
      return "The device ran out of memory. Close other tabs or choose the smaller model in Settings.";
    return m || "The local AI failed.";
  }

  const call = (msg, handlers = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      waiting.set(id, { resolve, reject, ...handlers });
      ensureWorker().postMessage({ ...msg, id });
    });

  /* ------------------------------------------------------------- API */

  async function load(model, onProgress) {
    if (engine) {
      await engine.load?.(model, onProgress);
      setStatus({ state: "ready", model, device: "test" });
      return status;
    }
    const s = support();
    if (!s.ok) throw new Error(s.reason);
    setStatus({ state: "loading", model });
    try {
      const info = (await installed()).find((m) => m.id === model);
      if (!info) throw new Error("That AI model is not installed on this computer.");
      const res = await call(
        {
          type: "load",
          modelBase: modelBase(),
          /* Browser-installed models are read from the browser's storage under their Hugging Face name. */
          hub: info.source === "browser" ? info.hub : "",
          model: info.source === "browser" ? info.repo : model,
          dtype: {
            gpu: info.dtypeGPU || info.dtype || "q4f16",
            cpu: info.dtypeCPU || info.dtype || "q4",
          },
          preferGPU: info.webgpu !== false,
        },
        { onProgress },
      );
      setStatus({
        state: "ready",
        model,
        device: res.device,
        loadedMs: res.ms,
      });
      return status;
    } catch (err) {
      setStatus({ state: "idle", model: "", device: "" });
      throw err;
    }
  }

  /* messages: [{role, content}]. Returns { text, stats }. Rejects with Error("Stopped.") if aborted before any text. */
  async function chat({ model, messages, onDelta, onProgress, signal, maxNewTokens = 420 }) {
    if (signal?.aborted) throw new Error("Stopped.");
    if (status.state !== "ready" || status.model !== model) await load(model, onProgress);
    /* Stop pressed while the model was still loading. */
    if (signal?.aborted) throw new Error("Stopped.");
    let text = "";
    const emit = (piece) => {
      text += piece;
      onDelta && onDelta(piece, text);
    };
    const stop = () => (engine ? engine.stop?.() : worker?.postMessage({ type: "stop" }));
    signal?.addEventListener("abort", stop);
    setStatus({ state: "busy" });
    try {
      let result;
      if (engine)
        result = await engine.generate({
          messages,
          maxNewTokens,
          onDelta: emit,
          signal,
        });
      else
        result = await call({ type: "generate", messages, maxNewTokens }, { onDelta: emit }).then((m) => m);
      return { text, stats: (result && result.stats) || {} };
    } finally {
      signal?.removeEventListener("abort", stop);
      /* Unloaded meanwhile: stay idle rather than claim a model that is no longer there. */
      if (status.state === "busy") setStatus({ state: "ready" });
    }
  }

  async function unload() {
    if (engine) engine.unload?.();
    else if (worker) {
      worker.terminate();
      worker = null;
    }
    /* Anything still waiting on the worker ends now, rather than hanging on "writing…" for ever. */
    for (const h of waiting.values()) h.reject(new Error("Stopped."));
    waiting.clear();
    setStatus({ state: "idle", model: "", device: "" });
  }

  /* A short reading test for a freshly installed model: three questions whose answers sit in a tiny made-up source.
     It proves the model loads and can follow the "answer only from the sources" rule on this device. It does not prove
     the model is good at everything: judge it on real questions too. */
  const CHECKS = [
    {
      source: "Do Not Disturb: dial *78 to turn it on and *79 to turn it off.",
      q: "What code turns Do Not Disturb on?",
      expect: "*78",
    },
    {
      source: "Voxone handsets register using SIP over UDP port 5060.",
      q: "Which UDP port do Voxone handsets register on?",
      expect: "5060",
    },
    {
      source: "After saving a profile rule, wait 20 minutes before rebooting the handset.",
      q: "How long should I wait after saving a profile rule?",
      expect: "20",
    },
  ];

  async function selfTest(model, { onStep } = {}) {
    const started = performance.now();
    const results = [];
    await load(model);
    const loadMs = Math.round(performance.now() - started);
    let tokens = 0;
    let seconds = 0;
    for (const c of CHECKS) {
      onStep && onStep(results.length + 1, CHECKS.length);
      const messages = [
        {
          role: "system",
          content: "Answer ONLY from the SOURCES. Be brief. Copy codes and numbers exactly. Cite like [1].",
        },
        {
          role: "user",
          content: `SOURCES:\n[1] Test\n${c.source}\n\nQUESTION: ${c.q}`,
        },
      ];
      const { text, stats } = await chat({ model, messages, maxNewTokens: 60 });
      tokens += stats.tokens || 0;
      seconds += stats.seconds || 0;
      results.push({
        question: c.q,
        answer: text.trim(),
        pass: text.includes(c.expect),
      });
    }
    return {
      model,
      device: status.device,
      loadMs,
      tokensPerSecond: seconds > 0 ? tokens / seconds : 0,
      results,
      passed: results.filter((r) => r.pass).length,
      total: results.length,
    };
  }

  const useEngine = (e) => {
    engine = e;
    status = { state: "idle", model: "", device: "", loadedMs: 0 };
  };

  const onStatus = (fn) => {
    listeners.push(fn);
    return () => (listeners = listeners.filter((x) => x !== fn));
  };

  return {
    support,
    installed,
    load,
    chat,
    unload,
    selfTest,
    useEngine,
    onStatus,
    status: () => ({ ...status }),
  };
})();
