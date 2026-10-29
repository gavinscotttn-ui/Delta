/* Runs the on-device language model in a background thread, so the page stays responsive.
   Everything it loads comes from this folder: model files from models/, the runtime from vendor/.
   It has no way to reach the network (see the Content Security Policy). */
import * as T from "../vendor/transformers/transformers.min.js";

let tokenizer = null;
let model = null;
let loaded = "";
let device = "";
let stopper = null;
let queue = Promise.resolve();

const channel = new MessageChannel();
const yieldToEventLoop = () =>
  new Promise((resolve) => {
    channel.port1.onmessage = resolve;
    channel.port2.postMessage(0);
  });

const post = (msg) => self.postMessage(msg);

/* Models come either from Astra's own models/ folder or from the browser's storage, where Astra installed them.
   Either way nothing is downloaded here: remote loading stays off. */
function configure(modelBase, hub) {
  const env = T.env;
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.useBrowserCache = !!hub;
  if (hub) env.remoteHost = hub;
  env.localModelPath = modelBase;
  const wasm = env.backends.onnx.wasm;
  wasm.wasmPaths = new URL("../vendor/transformers/", import.meta.url).href;
  /* Threads need cross-origin isolation; without it a single thread is used. */
  wasm.numThreads = self.crossOriginIsolated ? Math.min(4, (navigator.hardwareConcurrency || 2) - 1) : 1;
  wasm.proxy = false;
}

async function hasWebGPU() {
  try {
    return !!(navigator.gpu && (await navigator.gpu.requestAdapter()));
  } catch {
    return false;
  }
}

async function load({ id, modelBase, hub, model: name, dtype, preferGPU }) {
  if (loaded === name && model) return post({ type: "ready", id, model: name, device, ms: 0 });
  await unload();
  configure(modelBase, hub);
  const started = performance.now();
  const files = new Map();
  const progress = (p) => {
    if (p.status === "progress" && p.file) {
      files.set(p.file, { loaded: p.loaded || 0, total: p.total || 0 });
      let l = 0;
      let t = 0;
      for (const f of files.values()) {
        l += f.loaded;
        t += f.total;
      }
      post({ type: "progress", id, loaded: l, total: t });
    }
  };
  tokenizer = await T.AutoTokenizer.from_pretrained(name);
  const attempts = [];
  if (preferGPU && (await hasWebGPU())) attempts.push({ device: "webgpu", dtype: dtype.gpu });
  attempts.push({ device: "wasm", dtype: dtype.cpu });
  let lastError = null;
  for (const a of attempts) {
    try {
      model = await T.AutoModelForCausalLM.from_pretrained(name, {
        device: a.device,
        dtype: a.dtype,
        progress_callback: progress,
      });
      device = a.device;
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      model = null;
    }
  }
  if (!model) throw lastError || new Error("The model could not be loaded.");
  /* The generation loop only awaits promises, so the worker would never look at its message queue and a Stop request
     would sit unread until the answer finished. Yielding once per token lets "stop" through. */
  const forward = model.forward.bind(model);
  model.forward = async (inputs) => {
    await yieldToEventLoop();
    return forward(inputs);
  };
  loaded = name;
  post({
    type: "ready",
    id,
    model: name,
    device,
    ms: Math.round(performance.now() - started),
  });
}

async function generate({ id, messages, maxNewTokens }) {
  if (!model) throw new Error("The model is not loaded.");
  const inputs = tokenizer.apply_chat_template(messages, {
    add_generation_prompt: true,
    return_dict: true,
  });
  const promptTokens = inputs.input_ids.dims[1];
  stopper = new T.InterruptableStoppingCriteria();
  let count = 0;
  const started = performance.now();
  const streamer = new T.TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text) => post({ type: "delta", id, text }),
    token_callback_function: () => {
      count++;
    },
  });
  await model.generate({
    ...inputs,
    max_new_tokens: maxNewTokens,
    do_sample: false,
    repetition_penalty: 1.1,
    streamer,
    stopping_criteria: stopper,
  });
  const seconds = (performance.now() - started) / 1000;
  post({
    type: "done",
    id,
    stats: {
      promptTokens,
      tokens: count,
      seconds,
      tokensPerSecond: seconds > 0 ? count / seconds : 0,
    },
  });
}

async function unload() {
  try {
    await model?.dispose?.();
  } catch {
    /* already gone */
  }
  model = null;
  tokenizer = null;
  loaded = "";
  device = "";
}

self.onmessage = (e) => {
  const msg = e.data || {};
  if (msg.type === "stop") {
    stopper?.interrupt();
    return;
  }
  /* One job at a time: loading and generating share the model. */
  queue = queue.then(async () => {
    try {
      if (msg.type === "load") await load(msg);
      else if (msg.type === "generate") await generate(msg);
      else if (msg.type === "unload") {
        await unload();
        post({ type: "unloaded", id: msg.id });
      }
    } catch (err) {
      post({
        type: "error",
        id: msg.id,
        message: String((err && err.message) || err),
      });
    }
  });
};
post({ type: "boot" });
