"""Command-line entry point.

Examples
--------
    python -m em_eigensolver.cli --input matrix.npz --out eigen.npz
    python -m em_eigensolver.cli --input A.mtx --config config.json --out eigen.npz
    python -m em_eigensolver.cli --sample cluster_zero --sigma 0.0 --k 8 --out eigen.npz

Input formats: ``.npz`` (sparse CSR as written by ``write_csr_npz``, or scipy
``save_npz``, or dense array in ``.npy``), ``.npy`` (dense), ``.mtx``
(Matrix Market).  Output ``.npz`` contains ``eigenvalues``, ``eigenvectors``
(real/complex), ``residuals`` plus JSON metadata.
"""

from __future__ import annotations

import argparse
import json
import sys
import time

import numpy as np

from .backend import backend_name
from .io_matrix import MatrixIOError, read_matrix, write_eigen_npz
from .samples import SAMPLE_BUILDERS, build_sample
from .solver import SolverConfig, solve


def _progress(info: dict) -> None:
    tag = info.get("cycle", info.get("iter", "?"))
    print(f"  [progress] step {tag} matvecs={info.get('matvecs', '?')}",
          file=sys.stderr, flush=True)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="em_eigensolver",
        description="Hermitian sparse eigensolver for EM resonance problems "
                    "(large-scale, non-positive-definite, shift-invert capable).")
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--input", "-i", help="matrix file: .npz/.npy/.mtx")
    src.add_argument("--sample", choices=sorted(SAMPLE_BUILDERS),
                     help="built-in synthetic sample instead of a file")
    p.add_argument("--config", "-c", help="solver config JSON "
                   "(keys mirror SolverConfig fields)")
    p.add_argument("--out", "-o", default="eigen.npz", help="output .npz path")
    p.add_argument("--sigma", type=float, default=None,
                   help="target shift (overrides config)")
    p.add_argument("--k", type=int, default=None,
                   help="number of eigenpairs (overrides config)")
    p.add_argument("--method", default=None,
                   choices=["auto", "lanczos", "lobpcg", "jacobi-davidson"])
    p.add_argument("--tol", type=float, default=None)
    p.add_argument("--seed", type=int, default=None)
    p.add_argument("--verbose", action="store_true")
    args = p.parse_args(argv)

    cfg_kwargs: dict = {}
    if args.config:
        with open(args.config, encoding="utf-8") as fh:
            cfg_kwargs.update(json.load(fh))
    for key, val in (("sigma", args.sigma), ("k", args.k),
                     ("method", args.method), ("tol", args.tol),
                     ("seed", args.seed), ("verbose", True if args.verbose else None)):
        if val is not None:
            cfg_kwargs[key] = val
    try:
        cfg = SolverConfig(**cfg_kwargs)
    except (TypeError, ValueError) as exc:
        print(f"config error: {exc}", file=sys.stderr)
        return 2

    t0 = time.perf_counter()
    if args.sample:
        sample = build_sample(args.sample)
        A = sample.A
        if cfg.sigma is None:
            cfg.sigma = sample.recommended_sigma
        src_desc = f"sample {args.sample} (n={A.shape[0]}, nnz={A.nnz})"
    else:
        try:
            A = read_matrix(args.input)
        except (MatrixIOError, OSError) as exc:
            print(f"input error: {exc}", file=sys.stderr)
            return 2
        src_desc = f"{args.input} (n={A.shape[0]})"

    print(f"[em_eigensolver] backend={backend_name()} input={src_desc} "
          f"method={cfg.method} sigma={cfg.sigma} k={cfg.k}", flush=True)
    try:
        result = solve(A, cfg, on_progress=_progress)
    except ValueError as exc:
        print(f"solver error: {exc}", file=sys.stderr)
        return 2
    dt = time.perf_counter() - t0

    meta = {
        "method": result.method,
        "backend": result.backend,
        "converged": bool(result.converged),
        "iterations": result.iterations,
        "matvecs": result.matvecs,
        "seconds": round(dt, 3),
        "sigma": cfg.sigma,
        **result.diagnostics,
    }
    write_eigen_npz(args.out, result.eigenvalues, result.eigenvectors, meta)

    print(f"[em_eigensolver] converged={result.converged} "
          f"iters={result.iterations} matvecs={result.matvecs} "
          f"max_rel_residual={float(np.max(result.residuals)) if len(result.residuals) else 0.0:.3e} "
          f"time={dt:.2f}s", flush=True)
    print(f"[em_eigensolver] eigenvalues: "
          f"{np.array2string(result.eigenvalues, precision=8)}", flush=True)
    print(f"[em_eigensolver] written: {args.out}", flush=True)
    return 0 if result.converged else 1


if __name__ == "__main__":
    raise SystemExit(main())
