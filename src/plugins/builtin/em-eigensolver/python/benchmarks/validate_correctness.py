"""Correctness validation for the em_eigensolver (PRD 4.3 + 4.4).

Two reports in one runnable script:

* Dense-reference comparison (4.4) — every small/medium sample is checked
  against ``numpy.linalg.eigh`` (LAPACK): eigenvalues matched by proximity
  to the target and true residuals recomputed from the reference vectors.
* Numerical adversarial stress bench (4.3) — near-singular shifts, dense
  spectra at zero, repeated eigenvalues, extreme scalings and non-finite
  input, all certified with true residuals (or a clean, flagged failure).

Run:  python benchmarks/validate_correctness.py [--json out.json]
The ``--fast`` subset is imported by tests/test_all.py.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from em_eigensolver.backend import backend_name
from em_eigensolver.samples import build_sample
from em_eigensolver.solver import SolverConfig, solve


# --------------------------------------------------------------------------
# 4.4 — dense reference comparison
# --------------------------------------------------------------------------

def reference_comparison(kind: str, k: int, sigma: float | None = None,
                         which: str = "LM", tol: float = 1e-8,
                         dense_threshold: int = 0) -> dict:
    """Solve one sample and verify against a dense LAPACK reference.

    ``sigma=None`` means a genuinely extremal request (plain Lanczos, end
    chosen by ``which``) — the sample's recommended interior sigma is *not*
    substituted, so the reference subset uses the same selection rule.
    """
    sample = build_sample(kind)
    cfg = SolverConfig(k=k, sigma=sigma, which=which, tol=tol,
                       dense_threshold=dense_threshold)
    t0 = time.perf_counter()
    res = solve(sample.A, cfg)
    seconds = time.perf_counter() - t0

    dense = sample.A.toarray()
    w_ref, V_ref = np.linalg.eigh(dense)
    if cfg.sigma is not None:
        sel = np.argsort(np.abs(w_ref - cfg.sigma))[:k]
    elif which == "SA":
        sel = np.argsort(w_ref)[:k]
    else:
        sel = np.argsort(-np.abs(w_ref))[:k]
    lam_ref = np.sort(w_ref[sel])
    lam_got = np.sort(np.real(res.eigenvalues))
    scale = max(float(np.max(np.abs(w_ref))), 1e-12)
    # Guard against a short return (fewer locked pairs than requested):
    # compare the matched prefix, and fail unless the counts agree.
    m = min(len(lam_got), len(lam_ref))
    ev_err = float(np.max(np.abs(lam_got[:m] - lam_ref[:m]))) if m else float("nan")
    k_complete = len(lam_got) == len(lam_ref)
    # residual of the *reference* vectors through the sparse operator
    res_ref = max(
        float(np.linalg.norm(sample.A @ V_ref[:, i] - w_ref[i] * V_ref[:, i]))
        / scale for i in sel)

    ok = bool(res.converged) and k_complete and ev_err <= max(1e-6 * scale, tol * 10 * scale)
    return {
        "case": kind, "k": k, "k_returned": len(lam_got), "sigma": cfg.sigma,
        "method": res.method, "n": int(sample.A.shape[0]),
        "nnz": int(sample.A.nnz),
        "eigenvalues": [float(v) for v in lam_got],
        "reference_eigenvalues": [float(v) for v in lam_ref],
        "max_eigenvalue_error": ev_err,
        "max_eigenvalue_error_rel": ev_err / scale,
        "max_residual": float(np.max(res.residuals)) if len(res.residuals) else 0.0,
        "reference_residual": res_ref,
        "iterations": int(res.iterations), "matvecs": int(res.matvecs),
        "seconds": round(seconds, 3), "converged": bool(res.converged),
        "status": "PASS" if ok else "FAIL",
    }


def run_reference_cases(fast: bool = False) -> list[dict]:
    cases = [
        ("cavity_small", 6, None, "LM"),
        ("cavity_complex", 4, None, "LM"),
        ("degenerate_pair", 4, -1.0, "LM"),
        ("cluster_zero", 4, 0.0, "LM"),
    ]
    if not fast:
        # interior target just under the spectrum top (dense cluster near
        # λ_max): JD converges for k=4 within the default budget (measured
        # 284 steps, 4.2e-9 true residual); k=6 does not lock all six pairs
        # within 400 steps — the documented interior-cluster limitation.
        cases.append(("cavity_small", 4, 8.3, "LM"))
    return [reference_comparison(kind, k, sigma, which)
            for kind, k, sigma, which in cases]


# --------------------------------------------------------------------------
# 4.3 — adversarial stress bench
# --------------------------------------------------------------------------

def _grid_cavity_small():
    return build_sample("cavity_small").A


def stress_cases(fast: bool = False):
    """Yield (name, matrix, config, expectation) adversarial cases.

    expectation: ``converge`` (must converge with certified residuals) or
    ``flag`` (non-finite input — must be flagged/failed cleanly, never a
    silent bogus "converged" answer, and never a hang or crash).
    """
    from em_eigensolver.csr import csr_from_coo

    A0 = _grid_cavity_small()
    r, c, d = None, None, None
    cases: list[tuple] = []

    cases.append((
        "near_singular_shift",
        build_sample("cluster_zero").A,
        SolverConfig(k=3, sigma=0.0, tol=1e-8, dense_threshold=0),
        "converge",
    ))
    cases.append((
        "dense_spectrum_interior",
        build_sample("cluster_zero").A,
        SolverConfig(k=3, sigma=0.05, tol=1e-8, dense_threshold=0),
        "converge",
    ))
    cases.append((
        "repeated_eigenvalues",
        build_sample("degenerate_pair").A,
        SolverConfig(k=4, sigma=-1.0, tol=1e-8, dense_threshold=0),
        "converge",
    ))
    cases.append((
        "ill_conditioned_scale_1e9",
        A0 * 1e9,
        SolverConfig(k=3, sigma=0.6e9, tol=1e-8, dense_threshold=0),
        "converge",
    ))
    cases.append((
        "ill_conditioned_scale_1e-9",
        A0 * 1e-9,
        SolverConfig(k=3, sigma=0.6e-9, tol=1e-8, dense_threshold=0),
        "converge",
    ))
    cases.append((
        "complex_hermitian",
        build_sample("cavity_complex").A,
        SolverConfig(k=3, sigma=1.2, tol=1e-8, dense_threshold=0),
        "converge",
    ))
    if not fast:
        # 1e5 scale: extremal solve certifies 3.6e-9 true residual in ~15 s
        # (measured).  An interior shift-invert at this scale is reported
        # separately in the performance table — its MINRES inner solves run
        # on a huge indefinite system and only certify ~6e-5 (documented
        # limitation, see docs/technical/09 performance section).
        cases.append((
            "large_scale_cavity_1e5",
            build_sample("cavity_large").A,
            SolverConfig(k=6, which="LM", tol=1e-8, dense_threshold=0),
            "converge",
        ))

    # Non-finite input: NaN planted into a copy of the cavity matrix.
    A_base = _grid_cavity_small()
    rr = np.repeat(np.arange(A_base.shape[0]), np.diff(A_base.indptr)) \
        if not hasattr(A_base, "tocoo") else None
    if rr is None:
        rr = A_base.tocoo().row
    if hasattr(A_base, "tocoo"):
        coo = A_base.tocoo()
        if hasattr(coo, "row"):
            r_arr, c_arr, d_arr = coo.row, coo.col, coo.data
        else:
            r_arr, c_arr, d_arr = coo
    else:
        r_arr, c_arr, d_arr = rr, A_base.indices, A_base.data
    d_bad = np.asarray(d_arr, dtype=np.float64).copy()
    d_bad[3] = np.nan
    d_bad[7] = np.inf
    A_bad = csr_from_coo(np.asarray(r_arr, dtype=np.int64),
                         np.asarray(c_arr, dtype=np.int64), d_bad,
                         A_base.shape[0], A_base.shape[1])
    cases.append((
        "nonfinite_input",
        A_bad,
        SolverConfig(k=2, sigma=0.6, tol=1e-8, dense_threshold=0),
        "flag",
    ))
    return cases


def run_stress_case(name: str, A, cfg: SolverConfig, expectation: str) -> dict:
    t0 = time.perf_counter()
    row: dict = {"case": name, "expectation": expectation,
                 "n": int(A.shape[0]), "nnz": int(A.nnz), "sigma": cfg.sigma,
                 "method": cfg.method}
    try:
        res = solve(A, cfg)
        residuals = np.asarray(res.residuals, dtype=np.float64)
        finite = bool(np.all(np.isfinite(residuals))
                      and np.all(np.isfinite(res.eigenvalues)))
        row.update({
            "method": res.method,
            "converged": bool(res.converged),
            "max_residual": float(np.max(residuals)) if len(residuals) else None,
            "eigenvalues": [float(np.real(v)) for v in res.eigenvalues[:6]],
            "finite": finite,
            "iterations": int(res.iterations), "matvecs": int(res.matvecs),
        })
        if expectation == "converge":
            ok = bool(res.converged) and finite and row["max_residual"] <= cfg.tol * 100
        else:
            # non-finite input: acceptable outcomes are a clean non-convergence
            # or a flagged non-finite result — never a silent "converged".
            ok = (not res.converged) or not finite
    except (ValueError, FloatingPointError, np.linalg.LinAlgError) as exc:
        row.update({"error": f"{type(exc).__name__}: {exc}", "finite": False})
        ok = expectation == "flag"
    row["seconds"] = round(time.perf_counter() - t0, 3)
    row["status"] = "PASS" if ok else "FAIL"
    return row


def run_stress_bench(fast: bool = False) -> list[dict]:
    return [run_stress_case(*case) for case in stress_cases(fast)]


def _bench_dir() -> Path:
    """Project-root bench/ folder, sibling of the plugin packages."""
    return (Path(__file__).resolve().parent.parent.parent.parent.parent.parent.parent
            / "bench")


def write_stress_artifact(reference: list, stress: list) -> Path:
    """EM-01 deliverable: adversarial stress bench + LAPACK reference table.

    PRD EM-01 acceptance names ``bench/*stress*.json`` as the evidence
    artifact, so the stress rows are archived standalone instead of being
    buried inside the raw validate report.
    """
    dest = _bench_dir() / "em-eigensolver-stress.json"
    _bench_dir().mkdir(exist_ok=True)
    payload = {
        "plugin": "em-eigensolver",
        "benchmark": "EM-01 adversarial stress + LAPACK reference",
        "backend": backend_name(),
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "reference": reference,
        "stress": stress,
    }
    with open(dest, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)
    return dest


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--fast", action="store_true", help="skip the 1e5 case")
    ap.add_argument("--json", dest="json_path", default=None,
                    help="also write the raw reports as JSON")
    args = ap.parse_args(argv)

    t0 = time.perf_counter()
    refs = run_reference_cases(fast=args.fast)
    stress = run_stress_bench(fast=args.fast)
    total = time.perf_counter() - t0

    print(f"[validate] backend: {backend_name()}")
    print("\n== 4.4 dense-reference comparison ==")
    print(f"{'case':<22} {'method':<18} {'max|dλ|':>10} {'max res':>10} "
          f"{'iters':>6} {'matvec':>7} {'s':>7}  status")
    for r in refs:
        print(f"{r['case']:<22} {r['method']:<18} {r['max_eigenvalue_error']:>10.3e} "
              f"{r['max_residual']:>10.3e} {r['iterations']:>6} "
              f"{r['matvecs']:>7} {r['seconds']:>7.2f}  {r['status']}")
    print("\n== 4.3 adversarial stress bench ==")
    print(f"{'case':<28} {'method':<18} {'max res':>10} {'conv':>5} "
          f"{'finite':>6} {'s':>7}  status")
    for r in stress:
        print(f"{r['case']:<28} {r.get('method', '-'):<18} "
              f"{r.get('max_residual') if r.get('max_residual') is not None else float('nan'):>10.3e} "
              f"{str(r.get('converged')):>5} {str(r.get('finite')):>6} "
              f"{r['seconds']:>7.2f}  {r['status']}")
    n_fail = sum(1 for r in refs + stress if r["status"] != "PASS")
    print(f"\n[validate] {len(refs) + len(stress)} cases, {n_fail} failures, "
          f"total {total:.1f}s")
    if args.json_path:
        with open(args.json_path, "w", encoding="utf-8") as fh:
            json.dump({"backend": backend_name(), "reference": refs,
                       "stress": stress}, fh, indent=2)
        print(f"[validate] json written: {args.json_path}")
    # EM-01 evidence: standalone stress artifact in the project bench folder.
    stress_path = write_stress_artifact(refs, stress)
    print(f"[validate] stress artifact written: {stress_path}")
    return 1 if n_fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
