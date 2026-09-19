"""Worker-side driver: JSON bridge between the JS host and the kernels.

The browser Pyodide worker (``em-worker.ts``) imports this module and calls:

* :func:`set_progress_sink` — register a JS callback receiving JSON strings;
* :func:`solve_json` — run one solve request, return the report as JSON;
* :func:`export_npz` — serialise the last result into the Pyodide FS.

Everything crossing the JS boundary is a JSON *string* (or a plain str):
``postMessage`` cannot structured-clone PyProxy objects, and the
``n x k`` eigenvector block stays inside Python until explicitly exported
as a compressed ``.npz``.
"""

from __future__ import annotations

import json

import numpy as np

from .io_matrix import read_matrix, write_eigen_npz
from .solver import SolverConfig, solve, solve_sample

_progress_sink = None
_last: dict | None = None


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
    sigma = c.get("sigma", None)
    return SolverConfig(
        method=str(c.get("method", "auto")),
        k=int(c.get("k", 6)),
        sigma=(float(sigma) if sigma is not None else None),
        which=str(c.get("which", "LM")),
        tol=float(c.get("tol", 1e-8)),
        max_cycles=int(c.get("max_cycles", 60)),
        max_iter=int(c.get("max_iter", 400)),
        basis_dim=int(c.get("basis_dim", 48)),
        seed=int(c.get("seed", 0)),
        dense_threshold=int(c.get("dense_threshold", 800)),
        verbose=bool(c.get("verbose", True)),
    )


def _meta_of(name: str, A, description: str | None) -> dict:
    shape = [int(v) for v in A.shape]
    nnz = int(A.nnz) if hasattr(A, "nnz") else -1
    is_complex = bool(np.iscomplexobj(A.data)) if hasattr(A, "data") else False
    return {"name": name, "description": description or "",
            "shape": shape, "nnz": nnz, "complex": is_complex}


def solve_json(payload: str) -> str:
    """Run one solve request (``{"source": "sample"|"file", ...}``).

    Returns the :class:`~em_eigensolver.solver.EigenResult` report as JSON
    (without the eigenvectors — export those via :func:`export_npz`).
    """
    global _last
    req = json.loads(payload)
    cfg = _build_config(req.get("config", {}))
    if req.get("source") == "sample":
        res, sample = solve_sample(str(req["sample"]), cfg, _emit_progress)
        meta = _meta_of(sample.name, sample.A, sample.description)
    else:
        A = read_matrix(str(req["path"]))
        res = solve(A, cfg, _emit_progress)
        meta = _meta_of(req.get("name") or req["path"], A, None)

    _last = {"w": np.asarray(res.eigenvalues, dtype=np.float64),
             "v": res.eigenvectors, "meta": meta}
    report = res.to_dict()
    report.pop("eigenvectors", None)  # n x k: stay in Python, export on demand
    report["meta"] = meta
    return json.dumps(report, default=float)


def export_npz(path: str) -> str:
    """Write the last solve result (eigenvalues + eigenvectors) to ``path``."""
    if _last is None:
        raise RuntimeError("no result to export yet — run a solve first")
    write_eigen_npz(path, _last["w"], _last["v"], _last["meta"])
    return path
