#!/usr/bin/env python3
"""Ergalics Desktop Python runner.

Speaks newline-delimited JSON over stdio, mirroring the Pyodide worker
protocol: persistent namespace, streamed stdout/stderr events, per-run
variable snapshot, and a small `studio` module (files / params / CSV /
summary) so existing code-mode programs keep working.
"""

import io
import json
import sys
import time
import types

_FILES = {}
_PARAMS = {}
G = {"__name__": "__ergalics__"}


def _emit(msg):
    sys.__stdout__.write(json.dumps(msg, ensure_ascii=False, default=str) + "\n")
    sys.__stdout__.flush()


class _EventWriter(io.TextIOBase):
    def __init__(self, kind):
        self.kind = kind

    def writable(self):
        return True

    def write(self, text):
        if text:
            _emit({"type": self.kind, "text": text})
        return len(text) if text else 0


# Studio module: minimal but compatible surface with the Pyodide injection.
studio = types.ModuleType("studio")


def _studio_load(path):
    if path in _FILES:
        return _FILES[path]
    raise FileNotFoundError(f"file not found in session: {path}")


def _studio_params():
    return dict(_PARAMS)


def _studio_load_csv(text):
    import csv
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        return {"columns": [], "length": 0}
    header = rows[0]
    cols = {name: [] for name in header}
    for row in rows[1:]:
        for name, cell in zip(header, row):
            try:
                cols[name].append(float(cell))
            except ValueError:
                cols[name].append(cell)
    return {"columns": [{"name": n, "data": cols[n]} for n in header], "length": len(rows) - 1}


def _studio_summary(df, column):
    import statistics as st
    columns = df.get("columns", []) if isinstance(df, dict) else []
    col = next((c for c in columns if c["name"] == column), None)
    if col is None:
        raise KeyError(column)
    nums = [v for v in col["data"] if isinstance(v, (int, float))]
    return {
        "column": column,
        "n": len(nums),
        "mean": st.fmean(nums) if nums else None,
        "stdev": st.stdev(nums) if len(nums) > 1 else 0.0,
        "min": min(nums) if nums else None,
        "max": max(nums) if nums else None,
    }


studio.load = _studio_load
studio.params = _studio_params
studio.loadCSV = _studio_load_csv
studio.summary = _studio_summary
sys.modules["studio"] = studio
G["studio"] = studio
G["_FILES"] = _FILES
G["_PARAMS"] = _PARAMS


def _to_columns(values):
    """Convert a 1-D numeric sequence into table-snapshot columns."""
    try:
        data = [float(v) for v in values]
    except (TypeError, ValueError):
        data = [str(v) for v in values]
    return [{"name": "value", "data": data}]


def _snapshot():
    out = {}
    for name, val in list(G.items()):
        if name.startswith("_") or name in ("studio", "sys", "types", "io", "time", "json"):
            continue
        try:
            if isinstance(val, (int, float, bool, str)):
                out[name] = {"kind": "scalar", "value": val}
                continue
            if hasattr(val, "tolist"):  # numpy arrays
                val = val.tolist()
            if isinstance(val, (list, tuple)) and val and all(isinstance(v, (int, float)) for v in val):
                out[name] = {
                    "kind": "table", "name": name,
                    "columns": [{"name": name, "data": [float(v) for v in val]}],
                    "length": len(val), "provenance": "code",
                }
        except Exception:
            continue
    return out


def _check_packages(packages):
    import importlib
    missing = []
    for pkg in packages:
        try:
            importlib.import_module(pkg)
        except Exception:
            missing.append(pkg)
    if missing:
        _emit({"type": "notify", "kind": "warning",
               "message": "packages not available in this interpreter: " + ", ".join(missing)})


def _handle(msg):
    op = msg.get("op")
    start = time.time()
    if op == "run":
        _FILES.clear(); _FILES.update(msg.get("files") or {})
        _PARAMS.clear(); _PARAMS.update(msg.get("params") or {})
        _check_packages(msg.get("packages") or [])
        code = msg.get("code", "")
        try:
            exec(compile(code, "<ergalics>", "exec"), G)
            _emit({"type": "result", "id": msg.get("id", 0), "ok": True,
                   "variables": _snapshot(), "durationMs": int((time.time() - start) * 1000)})
        except BaseException as exc:  # mirror Pyodide: report, don't die
            _emit({"type": "result", "id": msg.get("id", 0), "ok": False,
                   "variables": _snapshot(),
                   "error": f"{type(exc).__name__}: {exc}",
                   "durationMs": int((time.time() - start) * 1000)})
    elif op == "repl":
        code = msg.get("code", "")
        try:
            try:
                text = repr(eval(compile(code, "<repl>", "eval"), G))
            except SyntaxError:
                exec(compile(code, "<repl>", "exec"), G)
                text = ""
            _emit({"type": "result", "id": msg.get("id", 0), "ok": True, "text": text, "durationMs": 0})
        except BaseException as exc:
            _emit({"type": "result", "id": msg.get("id", 0), "ok": False,
                   "text": "", "error": f"{type(exc).__name__}: {exc}", "durationMs": 0})


def main():
    sys.stdout = _EventWriter("stdout")
    sys.stderr = _EventWriter("stderr")
    version = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    _emit({"type": "ready", "version": version})
    for line in sys.__stdin__:
        line = line.strip()
        if not line:
            continue
        try:
            _handle(json.loads(line))
        except BaseException as exc:
            _emit({"type": "result", "id": -1, "ok": False,
                   "error": f"runner error: {type(exc).__name__}: {exc}", "durationMs": 0})


if __name__ == "__main__":
    main()
