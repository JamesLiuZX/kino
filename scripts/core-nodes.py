#!/usr/bin/env python3
"""Extract ComfyUI's core node definitions from source, statically (no torch import).

Writes comfy/core_nodes.json: {node_id: {inputs: {name: {...}}, outputs: [type...], dynamic: [prefix...]}}.
Kino uses it to convert UI-format workflows to API format and to validate graphs
offline. When a live ComfyUI is connected, /object_info is preferred; this file is
the fallback and the contract the bundled workflows are tested against.

Usage: python3 scripts/core-nodes.py /path/to/ComfyUI > comfy/core_nodes.json
"""
import ast
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(sys.argv[1])
FILES = [ROOT / "nodes.py", *sorted((ROOT / "comfy_extras").glob("*.py"))]

# V3 io.<Type> -> wire type
IO_TYPES = {
    "Model": "MODEL", "Clip": "CLIP", "Vae": "VAE", "Conditioning": "CONDITIONING", "Latent": "LATENT",
    "Image": "IMAGE", "Mask": "MASK", "Int": "INT", "Float": "FLOAT", "String": "STRING", "Boolean": "BOOLEAN",
    "Combo": "COMBO", "MultiCombo": "COMBO", "Sampler": "SAMPLER", "Sigmas": "SIGMAS", "Noise": "NOISE",
    "Guider": "GUIDER", "Audio": "AUDIO", "Video": "VIDEO", "ClipVision": "CLIP_VISION",
    "ClipVisionOutput": "CLIP_VISION_OUTPUT", "UpscaleModel": "UPSCALE_MODEL", "LatentUpscaleModel": "LATENT_UPSCALE_MODEL",
    "ControlNet": "CONTROL_NET", "StyleModel": "STYLE_MODEL", "Gligen": "GLIGEN", "AudioEncoder": "AUDIO_ENCODER",
    "AudioEncoderOutput": "AUDIO_ENCODER_OUTPUT", "WanCameraEmbedding": "WAN_CAMERA_EMBEDDING", "AnyType": "*",
    "MultiType": "*", "MatchType": "*", "LatentOperation": "LATENT_OPERATION", "Hooks": "HOOKS",
    "HookKeyframes": "HOOK_KEYFRAMES", "Photomaker": "PHOTOMAKER", "Point": "POINT", "ModelPatch": "MODEL_PATCH",
    "Custom": "*",
}
WIDGET_TYPES = {"INT", "FLOAT", "STRING", "BOOLEAN", "COMBO"}
DYNAMIC = {"Autogrow", "DynamicCombo", "DynamicSlot"}
# io types whose Input() defaults to optional=True (comfy_api/latest/_io.py).
DEFAULT_OPTIONAL = {"ResolutionPreview": True}


def lit(node):
    try:
        return ast.literal_eval(node)
    except Exception:
        return None


def kwargs(call):
    return {k.arg: k.value for k in call.keywords if k.arg}


def wire_type(node):
    """A V1 type slot: "MODEL", IO.MODEL (comfy_types enum), or a combo list."""
    v = lit(node)
    if isinstance(v, str):
        return v
    if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id == "IO":
        return "*" if node.attr == "ANY" else node.attr
    return "COMBO"


def inherited(cls, classes, finder):
    """Run finder on cls, then on its same-module base classes, until one answers."""
    seen = set()
    stack = [cls]
    while stack:
        c = stack.pop(0)
        if c.name in seen:
            continue
        seen.add(c.name)
        found = finder(c)
        if found is not None:
            return found
        stack += [classes[b.id] for b in c.bases if isinstance(b, ast.Name) and b.id in classes]
    return None


def v1_inputs(cls):
    for item in cls.body:
        if not (isinstance(item, ast.FunctionDef) and item.name == "INPUT_TYPES"):
            continue
        for stmt in ast.walk(item):
            if not (isinstance(stmt, ast.Return) and isinstance(stmt.value, ast.Dict)):
                continue
            out = {}
            for sk, sv in zip(stmt.value.keys, stmt.value.values):
                section = lit(sk)
                if section not in ("required", "optional") or not isinstance(sv, ast.Dict):
                    continue
                for ik, iv in zip(sv.keys, sv.values):
                    name = lit(ik)
                    if not isinstance(name, str):
                        continue
                    wire, opts = "COMBO", {}
                    if isinstance(iv, ast.Tuple) and iv.elts:
                        wire = wire_type(iv.elts[0])
                        if len(iv.elts) > 1 and isinstance(iv.elts[1], ast.Dict):
                            opts = {lit(k): lit(v) for k, v in zip(iv.elts[1].keys, iv.elts[1].values) if isinstance(lit(k), str)}
                    spec = {"type": wire, "required": section == "required"}
                    if opts.get("forceInput"):
                        spec["forceInput"] = True
                    if opts.get("control_after_generate") or (wire == "INT" and name in ("seed", "noise_seed")):
                        spec["control"] = True
                    out[name] = spec
            return out
    return None


def v1_outputs(cls):
    for item in cls.body:
        if isinstance(item, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "RETURN_TYPES" for t in item.targets):
            if isinstance(item.value, ast.Tuple):
                return [wire_type(e) for e in item.value.elts]
    return None


def v1_is_output(cls):
    for item in cls.body:
        if isinstance(item, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "OUTPUT_NODE" for t in item.targets):
            return lit(item.value) is True
    return None


def io_kind(call):
    f = call.func
    if isinstance(f, ast.Attribute) and isinstance(f.value, ast.Attribute):
        return f.value.attr
    if isinstance(f, ast.Attribute) and isinstance(f.value, ast.Name):
        return f.value.id
    return ""


class Resolver:
    """Follows names to the values they were assigned, so option trees written as
    `opts = [...]` or keyed by `SomeEnum.MEMBER` read like literals."""

    def __init__(self, module_assigns, enums, local_assigns=None):
        self.module, self.enums, self.local = module_assigns, enums, local_assigns or {}

    def __call__(self, node, depth=0):
        if depth > 8 or node is None:
            return node
        if isinstance(node, ast.Name):
            target = self.local.get(node.id, self.module.get(node.id))
            return self(target, depth + 1) if target is not None else node
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
            members = self.enums.get(node.value.id)
            if members and node.attr in members:
                return ast.Constant(members[node.attr])
        return node


def input_spec(el, res):
    """(name, spec) for one io.X.Input(...) call; DynamicCombo carries its option tree."""
    name = lit(res(el.args[0])) if el.args else lit(res(kwargs(el).get("id")))
    if not isinstance(name, str):
        return None, None
    kind, ekw = io_kind(el), kwargs(el)
    optional = lit(ekw.get("optional")) if "optional" in ekw else DEFAULT_OPTIONAL.get(kind, False)
    required = optional is not True
    if kind == "DynamicCombo":
        options = {}
        for opt in getattr(res(ekw.get("options")), "elts", None) or []:
            opt = res(opt)
            if not isinstance(opt, ast.Call):
                continue
            okw = kwargs(opt)
            key = lit(res(opt.args[0] if opt.args else okw.get("key")))
            nested_list = res(opt.args[1] if len(opt.args) > 1 else okw.get("inputs"))
            nested = []
            for sub in getattr(nested_list, "elts", None) or []:
                sub = res(sub)
                if isinstance(sub, ast.Call) and isinstance(sub.func, ast.Attribute) and sub.func.attr == "Input":
                    sname, sspec = input_spec(sub, res)
                    if sname:
                        nested.append({"name": sname, **sspec})
                elif isinstance(sub, ast.Call) and isinstance(sub.func, ast.Name):
                    # Built by a helper function: can't be expanded statically.
                    nested.append({"unresolved": sub.func.id})
            if isinstance(key, str):
                options[key] = nested
        return name, {"type": "COMBO", "required": required, "options": options}
    if kind in DYNAMIC:
        return name, {"type": "DYNAMIC", "required": False}
    wire = IO_TYPES.get(kind, kind.upper() or "*")
    spec = {"type": wire, "required": required}
    if lit(ekw.get("force_input")) is True:
        spec["forceInput"] = True
    if lit(ekw.get("control_after_generate")) is True or (wire == "INT" and name in ("seed", "noise_seed")):
        spec["control"] = True
    return name, spec


def local_assigns(cls):
    out = {}
    for fn in cls.body:
        if isinstance(fn, ast.FunctionDef) and fn.name == "define_schema":
            for stmt in fn.body:
                if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 and isinstance(stmt.targets[0], ast.Name):
                    out[stmt.targets[0].id] = stmt.value
    return out


def v3_schema(cls, base_res):
    res = Resolver(base_res.module, base_res.enums, local_assigns(cls))
    for call in ast.walk(cls):
        if not (isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute) and call.func.attr == "Schema"):
            continue
        kw = kwargs(call)
        node_id = lit(kw.get("node_id"))
        if not isinstance(node_id, str):
            continue
        if isinstance(kw.get("inputs"), ast.Attribute):  # inputs=parent_schema.inputs
            return node_id, {"inherit": True, **({"output": True} if lit(kw.get("is_output_node")) is True else {})}
        inputs, dynamic, outputs = {}, [], []
        for el in getattr(res(kw.get("inputs")), "elts", None) or []:
            el = res(el)
            if not (isinstance(el, ast.Call) and isinstance(el.func, ast.Attribute) and el.func.attr == "Input"):
                continue
            name, spec = input_spec(el, res)
            if not name:
                continue
            if spec["type"] == "DYNAMIC":  # Autogrow / DynamicSlot: sockets named "<name>.<key>"
                dynamic.append(name + ".")
                continue
            if "options" in spec:
                dynamic.append(name + ".")
            inputs[name] = spec
        for el in getattr(kw.get("outputs"), "elts", None) or []:
            if isinstance(el, ast.Call) and isinstance(el.func, ast.Attribute) and el.func.attr == "Output":
                outputs.append(IO_TYPES.get(io_kind(el), io_kind(el).upper() or "*"))
        spec = {"inputs": inputs, "outputs": outputs}
        if dynamic:
            spec["dynamic"] = dynamic
        if lit(kw.get("is_output_node")) is True:
            spec["output"] = True
        return node_id, spec
    return None


registry = {}  # insertion order = definition order; the converter depends on it
for path in FILES:
    tree = ast.parse(path.read_text(encoding="utf-8-sig"), filename=str(path))
    classes = {n.name: n for n in tree.body if isinstance(n, ast.ClassDef)}
    module_assigns = {
        s.targets[0].id: s.value
        for s in tree.body
        if isinstance(s, ast.Assign) and len(s.targets) == 1 and isinstance(s.targets[0], ast.Name)
    }
    enums = {
        name: {
            s.targets[0].id: lit(s.value)
            for s in cls.body
            if isinstance(s, ast.Assign) and len(s.targets) == 1 and isinstance(s.targets[0], ast.Name) and isinstance(lit(s.value), str)
        }
        for name, cls in classes.items()
        if any(isinstance(b, ast.Name) and b.id in ("Enum", "str") for b in cls.bases)
    }
    base_res = Resolver(module_assigns, enums)
    v3_by_class = {}
    for cls in classes.values():
        found = v3_schema(cls, base_res)
        if found:
            v3_by_class[cls.name] = found
    for cls_name, (node_id, spec) in v3_by_class.items():
        if spec.pop("inherit", False):
            parent = next((v3_by_class[b.id][1] for b in classes[cls_name].bases if isinstance(b, ast.Name) and b.id in v3_by_class), None)
            if parent:
                spec = {**{k: v for k, v in parent.items() if k != "output"}, **spec}
        registry[node_id] = spec
    for stmt in tree.body:
        if isinstance(stmt, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "NODE_CLASS_MAPPINGS" for t in stmt.targets):
            if isinstance(stmt.value, ast.Dict):
                for k, v in zip(stmt.value.keys, stmt.value.values):
                    nid = lit(k)
                    if isinstance(nid, str) and isinstance(v, ast.Name) and v.id in classes:
                        cls = classes[v.id]
                        ins = inherited(cls, classes, v1_inputs)
                        if ins is not None or nid not in registry:
                            spec = {"inputs": ins or {}, "outputs": inherited(cls, classes, v1_outputs) or []}
                            if inherited(cls, classes, v1_is_output):
                                spec["output"] = True
                            registry[nid] = spec

try:
    rev = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
except Exception:
    rev = ""
version = ""
vf = ROOT / "comfyui_version.py"
if vf.exists():
    for line in vf.read_text().splitlines():
        if line.startswith("__version__"):
            version = line.split("=")[1].strip().strip('"')

json.dump({"comfyui": {"version": version, "commit": rev}, "widgetTypes": sorted(WIDGET_TYPES), "nodes": dict(sorted(registry.items()))},
          sys.stdout, indent=0, separators=(",", ":"))
print(f"{len(registry)} core nodes from ComfyUI {version} ({rev})", file=sys.stderr)
