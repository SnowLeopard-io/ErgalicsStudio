"""Reproducible-solve credentials (``repro.json``) for em_eigensolver.

REQ-F of the em-eigensolver v3 PRD: every solve can emit a compact,
self-contained credential capturing everything needed to re-run the same
problem and verify the numbers:

* **matrix fingerprint** — a deterministic SHA-256 digest over the CSR
  structure + values (shape/nnz/dtype recorded alongside). Hashing bytes of a
  100k-order matrix costs a few ms; never densifies, never copies the data.
* **parameter hash** — canonical JSON (sorted keys, no whitespace) of the
  resolved ``SolverConfig`` fields, so any parameter drift changes the hash.
* **seed** — recorded verbatim (it decides the starting block).
* **code snapshot** — package version, Python/NumPy versions, backend, and a
  per-module source digest + aggregate, so editing a kernel invalidates the
  credential.
* **result digest** — the eigenvalue block bytes hashed, plus convergence and
  residual summary, so a re-run can be asserted digest-level identical.

Pure NumPy/stdlib (no scipy import), so it works unchanged on the Pyodide
worker where the driver can attach the credential to every solve report.
"""

from __future__ import annotations

import datetime
import hashlib
import importlib
import json
import platform
from dataclasses import asdict, is_dataclass
from pathlib import Path

import numpy as np

REPRO_SCHEMA = "ergalics.em-repro"
REPRO_VERSION = 1

# Modules whose source participates in the code snapshot aggregate.
_CODE_MODULES = (
    "backend", "csr", "io_matrix", "minres", "lanczos", "lobpcg",
    "jacdavid", "samples", "solver", "repro", "driver",
)


def _digest(data: bytes) -> str:
    """Truncated SHA-256 (64 bits, 16 hex chars) — collision-safe for
    fingerprints that are always compared verbatim, not adversarially."""
    return hashlib.sha256(data).hexdigest()[:16]


def canonical_json(obj) -> str:
    """Deterministic JSON text: sorted keys, no whitespace, ASCII-safe.

    Objects that ``json`` cannot serialise (numpy scalars, dataclasses) are
    reduced to plain Python first so the text is stable across backends.
    """
    return json.dumps(_plain(obj), sort_keys=True, separators=(",", ":"),
                      ensure_ascii=True, allow_nan=False)


def _plain(obj):
    """Recursively convert numpy scalars / dataclasses / arrays to JSON-safe
    plain Python (the same discipline the driver applies at the JS bridge)."""
    if isinstance(obj, dict):
        return {str(k): _plain(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_plain(v) for v in obj]
    if is_dataclass(obj) and not isinstance(obj, type):
        return _plain(asdict(obj))
    if isinstance(obj, np.generic):
        return obj.item()
    if isinstance(obj, np.ndarray):
        return _plain(obj.tolist())
    if isinstance(obj, (bool, int, float, str)) or obj is None:
        return obj
    return str(obj)


def params_hash(params) -> str:
    """Hash of the resolved solver parameters (canonical JSON digest)."""
    return _digest(canonical_json(params).encode("utf-8"))


def matrix_fingerprint(A) -> dict:
    """Deterministic fingerprint of a sparse (CSR) or dense matrix.

    Sparse: SHA-256 over ``indptr`` (widened to int64 so the hash does not
    depend on the index dtype a backend happened to pick), ``indices`` and the
    values widened to float64/complex128. Dense: SHA-256 over the C-contiguous
    bytes. The full bytes are hashed — O(nnz), milliseconds even at 100k order
    — which is far safer than sampling for a credential that must be
    reproducible.
    """
    shape = [int(A.shape[0]), int(A.shape[1])]
    if hasattr(A, "indptr") and hasattr(A, "indices") and hasattr(A, "data"):
        nnz = int(A.nnz)
        complex_ = bool(np.iscomplexobj(A.data))
        h = hashlib.sha256()
        h.update(np.asarray(A.indptr, dtype=np.int64).tobytes())
        h.update(np.asarray(A.indices, dtype=np.int64).tobytes())
        h.update(np.asarray(A.data,
                            dtype=np.complex128 if complex_ else np.float64,
                            order="C").tobytes())
        fingerprint = h.hexdigest()[:16]
        representation = "csr"
    else:
        dense = np.ascontiguousarray(np.asarray(A))
        nnz = int(np.count_nonzero(dense))
        complex_ = bool(np.iscomplexobj(dense))
        fingerprint = _digest(dense.tobytes())
        representation = "dense"
    return {
        "representation": representation,
        "shape": shape,
        "nnz": nnz,
        "complex": complex_,
        "hash": fingerprint,
    }


def code_snapshot() -> dict:
    """Versions + per-module source digests of the running solver package.

    In the browser (Pyodide) the package sources were written into the
    interpreter FS by the worker, so ``module.__file__`` reads back exactly
    the bytes that execute. Any module that cannot be read records ``null``
    and is excluded from the aggregate (never silently treated as unchanged).
    """
    from . import __version__
    from .backend import backend_name

    files: dict[str, str | None] = {}
    agg = hashlib.sha256()
    for name in _CODE_MODULES:
        digest = None
        try:
            mod = importlib.import_module(f".{name}", __package__)
            src = Path(mod.__file__).read_bytes()
            digest = _digest(src)
            agg.update(f"{name}:{digest}\n".encode("ascii"))
        except Exception:  # noqa: BLE001 — a missing source must not kill a solve
            digest = None
        files[name] = digest
    return {
        "package": "em_eigensolver",
        "version": __version__,
        "python": platform.python_version(),
        "numpy": np.__version__,
        "backend": backend_name(),
        "files": files,
        "aggregate": agg.hexdigest()[:16],
    }


def build_repro(A, config, result: dict, source: str) -> dict:
    """Assemble the credential for one finished solve.

    ``config`` is the resolved :class:`~em_eigensolver.solver.SolverConfig`
    (or any mapping of the same fields); ``result`` is an
    ``EigenResult.to_dict()``-shaped mapping; ``source`` names where the
    matrix came from (sample id or file name — descriptive, the identity of
    the data lives in the matrix fingerprint).
    """
    eigvals = np.asarray(result["eigenvalues"], dtype=np.float64)
    residuals = np.asarray(result.get("residuals", []), dtype=np.float64)
    return {
        "schema": REPRO_SCHEMA,
        "version": REPRO_VERSION,
        "created_at": datetime.datetime.now(datetime.timezone.utc)
        .isoformat(timespec="seconds"),
        "source": str(source),
        "matrix": matrix_fingerprint(A),
        "params": _plain(config),
        "params_hash": params_hash(config),
        "seed": int(_plain(config).get("seed", 0)),
        "code": code_snapshot(),
        "result": {
            "method": str(result.get("method", "")),
            "backend": str(result.get("backend", "")),
            "converged": bool(result.get("converged", False)),
            "iterations": int(result.get("iterations", 0)),
            "matvecs": int(result.get("matvecs", 0)),
            "eigenvalues": [_plain(v) for v in eigvals.tolist()],
            "eigenvalues_hash": _digest(eigvals.astype(np.float64).tobytes()),
            "max_residual": float(np.max(residuals)) if residuals.size else 0.0,
        },
    }


def repro_to_json(repro: dict) -> str:
    """Serialise a credential as pretty, diff-friendly JSON."""
    return json.dumps(repro, indent=2, ensure_ascii=False, allow_nan=False)
