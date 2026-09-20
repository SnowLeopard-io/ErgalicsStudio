"""Worker-side driver: JSON bridge between the JS host and the kernels.

The browser Pyodide worker (``em-worker.ts``) imports this module and calls:

* :func:`set_progress_sink` — register a JS callback receiving JSON strings;
* :func:`solve_json` — run one solve request, return the report as JSON;
* :func:`export_npz` — serialise the last result into the Pyodide FS;
* :func:`export_repro` — write the last solve's repro credential (JSON).

Everything crossing the JS boundary is a JSON *string* (or a plain str):
``postMessage`` cannot structured-clone PyProxy objects, and the
``n x k`` eigenvector block stays inside Python until explicitly exported
as a compressed ``.npz``.
"""

from __future__ import annotations

import json
import math

import numpy as np

from .io_matrix import read_matrix, write_eigen_npz
from .repro import build_repro, repro_to_json
from .solver import SolverConfig, solve, solve_sample

_progress_sink = None
_last: dict | None = None
# Host GPU SpMV bridge (registered by em-worker.ts via register_gpu_spmv).
_gpu_upload = None
_gpu_spmv = None


def register_gpu_spmv(upload_fn, spmv_fn) -> None:
    """Receive the WebGPU SpMV host bridge (upload once, then per-vector)."""
    global _gpu_upload, _gpu_spmv
    _gpu_upload = upload_fn
    _gpu_spmv = spmv_fn


def _apply_gpu_spmv(enabled: bool) -> None:
    from . import csr as _csr
    if enabled and _gpu_upload is not None and _gpu_spmv is not None:
        _csr.set_gpu_spmv(_gpu_upload, _gpu_spmv, enabled=True)
    else:
        _csr.set_gpu_spmv(None, None, enabled=False)


def set_progress_sink(fn) -> None:
    """Register ``fn(json_str)`` invoked after every restart cycle."""
    global _progress_sink
    _progress_sink = fn


def _emit_progress(info: dict) -> None:
    if _progress_sink is None:
        return
    try:
        # tolist() default: kernel progress dicts may carry numpy scalars/arrays
        _progress_sink(json.dumps(info, default=lambda o: o.tolist()))
    except Exception:  # noqa: BLE001 — progress must never kill a solve
        pass


def _build_config(c: dict) -> SolverConfig:
    """Config from JSON, accepting both snake_case (Python/CLI) and the
    camelCase keys the TS host sends (maxCycles/basisDim/...). Accepting the
    host spelling here is not cosmetic: a pure snake_case reader silently
    ignored the UI's basis-width knob and solved with the default."""
    def get(*names, default=None):
        for name in names:
            if name in c and c[name] is not None:
                return c[name]
        return default

    sigma = get("sigma")
    return SolverConfig(
        method=str(get("method", default="auto")),
        k=int(get("k", default=6)),
        sigma=(float(sigma) if sigma is not None else None),
        which=str(get("which", default="LM")),
        tol=float(get("tol", default=1e-8)),
        max_cycles=int(get("max_cycles", "maxCycles", default=60)),
        max_iter=int(get("max_iter", "maxIter", default=400)),
        basis_dim=int(get("basis_dim", "basisDim", default=48)),
        seed=int(get("seed", default=0)),
        dense_threshold=int(get("dense_threshold", "denseThreshold", default=800)),
        gpu_spmv=bool(get("gpu_spmv", "gpuSpmv", default=False)),
        verbose=bool(get("verbose", default=True)),
    )


def _meta_of(name: str, A, description: str | None) -> dict:
    shape = [int(v) for v in A.shape]
    nnz = int(A.nnz) if hasattr(A, "nnz") else -1
    is_complex = bool(np.iscomplexobj(A.data)) if hasattr(A, "data") else False
    return {"name": name, "description": description or "",
            "shape": shape, "nnz": nnz, "complex": is_complex}


def _nearest_grid(n: int) -> tuple[int, int]:
    """Closest-to-square integer factor pair ``(rows, cols)`` with rows*cols=n.

    Grid-geometry sample matrices (cavity_*) are square, so this recovers the
    exact resonator mesh; band-assembly samples get an approximate layout and
    the report flags it via ``"approx": true``.

    Primes (and tiny n) have no factor pair with both sides >= 2, which would
    collapse the 3D surface to a 1-row strip with zero quads — fall back to an
    approximate 2-row layout instead; ``mode_fields`` zero-pads the remainder.
    """
    r = int(np.sqrt(n))
    while r > 1 and n % r != 0:
        r -= 1
    if r < 2:
        if n < 2:
            return 1, 1
        return 2, max(2, math.ceil(n / 2))
    return r, n // r


def _block_bounds(size: int, target: int) -> tuple[np.ndarray, np.ndarray]:
    """Starts + counts of ~``target`` contiguous blocks covering ``size``."""
    if size <= target:
        bounds = np.arange(size + 1, dtype=np.int64)
    else:
        bounds = np.unique(np.floor(np.linspace(0, size, target + 1)).astype(np.int64))
    return bounds[:-1].astype(np.intp), np.diff(bounds).astype(np.float64)


def _downsample_grid(g: np.ndarray, target: int = 64) -> np.ndarray:
    """Block-mean reduction to at most ``target`` cells per axis (any size)."""
    rs, rc = _block_bounds(g.shape[0], target)
    cs, cc = _block_bounds(g.shape[1], target)
    out = np.add.reduceat(np.add.reduceat(g, rs, axis=0), cs, axis=1)
    return out / (rc[:, None] * cc[None, :])


def mode_fields(max_modes: int = 6, target: int = 64) -> list[dict]:
    """Downsampled mode fields of the last solve, JSON-safe for the host.

    Complex eigenvectors become |field| magnitude; real ones keep their sign
    so the nodal structure stays visible. Values are normalised to max |1|.
    """
    if _last is None or _last.get("v") is None:
        return []
    v = np.asarray(_last["v"])
    n = v.shape[0]
    rows, cols = _nearest_grid(n)
    fields: list[dict] = []
    for j in range(min(v.shape[1], int(max_modes))):
        vec = v[:, j]
        data = np.abs(vec) if np.iscomplexobj(vec) else np.real(vec)
        # Approximate layouts (primes) can have rows*cols > n — zero-pad.
        flat = np.zeros(rows * cols, dtype=np.float64)
        m = min(n, rows * cols)
        flat[:m] = np.asarray(data[:m], dtype=np.float64)
        grid = flat.reshape(rows, cols)
        small = _downsample_grid(np.asarray(grid, dtype=np.float64), target)
        peak = float(np.max(np.abs(small)))
        if peak <= 0.0:
            peak = 1.0
        fields.append({
            "index": int(j),
            "eigenvalue": float(np.real(_last["w"][j])),
            "rows": int(small.shape[0]),
            "cols": int(small.shape[1]),
            "values": (small / peak).ravel().tolist(),
            "approx": bool(rows != cols),
        })
    return fields


def _sanitize_json(obj, hit: list[bool]):
    """Recursively replace NaN/Inf floats with ``None``.

    ``json.dumps`` would happily emit bare ``NaN``/``Infinity`` tokens, which
    crash ``JSON.parse`` on the host — a diverged solve must fail with a
    readable message instead of a syntax error.
    """
    if isinstance(obj, float):
        if not np.isfinite(obj):
            hit[0] = True
            return None
        return obj
    if isinstance(obj, dict):
        return {k: _sanitize_json(v, hit) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize_json(v, hit) for v in obj]
    return obj


def solve_json(payload: str) -> str:
    """Run one solve request (``{"source": "sample"|"file", ...}``).

    Returns the :class:`~em_eigensolver.solver.EigenResult` report as JSON
    (without the eigenvectors — export those via :func:`export_npz`).
    """
    global _last
    req = json.loads(payload)
    cfg = _build_config(req.get("config", {}))
    _apply_gpu_spmv(cfg.gpu_spmv)
    if req.get("source") == "sample":
        res, sample = solve_sample(str(req["sample"]), cfg, _emit_progress)
        A = sample.A
        meta = _meta_of(sample.name, A, sample.description)
    else:
        A = read_matrix(str(req["path"]))
        res = solve(A, cfg, _emit_progress)
        meta = _meta_of(req.get("name") or req["path"], A, None)

    _last = {"w": np.asarray(res.eigenvalues, dtype=np.float64),
             "v": res.eigenvectors, "meta": meta,
             "residuals": np.asarray(res.residuals, dtype=np.float64)}
    report = res.to_dict()
    report.pop("eigenvectors", None)  # n x k: stay in Python, export on demand
    report["meta"] = meta
    if cfg.gpu_spmv:
        # Honest boundary (PRD 3.1): WebGPU readback is asynchronous while the
        # Pyodide event loop is blocked by the sync solver loop, so a sync
        # in-loop GPU bridge cannot exist in this build. Unless the host
        # registered a synchronous bridge, the exact CPU f64 kernel ran.
        report.setdefault("diagnostics", {})["gpu_spmv"] = (
            "active via host bridge" if _gpu_spmv is not None else
            "requested but unavailable: WebGPU SpMV is async and cannot be "
            "called from the sync solve loop — exact CPU f64 path used "
            "(browser kernel exposed via spmvAsync in src/core/gpu-kernels.ts)")
    # Downsampled mode fields for the 3D visualisation (≤6 modes, ≤64x64
    # cells each) — small enough to ride along in the JSON report.
    # Key is camelCase to match the TS protocol (EmResultPayload.modeFields);
    # the report crosses to JS verbatim, with no case conversion.
    report["modeFields"] = mode_fields()
    # Repro credential (PRD REQ-F): matrix fingerprint + parameter hash +
    # seed + code snapshot + result digest — small enough to ride along in
    # every report; the host can download it verbatim as repro.json.
    repro = build_repro(A, cfg, report, meta["name"])
    _last["repro"] = repro
    report["repro"] = repro
    # NaN/Inf (diverged residuals, broken-down eigenvalues) must never reach
    # the host as bare JSON tokens — sanitize to null and flag the report so
    # the TS side can show a readable "likely diverged" message.
    hit: list[bool] = [False]
    clean = _sanitize_json(report, hit)
    if hit[0]:
        clean["nonfinite"] = True
    return json.dumps(clean, default=float)


def export_npz(path: str) -> str:
    """Write the last solve result (eigenvalues + eigenvectors) to ``path``."""
    if _last is None:
        raise RuntimeError("no result to export yet — run a solve first")
    write_eigen_npz(path, _last["w"], _last["v"], _last["meta"],
                    residuals=_last.get("residuals"))
    return path


def export_repro(path: str) -> str:
    """Write the last solve's repro credential (repro.json) to ``path``."""
    if _last is None or "repro" not in _last:
        raise RuntimeError("no repro credential yet — run a solve first")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(repro_to_json(_last["repro"]))
    return path
