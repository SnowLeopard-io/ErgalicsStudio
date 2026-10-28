"""Minimal CSR sparse matrix (pure NumPy) and shared sparse primitives.

Only the handful of operations the eigensolver needs are implemented; when
SciPy is available the constructors return a ``scipy.sparse.csr_matrix``
instead, so production runs use the battle-tested implementation. Both
backends expose the same duck-typed surface:

``shape`` / ``nnz`` / ``dtype`` / ``A @ x`` / ``A.dot(x)`` / ``A.diagonal()``
/ ``A.conj()`` / ``A.T`` / ``A.H`` / ``A.tocoo()``.

Important invariant (competition constraint): constructing a CSR never
allocates an ``n x n`` dense array.  COO -> CSR conversion sorts and reduces
linear indices with O(nnz log nnz) workspace only.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

import numpy as np

from .backend import HAVE_SCIPY

if HAVE_SCIPY:  # pragma: no cover
    import scipy.sparse as _sp


# --------------------------------------------------------------------------
# Optional GPU SpMV delegation (browser WebGPU bridge, see em-worker.ts).
#
# The host may register a GPU SpMV implementation via :func:`set_gpu_spmv`.
# It is *opt-in* (``gpu_spmv`` config flag) and only used for real-valued
# float matrices: the WebGPU kernel is f32, so results carry ~1e-7 relative
# noise and the certified residual floor is correspondingly looser. Any GPU
# failure returns ``None`` and the CPU path takes over transparently.
# --------------------------------------------------------------------------

_GPU_SPMV_UPLOAD = None     # host fn(indptr, indices, data) -> handle
_GPU_SPMV_HOST = None       # host fn(handle, x32, y32) fills y32 in-place
_GPU_SPMV_ENABLED = False
_GPU_SPMV_MIN_ROWS = 4096


def set_gpu_spmv(upload_fn, spmv_fn, enabled: bool = True) -> None:
    """Register the host GPU SpMV bridge (call from the JS worker)."""
    global _GPU_SPMV_UPLOAD, _GPU_SPMV_HOST, _GPU_SPMV_ENABLED
    _GPU_SPMV_UPLOAD = upload_fn
    _GPU_SPMV_HOST = spmv_fn
    _GPU_SPMV_ENABLED = bool(enabled)


def gpu_spmv_enabled() -> bool:
    return bool(_GPU_SPMV_ENABLED and _GPU_SPMV_UPLOAD and _GPU_SPMV_HOST)


def _worker_count() -> int:
    """CPU matvec worker count (env override: ``EM_EIGENSOLVER_THREADS``)."""
    env = os.environ.get("EM_EIGENSOLVER_THREADS")
    if env:
        try:
            return max(1, int(env))
        except ValueError:
            pass
    try:
        return max(1, min(8, os.cpu_count() or 1))
    except Exception:  # pragma: no cover - defensive
        return 1


# Rows above this threshold are split into worker-sized blocks and multiplied
# concurrently (the reduceat-based block kernel releases the GIL inside the
# large ufuncs). Below it the single-block path is faster than any pool.
# Measured crossover (8 workers, grid Laplacian): 10201 rows → 0.25× (pool
# overhead dominates), 40000 rows → 1.40×, 102400 rows → 1.49×; hence 4e4.
_PARALLEL_MIN_ROWS = 40000

_POOL = None


def _pool(workers: int):
    """Lazily created, reused matvec pool (per-call pools cost ~0.5 ms)."""
    global _POOL
    if _POOL is None:
        from concurrent.futures import ThreadPoolExecutor
        _POOL = ThreadPoolExecutor(max_workers=workers)
    return _POOL


# --------------------------------------------------------------------------
# Pure-NumPy CSR
# --------------------------------------------------------------------------


@dataclass
class NumpyCSR:
    """Compressed-sparse-row matrix (real or complex, general)."""

    indptr: np.ndarray
    indices: np.ndarray
    data: np.ndarray
    shape: tuple[int, int]

    # -- construction helpers ----------------------------------------------

    def __post_init__(self) -> None:
        if self.data.ndim != 1 or self.indices.ndim != 1 or self.indptr.ndim != 1:
            raise ValueError("csr arrays must be 1-D")
        if self.indices.shape != self.data.shape:
            raise ValueError("indices/data length mismatch")
        if self.indptr.shape[0] != self.shape[0] + 1:
            raise ValueError("indptr length mismatch")

    @property
    def ndim(self) -> int:
        return 2

    @property
    def size(self) -> int:
        return self.shape[0] * self.shape[1]

    @property
    def nnz(self) -> int:
        return int(self.data.size)

    @property
    def dtype(self):
        return self.data.dtype

    # -- linear algebra -----------------------------------------------------

    def _gpu_dot(self, x: np.ndarray) -> np.ndarray | None:
        """Delegate one matvec to the WebGPU host bridge (opt-in, f32).

        Uploads the CSR arrays once per matrix, then per call only ships the
        ``x`` / ``y`` vectors. Returns ``None`` whenever the GPU path is not
        usable (not enabled, complex/integer data, host failure) so the
        caller falls back to the exact CPU kernel.
        """
        if not gpu_spmv_enabled() or x.ndim != 1:
            return None
        if self.shape[0] < _GPU_SPMV_MIN_ROWS:
            return None
        if np.iscomplexobj(self.data) or not np.issubdtype(self.data.dtype, np.floating):
            return None
        try:
            if not hasattr(self, "_gpu_handle"):
                # pylint: disable=assignment-from-none
                handle = _GPU_SPMV_UPLOAD(self.indptr, self.indices, self.data)
                if handle is None:
                    return None
                self._gpu_handle = handle  # type: ignore[attr-defined]
            x32 = np.ascontiguousarray(x, dtype=np.float32)
            y32 = np.zeros(self.shape[0], dtype=np.float32)
            _GPU_SPMV_HOST(self._gpu_handle, x32, y32)
            return y32.astype(np.result_type(self.data.dtype, x.dtype))
        except Exception:  # noqa: BLE001 — GPU must never kill a solve
            self._gpu_handle = None  # type: ignore[attr-defined]
            return None

    def _dot_block(self, x: np.ndarray, lo: int, hi: int, dt) -> np.ndarray:
        """Rows ``[lo, hi)`` of ``A @ x`` (vectorised reduceat, no densify).

        Rows with no stored entries (or an empty trailing range) fall back to
        the scalar per-row loop: ``np.add.reduceat`` cannot represent empty
        segments.
        """
        s0, s1 = int(self.indptr[lo]), int(self.indptr[hi])
        n_rows = hi - lo
        if s0 == s1:
            return np.zeros(n_rows, dtype=dt)
        starts = (self.indptr[lo:hi] - s0).astype(np.intp)
        has_empty = bool(np.any(starts[1:] == starts[:-1])) or starts[-1] == s1 - s0
        if has_empty:
            data, indices, indptr = self.data, self.indices, self.indptr
            return np.array(
                [
                    np.sum(data[indptr[i]: indptr[i + 1]]
                           * x[indices[indptr[i]: indptr[i + 1]]])
                    for i in range(lo, hi)
                ],
                dtype=dt,
            )
        vals = self.data[s0:s1] * x[self.indices[s0:s1]]
        return np.add.reduceat(vals, starts)

    def dot(self, x: np.ndarray) -> np.ndarray:
        """Sparse matrix-vector / matrix-dense-matrix product (no densify).

        Row blocks above ``_PARALLEL_MIN_ROWS`` are multiplied on a thread
        pool (``EM_EIGENSOLVER_THREADS`` caps the worker count, ``1`` forces
        the serial path); results are bitwise identical across worker counts
        because every row is reduced inside exactly one block.
        """
        x = np.asarray(x)
        if x.shape[0] != self.shape[1]:
            raise ValueError("dimension mismatch")
        dt = np.result_type(self.data.dtype, x.dtype)
        if x.ndim == 1:
            gpu = self._gpu_dot(x)
            if gpu is not None:
                return gpu
            n = self.shape[0]
            workers = _worker_count() if n >= _PARALLEL_MIN_ROWS else 1
            if workers > 1:
                bounds = np.linspace(0, n, workers + 1).astype(np.int64)
                spans = [(int(a), int(b)) for a, b in zip(bounds[:-1], bounds[1:]) if b > a]
                parts = list(
                    _pool(workers).map(lambda ab: self._dot_block(x, ab[0], ab[1], dt), spans))
                return np.concatenate(parts) if parts else np.zeros(n, dtype=dt)
            return self._dot_block(x, 0, n, dt)
        # Dense right-hand block with a small number of columns (basis blocks)
        # — iterating columns keeps peak memory O(nnz + n*k), never O(n^2).
        # (A vectorised 2-D reduceat block kernel was measured 1.1–1.8× SLOWER
        # than this column loop on the pure-NumPy backend: the strided
        # axis-0 reduction is not cache-friendly, so we keep the 1-D kernel
        # per column.  SciPy's native ``A @ X`` on the other backend is faster
        # and is used directly by the kernels' block application.)
        cols = [self.dot(x[:, j]) for j in range(x.shape[1])]
        return np.stack(cols, axis=1)

    def __matmul__(self, x):
        return self.dot(x)

    def toarray(self) -> np.ndarray:
        """Dense copy (caller decides when n^2 is acceptable, e.g. the
        dense-lapack fast path for n <= dense_threshold)."""
        out = np.zeros(self.shape, dtype=self.data.dtype)
        for i in range(self.shape[0]):
            sl = slice(self.indptr[i], self.indptr[i + 1])
            out[i, self.indices[sl]] = self.data[sl]
        return out

    # scipy compatibility alias used by solver._dense_path detection.
    todense = toarray

    def diagonal(self, k: int = 0) -> np.ndarray:
        if k != 0:
            raise NotImplementedError("only main diagonal is supported")
        n = min(self.shape)
        out = np.zeros(n, dtype=self.data.dtype)
        for i in range(n):
            sl = slice(self.indptr[i], self.indptr[i + 1])
            hit = np.flatnonzero(self.indices[sl] == i)
            if hit.size:
                out[i] = self.data[self.indptr[i] + hit[0]]
        return out

    def conj(self):
        return NumpyCSR(self.indptr, self.indices.copy(), np.conj(self.data), self.shape)

    @property
    def T(self):
        return self._transpose(conjugate=False)

    @property
    def H(self):
        return self._transpose(conjugate=True)

    def _transpose(self, conjugate: bool):
        n, m = self.shape
        data = np.conj(self.data) if conjugate and np.iscomplexobj(self.data) else self.data
        return csr_from_coo(
            self.indices,
            # row of A^H(-conj) == column of A
            _row_of_csr(self),
            data,
            m,
            n,
            hermitian_fill=False,
        )

    def conjT(self):
        return self.H

    def tocoo(self):
        rows = np.repeat(np.arange(self.shape[0]), np.diff(self.indptr))
        return rows, self.indices.copy(), self.data.copy()

    def tocsr(self):
        return self

    def tocsc(self):  # pragma: no cover - convenience, rarely used
        return self.T.T  # identity-ish fallback; not used by the solver

    def copy(self):
        return NumpyCSR(self.indptr.copy(), self.indices.copy(), self.data.copy(), self.shape)

    def astype(self, dtype):
        return NumpyCSR(self.indptr, self.indices, self.data.astype(dtype), self.shape)

    def get(self, i: int, j: int, default=0.0):
        sl = slice(self.indptr[i], self.indptr[i + 1])
        hit = np.flatnonzero(self.indices[sl] == j)
        return self.data[self.indptr[i] + hit[0]] if hit.size else default


def _row_of_csr(A: NumpyCSR) -> np.ndarray:
    return np.repeat(np.arange(A.shape[0]), np.diff(A.indptr))


# --------------------------------------------------------------------------
# Factories
# --------------------------------------------------------------------------


def _coo_reduce(rows: np.ndarray, cols: np.ndarray, data: np.ndarray, n_rows: int, n_cols: int):
    """Sum duplicate (row, col) entries; returns sorted-row CSR arrays."""
    if rows.size == 0:
        return (
            np.zeros(n_rows + 1, dtype=np.int64),
            np.zeros(0, dtype=np.int64),
            np.zeros(0, dtype=data.dtype),
        )
    # Drop explicit zeros that some writers emit (e.g. real part of a complex
    # entry) only when exactly zero; keeps nnz honest without changing values.
    nz = np.nonzero(data)[0]
    rows, cols, data = rows[nz], cols[nz], data[nz]
    keys = rows.astype(np.int64) * np.int64(n_cols) + cols.astype(np.int64)
    order = np.argsort(keys, kind="stable")
    keys, rows, cols, data = keys[order], rows[order], cols[order], data[order]
    unique_keys, start = np.unique(keys, return_index=True)
    if start.size == data.size:
        urows = (unique_keys // n_cols).astype(np.int64)
        ucols = (unique_keys % n_cols).astype(np.int64)
        udata = data
    else:
        ends = np.r_[start[1:], data.size]
        urows = (unique_keys // n_cols).astype(np.int64)
        ucols = (unique_keys % n_cols).astype(np.int64)
        if np.iscomplexobj(data):
            # np.add.reduceat supports complex directly.
            udata = np.add.reduceat(data, start)
        else:
            udata = np.add.reduceat(data, start)
    indptr = np.zeros(n_rows + 1, dtype=np.int64)
    np.add.at(indptr[1:], urows, 1)
    np.cumsum(indptr, out=indptr)
    # Columns inside each row are sorted because (key) order = (row, col).
    return indptr, ucols.astype(np.int64), udata


def csr_from_coo(rows, cols, data, n_rows: int, n_cols: int | None = None,
                 hermitian_fill: bool = False):
    """Build a CSR matrix from coordinate triples, never going dense.

    ``hermitian_fill=True`` mirrors the supplied triangle with conjugation
    (A_ji = conj(A_ij)) instead of trusting possibly-missing counterpart
    entries. Used when the input declares ``hermitian``/``symmetric`` storage.
    """
    rows = np.asarray(rows, dtype=np.int64)
    cols = np.asarray(cols, dtype=np.int64)
    data = np.asarray(data)
    if n_cols is None:
        n_cols = n_rows
    if hermitian_fill:
        off = rows != cols
        r2 = np.concatenate([rows, cols[off]])
        c2 = np.concatenate([cols, rows[off]])
        d2 = np.concatenate([data, np.conj(data[off]) if np.iscomplexobj(data) else data[off]])
        rows, cols, data = r2, c2, d2
    if HAVE_SCIPY:  # pragma: no cover
        A = _sp.coo_matrix((data, (rows, cols)), shape=(n_rows, n_cols)).tocsr()
        A.sum_duplicates()
        return A
    indptr, indices, values = _coo_reduce(rows, cols, data, n_rows, n_cols)
    return NumpyCSR(indptr, indices, values, (n_rows, n_cols))


def csr_from_arrays(indptr, indices, data, shape: tuple[int, int]):
    """Build from canonical CSR arrays (scipy save_npz payload / readers)."""
    indptr = np.asarray(indptr, dtype=np.int64)
    indices = np.asarray(indices, dtype=np.int64)
    data = np.asarray(data)
    if HAVE_SCIPY:  # pragma: no cover
        return _sp.csr_matrix((data, indices, indptr), shape=shape)
    return NumpyCSR(indptr, indices, data, shape)


# --------------------------------------------------------------------------
# Backend-agnostic sparse helpers
# --------------------------------------------------------------------------


def matvec(A, x: np.ndarray) -> np.ndarray:
    """Dense-free sparse matvec for either backend."""
    return A @ x


def nnz_of(A) -> int:
    return int(A.nnz)


def rows_of(A) -> np.ndarray:
    """COO row index array on either backend (O(nnz))."""
    if isinstance(A, NumpyCSR):
        return _row_of_csr(A)
    return A.tocoo().row  # scipy


def coo_of(A):
    """Return (rows, cols, data)."""
    if isinstance(A, NumpyCSR):
        return A.tocoo()
    c = A.tocoo()
    return c.row, c.col, c.data


def diagonal_of(A) -> np.ndarray:
    return np.asarray(A.diagonal())


def hermiticity_measure(A, sample_size: int = 200_000, rng: np.random.Generator | None = None) -> float:
    """Relative Frobenius-norm estimate of ``||A - A^H|| / ||A||``.

    Uses a Hutchinson-style sampled product so the check is O(nnz)-ish and
    never forms the dense difference. ``sample_size`` budgets the probe
    work: ``num_probes = clip(sample_size // n, 1, 8)`` random columns are
    used (more probes tighten the estimate on non-Hermitian input; a
    Hermitian matrix measures exactly 0 with any probe count). ``rng``
    defaults to a fixed-seed generator, so the result is reproducible.
    """
    if rng is None:
        rng = np.random.default_rng(0)
    n = A.shape[0]
    if n != A.shape[1] or n == 0:
        return float("inf")
    num_probes = int(min(8, max(1, sample_size // n)))
    is_complex = np.iscomplexobj(A.data) if hasattr(A, "data") else False
    dt = np.complex128 if is_complex else np.float64
    signs = rng.choice(np.array([-1.0, 1.0]), size=(n, num_probes))
    if is_complex:
        X = signs * np.exp(1j * rng.uniform(0, 2 * np.pi, size=(n, num_probes)))
    else:
        X = signs
    X = X.astype(dt)
    ax = A @ X
    ahx = A.conj().T @ X  # .H is not part of the scipy csr_matrix API
    err = float(np.linalg.norm(ax - ahx))
    ref = float(np.linalg.norm(ax) + np.linalg.norm(ahx)) + 1e-300
    return err / ref


def sparse_memory_bytes(A, complex128: bool = True) -> int:
    """Rough storage of the CSR arrays (values 16 B complex128, indices 8 B)."""
    nz = nnz_of(A)
    value_bytes = 16 if complex128 and np.iscomplexobj(A.data) else 8
    return nz * (value_bytes + 4) + (A.shape[0] + 1) * 4  # int32 indices estimate
