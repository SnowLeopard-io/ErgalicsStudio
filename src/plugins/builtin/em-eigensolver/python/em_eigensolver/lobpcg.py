"""Block LOBPCG (Locally Optimal Block Preconditioned Conjugate Gradient).

Targets extremal eigenpairs and — crucially for the competition statement —
**multiple / clustered eigenvalues**: the block formulation keeps B mutually
orthogonal search directions, so a cluster of degenerate modes is captured
in a single iteration instead of requiring deflation.

The iteration is the classical three-basis Rayleigh-Ritz scheme
(Knyazev et al.): search space ``span{X, R, P}`` where
X = current Ritz block, R = residual block (``A X - X diag(theta)``),
P = previous search direction block.  The small projected eigenproblem is
dense ``<= 3B x 3B`` (B = block size ~ k + 4) — dense work stays O(B^3),
the n x n operator is never formed.  Memory is O(n * 3B).

Preconditioning hooks are accepted as an optional SPD linear operator
applied to the residual block; without it LOBPCG is still correct (plain
Rayleigh-Ritz subspace iteration with locally optimal expansion).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

_EPS = 1e-14


@dataclass
class LobpcgResult:
    eigenvalues: np.ndarray          # (k,)
    eigenvectors: np.ndarray         # (n, k)
    residuals: np.ndarray            # (k,) true relative residuals
    iterations: int
    matvecs: int
    converged: bool
    diagnostics: dict = field(default_factory=dict)


def _orthonormalize(V: np.ndarray, rng: np.random.Generator,
                    replace_dependent: bool = True) -> np.ndarray:
    """Modified Gram-Schmidt with re-orthogonalisation.

    Columns that are (numerically) linearly dependent are either dropped or
    replaced by fresh random directions.  Once the space is exhausted the
    returned block simply has fewer columns than V (never padded with
    numerical-noise directions).
    """
    n, ncols = V.shape
    out_cols: list[np.ndarray] = []
    for j in range(ncols):
        v = V[:, j].astype(V.dtype, copy=True)
        for _pass in (0, 1):
            for u in out_cols:
                v = v - u * np.vdot(u, v)
        nv = float(np.sqrt(max(np.vdot(v, v).real, 0.0)))
        if nv > 1e-8:
            out_cols.append(v / nv)
        elif replace_dependent:
            w = rng.standard_normal(n)
            if np.iscomplexobj(V):
                w = w + 1j * rng.standard_normal(n)
            for u in out_cols:
                w = w - u * np.vdot(u, w)
            nw = float(np.linalg.norm(w))
            if nw > 1e-8:
                out_cols.append(w / nw)
        if len(out_cols) == ncols:
            break
    # top-up with random directions only while the space still has room
    while len(out_cols) < ncols:
        w = rng.standard_normal(n)
        if np.iscomplexobj(V):
            w = w + 1j * rng.standard_normal(n)
        for u in out_cols:
            w = w - u * np.vdot(u, w)
        nw = float(np.linalg.norm(w))
        if nw <= 1e-8:
            break  # space exhausted; do NOT pad with noise directions
        out_cols.append(w / nw)
    return np.stack(out_cols, axis=1)


def _mat_cols(matvec, X: np.ndarray, counter: list[int]) -> np.ndarray:
    """Apply the operator column-wise (never densifying anything)."""
    out = np.empty_like(X)
    for j in range(X.shape[1]):
        out[:, j] = matvec(X[:, j])
        counter[0] += 1
    return out


def lobpcg_solve(
    matvec,
    n: int,
    k: int,
    *,
    largest: bool = True,
    tol: float = 1e-8,
    max_iter: int = 200,
    block: int | None = None,
    seed: int = 0,
    precond=None,
    on_progress=None,
) -> LobpcgResult:
    """Compute ``k`` extremal eigenpairs of Hermitian ``matvec``.

    Parameters
    ----------
    largest : bool
        ``True`` -> largest algebraic eigenvalues, ``False`` -> smallest.
    block : int, optional
        Block size B (>= k).  Defaults to ``k + 4`` for cluster robustness.
    precond : callable, optional
        SPD preconditioner ``M^{-1} r`` applied to the residual block.
    on_progress : callable, optional
        ``on_progress(info: dict)`` after every iteration.
    """
    if k < 1:
        raise ValueError("k must be >= 1")
    B = int(block if block is not None else k + 4)
    B = max(B, k)
    B = min(B, n)
    rng = np.random.default_rng(seed)
    counter = [0]

    dtype_probe = matvec(np.zeros(n))
    is_complex = np.iscomplexobj(dtype_probe)
    dt = np.complex128 if is_complex else np.float64

    X = _orthonormalize(
        (rng.standard_normal((n, B)) + (1j * rng.standard_normal((n, B)) if is_complex else 0)).astype(dt),
        rng, replace_dependent=False,
    )
    P: np.ndarray | None = None
    theta = np.zeros(B)
    converged = False
    it = 0
    last_rel = np.ones(B)

    for it in range(1, max_iter + 1):
        AX = _mat_cols(matvec, X, counter)

        # Rayleigh-Ritz on span{X}
        Hx = X.conj().T @ AX
        Hx = 0.5 * (Hx + Hx.conj().T)
        theta, S = np.linalg.eigh(Hx)
        order = np.arange(B) if largest else np.arange(B - 1, -1, -1)
        # eigh ascending: largest -> take last columns first
        if largest:
            S = S[:, ::-1]
            theta = theta[::-1]
        X = X @ S
        AX = AX @ S

        # residuals R = A X - X diag(theta)
        R = AX - X * theta[np.newaxis, :]

        # ---- convergence on true residuals (already exact: AX is fresh) ----
        scaleA = float(np.max(np.abs(theta))) or 1.0
        res_norms = np.sqrt(np.maximum(np.einsum("ij,ij->j", R.conj(), R).real, 0.0))
        last_rel = res_norms / scaleA
        if on_progress is not None:
            on_progress({"iter": it, "ritz": theta[:k].tolist(),
                         "rel_residuals": last_rel[:k].tolist(),
                         "matvecs": counter[0]})
        if bool(np.all(last_rel[:k] <= tol)):
            converged = True
            break

        # ---- build the locally optimal basis [X, R~, P] ---------------------
        Rt = R.copy()
        if precond is not None:
            for j in range(B):
                Rt[:, j] = precond(Rt[:, j])
        norms = np.sqrt(np.maximum(np.einsum("ij,ij->j", Rt.conj(), Rt).real, 0.0))
        norms[norms < _EPS] = 1.0
        Rt = Rt / norms[np.newaxis, :]

        basis = [X, Rt]
        if P is not None:
            basis.append(P)
        Qall = _orthonormalize(np.concatenate(basis, axis=1), rng)
        Aall = _mat_cols(matvec, Qall, counter)
        H = Qall.conj().T @ Aall
        H = 0.5 * (H + H.conj().T)
        evals, evecs = np.linalg.eigh(H)
        m_eff = Qall.shape[1]

        # wanted: B extremal (fewer if the space was exhausted); keep further
        # directions as the P block
        if largest:
            sel = np.argsort(-evals)
        else:
            sel = np.argsort(evals)
        tb = min(B, m_eff)
        take = sel[:tb]
        extra = sel[tb:min(2 * tb, m_eff)]
        X = Qall @ evecs[:, take]
        P = Qall @ evecs[:, extra] if len(extra) else None
        theta = evals[take]

    # ---- final exact residuals ----------------------------------------------
    AX = _mat_cols(matvec, X, counter)
    lam = X.conj().T @ AX
    lam = 0.5 * (lam + lam.conj().T)
    theta_f, S_f = np.linalg.eigh(lam)
    if largest:
        S_f = S_f[:, ::-1]
        theta_f = theta_f[::-1]
    X = X @ S_f
    res = np.empty(k)
    scaleA = float(np.max(np.abs(theta_f))) or 1.0
    for i in range(k):
        r = matvec(X[:, i]) - theta_f[i] * X[:, i]
        counter[0] += 1
        res[i] = float(np.linalg.norm(r)) / scaleA

    return LobpcgResult(
        eigenvalues=np.asarray(theta_f[:k], dtype=np.float64),
        eigenvectors=X[:, :k],
        residuals=res,
        iterations=it, matvecs=counter[0], converged=converged,
        diagnostics={"block": B, "backend": "lobpcg",
                     "rel_residuals_last": last_rel[:k].tolist()},
    )
