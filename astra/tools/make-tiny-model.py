#!/usr/bin/env python3
"""Builds two tiny test language models for tests/local-ai.test.mjs.

They are NOT useful models. Each one is a hand-made ONNX graph that always continues a fixed chain of words, so the
tests can prove that Astra's worker, the ONNX runtime, the tokenizer, streaming and Stop all work, without needing
a real model download. Run: python3 tools/make-tiny-model.py   (needs: pip install onnx numpy)
The output is committed under tests/fixtures/models/, so you only need this to regenerate it."""
import json
import os

import numpy as np
import onnx
from onnx import TensorProto as T
from onnx import helper as h
from onnx import numpy_helper as nh

OUT = os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures", "models")

SPECIAL = ["[UNK]", "<|im_start|>", "<|im_end|>"]
TEMPLATE = (
    "{% for m in messages %}<|im_start|> {{ m['role'] }} {{ m['content'] }} <|im_end|> {% endfor %}"
    "{% if add_generation_prompt %}<|im_start|> assistant{% endif %}"
)


def build(name, answer, loop=None):
    """answer: words said in order, then end-of-turn. loop: if set, repeat these words forever instead of ending."""
    words = ["system", "user", "assistant"] + answer + (loop or [])
    vocab = {}
    for w in SPECIAL + words:
        vocab.setdefault(w, len(vocab))
    v = len(vocab)
    eos = vocab["<|im_end|>"]

    nxt = {vocab["assistant"]: vocab[answer[0]]}
    for a, b in zip(answer, answer[1:]):
        nxt[vocab[a]] = vocab[b]
    if loop:
        nxt[vocab[answer[-1]]] = vocab[loop[0]]
        for a, b in zip(loop, loop[1:] + loop[:1]):
            nxt[vocab[a]] = vocab[b]
    else:
        nxt[vocab[answer[-1]]] = eos
    w = np.zeros((v, v), dtype=np.float32)
    for a, b in nxt.items():
        w[a, b] = 10.0
    w[:, eos] += 0.0
    emb = np.random.RandomState(1).randn(v, 2).astype(np.float32)

    ids = h.make_tensor_value_info("input_ids", T.INT64, ["batch", "seq"])
    mask = h.make_tensor_value_info("attention_mask", T.INT64, ["batch", "total"])
    pk = h.make_tensor_value_info("past_key_values.0.key", T.FLOAT, ["batch", 1, "past", 2])
    pv = h.make_tensor_value_info("past_key_values.0.value", T.FLOAT, ["batch", 1, "past", 2])
    logits = h.make_tensor_value_info("logits", T.FLOAT, ["batch", "seq", v])
    ok = h.make_tensor_value_info("present.0.key", T.FLOAT, ["batch", 1, "total2", 2])
    ov = h.make_tensor_value_info("present.0.value", T.FLOAT, ["batch", 1, "total2", 2])
    nodes = [
        h.make_node("Gather", ["W", "input_ids"], ["logits"], axis=0),
        h.make_node("Gather", ["E", "input_ids"], ["e"], axis=0),
        h.make_node("Unsqueeze", ["e", "ax1"], ["knew"]),
        h.make_node("Concat", ["past_key_values.0.key", "knew"], ["present.0.key"], axis=2),
        h.make_node("Concat", ["past_key_values.0.value", "knew"], ["present.0.value"], axis=2),
    ]
    graph = h.make_graph(
        nodes,
        name,
        [ids, mask, pk, pv],
        [logits, ok, ov],
        [nh.from_array(w, "W"), nh.from_array(emb, "E"), nh.from_array(np.array([1], dtype=np.int64), "ax1")],
    )
    model = h.make_model(graph, opset_imports=[h.make_opsetid("", 17)])
    model.ir_version = 9
    onnx.checker.check_model(model)

    d = os.path.join(OUT, name)
    os.makedirs(os.path.join(d, "onnx"), exist_ok=True)
    onnx.save(model, os.path.join(d, "onnx", "model.onnx"))
    json.dump(
        {
            "architectures": ["LlamaForCausalLM"],
            "model_type": "llama",
            "vocab_size": v,
            "hidden_size": 2,
            "intermediate_size": 4,
            "num_hidden_layers": 1,
            "num_attention_heads": 1,
            "num_key_value_heads": 1,
            "head_dim": 2,
            "max_position_embeddings": 512,
            "bos_token_id": vocab["<|im_start|>"],
            "eos_token_id": eos,
            "pad_token_id": 0,
        },
        open(os.path.join(d, "config.json"), "w"),
        indent=2,
    )
    json.dump({"eos_token_id": eos, "pad_token_id": 0, "do_sample": False}, open(os.path.join(d, "generation_config.json"), "w"))
    added = [
        {"id": vocab[s], "content": s, "single_word": False, "lstrip": False, "rstrip": False, "normalized": False, "special": True}
        for s in SPECIAL
    ]
    json.dump(
        {
            "version": "1.0",
            "truncation": None,
            "padding": None,
            "added_tokens": added,
            "normalizer": None,
            "pre_tokenizer": {"type": "WhitespaceSplit"},
            "post_processor": None,
            "decoder": None,
            "model": {
                "type": "WordPiece",
                "unk_token": "[UNK]",
                "continuing_subword_prefix": "##",
                "max_input_chars_per_word": 100,
                "vocab": vocab,
            },
        },
        open(os.path.join(d, "tokenizer.json"), "w"),
        indent=1,
    )
    json.dump(
        {
            "tokenizer_class": "PreTrainedTokenizerFast",
            "model_max_length": 512,
            "unk_token": "[UNK]",
            "bos_token": "<|im_start|>",
            "eos_token": "<|im_end|>",
            "pad_token": "[UNK]",
            "clean_up_tokenization_spaces": False,
            "chat_template": TEMPLATE,
        },
        open(os.path.join(d, "tokenizer_config.json"), "w"),
        indent=2,
    )


build("tiny-lm", ["Tiny", "test", "model:", "plumbing", "works", "[1]."])
build("tiny-loop", ["Going", "and"], loop=["going", "and"])
json.dump(
    [
        {"id": "tiny-lm", "name": "Tiny test model (says one fixed sentence)", "size": "1 KB", "dtype": "fp32", "webgpu": False},
        {"id": "tiny-loop", "name": "Tiny test model (never stops)", "size": "1 KB", "dtype": "fp32", "webgpu": False},
    ],
    open(os.path.join(OUT, "installed.json"), "w"),
    indent=2,
)
print("written to", os.path.abspath(OUT))
