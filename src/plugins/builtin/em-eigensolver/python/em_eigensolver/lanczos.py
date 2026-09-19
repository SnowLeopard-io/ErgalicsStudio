"""Thick-restart (Krylov-Schur style) Lanczos eigensolver for Hermitian A.

Supports two spectral transformations:

* **plain** — ``A q`` per expansion step; finds extremal eigenvalues
  (``which`` = ``'LM' | 'LA' | 'SA'``).
* **shift-invert** — ``(A - sigma I)^{-1} q`` per step, solved with the
  Hermitian MINRES in :mod:`em_eigensolver.minres` (indefinite-safe);
  finds eigenvalues closest to the target shift ``sigma`` — exactly the
  "resonant frequency band" use case of the competition statement.  The
  Ritz values of the transformed operator map back as ``lambda = sigma + 1/theta``.

Thick restart (Wu & Simon): after each cycle the ``k`` wanted Ritz vectors
form the new basis together with the last Lanczos vector, keeping all
converged information (unlike naive restarted Lanczos).  The projected
matrix stays ``(m+1) x m`` with m <= basis_dim (a few hundred), so the only
dense eigendecomposition is on that small matrix — the n x n operator is
never formed or densified.

Adaptive shift: when ``sigma`` is nearly an eigenvalue, ``(A - sigma I)``
becomes near-singular and the inner MINRES needs many iterations.  The
outer loop monitors the inner iteration rate and nudges sigma away from
the singularity at cycle boundaries (recorded in ``shift_history``).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .minres import minres_solve

_EPS = 1e-14


@dataclass
class KrylovResult:
    eigenvalues: np.ndarray          # (k,) real
    eigenvectors: np.ndarray         # (n, k)
    residuals: np.ndarray            # (k,) true relative residuals
    iterations: int                  # outer cycles used
    matvecs: int                     # total operator applications (incl. inner)
    converged: bool
    inner_iterations: int = 0        # total MINRES iterations (shift-invert)
    shift_history: list = field(default_factory=list)
    diagnostics: dict = field(default_factory=dict)


def _select_wanted(theta: np.ndarray, k: int, which: str) -> np.ndarray:
    if which == "LM":
        idx = np.argsort(-np.abs(theta))
    elif which == "LA":
        idx = np.argsort(-theta)
    elif which == "SA":
        idx = np.argsort(theta)
    else:
        raise ValueError(f"unsupported which: {which!r}")
    return idx[:k]


def lanczos_solve(
    matvec,
    n: int,
    k: int,
    *,
    sigma: float | None = None,
    which: str = "LM",
    tol: float = 1e-8,
    max_cycles: int = 60,
    basis_dim: int = 60,
    seed: int = 0,
    v0: np.ndarray | None = None,
    shift_adaptive: bool = True,
    near_singular_threshold: int = 120,
    max_shift_moves: int = 5,
    minres_rtol: float = 1e-6,
    minres_maxiter: int = 250,
    minres_restart: int = 80,
    verbose: bool = False,
    on_progress=None,
) -> KrylovResult:
    """Compute ``k`` eigenpairs of the Hermitian operator ``matvec``.

    Parameters
    ----------
    matvec : callable
        Sparse ``A @ x``; must never build a dense n x n array.
    sigma : float, optional
        Shift-invert target.  ``None`` selects extremal eigenvalues by
        ``which``.  Given a sigma, eigenvalues closest to sigma are found.
        The inner MINRES uses *inexact* shift-invert (moderate ``minres_rtol``):
        outer Rayleigh-Ritz re-orthogonalisation restores full accuracy, while
        near-singular shifts only cost a bounded number of inner iterations.
    shift_adaptive
        Nudge sigma away from near-singular positions automatically.
    on_progress : callable, optional
        ``on_progress(info: dict)`` after every restart cycle.
    """
    if k < 1:
        raise ValueError("k must be >= 1")
    # Inexact shift-invert: the outer residual cannot drop far below the
    # inner MINRES tolerance, so relax the effective tol accordingly.
    if sigma is not None:
        tol = max(tol, 20.0 * minres_rtol)
    m = int(max(basis_dim, k + 8))
    m = min(m, n)
    if m < k:
        raise ValueError("basis smaller than k and n; use the dense path")
    rng = np.random.default_rng(seed)

    total_matvecs = [0]
    inner_total = [0]
    inner_recent: list[int] = []
    inner_converged = [True]
    shift_history: list[float] = []

    # ---- operator (optionally shift-inverted through MINRES) --------------
    if sigma is None:
        def Op(x):
            total_matvecs[0] += 1
            return matvec(x)
    else:
        def Op(x):
            inner_counter: list[int] = [0]
            res = minres_solve(
                matvec, x, shift=sigma_current,  # closure: track adaptive moves
                rtol=minres_rtol, maxiter=minres_maxiter,
                restart=minres_restart, matvec_counter=inner_counter,
            )
            total_matvecs[0] += inner_counter[0]
            inner_total[0] += res.iterations
            inner_recent.append(res.iterations)
            if not res.converged:
                inner_converged[0] = False
            return res.x

    # probe dtype with one call (also gives a realistic scale for ||A||)
    if v0 is not None:
        q0 = np.array(v0, copy=True)
    else:
        q0 = rng.standard_normal(n)
    w0 = matvec(q0)
    total_matvecs[0] += 1
    scale_est = max(float(np.linalg.norm(w0)), 1.0)  # ~ ||A|| lower bound
    if np.iscomplexobj(w0):
        q0 = q0 + 1j * rng.standard_normal(n)
    q0 /= np.linalg.norm(q0)

    def exact_residuals(Y: np.ndarray, lam: np.ndarray):
        """True residuals ||A y - lambda y|| / ||y|| (k matvecs)."""
        res = np.empty(len(lam), dtype=np.float64)
        for i in range(len(lam)):
            total_matvecs[0] += 1
            r = matvec(Y[:, i]) - lam[i] * Y[:, i]
            res[i] = float(np.linalg.norm(r))
        return res

    # ---- state ------------------------------------------------------------
    Q: list[np.ndarray] = [q0]
    H = np.zeros((m + 1, m), dtype=np.result_type(w0, np.float64))
    lenQ = 1
    sigma_current = sigma
    shift_moves = 0
    shift_dir: float | None = None
    shift_step = 0.0
    last_info: dict = {}
    result: KrylovResult | None = None

    for cycle in range(1, max_cycles + 1):
        # ---- expand basis to m columns ------------------------------------
        for j in range(lenQ - 1, m):
            w = Op(Q[j])
            # two-pass DGKS orthogonalisation; projection coeffs fill H[i, j]
            for pas in (0, 1):
                for i, qi in enumerate(Q):
                    c = np.vdot(qi, w)
                    H[i, j] = c if pas == 0 else H[i, j] + c
                    w = w - c * qi
            beta = float(np.linalg.norm(w))
            H[j + 1, j] = beta
            if beta > _EPS:
                Q.append(w / beta)
            else:
                # invariant subspace reached: continue with a random direction
                w = rng.standard_normal(n)
                if np.iscomplexobj(Q[0]):
                    w = w + 1j * rng.standard_normal(n)
                for _pas in (0, 1):
                    for qi in Q:
                        w = w - qi * np.vdot(qi, w)
                Q.append(w / np.linalg.norm(w))
                H[j + 1, j] = 0.0
            lenQ += 1

        # ---- Rayleigh-Ritz on the small projection ------------------------
        Hm = H[:m, :m]
        Hm = 0.5 * (Hm + Hm.conj().T)  # enforce exact Hermitianity of the projection
        theta, S = np.linalg.eigh(Hm)
        lastrow = H[m, :m]
        resid_est = np.abs(lastrow @ S)

        wanted = _select_wanted(theta, k, which if sigma is None else "LM")
        Y = np.stack([sum(S[i, t] * Q[i] for i in range(m))
                      for t in wanted], axis=1)
        lam = theta[wanted] if sigma is None else (sigma_current + 1.0 / theta[wanted])

        res_true = exact_residuals(Y, lam)
        scaleA = float(np.max(np.abs(lam))) or 1.0
        rel = res_true / max(scaleA, _EPS)
        ok = rel <= tol

        last_info = {
            "cycle": cycle, "ritz": lam.tolist(),
            "residuals": res_true.tolist(),
            "matvecs": total_matvecs[0], "inner": inner_total[0],
            "sigma": sigma_current,
        }
        if verbose:
            sig_str = "plain" if sigma_current is None else f"{sigma_current:.6g}"
            print(f"[lanczos] cycle {cycle:3d} | rel_res_max {rel.max():.3e}"
                  f" | matvecs {total_matvecs[0]:6d} | inner {inner_total[0]:6d}"
                  f" | sigma {sig_str}"
                  f" | lambda~ {np.sort(np.asarray(lam))[:3]}", flush=True)
        if on_progress is not None:
            on_progress(last_info)

        if bool(np.all(ok)):
            result = KrylovResult(
                eigenvalues=np.asarray(lam, dtype=np.float64),
                eigenvectors=Y, residuals=res_true, iterations=cycle,
                matvecs=total_matvecs[0], converged=True,
                inner_iterations=inner_total[0],
                shift_history=list(shift_history),
                diagnostics={"cycles": cycle, "basis": m,
                             "backend_shift": sigma_current,
                             "residual_estimate_max": float(resid_est.max())},
            )
            break

        # ---- adaptive shift at cycle boundary ------------------------------
        if (sigma is not None and shift_adaptive and len(inner_recent) >= 8
                and shift_moves < max_shift_moves):
            recent = inner_recent[-16:]
            hot = sum(1 for it in recent if it >= near_singular_threshold)
            if (hot / len(recent) > 0.3 or not inner_converged[0]):
                # Escape the near-singular zone: fixed direction, doubling
                # step (a sigma-proportional step vanishes when sigma ~ 0 and
                # alternating directions just oscillate around the spectrum).
                if shift_dir is None:
                    shift_dir = 1.0 if sigma_current >= 0 else -1.0
                    shift_step = max(1e-3 * scale_est, 1e-2 * abs(sigma_current))
                else:
                    shift_step *= 2.0
                sigma_current = float(sigma_current + shift_dir * shift_step)
                shift_history.append(sigma_current)
                shift_moves += 1
                inner_recent.clear()
                inner_converged[0] = True
                Q = [Q[0]]  # transformed operator changed: restart the basis
                H = np.zeros((m + 1, m), dtype=H.dtype)
                lenQ = 1
                continue

        # ---- thick restart (Wu & Simon) ------------------------------------
        Sk = S[:, wanted]                       # m x k eigenvector block
        coupling = H[m, :m] @ Sk                # (k,) last-row coupling
        Qnew = [sum(S[i, t] * Q[i] for i in range(m)) for t in wanted]
        Qnew.append(Q[m])                       # keep the last Lanczos vector
        H = np.zeros((m + 1, m), dtype=H.dtype)
        for t in range(k):
            H[t, t] = float(theta[wanted[t]])
        H[k, :k] = coupling
        Q = Qnew
        lenQ = k + 1

    if result is None:
        result = KrylovResult(
            eigenvalues=np.asarray(lam, dtype=np.float64),
            eigenvectors=Y, residuals=res_true, iterations=max_cycles,
            matvecs=total_matvecs[0], converged=False,
            inner_iterations=inner_total[0],
            shift_history=list(shift_history),
            diagnostics={"cycles": max_cycles, "basis": m,
                         "backend_shift": sigma_current,
                         "max_cycles_reached": True},
        )
    return result
