"""Unified solver facade: config in, eigenpairs out.

``solve`` routes to one of the three kernels behind a single config object:

* ``"lanczos"``          — thick-restart Krylov-Schur; plain for extremal
  eigenvalues, shift-invert (with adaptive sigma) when a target is given.
  Best when the target sits in a spectral gap.
* ``"lobpcg"``           — block LOBPCG for extremal eigenvalues with
  clusters; the block formulation captures degenerate modes natively.
* ``"jacobi-davidson"``  — deflating JD for eigenvalues *inside* dense
  spectral clusters / near-singular targets; the most robust interior
  method when iterative shift-invert degenerates.
* ``"auto"``             — sigma given -> Jacobi-Davidson (robust interior);
  no sigma -> Lanczos plain (extremal).  Small matrices (n <=
  dense_threshold) are solved directly with LAPACK — that is *not* the
  forbidden "densifying a sparse matrix": it only happens below the
  threshold where the dense eigendecomposition is cheaper than any
  iterative method and uses O(n^2) memory that is smaller than the
  sparse iterative workspace.

Convergence is always certified with true residuals
``||A x - lambda x|| / max(|lambda|, floor)`` recomputed at the end; the
facade never trusts inner-projection estimates alone.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict

import numpy as np

from .backend import HAVE_SCIPY, backend_name
from .jacdavid import jd_solve
from .lanczos import lanczos_solve
from .lobpcg import lobpcg_solve

EPS = 1e-14


@dataclass
class SolverConfig:
    method: str = "auto"             # auto | lanczos | lobpcg | jacobi-davidson
    k: int = 6                       # number of eigenpairs
    sigma: float | None = None       # target shift (resonant frequency)
    which: str = "LM"                # extremal selection when sigma is None
    tol: float = 1e-8                # relative residual tolerance
    max_cycles: int = 60             # Lanczos outer cycles
    max_iter: int = 400              # LOBPCG / JD outer iterations
    basis_dim: int = 48              # Krylov/search-space memory knob
    seed: int = 0
    adaptive_shift: bool = True      # sigma nudge for near-singular shifts
    shift_adaptive: bool = True      # alias kept for lanczos kwargs
    dense_threshold: int = 800       # direct LAPACK path for tiny problems
    minres_rtol: float = 1e-6
    # Shift-invert accounting (docs 09 §2.3/§4): the inner MINRES is
    # intentionally inexact, so the outer loop judges convergence against
    # max(tol, 20 * minres_rtol) — with defaults that floor is 2e-5, NOT the
    # requested tol. Shift-invert results can therefore certify a true
    # residual far above tol while converged=True is still self-consistent.
    # For dense-spectrum interior targets prefer Jacobi-Davidson (auto route).
    minres_maxiter: int = 250
    gpu_spmv: bool = False           # opt-in WebGPU SpMV delegation (f32)
    verbose: bool = False

    def normalized(self) -> "SolverConfig":
        cfg = SolverConfig(**asdict(self))
        if cfg.method not in ("auto", "lanczos", "lobpcg", "jacobi-davidson"):
            raise ValueError(f"unknown method {cfg.method!r}")
        if cfg.k < 1:
            raise ValueError("k must be >= 1")
        if cfg.tol <= 0:
            raise ValueError("tol must be positive")
        if cfg.method == "jacobi-davidson" and cfg.sigma is None:
            cfg.sigma = 0.0          # JD needs a target
        return cfg


@dataclass
class EigenResult:
    eigenvalues: np.ndarray          # (k,) real, sorted by |lambda - sigma| or extremal
    eigenvectors: np.ndarray         # (n, k)
    residuals: np.ndarray            # (k,) true relative residuals
    converged: bool
    iterations: int
    matvecs: int
    method: str                      # actually used kernel
    backend: str                     # 'scipy' | 'numpy'
    diagnostics: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["eigenvalues"] = self.eigenvalues.tolist()
        d["residuals"] = self.residuals.tolist()
        d["converged"] = bool(self.converged)
        return d


def _dense_path(A, n: int, cfg: SolverConfig):
    """Direct LAPACK solve for tiny problems (O(n^2) memory, below threshold)."""
    dense = np.asarray(A.todense()) if hasattr(A, "todense") else A.toarray() \
        if hasattr(A, "toarray") else None
    if dense is None:
        return None
    w, V = np.linalg.eigh(dense)
    if cfg.sigma is not None:
        order = np.argsort(np.abs(w - cfg.sigma))
    elif cfg.which == "SA":
        order = np.argsort(w)
    elif cfg.which == "LA":
        order = np.argsort(-w)
    else:
        order = np.argsort(-np.abs(w))
    sel = order[:cfg.k]
    lam = w[sel]
    Y = V[:, sel]
    scaleA = float(np.max(np.abs(w))) or 1.0
    residuals = np.array([
        float(np.linalg.norm(A @ Y[:, i] - lam[i] * Y[:, i])) / scaleA
        for i in range(cfg.k)
    ])
    return EigenResult(
        eigenvalues=np.asarray(lam, dtype=np.float64), eigenvectors=Y,
        residuals=residuals, converged=bool(np.all(residuals <= cfg.tol)),
        iterations=0, matvecs=0, method="dense-lapack",
        backend=backend_name(),
        diagnostics={"dense_threshold": cfg.dense_threshold, "n": n},
    )


def solve(A, config: SolverConfig | None = None, on_progress=None) -> EigenResult:
    """Solve the Hermitian eigenproblem for the sparse operator ``A``.

    Parameters
    ----------
    A : sparse CSR-like object supporting ``A @ x`` and ``A.conj().T``.
        Row/col access must never densify the matrix.
    config : SolverConfig
    on_progress : callable, optional
        Progress callback forwarded to the kernels.
    """
    cfg = (config or SolverConfig()).normalized()
    n, m = A.shape
    if n != m:
        raise ValueError(f"matrix must be square, got {n}x{m}")
    if n == 0:
        raise ValueError("empty matrix")
    k = min(cfg.k, n)

    # tiny problems: direct path (memory-safe, no sparse machinery needed)
    if n <= cfg.dense_threshold and (hasattr(A, "todense") or hasattr(A, "toarray")):
        try:
            res = _dense_path(A, n, cfg)
            if res is not None:
                return res
        except MemoryError:
            pass

    def matvec(x):
        return A @ x

    method = cfg.method
    if method == "auto":
        method = "jacobi-davidson" if cfg.sigma is not None else "lanczos"

    shift_history: list[float] = []
    inner_iterations = 0

    if method == "lanczos":
        out = lanczos_solve(
            matvec, n, k,
            sigma=cfg.sigma, which=cfg.which, tol=cfg.tol,
            max_cycles=cfg.max_cycles, basis_dim=cfg.basis_dim,
            seed=cfg.seed, shift_adaptive=cfg.adaptive_shift,
            minres_rtol=cfg.minres_rtol, minres_maxiter=cfg.minres_maxiter,
            verbose=cfg.verbose, on_progress=on_progress,
        )
        eigenvalues, eigenvectors, residuals = (
            out.eigenvalues, out.eigenvectors, out.residuals)
        iterations, matvecs, converged = (
            out.iterations, out.matvecs, out.converged)
        shift_history = list(out.shift_history)
        inner_iterations = out.inner_iterations
        diagnostics = dict(out.diagnostics)

    elif method == "lobpcg":
        out = lobpcg_solve(
            matvec, n, k,
            largest=(cfg.which != "SA"), tol=cfg.tol, max_iter=cfg.max_iter,
            block=max(cfg.basis_dim // 3, k + 4), seed=cfg.seed,
            on_progress=on_progress,
        )
        eigenvalues, eigenvectors, residuals = (
            out.eigenvalues, out.eigenvectors, out.residuals)
        iterations, matvecs, converged = (
            out.iterations, out.matvecs, out.converged)
        diagnostics = dict(out.diagnostics)

    else:  # jacobi-davidson
        out = jd_solve(
            matvec, n, k,
            sigma=float(cfg.sigma or 0.0), tol=cfg.tol, max_iter=cfg.max_iter,
            basis_dim=cfg.basis_dim, seed=cfg.seed,
            # The correction equation is solved *inexactly* on purpose (JD
            # only needs a descent direction), so the inner rtol must never
            # be stricter than JD's own 1e-4 default — hence max(), not min().
            minres_rtol=max(cfg.minres_rtol, 1e-4),
            minres_maxiter=min(cfg.minres_maxiter, 160),
            verbose=cfg.verbose, on_progress=on_progress,
        )
        eigenvalues, eigenvectors, residuals = (
            out.eigenvalues, out.eigenvectors, out.residuals)
        iterations, matvecs, converged = (
            out.iterations, out.matvecs, out.converged)
        inner_iterations = out.inner_iterations
        diagnostics = dict(out.diagnostics)

    return EigenResult(
        eigenvalues=eigenvalues, eigenvectors=eigenvectors,
        residuals=residuals, converged=bool(converged),
        iterations=iterations, matvecs=matvecs, method=method,
        backend=backend_name(), diagnostics={
            **diagnostics,
            "k": k, "n": n, "tol": cfg.tol, "sigma": cfg.sigma,
            "inner_iterations": inner_iterations,
            "shift_history": shift_history,
            "memory_hint_mb": round(
                (n * cfg.basis_dim * (16 if np.iscomplexobj(eigenvectors) else 8))
                / 1e6, 1),
        },
    )


def solve_sample(kind: str, config: SolverConfig | None = None,
                 on_progress=None, sample_params: dict | None = None) -> tuple[EigenResult, "SampleMatrix"]:
    """Build a named synthetic sample and solve it (demo / self-test path)."""
    from .samples import build_sample  # local import avoids cycle
    sample = build_sample(kind, **(sample_params or {}))
    return solve(sample.A, config, on_progress), sample
