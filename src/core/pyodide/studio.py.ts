// ==========================================================================
// Ergalics Studio — Python `studio` module source (Pyodide runtime)
//
// This string is injected into the Pyodide worker's main namespace before any
// user code runs. It mirrors the semantics of the JS `studio-api.ts` bridge
// (block-code-modes.md §3.1 invariant #2): same data-source parsing, same
// table-level transforms, same plot payloads — so a program behaves the same
// whether interpreted by the IR interpreter, generated as JS, or run in real
// CPython via Pyodide.
//
// Cross-worker side effects (plot / notify / print) are fire-and-forget calls
// into the JS module `studio_bridge`, which posts a message to the host. Data
// files are shipped into the worker as `_FILES` before each run so `load` is
// synchronous and needs no async host round-trip.
//
// The public surface is a single `studio` object (methods match the JS
// StudioApi) so module-level builtins (`range`, `print`, `random`) are never
// shadowed in the user's global namespace.
// ==========================================================================

export const STUDIO_PYTHON_SOURCE = `import re
import random as _random

import numpy as _np

import studio_bridge

_FILES = {}
_PARAMS = {}


class DataTable:
    """Columnar table with list columns - the Python mirror of the JS
    DataTable. columns is a list of (name, list) pairs."""

    def __init__(self, name, columns, provenance=""):
        self.name = name
        self.columns = columns
        self.provenance = provenance

    def column_names(self):
        return [c[0] for c in self.columns]

    def __len__(self):
        return len(self.columns[0][1]) if self.columns else 0

    def __repr__(self):
        names = ", ".join(self.column_names())
        return f"DataTable({len(self)} rows x {len(self.columns)} cols [{names}])"


class _Studio:
    # ---- data sources -----------------------------------------------------

    def load(self, path):
        if path not in _FILES:
            raise FileNotFoundError(
                f'file "{path}" not found (available: {", ".join(sorted(_FILES))})'
            )
        text = _FILES[path]
        lower = path.lower()
        if lower.endswith(".xyz"):
            return _parse_delimited(text, _xyz_name)
        if lower.endswith(".json"):
            return _load_json(text)
        return _parse_delimited(text, _default_name)

    def loadCSV(self, text):
        return _parse_delimited(text, _default_name)

    def loadXYZ(self, text):
        return _parse_delimited(text, _xyz_name)

    def random(self, n, seed=None):
        rng = _random.Random(seed) if seed is not None else _random.Random()
        count = max(1, int(n))
        return DataTable("random", [("x", [rng.random() for _ in range(count)])], provenance="studio.random")

    def range(self, start, stop, step=1):
        s = step if step != 0 else 1
        return DataTable("range", [("value", list(range(start, stop, s)))], provenance="studio.range")

    # ---- transforms (table-level) ----------------------------------------

    def normalize(self, df, column, mode="minmax"):
        raw = _require_column(df, column)
        values = _np.asarray(raw, dtype=float)
        if len(values) == 0 or not _np.all(_np.isfinite(values)):
            out = _np.zeros(len(values))
        elif mode == "zscore":
            mean = values.mean()
            std = values.std()
            out = _np.zeros(len(values)) if std == 0 else (values - mean) / std
        else:
            vmin = values.min()
            vmax = values.max()
            span = vmax - vmin
            out = _np.zeros(len(values)) if span == 0 else (values - vmin) / span
        cols = [(c[0], list(c[1])) for c in df.columns]
        cols.append((f"{column}_{mode}", [float(v) for v in out]))
        return DataTable(df.name, cols, provenance=df.provenance)

    def sort(self, df, column, direction="asc"):
        values = _require_column(df, column)
        order = sorted(range(len(values)), key=lambda i: values[i], reverse=direction == "desc")
        cols = [(c[0], [c[1][i] for i in order]) for c in df.columns]
        return DataTable(df.name, cols, provenance=df.provenance)

    def select(self, df, columns):
        chosen = [(name, _require_column(df, name)) for name in columns]
        return DataTable(df.name, chosen, provenance=df.provenance)

    def addColumn(self, df, name, values):
        if name in df.column_names():
            raise ValueError(f'column "{name}" already exists')
        if len(values) != len(df):
            raise ValueError(f"column length {len(values)} != table length {len(df)}")
        cols = [(c[0], list(c[1])) for c in df.columns]
        cols.append((name, list(values)))
        return DataTable(df.name, cols, provenance=df.provenance)

    def filter(self, df, column, op, value):
        data = _require_column(df, column)
        keep = [i for i in range(len(data)) if _compare(data[i], op, float(value))]
        cols = [(c[0], [c[1][i] for i in keep]) for c in df.columns]
        return DataTable(df.name, cols, provenance=df.provenance)

    # ---- statistics -------------------------------------------------------

    def summary(self, df, column):
        values = _np.asarray(_require_column(df, column), dtype=float)
        if len(values) == 0:
            stats = [0.0, 0.0, 0.0, 0.0, 0.0]
        else:
            stats = [
                float(values.mean()),
                float(values.std()),
                float(values.min()),
                float(values.max()),
                float(_np.median(values)),
            ]
        return DataTable(
            "summary",
            [("stat", ["mean", "std", "min", "max", "median"]), (column, stats)],
            provenance="studio.summary",
        )

    def histogram(self, df, column, bins):
        bins = int(bins)
        if bins < 1:
            raise ValueError("bins must be >= 1")
        values = _np.asarray(_require_column(df, column), dtype=float)
        counts = [0.0] * bins
        centers = [0.0] * bins
        if len(values) > 0 and _np.all(_np.isfinite(values)):
            vmin = float(values.min())
            vmax = float(values.max())
            span = vmax - vmin or 1
            step = span / bins
            centers = [vmin + step * (b + 0.5) for b in range(bins)]
            for v in values:
                idx = min(bins - 1, int((float(v) - vmin) // step))
                counts[idx] += 1
        return DataTable(
            "hist",
            [("center", centers), ("count", counts)],
            provenance="studio.histogram",
        )

    # ---- visualization ----------------------------------------------------

    def plot(self, plot_type, data, opts=None):
        opts = opts or {}
        columns = []
        delimiter = " "
        if plot_type == "histogram":
            col = opts.get("column") or (data.column_names()[0] if data.columns else None)
            if col is None:
                raise ValueError("histogram needs a numeric column")
            columns = [col]
            delimiter = "\\n"
        else:
            names = data.column_names()
            x = opts.get("x") or names[0]
            y = opts.get("y") or names[1]
            if not x or not y:
                raise ValueError(f"{plot_type} needs at least two columns")
            columns = [x, y]
            if plot_type == "scatter" and opts.get("color"):
                columns.append(opts["color"])
            if plot_type in ("pointcloud", "point-cloud") and opts.get("z"):
                columns.append(opts["z"])
            if plot_type == "line":
                delimiter = ","
        lines = []
        for i in range(len(data)):
            lines.append(delimiter.join(str(_column_value(data, c, i)) for c in columns))
        text = "\\n".join(lines)
        plugin_id = _PLOT_PLUGINS.get(plot_type)
        if plugin_id is None:
            raise ValueError(f'unknown plot type "{plot_type}"')
        studio_bridge.plot(plugin_id, text)

    # ---- host interaction -------------------------------------------------

    def print(self, *args):
        studio_bridge.log(" ".join(str(a) for a in args))

    def notify(self, kind, message):
        studio_bridge.notify(kind, message)

    def getParam(self, key):
        return _PARAMS.get(key)

    def setParam(self, key, value):
        _PARAMS[key] = value


studio = _Studio()


# ---- private helpers -------------------------------------------------------


def _is_num(t):
    try:
        float(t)
        return True
    except (ValueError, TypeError):
        return False


def _split_tokens(line):
    return [t for t in re.split(r"[\\s,]+", line.strip()) if t]


def _default_name(i):
    return ["x", "y", "z", "w"][i] if i < 4 else f"c{i}"


def _xyz_name(i):
    return ["x", "y", "z"][i] if i < 3 else f"c{i}"


def _parse_delimited(text, default_names):
    """Parse whitespace/comma-delimited numeric columns, matching the JS
    parseDelimitedColumns: a non-numeric header supplies names, malformed or
    ragged rows are skipped, and the width comes from the first data row."""
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    header = []
    columns = []
    width = 0
    started = False
    for line in lines:
        tokens = _split_tokens(line)
        if not tokens:
            continue
        if not started and any(not _is_num(t) for t in tokens):
            header.extend(tokens)
            continue
        try:
            values = [float(t) for t in tokens]
        except (ValueError, TypeError):
            continue
        if not started:
            width = len(values)
            columns = [[] for _ in range(width)]
            started = True
        if len(values) != width:
            continue
        for i, v in enumerate(values):
            columns[i].append(v)
    if not started:
        raise ValueError("no numeric data found")
    names = [header[i] if i < len(header) else default_names(i) for i in range(width)]
    return DataTable("data", list(zip(names, columns)), provenance="load")


def _load_json(text):
    import json as _json

    parsed = _json.loads(text)
    if isinstance(parsed, list) and parsed and all(isinstance(r, dict) for r in parsed):
        names = list(dict.fromkeys(k for r in parsed for k in r.keys()))
        columns = []
        for name in names:
            values = [r.get(name) for r in parsed]
            if all(isinstance(v, (int, float)) and isinstance(v, (int, float)) for v in values):
                columns.append((name, [float(v) for v in values]))
            else:
                columns.append((name, ["" if v is None else str(v) for v in values]))
        return DataTable("json", columns, provenance="loadJSON")
    if isinstance(parsed, dict) and isinstance(parsed.get("columns"), list):
        cols = parsed["columns"]
        columns = []
        for c in cols:
            name = str(c.get("name", ""))
            data = c.get("data", [])
            if all(isinstance(v, (int, float)) for v in data):
                columns.append((name, [float(v) for v in data]))
            else:
                columns.append((name, ["" if v is None else str(v) for v in data]))
        if not columns:
            raise ValueError("JSON dataset has no columns")
        return DataTable("json", columns, provenance="loadJSON")
    raise ValueError("unsupported JSON dataset shape (expected row records or { columns: [...] })")


def _require_column(df, column):
    if not column:
        raise ValueError("this block is not configured - pick a column first")
    for name, data in df.columns:
        if name == column:
            return data
    raise ValueError(f'column "{column}" does not exist')


def _column_value(df, column, i):
    data = _require_column(df, column)
    return data[i]


def _compare(a, op, b):
    x = float(a)
    if op == "==":
        return x == b
    if op == "!=":
        return x != b
    if op == "<":
        return x < b
    if op == "<=":
        return x <= b
    if op == ">":
        return x > b
    if op == ">=":
        return x >= b
    raise ValueError(f"unknown comparison operator {op!r}")


_PLOT_PLUGINS = {
    "scatter": "example.scatter",
    "line": "example.timeseries",
    "histogram": "example.histogram",
    "pointcloud": "example.point-cloud",
    "point-cloud": "example.point-cloud",
}


def _repl(code):
    """Evaluate a REPL line: expressions print their repr, statements execute.
    stdout is captured by the host's setStdout, so print() flows to the console."""
    try:
        tree = compile(code, "<repl>", "eval")
    except SyntaxError:
        exec(compile(code, "<repl>", "exec"))
        return None
    value = eval(tree)
    if value is not None:
        return repr(value)
    return None


def _snapshot_variables():
    """Summarize top-level variables for the VariablePanel: DataTable -> table
    (with full column data so the host can rebuild a real DataTable), numeric /
    string / bool -> scalar, numpy arrays -> a descriptive scalar string."""
    out = {}
    for name, value in globals().items():
        if name.startswith("_"):
            continue
        if isinstance(value, DataTable):
            out[name] = {
                "kind": "table",
                "name": name,
                "columns": [{"name": c[0], "data": list(c[1])} for c in value.columns],
                "length": len(value),
                "provenance": value.provenance,
            }
        elif isinstance(value, bool):
            out[name] = {"kind": "scalar", "value": bool(value)}
        elif isinstance(value, (int, float)):
            out[name] = {"kind": "scalar", "value": float(value)}
        elif isinstance(value, str):
            out[name] = {"kind": "scalar", "value": value}
        elif isinstance(value, _np.ndarray):
            out[name] = {
                "kind": "scalar",
                "value": f"numpy.ndarray shape={list(value.shape)} dtype={value.dtype}",
            }
    return out
`;