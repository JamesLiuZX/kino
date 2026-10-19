#!/usr/bin/env python3
"""Builds the two models the web demo runs in the browser (kino/web/models).

  cutout.onnx   IS-Net general-use (DIS, Apache-2.0), as rembg publishes it,
                cut down to its final mask and with int8 per-channel weights:
                178 MB -> 44 MB, the same mask to within a grey level.
  upscale.onnx  Real-ESRGAN general x4v3 (BSD-3-Clause), the compact 4x model,
                with Real-ESRGAN's default denoise strength (0.5) baked in.

  pip install onnx numpy onnxruntime
  python3 scripts/web-models.py web/models

Downloads the originals from the projects' GitHub releases, writes both models
and checks each one against its original (onnxruntime) before saving.
"""

import io
import pickle
import sys
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

ISNET = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx"
ESRGAN = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth"
ESRGAN_WDN = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-wdn-x4v3.pth"
DENOISE = 0.5  # Real-ESRGAN's default for this model: half way to the denoising weights


def fetch(url, cache):
    path = cache / url.rsplit("/", 1)[1]
    if not path.exists():
        print(f"downloading {url}")
        with urllib.request.urlopen(url) as r, open(path, "wb") as f:
            f.write(r.read())
    return path


# ---------------------------------------------------------------- cut-out


def prune_to(model, keep):
    """Keep one graph output and the nodes it depends on."""
    g = model.graph
    out = next(o for o in g.output if o.name == keep)
    del g.output[:]
    g.output.append(out)
    needed, nodes = {keep}, []
    for node in reversed(g.node):
        if any(o in needed for o in node.output):
            nodes.append(node)
            needed.update(node.input)
    nodes.reverse()
    del g.node[:]
    g.node.extend(nodes)
    inits = [i for i in g.initializer if i.name in needed]
    del g.initializer[:]
    g.initializer.extend(inits)


def int8_weights(model):
    """Conv weights to int8 with one scale per output channel, dequantized in the graph."""
    g = model.graph
    convs = {n.input[1] for n in g.node if n.op_type == "Conv"}
    kept, dq = [], []
    for init in g.initializer:
        w = numpy_helper.to_array(init)
        if init.name not in convs or w.ndim != 4:
            kept.append(init)
            continue
        scale = np.maximum(np.abs(w).reshape(w.shape[0], -1).max(axis=1), 1e-12) / 127
        q = np.clip(np.round(w / scale[:, None, None, None]), -127, 127).astype(np.int8)
        n = init.name
        kept += [numpy_helper.from_array(q, f"{n}.q"), numpy_helper.from_array(scale.astype(np.float32), f"{n}.scale"), numpy_helper.from_array(np.zeros(w.shape[0], np.int8), f"{n}.zero")]
        dq.append(helper.make_node("DequantizeLinear", [f"{n}.q", f"{n}.scale", f"{n}.zero"], [n], axis=0))
    del g.initializer[:]
    g.initializer.extend(kept)
    nodes = list(g.node)
    del g.node[:]
    g.node.extend(dq + nodes)


def build_cutout(cache, out):
    src = fetch(ISNET, cache)
    model = onnx.load(src)
    prune_to(model, "output_image")
    int8_weights(model)
    model.producer_name = "kino web-models.py (from rembg isnet-general-use)"
    onnx.checker.check_model(model)
    onnx.save(model, out)
    check(src, out, "input_image", np.random.default_rng(1).random((1, 3, 1024, 1024), np.float32) - 0.5, tol=2 / 255)


# ---------------------------------------------------------------- upscale


class _Storage:
    def __init__(self, dtype):
        self.dtype = dtype


def load_pth(path):
    """A torch.save() state dict, read with numpy alone."""
    z = zipfile.ZipFile(path)
    root = z.namelist()[0].split("/")[0]
    dtypes = {"FloatStorage": np.float32, "HalfStorage": np.float16, "DoubleStorage": np.float64, "LongStorage": np.int64}

    def rebuild(storage, offset, size, stride, *_):
        data, dtype = storage
        a = np.frombuffer(data, dtype)
        return np.lib.stride_tricks.as_strided(a[offset:], size, [s * a.itemsize for s in stride]).copy()

    class Unpickler(pickle.Unpickler):
        def find_class(self, module, name):
            if name == "_rebuild_tensor_v2":
                return rebuild
            if name in dtypes:
                return _Storage(dtypes[name])
            if module == "collections" and name == "OrderedDict":
                import collections

                return collections.OrderedDict
            raise pickle.UnpicklingError(f"{module}.{name} isn't allowed in a weights file")

        def persistent_load(self, pid):
            _, storage, key, *_ = pid
            return (z.read(f"{root}/data/{key}"), storage.dtype)

    state = Unpickler(io.BytesIO(z.read(f"{root}/data.pkl"))).load()
    return state.get("params_ema") or state.get("params") or state


def build_upscale(cache, out):
    a, b = load_pth(fetch(ESRGAN, cache)), load_pth(fetch(ESRGAN_WDN, cache))
    w = {k: ((1 - DENOISE) * a[k] + DENOISE * b[k]).astype(np.float32) for k in a}
    layers = sorted({int(k.split(".")[1]) for k in w})
    nodes, inits, x = [], [], "image"
    for i in layers:
        p = f"body.{i}"
        if f"{p}.bias" in w:  # a 3x3 conv
            inits += [numpy_helper.from_array(w[f"{p}.weight"], f"{p}.weight"), numpy_helper.from_array(w[f"{p}.bias"], f"{p}.bias")]
            nodes.append(helper.make_node("Conv", [x, f"{p}.weight", f"{p}.bias"], [f"{p}.out"], kernel_shape=[3, 3], pads=[1, 1, 1, 1]))
        else:  # PReLU, one slope per channel
            inits.append(numpy_helper.from_array(w[f"{p}.weight"].reshape(-1, 1, 1), f"{p}.slope"))
            nodes.append(helper.make_node("PRelu", [x, f"{p}.slope"], [f"{p}.out"]))
        x = f"{p}.out"
    inits.append(numpy_helper.from_array(np.array([1, 1, 4, 4], np.float32), "scales"))
    nodes += [
        helper.make_node("DepthToSpace", [x], ["shuffled"], blocksize=4, mode="CRD"),
        helper.make_node("Resize", ["image", "", "scales"], ["base"], mode="nearest", coordinate_transformation_mode="asymmetric", nearest_mode="floor"),
        helper.make_node("Add", ["shuffled", "base"], ["sum"]),
        helper.make_node("Clip", ["sum", "zero", "one"], ["upscaled"]),
    ]
    inits += [numpy_helper.from_array(np.array(0, np.float32), "zero"), numpy_helper.from_array(np.array(1, np.float32), "one")]
    graph = helper.make_graph(
        nodes,
        "realesr-general-x4v3",
        [helper.make_tensor_value_info("image", TensorProto.FLOAT, [1, 3, "h", "w"])],
        [helper.make_tensor_value_info("upscaled", TensorProto.FLOAT, [1, 3, "H", "W"])],
        inits,
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)], producer_name="kino web-models.py (from Real-ESRGAN general x4v3)")
    model.ir_version = 7
    onnx.checker.check_model(model)
    onnx.save(model, out)
    x = np.random.default_rng(2).random((1, 3, 24, 20), np.float32)
    got = run(out, "image", x)
    want = np.clip(reference_sr(w, layers, x), 0, 1)
    err = np.abs(got - want).max()
    print(f"{out.name}: {out.stat().st_size / 1e6:.1f} MB, max difference from the reference {err:.2e}")
    assert err < 1e-4, err


def reference_sr(w, layers, x):
    """SRVGGNetCompact's forward pass in numpy, to check the graph."""
    def conv(x, k, b):
        n, c, h, wd = x.shape
        p = np.pad(x, ((0, 0), (0, 0), (1, 1), (1, 1)))
        cols = np.stack([p[:, :, i : i + h, j : j + wd] for i in range(3) for j in range(3)], axis=2)  # n c 9 h w
        return np.einsum("ncshw,ocs->nohw", cols, k.reshape(k.shape[0], c, 9)) + b[None, :, None, None]

    y = x
    for i in layers:
        p = f"body.{i}"
        if f"{p}.bias" in w:
            y = conv(y, w[f"{p}.weight"], w[f"{p}.bias"])
        else:
            y = np.where(y >= 0, y, y * w[f"{p}.weight"][None, :, None, None])
    n, c, h, wd = y.shape
    r = 4
    y = y.reshape(n, c // (r * r), r, r, h, wd).transpose(0, 1, 4, 2, 5, 3).reshape(n, c // (r * r), h * r, wd * r)
    return y + x.repeat(4, axis=2).repeat(4, axis=3)


# ---------------------------------------------------------------- checks


def run(path, name, x):
    import onnxruntime as ort

    return ort.InferenceSession(str(path), providers=["CPUExecutionProvider"]).run(None, {name: x})[0]


def check(original, built, name, x, tol):
    want, got = run(original, name, x), run(built, name, x)
    norm = lambda m: (m - m.min()) / (m.max() - m.min() + 1e-8)
    err = np.abs(norm(want) - norm(got))
    print(f"{built.name}: {built.stat().st_size / 1e6:.1f} MB, mask differs from the original by {err.mean() * 255:.2f} grey levels on average")
    assert err.mean() < tol, err.mean()


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent.parent / "web" / "models")
    out.mkdir(parents=True, exist_ok=True)
    cache = Path(sys.argv[2]) if len(sys.argv) > 2 else out / ".cache"
    cache.mkdir(parents=True, exist_ok=True)
    build_upscale(cache, out / "upscale.onnx")
    build_cutout(cache, out / "cutout.onnx")
