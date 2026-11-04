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

Parameter sweep (service diagnostics): pass ``--sweep kind:param=v1,v2,...``
(e.g. ``--sweep cavity:size=12,16,20,24`` or ``--sweep cavity:mu=0,0.5,1.0``)
to re-solve across a cavity geometry/material knob and write a JSON
diagnostic report (eigenvalue curves + certified residuals per point) to
``--out`` instead of the ``.npz`` archive.
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
    p.add_argument("--sweep", default=None, metavar="KIND:PARAM=V1,V2",
                   help="parameter sweep (service diagnostics): e.g. "
                        "cavity:size=12,16,20,24 | cavity:mu=0,0.5,1.0 | "
                        "cluster_zero:seed=1,2,3; writes a JSON report")
    p.add_argument("--repro", default=None, metavar="PATH",
                   help="also write a reproducibility credential "
                        "(repro.json: matrix fingerprint + parameter hash + "
                        "seed + code snapshot + result digest)")
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

    # ---- parameter sweep mode (service diagnostics, PRD 4.2) ---------------
    if args.sweep:
        try:
            head, _, vals_text = args.sweep.partition("=")
            kind, _, param = head.partition(":")
            values = [float(v) for v in vals_text.split(",") if v.strip()]
            if not kind or not param or not values:
                raise ValueError("expected KIND:PARAM=V1,V2,...")
            from .sweep import sweep_eigenvalues
            result = sweep_eigenvalues(kind=kind, param=param, values=values,
                                       config=cfg)
        except (ValueError, ImportError) as exc:
            print(f"sweep error: {exc}", file=sys.stderr)
            return 2
        if args.out.lower().endswith(".npz"):
            args.out = args.out[:-4] + ".json"
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump({"backend": backend_name(), "config": {
                "k": cfg.k, "sigma": cfg.sigma, "tol": cfg.tol,
                "seed": cfg.seed, "method": cfg.method},
                **result.to_dict()}, fh, ensure_ascii=False, indent=2)
        ok = all(p.converged and p.error is None for p in result.points)
        print(f"[em_eigensolver] sweep {result.kind}:{result.param} "
              f"({len(result.points)} points, "
              f"{'all converged' if ok else 'SOME POINTS FAILED'}) "
              f"time={result.seconds:.2f}s", flush=True)
        for pt in result.points:
            lam = ", ".join(f"{v:.6g}" for v in pt.eigenvalues[:4])
            print(f"  {result.param}={pt.value:g} n={pt.n} "
                  f"maxres={max(pt.residuals, default=0):.2e} "
                  f"lam~[{lam}]" + (f" ERROR={pt.error}" if pt.error else ""),
                  flush=True)
        print(f"[em_eigensolver] written: {args.out}", flush=True)
        return 0 if ok else 1

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
    write_eigen_npz(args.out, result.eigenvalues, result.eigenvectors, meta,
                    residuals=result.residuals)

    if args.repro:
        # REQ-F credential: matrix fingerprint + parameter hash + seed + code
        # snapshot + result digest — a third party re-runs the same input and
        # asserts the digests (or the eigenvalues) byte-for-byte.
        from .repro import build_repro, repro_to_json
        report = result.to_dict()
        report.pop("eigenvectors", None)  # n x k stays in the .npz
        repro = build_repro(A, cfg, report,
                            args.sample or args.input)
        with open(args.repro, "w", encoding="utf-8") as fh:
            fh.write(repro_to_json(repro))
        print(f"[em_eigensolver] repro credential: "
              f"matrix={repro['matrix']['hash']} "
              f"params={repro['params_hash']} "
              f"eigenvalues={repro['result']['eigenvalues_hash']}", flush=True)
        print(f"[em_eigensolver] written: {args.repro}", flush=True)

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
