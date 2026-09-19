"""Jacobi-Davidson eigensolver for interior eigenvalues near a target sigma.

This is the workhorse for the hardest regime of the competition statement:
* eigenvalues **inside** a dense spectral cluster (shift-invert Lanczos
  degenerates there because ``(A - sigma I)`` is near-singular no matter
  where sigma is placed inside the band);
* **repeated / clustered eigenvalues**, handled via *deflation*: converged
  eigenvectors are locked into an orthonormal basis W and projected out of
  every subsequent search, so a degenerate mode is found again and again in
  fresh directions instead of collapsing onto the same vector.

Core iteration (Sleijpen & van der Vorst):
1. Rayleigh-Ritz on the current search space V  (small dense eigenproblem,
   ``m x m`` with m <= basis_dim; the n x n operator is never formed).
2. Pick the Ritz pair closest to sigma; residual  ``r = A u - theta u``
   is exact (AV columns are computed explicitly).
3. Correction equation, solved approximately with the Hermitian MINRES:
       (I - u u^H - W W^H)(A - theta I)(I - u u^H - W W^H) t = -r'
   The oblique projections move theta out of the spectrum, so the correction
   system stays solvable even when ``theta ~= lambda`` (near-singular shift).
   The inner solve is deliberately *inexact* (relaxed rtol) — JD only needs
   a descent direction.
4. Expand V with the (orthogonalised) correction; restart by keeping the
   best Ritz vectors when the basis hits ``basis_dim``.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .minres import minres_solve

_EPS = 1e-14


@dataclass
class JdResult:
    eigenvalues: np.ndarray          # (k,)
    eigenvectors: np.ndarray         # (n, k)
    residuals: np.ndarray            # (k,) relative residuals
    iterations: int                  # outer expansion steps used
    matvecs: int                     # total A applications (incl. inner)
    converged: bool
    inner_iterations: int = 0
    diagnostics: dict = field(default_factory=dict)


def _ortho_against(t: np.ndarray, basis_cols, passes: int = 2) -> np.ndarray:
    for _ in range(passes):
        for u in basis_cols:
            t = t - u * np.vdot(u, t)
    return t


def jd_solve(
    matvec,
    n: int,
    k: int,
    *,
    sigma: float = 0.0,
    tol: float = 1e-8,
    max_iter: int = 400,
    basis_dim: int = 48,
    keep: int = 8,
    seed: int = 0,
    minres_rtol: float = 1e-4,
    minres_maxiter: int = 120,
    verbose: bool = False,
    on_progress=None,
) -> JdResult:
    """Find ``k`` eigenpairs of Hermitian ``matvec`` closest to ``sigma``.

    Parameters
    ----------
    basis_dim
        Maximum search-space size before a restart (memory O(n * basis_dim)).
    keep
        Number of Ritz vectors retained at a restart.
    minres_rtol / minres_maxiter
        Budget for the (inexact) correction-equation solves.
    """
    if k < 1:
        raise ValueError("k must be >= 1")
    m0 = int(min(max(basis_dim, k + 4), n))
    keep = int(min(max(keep, k + 2), m0))
    rng = np.random.default_rng(seed)
    total_matvecs = [0]
    inner_total = [0]

    def A(x):
        total_matvecs[0] += 1
        return matvec(x)

    probe = A(rng.standard_normal(n))
    is_complex = np.iscomplexobj(probe)
    dt = np.complex128 if is_complex else np.float64
    scale_est = max(float(np.linalg.norm(probe)), 1.0)

    def rand_vec() -> np.ndarray:
        w = rng.standard_normal(n)
        if is_complex:
            w = w + 1j * rng.standard_normal(n)
        return w

    # ---- locked (converged, deflated) eigenpairs ---------------------------
    lock_lam: list[float] = []
    lock_vec: list[np.ndarray] = []

    def Wmat() -> np.ndarray:
        return (np.stack(lock_vec, axis=1) if lock_vec
                else np.zeros((n, 0), dtype=dt))

    def project_out(x: np.ndarray, extra: np.ndarray | None = None) -> np.ndarray:
        """Project x orthogonal to locked vectors and (optionally) u."""
        if lock_vec:
            Wc = Wmat()
            x = x - Wc @ (Wc.conj().T @ x)
        if extra is not None:
            x = x - extra * np.vdot(extra, x)
        return x

    # ---- initial search space ----------------------------------------------
    V = np.empty((n, 0), dtype=dt)
    AV = np.empty((n, 0), dtype=dt)
    while V.shape[1] < m0:
        w = rand_vec()
        w = _ortho_against(w, [V[:, j] for j in range(V.shape[1])] + lock_vec)
        nw = float(np.linalg.norm(w))
        if nw <= 1e-8:
            break
        w = w / nw
        V = np.concatenate([V, w[:, None]], axis=1)
        AV = np.concatenate([AV, A(w)[:, None]], axis=1)
    H = V.conj().T @ AV
    H = 0.5 * (H + H.conj().T)

    found_lam: list[float] = []
    found_vec: list[np.ndarray] = []
    found_res: list[float] = []
    it = 0
    converged = False
    last_rel = 1.0

    def restart(new_cols: int) -> None:
        """Rebuild the search space around the best Ritz vectors."""
        nonlocal V, AV, H
        Vn = np.empty((n, 0), dtype=dt)
        AVn = np.empty((n, 0), dtype=dt)
        for j in range(min(new_cols, V.shape[1])):
            w = project_out(V[:, j])
            for _ in range(2):
                w = _ortho_against(w, [Vn[:, t] for t in range(Vn.shape[1])]
                                   + lock_vec)
            nw = float(np.linalg.norm(w))
            if nw <= 1e-8:
                continue
            w = w / nw
            Vn = np.concatenate([Vn, w[:, None]], axis=1)
            AVn = np.concatenate([AVn, A(w)[:, None]], axis=1)
        while Vn.shape[1] < new_cols:
            w = rand_vec()
            w = _ortho_against(w, [Vn[:, t] for t in range(Vn.shape[1])]
                               + lock_vec)
            nw = float(np.linalg.norm(w))
            if nw <= 1e-8:
                break
            w = w / nw
            Vn = np.concatenate([Vn, w[:, None]], axis=1)
            AVn = np.concatenate([AVn, A(w)[:, None]], axis=1)
        V, AV = Vn, AVn
        H = V.conj().T @ AV
        H = 0.5 * (H + H.conj().T)

    while it < max_iter and len(found_lam) < k:
        it += 1
        theta, S = np.linalg.eigh(H)
        # Ritz values closest to sigma, skipping *locked* Ritz pairs.
        # A pair is locked only if BOTH the eigenvalue matches AND the Ritz
        # vector is parallel to a locked vector — a repeated eigenvalue has
        # orthogonal copies which must NOT be skipped (that is the point of
        # deflation).
        order = np.argsort(np.abs(theta - sigma))
        picked = -1
        u = None
        for idx in order:
            u_cand = V @ S[:, idx]
            th_c = theta[idx]
            is_locked = False
            for lm, lv in zip(lock_lam, lock_vec):
                if (abs(th_c - lm) <= 1e-9 * max(scale_est, abs(th_c))
                        and abs(np.vdot(lv, u_cand)) > 0.9):
                    is_locked = True
                    break
            if is_locked:
                continue
            picked = int(idx)
            u = u_cand
            break
        if picked < 0:
            break
        theta_i = float(theta[picked])
        r = AV @ S[:, picked] - theta_i * u
        res_norm = float(np.linalg.norm(r))
        last_rel = res_norm / max(abs(theta_i), 1e-3 * scale_est)

        if verbose and it % 10 == 0:
            print(f"[jd] step {it:4d} | lam {theta_i:+.8f} | rel {last_rel:.3e}"
                  f" | locked {len(lock_lam)}/{k} | matvecs {total_matvecs[0]}"
                  f" | basis {V.shape[1]}", flush=True)
        if on_progress is not None:
            on_progress({"iter": it, "ritz": theta_i, "rel": last_rel,
                         "locked": len(lock_lam), "matvecs": total_matvecs[0]})

        if last_rel <= tol:
            # lock and deflate
            uu = u / np.linalg.norm(u)
            lock_lam.append(theta_i)
            lock_vec.append(uu)
            if len(lock_lam) >= k:
                converged = True
                break
            # rebuild space without the locked direction
            restart(keep)
            continue

        # ---- correction equation (inexact MINRES on projected operator) ----
        def cp_matvec(x, _u=u, _th=theta_i):
            xp = project_out(x, extra=_u)
            yp = A(xp) - _th * xp
            return project_out(yp, extra=_u)

        rhs = project_out(-r, extra=u)
        inner_counter: list[int] = [0]
        sol = minres_solve(cp_matvec, rhs, rtol=minres_rtol,
                           maxiter=minres_maxiter, restart=minres_maxiter,
                           matvec_counter=inner_counter)
        total_matvecs[0] += inner_counter[0]
        inner_total[0] += sol.iterations
        t = project_out(sol.x, extra=u)
        t = _ortho_against(t, [V[:, j] for j in range(V.shape[1])] + lock_vec)
        nt = float(np.linalg.norm(t))
        if nt <= 1e-10:
            t = rand_vec()
            t = _ortho_against(t, [V[:, j] for j in range(V.shape[1])] + lock_vec)
            nt = float(np.linalg.norm(t))
            if nt <= 1e-10:
                break
        t = t / nt
        # expand; restart when the basis is full
        if V.shape[1] >= basis_dim:
            restart(keep)
            t = project_out(t)
            t = _ortho_against(t, [V[:, j] for j in range(V.shape[1])] + lock_vec)
            nt = float(np.linalg.norm(t))
            if nt <= 1e-10:
                continue
            t = t / nt
        Atv = A(t)
        Hnew_col = V.conj().T @ Atv
        V = np.concatenate([V, t[:, None]], axis=1)
        AV = np.concatenate([AV, Atv[:, None]], axis=1)
        H = np.pad(H, ((0, 1), (0, 1)))
        H[:-1, -1] = Hnew_col
        H[-1, :-1] = Hnew_col.conj()
        H[-1, -1] = float(np.vdot(t, Atv).real)

    # ---- assemble result -----------------------------------------------------
    if lock_lam:
        order = np.argsort(np.abs(np.asarray(lock_lam) - sigma))
        sel = order[:k]
        found_lam = [lock_lam[i] for i in sel]
        found_vec = [lock_vec[i] for i in sel]
    conv_final = len(lock_lam) >= k
    if not lock_lam:
        return JdResult(np.zeros(0), np.zeros((n, 0)), np.zeros(0),
                        it, total_matvecs[0], False, inner_total[0],
                        {"locked": 0})
    residuals = []
    scaleA = max(max(abs(l) for l in found_lam), 1e-3 * scale_est)
    for i, v in enumerate(found_vec):
        rv = A(v) - found_lam[i] * v
        residuals.append(float(np.linalg.norm(rv)) / scaleA)
    return JdResult(
        eigenvalues=np.asarray(found_lam, dtype=np.float64),
        eigenvectors=np.stack(found_vec, axis=1),
        residuals=np.asarray(residuals, dtype=np.float64),
        iterations=it, matvecs=total_matvecs[0],
        converged=conv_final, inner_iterations=inner_total[0],
        diagnostics={"locked": len(lock_lam), "backend": "jacobi-davidson",
                     "last_rel": last_rel},
    )
