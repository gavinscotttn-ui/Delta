# Models

This folder is optional. The easy way to get the AI assistant is **Settings → AI assistant → Add the AI assistant**, which installs it into the browser. Use this folder only for a computer that cannot reach Hugging Face: install the model here on one that can, then copy the folder across. Nothing in it is ever sent anywhere: the model runs inside your browser.

## Install a model (once, needs internet)

```
npm run model                       # lists what is available
npm run model -- qwen2.5-0.5b-instruct
```

Then reload Astra, open **Settings → AI assistant**, choose the model, press **Check the model**, then tick **Use the local AI assistant** and **Save**.

After that it works with no connection at all. To remove one: `npm run model -- --remove qwen2.5-0.5b-instruct`.

## Choosing

| Model                 | Download     | Notes                                                                                                     |
| --------------------- | ------------ | --------------------------------------------------------------------------------------------------------- |
| Qwen2.5 0.5B Instruct | about 0.5 GB | Fast, even without a graphics card. Follows short sources well; weaker on long procedures.                |
| Qwen2.5 1.5B Instruct | about 1.2 GB | Noticeably better answers. Wants WebGPU (a recent Chrome or Edge with a graphics card) to be comfortable. |

Both are Apache-2.0 licensed. Speed depends on your machine: use **Check the model** to see how long it takes to load and roughly how fast it writes on yours.

## Doing it by hand

If the installer cannot reach `huggingface.co`, download these files from the model's page on Hugging Face (use the `onnx-community` repository named in `manifest.json`) into `models/<id>/`, keeping the folder layout:

```
config.json  generation_config.json  tokenizer.json  tokenizer_config.json
onnx/model_q4.onnx            (CPU)
onnx/model_q4f16.onnx         (WebGPU, optional)
```

Then add an entry to `models/installed.json`:

```json
[
  {
    "id": "qwen2.5-0.5b-instruct",
    "name": "Qwen2.5 0.5B Instruct",
    "dtypeGPU": "q4f16",
    "dtypeCPU": "q4",
    "webgpu": true
  }
]
```

(Use `"webgpu": false` if you did not download the `q4f16` file.)

## Where it runs

The model needs a worker and WebAssembly, which browsers allow for **extensions** but not for a page opened straight from disk (`file://`). Install Astra as the new-tab extension (README) to use it. The Ask page works from guides and documents either way.
