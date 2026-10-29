# The Ask assistant

Ask answers questions from your guides and the supplier documents. It has two layers.

## 1. Offline (always on, no key, nothing leaves the device)

- Understands how engineers actually phrase faults ("can only hear one side", "won't ring", "can't dial 0800") through a short list of plain synonym groups, not a language model.
- Ranks the guides, workflows and document pages with BM25. A word nobody has written about counts heavily against a match, so "reset my Gmail password" is reported as not covered instead of being answered with the nearest guide.
- **Lookups** ("shortcode for DND", "profile rule for T46U", "which ports does Voxone need", "Cyber Essentials price") are answered straight from the guides' tables, with click-to-copy codes. A table is shown only when the question asks for a value.
- Every answer shows the words that decided the match, so a wrong match is visible.
- A follow-up that sounds like one ("what about Android?") is searched together with the question before it.

How good is it? Measured on realistic questions: the right guide is the first result for 38 of 40 questions it was tuned on and in the top three for all 40. On 18 questions written afterwards it was in the top three for 17. Questions the library cannot answer are reported as weak or not covered; one known false positive is "set up Outlook email on my phone", which matches the Collaborate guides. Tests in `tests/assistant.test.mjs` keep these numbers from slipping.

## 2. Optional local AI (off by default, runs on your computer)

A small language model writes a short answer from the guides and documents that layer 1 found. The model runs **inside the browser**. There is no account and no key, and nothing you type is sent anywhere.

**Set up**: Settings > AI assistant > **Add the AI assistant**. That is the only step. Astra looks the model up on Hugging Face, picks the right precision for the computer (WebGPU or processor), downloads it with a progress bar (Cancel stops it), checks every weight file against the SHA-256 Hugging Face publishes, stores it in the browser's own storage and switches the assistant on. Ask writes answers straight away, and from then on the model loads from the browser with downloads switched off, so it works with no internet. **Remove** deletes it again.

**Network.** The Content Security Policy is `connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co`: the browser refuses every other outside address. Astra contacts Hugging Face only while a download you started is running (`js/model-store.js` is the only code that does).

**Installing from disk instead** (for a computer that cannot reach Hugging Face): `npm run model -- qwen2.5-0.5b-instruct` on a computer that can, then copy `models/` across; see `models/README.md`. Models in `models/` appear in Settings alongside any added from the browser.

**It only works in the installed extension.** The model runs in a Web Worker with WebAssembly, which browsers refuse for a page opened straight from disk. From a plain file, Settings says so and Ask keeps working offline.

**What the model is given**, per question: a short rule list, up to two guides (the parts that best match the question, about 1,600 characters each), up to two document passages (about 700 characters), the last two exchanges, and the current case only if you tick that option. It never sees the rest of your workspace. Small models read short sources far better than long ones, which is why the excerpts are small.

**How it is kept honest**

- It is told to answer only from the numbered sources, copy commands exactly, cite with [1], and say so when the sources do not cover the question.
- A question the library cannot answer is not given to the model at all.
- Afterwards Astra checks every command, URL, dial code, IP address, **price, phone number, percentage and time period** in the answer against the sources and the whole library, however it is written (£180, £180.00 and GBP 180 are the same price). Anything it cannot find is flagged **Not found in your guides or documents** with a warning not to give it to a customer.
- Citation numbers link to the guides and pages used. You can press Stop at any time and keep what was written.

**Models.** `qwen2.5-0.5b-instruct` is small and quick. `qwen2.5-1.5b-instruct` answers better but wants WebGPU. Others can be added to `models/manifest.json` if they are published as ONNX for Transformers.js with a chat template. Speed is whatever your machine gives: **Check the model** reports load time and writing speed.

**The runtime** is Transformers.js and ONNX Runtime Web, copied unchanged into `vendor/transformers/` (licences included). WebGPU is used when available and falls back to the processor.

## What has and has not been tested

Tested automatically in a real browser, under the same Content Security Policy as the extension: the worker starts, the WebAssembly runtime loads, a model loads from `models/`, a model installs from a stand-in Hugging Face (tree listing, download, SHA-256 check, an altered file rejected) and then runs with that server unreachable, one click in Settings adds the model and Ask uses it, text streams in pieces, Stop interrupts a model that would never finish, a missing model gives a plain message, nothing is requested outside the page's own origin, and Ask and "Check the model" work end to end. The model used for that is a tiny hand-made one (`tools/make-tiny-model.py`) that always says the same sentence. The rest (prompt size, citations, the answer checker, retry, follow-ups, Settings, backups) is tested with a stand-in engine.

**Not tested: a real model.** The sandbox these tests ran in cannot reach Hugging Face, so the Qwen files have never been loaded here. That means three things are unknown until you run it: the repository file names (the installer reads the repository's file list and stops with a clear message if what it needs is missing), how long a real model takes to load on your machine, and how good its answers are. Press **Check the model** first; it asks three questions with known answers and reports the time and speed. If a real model fails the plumbing, the error message in Settings says why.

## Known limits

- It can only answer from what is in the guides and documents. Faults nobody has written up will not be found.
- The model can still misread a source. The checker catches invented commands and codes, not a wrong explanation: read the steps against the cited guide.
- Wording the synonym list has never seen can miss. Add groups to `SYNONYMS` in `js/assistant-core.js` and add the question to `tests/golden-queries.json`.
