"""MINRES inner solver for Hermitian (possibly indefinite) linear systems.

Shift-invert spectral transformation and the Jacobi-Davidson correction
equation both require solving  ``(A - sigma I) y = x``  where the operator is
Hermitian but *non-positive-definite* (sigma may sit inside the spectrum).
Conjugate Gradients does not apply there; MINRES does.

Implementation notes
--------------------
* The Hermitian Lanczos three-term recurrence builds the basis; the small
  least-squares problem ``min || beta1 e1 - T_k y ||`` on the tridiagonal
  projection is solved with LAPACK ``lstsq`` every ``check_every`` steps.
  This is mathematically classical MINRES (same Krylov space, same residual
  minimisation) at negligible overhead, since ``T_k`` is at most
  ``restart x restart`` (default 80).
* No inner preconditioning: any nontrivial preconditioner either breaks the
  Hermitian three-term recurrence (sign-indefinite Jacobi ``M = diag(A)``)
  or catastrophically worsens conditioning of random matrices (symmetric
  scaling with near-zero diagonals).  For matrices with a well-conditioned
  diagonal structure, apply an explicit symmetric transformation
  ``A' = P A P`` *before* calling this solver (documented in solver.py).
* Every restart cycle recomputes the exact residual with one extra matvec,
  so convergence is decided by true residuals, never by accumulated
  recurrences.  Memory is O(n * restart); nothing is densified.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

_EPS = 1e-14


@dataclass
class MinresResult:
    x: np.ndarray
    iterations: int
    matvecs: int
    rel_residual: float
    converged: bool
    flag: str  # 'converged' | 'maxiter' | 'breakdown'


def minres_solve(
    matvec,
    b: np.ndarray,
    *,
    shift: float = 0.0,
    x0: np.ndarray | None = None,
    rtol: float = 1e-6,
    maxiter: int = 200,
    restart: int = 80,
    check_every: int = 4,
    matvec_counter: list[int] | None = None,
) -> MinresResult:
    """Solve ``(H - shift I) x = b`` for Hermitian H, indefinite allowed.

    Parameters
    ----------
    matvec : callable
        Sparse ``H @ x`` (never dense).
    b : (n,) real/complex array.
    shift : float
        Constant diagonal shift of the operator.
    rtol
        Relative residual stopping threshold.
    restart
        Basis size before a restarted cycle (memory cap).
    """
    b = np.asarray(b)

    def _count(k: int = 1) -> None:
        if matvec_counter is not None:
            matvec_counter[0] += k

    x = np.zeros_like(b) if x0 is None else np.array(x0, copy=True)
    r = b.copy()
    if x0 is not None:
        r = b - (matvec(x) - shift * x)
        _count()
    bnorm = float(np.linalg.norm(b))
    if bnorm == 0.0:
        return MinresResult(x, 0, 0, 0.0, True, "converged")

    total_iters = 0
    total_matvecs = 1 if x0 is not None else 0
    rel = 1.0

    while total_iters < maxiter:
        # ---------------- one restarted Lanczos cycle ----------------------
        beta = float(np.linalg.norm(r))
        if not np.isfinite(beta) or beta <= _EPS * bnorm:
            break  # x already solves the system to numerical exactness
        q = r / beta
        v_prev = np.zeros_like(b)
        Q = [q]
        alphas: list[float] = []
        betas: list[float] = [beta]
        last_y: np.ndarray | None = None
        lucky = False

        k = 0
        for k in range(1, restart + 1):
            if total_iters + k > maxiter:
                break
            w = matvec(q) - shift * q
            total_matvecs += 1
            _count()
            alpha = float(np.vdot(q, w).real)  # Hermitian => real
            w = w - alpha * q
            if k > 1:
                w = w - betas[k - 1] * v_prev
            # DGKS full reorthogonalisation (keeps complex/indefinite basis clean)
            for qi in Q:
                w = w - qi * np.vdot(qi, w)
            beta_sq = float(np.vdot(w, w).real)
            alphas.append(alpha)

            if not np.isfinite(beta_sq) or beta_sq <= (_EPS * bnorm) ** 2:
                lucky = True  # invariant subspace hit
                beta_new = 0.0
            else:
                beta_new = float(np.sqrt(beta_sq))

            if lucky or (k % check_every == 0 or k == restart):
                # min || beta1 e1 - T_k y || on the tridiagonal projection
                size = k
                Tm = np.zeros((size + 1, size), dtype=np.float64)
                for j, a in enumerate(alphas):
                    Tm[j, j] = a
                for j in range(1, size):
                    Tm[j, j - 1] = betas[j]
                    Tm[j - 1, j] = betas[j]
                Tm[size, size - 1] = beta_new
                rhs = np.zeros(size + 1)
                rhs[0] = betas[0]
                last_y, _, _, _ = np.linalg.lstsq(Tm, rhs, rcond=None)
                ls_rel = float(np.linalg.norm(rhs - Tm @ last_y) / bnorm)
                if ls_rel <= rtol or lucky:
                    break

            v_prev = q
            q = w / beta_new
            Q.append(q)
            betas.append(beta_new)

        total_iters += k

        # Materialise x and recompute the residual exactly (one matvec).
        if last_y is None:
            last_y = np.zeros(len(Q))
        dx = np.zeros_like(b)
        for coeff, qi in zip(last_y, Q):
            dx += coeff * qi
        x = x + dx
        r = b - (matvec(x) - shift * x)
        total_matvecs += 1
        _count()
        rel = float(np.linalg.norm(r) / bnorm)
        if rel <= rtol:
            return MinresResult(x, total_iters, total_matvecs, rel, True, "converged")

    return MinresResult(x, total_iters, total_matvecs, rel, rel <= rtol,
                        "converged" if rel <= rtol else "maxiter")
