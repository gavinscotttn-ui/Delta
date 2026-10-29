# Vendored runtime

Runs a small language model inside the browser, offline.

- `transformers.min.js` is `@huggingface/transformers` 3.8.1 (Apache-2.0), the self-contained build with ONNX Runtime Web included. See `LICENSE-transformers.js.txt`.
- `ort-wasm-simd-threaded.jsep.mjs` and `.wasm` are ONNX Runtime Web 1.22 (MIT), the WebAssembly engine used for both CPU and WebGPU.

Copied unchanged from the npm package. To update: `npm install @huggingface/transformers@<version>` somewhere temporary and copy those three files from its `dist/` folder, then run `npm test`.
