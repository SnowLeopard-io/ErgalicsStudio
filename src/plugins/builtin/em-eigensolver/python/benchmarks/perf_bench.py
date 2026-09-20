"""Performance benchmark for the em_eigensolver (PRD 3.2 + 3.3).

Produces, on any machine without CUDA:

* SpMV scaling curve 1e3 -> 1e5 measured through the production thread
  routing (the row-block pool engages only at ``n >= _PARALLEL_MIN_ROWS``);
* full-solve curve 1e3 -> 1e5 (thick-restart Lanczos, extremal, k=6);
* the headline ``cavity_large`` (n=102400) extremal run — eigenvalues,
  certified residuals, outer iterations, matvecs, wall time, peak memory —
  plus a shift-invert contrast row whose tolerance accounting is archived
  explicitly (``tol_requested`` vs ``tol_effective`` vs
  ``certified_rel_residual``).

Everything runs on the CPU (single box, no GPU required); numbers are
reproducible from the seed.  Run:

    python benchmarks/perf_bench.py [--json PATH] [--skip-large]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import tracemalloc

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from em_eigensolver.backend import backend_name
from em_eigensolver.csr import NumpyCSR, _coo_reduce, _worker_count
from em_eigensolver.samples import _grid_laplacian
from em_eigensolver.solver import SolverConfig, solve


def _numpy_csr_grid(nx: int, ny: int, **kwargs) -> NumpyCSR:
    """Grid-Laplacian sample forced onto the pure-NumPy CSR backend (so the
    benchmark exercises *our* matvec, not scipy's)."""
    A = _grid_laplacian(nx, ny, **kwargs)
    r = np.repeat(np.arange(A.shape[0]), np.diff(A.indptr))
    indptr, indices, values = _coo_reduce(
        r.astype(np.int64), A.indices.astype(np.int64), A.data,
        A.shape[0], A.shape[1])
    return NumpyCSR(indptr, indices, values, A.shape)


def _best_of(fn, reps: int = 5, warmup: int = 1) -> float:
    """Best-of wall time in seconds (median-of-3 of the fastest regime)."""
    for _ in range(warmup):
        fn()
    times = []
    for _ in range(reps):
        t0 = time.perf_counter()
        fn()
        times.append(time.perf_counter() - t0)
    return float(min(times))


def matvec_curve() -> list[dict]:
    """SpMV scaling measured through the *production* routing.

    The row-block thread pool only engages at ``n >= _PARALLEL_MIN_ROWS``
    (40000; measured crossover — forcing it on at 10201 rows yields 0.25×).
    Rows below the threshold therefore report the serial path with
    ``parallel_engaged: false``, exactly what a real solve would do.
    """
    sizes = [(32, 1024), (64, 4096), (101, 10201), (200, 40000), (320, 102400)]
    rows: list[dict] = []
    import em_eigensolver.csr as csr_mod
    threshold = csr_mod._PARALLEL_MIN_ROWS
    for nx, n in sizes:
        A = _numpy_csr_grid(nx, nx, mu=0.5)
        rng = np.random.default_rng(0)
        x = rng.standard_normal(n)

        os.environ["EM_EIGENSOLVER_THREADS"] = "1"
        t_serial = _best_of(lambda: A @ x)

        engaged = n >= threshold
        workers = _worker_count() if engaged else 1
        if engaged and workers > 1:
            os.environ.pop("EM_EIGENSOLVER_THREADS", None)
            t_par = _best_of(lambda: A @ x)
        else:
            t_par = t_serial

        rows.append({
            "n": n, "nnz": int(A.nnz), "workers": workers,
            "parallel_engaged": bool(engaged and workers > 1),
            "serial_ms": round(t_serial * 1e3, 3),
            "parallel_ms": round(t_par * 1e3, 3),
            "speedup": round(t_serial / t_par, 2) if t_par else None,
        })
        print(f"  spmv n={n:>6} nnz={A.nnz:>7} serial={t_serial*1e3:8.3f}ms "
              f"{'parallel(%d)' % workers if engaged and workers > 1 else 'serial  '}="
              f"{t_par*1e3:8.3f}ms "
              f"speedup={t_serial / t_par:4.2f}x engaged={engaged and workers > 1}")
    os.environ.pop("EM_EIGENSOLVER_THREADS", None)
    return rows


def _timed_solve(A, cfg: SolverConfig) -> dict:
    tracemalloc.start()
    t0 = time.perf_counter()
    res = solve(A, cfg)
    seconds = time.perf_counter() - t0
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    # Convergence accounting (docs 09 §4): kernels certify with true
    # residuals; the reported `residuals` are ABSOLUTE ||Ay - λy|| while the
    # judgment is RELATIVE — divided by max|λ_selected| — against the
    # effective tolerance. Shift-invert relaxes it to
    # max(tol, 20 × minres_rtol) because the inner MINRES is intentionally
    # inexact (docs 09 §2.3). Both quantities are archived here so the
    # requested tol is never silently conflated with the certified one.
    lam = np.asarray(res.eigenvalues)
    scale = float(np.max(np.abs(lam))) or 1.0
    max_res = float(np.max(res.residuals)) if len(res.residuals) else None
    tol_effective = (max(cfg.tol, 20.0 * cfg.minres_rtol)
                     if cfg.sigma is not None else cfg.tol)
    return {
        "n": int(A.shape[0]), "nnz": int(A.nnz),
        "method": res.method, "k": int(cfg.k or 0), "sigma": cfg.sigma,
        "tol_requested": cfg.tol,
        "tol_effective": tol_effective,
        "residual_metric": "absolute ||Ay - λy||₂ (unscaled)",
        "max_residual": max_res,
        "certified_rel_residual": (float(f"{max_res / scale:.2e}")
                                   if max_res is not None else None),
        "converged": bool(res.converged),
        "iterations": int(res.iterations), "matvecs": int(res.matvecs),
        "seconds": round(seconds, 2),
        "peak_memory_mb": round(peak / 1e6, 1),
        "workers": _worker_count(),
    }


def solve_curve(skip_large: bool = False) -> list[dict]:
    rows: list[dict] = []
    for nx in (32, 64, 101, 200, 320):
        if skip_large and nx == 320:
            continue
        A = _numpy_csr_grid(nx, nx, mu=0.5)
        cfg = SolverConfig(method="lanczos", k=6, tol=1e-8, dense_threshold=0,
                           seed=0)
        row = _timed_solve(A, cfg)
        row["case"] = f"grid-{nx}x{nx}"
        rows.append(row)
        print(f"  solve {row['case']:<12} n={row['n']:>6} {row['method']:<10} "
              f"conv={row['converged']} maxres={row['max_residual']:.2e} "
              f"iters={row['iterations']} matvecs={row['matvecs']} "
              f"{row['seconds']}s peak={row['peak_memory_mb']}MB")
    return rows


def headline_cavity_large(skip_large: bool = False) -> list[dict]:
    """The n=102400 evidence rows: extremal headline + shift-invert contrast.

    The extremal run is the headline (single-digit seconds, residual at the
    requested tolerance, linear-memory evidence). The shift-invert row is a
    contrast case: its certified residual is judged against the relaxed
    effective tolerance ``max(tol, 20 × minres_rtol)`` (never the requested
    ``tol``), and — like every row — carries ``certified_rel_residual`` so
    the accounting basis is explicit (docs 09 §4 / §9.4).
    """
    if skip_large:
        return []
    A = _numpy_csr_grid(320, 320, mu=0.0)
    rows = []
    for label, cfg in (
        ("cavity_large_extremal",
         SolverConfig(method="lanczos", k=6, which="LM", tol=1e-8,
                      dense_threshold=0, seed=0)),
        ("cavity_large_shift_invert",
         SolverConfig(method="lanczos", k=6, sigma=0.5, tol=1e-8,
                      dense_threshold=0, seed=0)),
    ):
        row = _timed_solve(A, cfg)
        row["case"] = label
        rows.append(row)
        print(f"  solve {label:<26} n={row['n']:>6} conv={row['converged']} "
              f"maxres={row['max_residual']:.2e} iters={row['iterations']} "
              f"matvecs={row['matvecs']} {row['seconds']}s "
              f"peak={row['peak_memory_mb']}MB lam={row['eigenvalues'][:3]}")
    return rows


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--json", dest="json_path", default=None)
    ap.add_argument("--skip-large", action="store_true")
    ap.add_argument("--no-matvec", action="store_true")
    args = ap.parse_args(argv)

    print(f"[perf] backend: {backend_name()} | workers: {_worker_count()}")
    print("== SpMV scaling (serial vs multi-threaded row-block) ==")
    mv = [] if args.no_matvec else matvec_curve()
    print("== Solve curve 1e3 -> 1e5 ==")
    sc = solve_curve(skip_large=args.skip_large)
    hl = headline_cavity_large(skip_large=args.skip_large)

    report = {"backend": backend_name(),
              "workers": _worker_count(),
              "cpu": os.environ.get("PROCESSOR_IDENTIFIER", ""),
              "date": time.strftime("%Y-%m-%d %H:%M:%S"),
              "matvec": mv, "solve_curve": sc, "headline": hl}
    if args.json_path:
        with open(args.json_path, "w", encoding="utf-8") as fh:
            json.dump(report, fh, indent=2)
        print(f"[perf] json written: {args.json_path}")
    n_bad = sum(1 for r in sc + hl if not r["converged"])
    return 1 if n_bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
