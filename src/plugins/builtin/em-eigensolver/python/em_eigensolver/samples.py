"""Synthetic electromagnetic-resonator sample matrices (fully reproducible).

The competition statement asks for sample data covering the hard regimes:

===========================  ==========================================
sample kind                  regime
===========================  ==========================================
``cavity_small``             memory-limited small scale (smoke tests)
``cluster_zero``             dense spectrum around zero + near-singular
                             shift sigma=0 (resonance extraction)
``degenerate_pair``          exactly repeated eigenvalues (deflation)
``cavity_complex``           complex Hermitian (TE/TM-like coupling)
``cavity_large``             ~1e5 unknowns scale check (optional)
===========================  ==========================================

All matrices are built sparse (CSR), Hermitian by construction, and
parameterised — **no hardcoded problem sizes or answers**; every sample is
generated from (n_cells, bandwidth, seed, ...) knobs.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .csr import csr_from_coo, sparse_memory_bytes

_EPS = 1e-14


@dataclass
class SampleMatrix:
    name: str
    description: str
    A: object                      # CSR matrix (NumpyCSR or scipy)
    recommended_sigma: float
    recommended_k: int = 6
    meta: dict = field(default_factory=dict)


def _grid_laplacian(nx: int, ny: int, mu: float = 0.0, scale: float = 1.0,
                    complex_phase: bool = False, seed: int = 0):
    """2-D five-point Laplacian on an nx*ny grid (Dirichlet), shifted by mu.

    Spectrum inside [mu, mu + 8*scale].  With ``complex_phase`` the
    horizontal coupling gets a constant phase e^{i phi} (TE/TM-like
    magnetic bias), keeping the matrix Hermitian.
    """
    n = nx * ny
    rng = np.random.default_rng(seed)
    diag_val = 4.0 * scale + mu
    off1 = -scale * np.ones(n)          # +1 neighbour
    if complex_phase:
        phi = 0.7 * rng.standard_normal() + 0.3
        off1 = off1 * np.exp(1j * phi)
    offn = -scale * np.ones(n)          # +nx neighbour

    rows: list[np.ndarray] = []
    cols: list[np.ndarray] = []
    vals: list[np.ndarray] = []

    idx = np.arange(n)
    # diagonal
    diag = np.full(n, diag_val, dtype=complex if complex_phase else float)
    # small deterministic material heterogeneity (keeps Hermitian, real diag)
    diag += 0.05 * scale * np.sin(3.0 * np.pi * (idx % nx) / max(nx - 1, 1)) \
        * np.sin(2.0 * np.pi * (idx // nx) / max(ny - 1, 1))

    # +1 coupling (horizontal), skip at row ends
    m = idx[(idx % nx) != nx - 1]
    j = m + 1
    rows.append(m); cols.append(j); vals.append(off1[m])
    rows.append(j); cols.append(m); vals.append(np.conj(off1[m]))
    # +nx coupling (vertical), skip at top boundary rows
    m2 = idx[idx < n - nx]
    j2 = m2 + nx
    rows.append(m2); cols.append(j2); vals.append(offn[m2])
    rows.append(j2); cols.append(m2); vals.append(np.conj(offn[m2]))
    rows.append(idx); cols.append(idx); vals.append(diag)

    r = np.concatenate(rows); c = np.concatenate(cols); d = np.concatenate(vals)
    return csr_from_coo(r.astype(np.int64), c.astype(np.int64), d, n, n)


def _band_block(size: int, mu: float, halfwidth: float, complex_: bool,
                seed: int):
    """Tridiagonal Hermitian block with spectrum inside [mu-hw, mu+hw]."""
    rng = np.random.default_rng(seed)
    d = mu + halfwidth * rng.standard_normal(size)
    off = 0.5 * halfwidth * (rng.standard_normal(size - 1)
                             + (1j * rng.standard_normal(size - 1) if complex_ else 0))
    dt = complex if complex_ else float
    B = np.zeros((size, size), dtype=dt)
    B[np.arange(size), np.arange(size)] = d
    B[np.arange(size - 1), np.arange(1, size)] = off
    B[np.arange(1, size), np.arange(size - 1)] = np.conj(off)
    return B


def _assemble_blocks(blocks: list[np.ndarray]):
    n = sum(B.shape[0] for B in blocks)
    dt = blocks[0].dtype
    rows: list[np.ndarray] = []
    cols: list[np.ndarray] = []
    vals: list[np.ndarray] = []
    b0 = 0
    for B in blocks:
        s = B.shape[0]
        rr, cc = np.nonzero(B)
        rows.append(rr + b0); cols.append(cc + b0); vals.append(B[rr, cc])
        b0 += s
    r = np.concatenate(rows).astype(np.int64)
    c = np.concatenate(cols).astype(np.int64)
    d = np.concatenate(vals)
    return csr_from_coo(r, c, d, n, n)


def _meta(A, sigma: float, k: int, extra: dict | None = None) -> dict:
    info = {
        "n": int(A.shape[0]),
        "nnz": int(A.nnz if hasattr(A, "nnz") else len(A.data)),
        "dtype": str(A.data.dtype if hasattr(A, "data") else "unknown"),
        "memory_mb": round(sparse_memory_bytes(A) / 1e6, 3),
        "recommended_sigma": sigma,
        "recommended_k": k,
    }
    if extra:
        info.update(extra)
    return info


def cavity_small(seed: int = 0) -> SampleMatrix:
    """900-unknown cavity; runs everywhere incl. low-memory environments."""
    A = _grid_laplacian(30, 30, mu=0.5, scale=1.0, seed=seed)
    return SampleMatrix(
        name="cavity_small",
        description="2D resonant cavity (900 unknowns), spectrum in [0.5, 8.5]."
                    " Small enough for memory-limited environments.",
        A=A, recommended_sigma=0.6, recommended_k=6,
        meta=_meta(A, 0.6, 6, {"regime": "memory-limited small scale"}),
    )


def cluster_zero(n_bands: int = 6, band_size: int = 120, halfwidth: float = 0.03,
                 seed: int = 1) -> SampleMatrix:
    """Spectrum clustered densely around zero; sigma=0 is near-singular.

    n_bands narrow tridiagonal bands are centred inside +-0.2 of zero, so
    hundreds of eigenvalues crowd the resonance region while the operator
    itself is (nearly) singular there — the core competition regime.
    """
    centers = np.linspace(-0.2, 0.2, n_bands)
    blocks = [_band_block(band_size, float(mu), halfwidth, False,
                          seed + 100 * i)
              for i, mu in enumerate(centers)]
    A = _assemble_blocks(blocks)
    return SampleMatrix(
        name="cluster_zero",
        description=f"Dense spectrum around zero ({n_bands} narrow bands, "
                    f"halfwidth {halfwidth}); sigma=0 sits inside the cluster "
                    "(near-singular shift + resonance extraction).",
        A=A, recommended_sigma=0.0, recommended_k=8,
        meta=_meta(A, 0.0, 8, {"regime": "dense spectrum at zero / near-singular shift",
                               "band_halfwidth": halfwidth}),
    )


def degenerate_pair(band_size: int = 100, seed: int = 2) -> SampleMatrix:
    """Exactly repeated eigenvalues: two identical bands (doubly degenerate)."""
    B1 = _band_block(band_size, -1.0, 0.1, False, seed)
    B2 = _band_block(band_size, 2.0, 0.1, False, seed + 7)
    A = _assemble_blocks([B1, B1, B2])          # identical blocks -> 2-fold
    return SampleMatrix(
        name="degenerate_pair",
        description="Two identical coupled-cavity bands: every eigenvalue of "
                    "the first band is exactly doubly degenerate.",
        A=A, recommended_sigma=-1.0, recommended_k=6,
        meta=_meta(A, -1.0, 6, {"regime": "repeated eigenvalues (deflation)"}),
    )


def cavity_complex(nx: int = 24, ny: int = 24, seed: int = 3) -> SampleMatrix:
    """Complex Hermitian cavity (magnetic-bias-like phase on the coupling)."""
    A = _grid_laplacian(nx, ny, mu=1.0, scale=1.0,
                        complex_phase=True, seed=seed)
    return SampleMatrix(
        name="cavity_complex",
        description="Complex Hermitian resonator (biased coupling phase), "
                    f"{nx * ny} unknowns; spectrum in ~[1, 9].",
        A=A, recommended_sigma=1.2, recommended_k=6,
        meta=_meta(A, 1.2, 6, {"regime": "complex Hermitian"}),
    )


def cavity_large(nx: int = 320, ny: int = 320, seed: int = 4) -> SampleMatrix:
    """~1e5 unknowns scale check (memory: a few hundred MB with basis 48)."""
    A = _grid_laplacian(nx, ny, mu=0.0, scale=1.0, seed=seed)
    return SampleMatrix(
        name="cavity_large",
        description=f"Large-scale 2D cavity ({nx * ny} unknowns, five-point "
                    "stencil); targets ~1e5-order capability check.",
        A=A, recommended_sigma=0.5, recommended_k=6,
        meta=_meta(A, 0.5, 6, {"regime": "large scale"}),
    )


SAMPLE_BUILDERS = {
    "cavity_small": cavity_small,
    "cluster_zero": cluster_zero,
    "degenerate_pair": degenerate_pair,
    "cavity_complex": cavity_complex,
    "cavity_large": cavity_large,
}


def build_sample(kind: str, **params) -> SampleMatrix:
    """Build a named sample; extra kwargs are forwarded to the builder."""
    if kind not in SAMPLE_BUILDERS:
        raise ValueError(f"unknown sample kind {kind!r}; "
                         f"available: {sorted(SAMPLE_BUILDERS)}")
    return SAMPLE_BUILDERS[kind](**params)
