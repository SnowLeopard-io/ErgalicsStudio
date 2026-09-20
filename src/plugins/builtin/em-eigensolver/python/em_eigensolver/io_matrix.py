"""Matrix input/output for NumPy/SciPy formats.

Supported inputs
----------------
* ``.mtx``  — Matrix Market, ``coordinate`` (real / complex / integer /
  pattern; general / symmetric / skew-symmetric / hermitian) and ``array``
  (dense, size-guarded). Token-streaming parser, no full-file copies.
* ``.npz``  — both ``scipy.sparse.save_npz`` payloads (``data`` /
  ``indices`` / ``indptr`` / ``shape`` / ``format``) and plain
  ``numpy.savez`` dense arrays.
* ``.npy``  — a single dense NumPy array (size-guarded).

Dense inputs are accepted only when ``n*n`` is below ``max_dense_cells`` and
are *immediately sparsified*; the dense intermediate is the documented input
format boundary, never a solver workspace.

Outputs
-------
* eigenpairs: ``numpy.savez``-compatible ``.npz`` (``eigenvalues`` real,
  ``eigenvectors``) — readable with ``numpy.load``;
* matrices: SciPy-compatible sparse CSR ``.npz``;
* optional Matrix Market export of vectors / matrices.
"""

from __future__ import annotations

import os
import zipfile

import numpy as np

from .csr import csr_from_arrays, csr_from_coo


class MatrixIOError(ValueError):
    """Raised for unreadable or unsafe (too large dense) matrix files."""


# --------------------------------------------------------------------------
# Matrix Market
# --------------------------------------------------------------------------

def read_mtx(path_or_text: str, max_dense_cells: int = 4_000_000,
             is_text: bool = False):
    """Read a Matrix Market file/text into a CSR matrix.

    Fills the mirrored triangle according to the banner: ``symmetric`` copies
    values, ``hermitian`` copies conjugates, ``skew-symmetric`` negates.
    """
    text = path_or_text if is_text else _read_text(path_or_text)
    lines = text.splitlines()
    banner = lines[0].strip().lower().split()
    # e.g. ['%%matrixmarket', 'matrix', 'coordinate', 'real', 'general']
    if not banner or banner[0] != "%%matrixmarket":
        raise MatrixIOError("not a Matrix Market file (missing banner)")
    obj = banner[2] if len(banner) > 2 else "coordinate"
    field = banner[3] if len(banner) > 3 else "real"
    symmetry = banner[4] if len(banner) > 4 else "general"

    pos = 1
    while pos < len(lines) and lines[pos].lstrip().startswith("%"):
        pos += 1
    if pos >= len(lines):
        raise MatrixIOError("truncated Matrix Market header")
    header = lines[pos].split()
    pos += 1
    n_rows, n_cols = int(header[0]), int(header[1])

    if obj == "array":
        if n_rows * n_cols > max_dense_cells:
            raise MatrixIOError(
                f"dense {n_rows}x{n_cols} array exceeds max_dense_cells="
                f"{max_dense_cells}; refusing to densify"
            )
        vals = np.asarray(" ".join(lines[pos:]).split(), dtype=np.float64)
        if vals.size < n_rows * n_cols:
            raise MatrixIOError("dense array has fewer values than declared")
        dense = vals[: n_rows * n_cols].reshape((n_rows, n_cols), order="F")
        if symmetry == "symmetric":
            dense = 0.5 * (dense + dense.T)
        elif symmetry == "hermitian":
            dense = 0.5 * (dense + np.conj(dense.T))
        r, c = np.nonzero(dense)
        return csr_from_coo(r, c, dense[r, c], n_rows, n_cols)

    if obj != "coordinate":
        raise MatrixIOError(f"unsupported Matrix Market object: {obj}")
    nnz_decl = int(header[2])
    tokens = " ".join(lines[pos:]).split()
    if field == "pattern":
        flat = tokens[: nnz_decl * 2]
        rows = np.asarray(flat[0::2], dtype=np.int64) - 1
        cols = np.asarray(flat[1::2], dtype=np.int64) - 1
        data = np.ones(rows.size, dtype=np.float64)
    elif field == "complex":
        flat = np.asarray(tokens[: nnz_decl * 4], dtype=np.float64)
        rows = flat[0::4].astype(np.int64) - 1
        cols = flat[1::4].astype(np.int64) - 1
        data = flat[2::4] + 1j * flat[3::4]
    else:
        flat = np.asarray(tokens[: nnz_decl * 3], dtype=np.float64)
        rows = flat[0::3].astype(np.int64) - 1
        cols = flat[1::3].astype(np.int64) - 1
        data = flat[2::3]

    rows, cols, data = _mirror_triangle(rows, cols, data, symmetry)
    return csr_from_coo(rows, cols, data, n_rows, n_cols)


def _mirror_triangle(rows: np.ndarray, cols: np.ndarray, data: np.ndarray,
                     symmetry: str):
    """Return COO arrays with the missing triangle restored on demand."""
    if symmetry == "general":
        return rows, cols, data
    off = rows != cols
    if symmetry == "hermitian":
        mirrored = np.conj(data[off])
    elif symmetry == "skew-symmetric":
        mirrored = -data[off]
    else:  # symmetric
        mirrored = data[off]
    rows_full = np.concatenate([rows, cols[off]])
    cols_full = np.concatenate([cols, rows[off]])
    data_full = np.concatenate([data, mirrored])
    return rows_full, cols_full, data_full


def _read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        return fh.read()


# --------------------------------------------------------------------------
# NumPy / SciPy .npy and .npz
# --------------------------------------------------------------------------

def _dense_to_sparse(dense: np.ndarray, max_dense_cells: int, source: str):
    if dense.ndim != 2 or dense.shape[0] != dense.shape[1]:
        raise MatrixIOError(f"{source}: expected a square 2-D array")
    n = dense.shape[0]
    if n * n > max_dense_cells:
        raise MatrixIOError(
            f"{source}: dense {n}x{n} matrix exceeds max_dense_cells="
            f"{max_dense_cells}; refusing to densify (provide sparse .npz/.mtx)"
        )
    r, c = np.nonzero(dense)
    return csr_from_coo(r, c, dense[r, c], n, n)


def read_npy(path_or_bytes, max_dense_cells: int = 4_000_000):
    """Read a single dense ``.npy`` matrix (size-guarded)."""
    try:
        import io

        if isinstance(path_or_bytes, (bytes, bytearray)):
            dense = np.load(io.BytesIO(bytes(path_or_bytes)), allow_pickle=False)
        else:
            dense = np.load(path_or_bytes, allow_pickle=False)
    except Exception as exc:  # corrupt / pickle-disallowed
        raise MatrixIOError(f"failed to read .npy: {exc}") from exc
    return _dense_to_sparse(np.asarray(dense), max_dense_cells, "npy")


def _csr_from_scipy_npz(handle, max_dense_cells: int, source: str):
    keys = set(handle.files)
    if not {"data", "indices", "indptr", "shape"} <= keys:
        return None
    shape = tuple(int(x) for x in np.asarray(handle["shape"]).ravel()[:2])
    fmt = "csr"
    if "format" in keys:
        try:
            fmt = str(handle["format"].item())
        except Exception:
            fmt = "csr"
    if fmt not in ("csr", "csc"):
        raise MatrixIOError(f"{source}: sparse format '{fmt}' is not supported")
    # Sparse input is always accepted: storage is O(nnz), never O(n^2).
    A = csr_from_arrays(
        handle["indptr"], handle["indices"], handle["data"], shape
    )
    if fmt == "csc":
        # Transpose twice via COO to obtain CSR without SciPy dependency.
        from .csr import coo_of, csr_from_coo

        r, c, d = coo_of(A)
        A = csr_from_coo(c, r, d, shape[1], shape[0])
    return A


def read_npz(path_or_bytes, max_dense_cells: int = 4_000_000):
    """Read ``scipy.sparse.save_npz`` or a dense ``numpy.savez`` archive."""
    import io

    try:
        if isinstance(path_or_bytes, (bytes, bytearray)):
            handle = np.load(io.BytesIO(bytes(path_or_bytes)), allow_pickle=True)
        else:
            handle = np.load(path_or_bytes, allow_pickle=True)
    except Exception as exc:
        raise MatrixIOError(f"failed to read .npz: {exc}") from exc
    with handle:
        sparse = _csr_from_scipy_npz(handle, max_dense_cells, "npz")
        if sparse is not None:
            return sparse
        # Dense savez: pick the first 2-D array.
        for key in handle.files:
            arr = np.asarray(handle[key])
            if arr.ndim == 2:
                return _dense_to_sparse(arr, max_dense_cells, f"npz:{key}")
    raise MatrixIOError("npz contained neither a sparse CSR payload nor a 2-D array")


def read_matrix(path: str, max_dense_cells: int = 4_000_000):
    """Dispatch by extension: ``.mtx`` / ``.npz`` / ``.npy`` (+ local extras).

    ``.h5``/``.hdf5`` (h5py), ``.fits`` (astropy) and ``.nc`` (scipy NetCDF)
    are engineering-format extras: they load through their optional native
    readers when available (local CLI / full CPython) and raise a clear
    MatrixIOError naming the missing package otherwise — the browser build
    (numpy-only Pyodide) keeps the privacy story: parse locally, upload
    nothing.
    """
    lower = path.lower()
    if lower.endswith(".mtx"):
        return read_mtx(path, max_dense_cells=max_dense_cells)
    if lower.endswith(".npz"):
        return read_npz(path, max_dense_cells=max_dense_cells)
    if lower.endswith(".npy"):
        return read_npy(path, max_dense_cells=max_dense_cells)
    if lower.endswith((".h5", ".hdf5")):
        return _read_hdf5(path, max_dense_cells)
    if lower.endswith(".fits"):
        return _read_fits(path, max_dense_cells)
    if lower.endswith(".nc"):
        return _read_netcdf(path, max_dense_cells)
    raise MatrixIOError(f"unsupported matrix extension: {path}")


def read_matrix_bytes(name: str, data: bytes, max_dense_cells: int = 4_000_000):
    """Read an in-memory upload (browser worker path)."""
    lower = name.lower()
    if lower.endswith(".mtx"):
        return read_mtx(data.decode("utf-8", errors="replace"),
                        max_dense_cells=max_dense_cells, is_text=True)
    if lower.endswith(".npz"):
        return read_npz(data, max_dense_cells=max_dense_cells)
    if lower.endswith(".npy"):
        return read_npy(data, max_dense_cells=max_dense_cells)
    raise MatrixIOError(f"unsupported matrix extension: {name}")


# --------------------------------------------------------------------------
# Engineering-format extras (local CPython only; optional dependencies)
# --------------------------------------------------------------------------

def _read_hdf5(path: str, max_dense_cells: int):
    """``.h5``/``.hdf5`` via h5py: sparse CSR-style datasets or a 2-D array."""
    try:
        import h5py
    except Exception as exc:  # ImportError or Pyodide stub
        raise MatrixIOError(
            ".h5/.hdf5 input requires the optional 'h5py' package "
            "(pip install h5py); the browser build supports .mtx/.npz/.npy"
        ) from exc
    with h5py.File(path, "r") as fh:
        if all(k in fh for k in ("indptr", "indices", "data")):
            if "shape" in fh:
                shape = tuple(int(x) for x in np.asarray(fh["shape"]).ravel()[:2])
            else:
                shape = (int(fh["indptr"].shape[0]) - 1,
                         int(np.max(fh["indices"][...])) + 1)
            return csr_from_arrays(fh["indptr"][...], fh["indices"][...],
                                   fh["data"][...], shape)
        dense = _first_2d_hdf5(fh)
    if dense is None:
        raise MatrixIOError("h5: no 2-D dataset found")
    return _dense_to_sparse(dense, max_dense_cells, "h5")


def _first_2d_hdf5(group, depth: int = 0):
    """Depth-first search for the first 2-D dataset (groups included)."""
    if depth > 8:
        return None
    for key in group:
        obj = group[key]
        if hasattr(obj, "ndim"):  # Dataset
            if obj.ndim == 2:
                return np.asarray(obj[...], dtype=np.float64)
        elif hasattr(obj, "keys"):  # nested Group
            found = _first_2d_hdf5(obj, depth + 1)
            if found is not None:
                return found
    return None


def _read_fits(path: str, max_dense_cells: int):
    """``.fits`` via astropy: first 2-D image HDU."""
    try:
        from astropy.io import fits
    except Exception as exc:
        raise MatrixIOError(
            ".fits input requires the optional 'astropy' package "
            "(pip install astropy); the browser build supports .mtx/.npz/.npy"
        ) from exc
    with fits.open(path, memmap=False) as hdul:
        for hdu in hdul:
            data = getattr(hdu, "data", None)
            if data is None:
                continue
            arr = np.asarray(data)
            if arr.ndim == 2:
                return _dense_to_sparse(
                    arr.astype(np.float64), max_dense_cells, "fits")
    raise MatrixIOError("fits: no 2-D image HDU found")


def _read_netcdf(path: str, max_dense_cells: int):
    """``.nc`` via ``scipy.io.netcdf_file``: first square 2-D variable."""
    try:
        from scipy.io import netcdf_file
    except Exception as exc:
        raise MatrixIOError(
            ".nc input requires SciPy (scipy.io.netcdf_file); the browser "
            "build supports .mtx/.npz/.npy"
        ) from exc
    with netcdf_file(path, "r", mmap=False) as nc:
        for name, var in getattr(nc, "variables", {}).items():
            arr = np.asarray(var[:], dtype=np.float64)
            if arr.ndim == 2 and arr.shape[0] == arr.shape[1]:
                return _dense_to_sparse(arr, max_dense_cells, f"nc:{name}")
    raise MatrixIOError("nc: no square 2-D variable found")


# --------------------------------------------------------------------------
# Triangle materialisation
# --------------------------------------------------------------------------

def materialize_triangle(A, part: str = "lower"):
    """Restore a full matrix from one stored triangle.

    ``part`` is ``'lower'`` (default for symmetric FEM storage) or
    ``'upper'``. Diagonal entries are kept once.  Returns a new CSR; never
    touches a dense array.
    """
    from .csr import coo_of, csr_from_coo

    r, c, d = coo_of(A)
    n = A.shape[0]
    if part == "lower":
        keep = r >= c
    elif part == "upper":
        keep = c >= r
    else:
        raise ValueError("part must be 'lower' or 'upper'")
    r, c, d = r[keep], c[keep], d[keep]
    off = r != c
    mirror = np.conj(d[off]) if np.iscomplexobj(d) else d[off]
    r2 = np.concatenate([r, c[off]])
    c2 = np.concatenate([c, r[off]])
    d2 = np.concatenate([d, mirror])
    return csr_from_coo(r2, c2, d2, n, n)


def hermitize(A):
    """Project onto the nearest Hermitian matrix: ``H = (A + A^H) / 2``.

    Returns ``(H, drift)`` where ``drift`` estimates
    ``||A - A^H||_F / (2||A||_F)`` using only off-diagonal entries whose
    mirrored counterpart is explicitly stored (``None`` when not estimable).
    O(nnz), no dense array.
    """
    from .csr import coo_of, csr_from_coo

    r, c, d = coo_of(A)
    n = A.shape[0]
    off = r != c
    r2 = np.concatenate([r, c[off]])
    c2 = np.concatenate([c, r[off]])
    mirrored = np.conj(d[off]) if np.iscomplexobj(d) else d[off]
    # diagonal entries keep weight 1.0 (A_ii + conj(A_ii) == 2 A_ii, then /2);
    # off-diagonal entries and their mirrored twins both carry 0.5.
    half = np.where(r == c, 1.0, 0.5)
    d2 = np.concatenate([d * half, mirrored * 0.5])
    H = csr_from_coo(r2, c2, d2, n, n)

    # Hermiticity drift on explicitly-stored reciprocal pairs only.
    pair = {}
    for i, j, z in zip(r[off], c[off], d[off]):
        pair[(int(i), int(j))] = z
    diffs, refs = [], []
    for (i, j), z in pair.items():
        w = pair.get((j, i))
        if w is not None:
            diffs.append(abs(z - np.conj(w)))
            refs.append(abs(z) + abs(w))
    drift = float(max(diffs) / max(max(refs), 1e-300)) if diffs else None
    return H, drift


# --------------------------------------------------------------------------
# Writers
# --------------------------------------------------------------------------

def write_eigen_npz(path: str, w: np.ndarray, v: np.ndarray, meta: dict | None = None,
                    residuals: np.ndarray | None = None):
    """Write eigenvalues/eigenvectors as a plain NumPy ``.npz``.

    Keys: ``eigenvalues`` (real float64), ``eigenvectors`` (float64 or
    complex128, columns correspond to eigenvalues), ``residuals`` (real
    float64, when provided) and optionally ``meta`` (JSON string).
    Loadable directly with ``numpy.load`` / ``scipy``.
    """
    w = np.asarray(w, dtype=np.float64)
    if np.iscomplexobj(v) and np.max(np.abs(np.imag(v))) <= 1e-14:
        v = np.real(v)
    save_kw = {"eigenvalues": w, "eigenvectors": np.asarray(v)}
    if residuals is not None and len(residuals):
        save_kw["residuals"] = np.asarray(residuals, dtype=np.float64)
    if meta:
        save_kw["meta"] = np.asarray(_json_dumps(meta))
    np.savez(path, **save_kw)


def write_csr_npz(path: str, A):
    """Write a SciPy-compatible sparse CSR ``.npz`` (manual, SciPy-free)."""
    from .csr import coo_of, csr_from_coo, NumpyCSR

    if not isinstance(A, NumpyCSR):
        Ac = A.tocsr()
        indptr, indices, data, shape = Ac.indptr, Ac.indices, Ac.data, Ac.shape
    else:
        indptr, indices, data, shape = A.indptr, A.indices, A.data, A.shape
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for name, arr in (
            ("data", np.asarray(data)),
            ("indices", np.asarray(indices, dtype=np.int32)),
            ("indptr", np.asarray(indptr, dtype=np.int32)),
            ("shape", np.asarray(shape, dtype=np.int64)),
        ):
            zf.writestr(f"{name}.npy", _npy_bytes(arr))
        zf.writestr("format.npy", _npy_bytes(np.array("csr")))


def write_mtx(path: str, A=None, *, dense: np.ndarray | None = None,
              name: str = "matrix"):
    """Write a Matrix Market file for a sparse matrix or a dense array."""
    if dense is not None:
        # Array (column-major) writer — used for eigenvector matrices.
        mat = np.asarray(dense)
        is_complex = np.iscomplexobj(mat) and np.max(np.abs(np.imag(mat))) > 0
        typ = "complex" if is_complex else "real"
        out = [f"%%MatrixMarket matrix array {typ} general",
               f"% {name}", f"{mat.shape[0]} {mat.shape[1]}"]
        flat = mat.reshape(-1, order="F")
        if is_complex:
            out.extend(f"{z.real:.17g} {z.imag:.17g}" for z in flat)
        else:
            out.extend(f"{float(np.real(z)):.17g}" for z in flat)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("\n".join(out) + "\n")
        return

    from .csr import coo_of

    r, c, d = coo_of(A)
    is_complex = np.iscomplexobj(d)
    lines = [f"%%MatrixMarket matrix coordinate {'complex' if is_complex else 'real'} general",
             f"% {name}", f"{A.shape[0]} {A.shape[1]} {d.size}"]
    if is_complex:
        lines.extend(f"{int(i) + 1} {int(j) + 1} {z.real:.17g} {z.imag:.17g}"
                     for i, j, z in zip(r, c, d))
    else:
        lines.extend(f"{int(i) + 1} {int(j) + 1} {float(z):.17g}"
                     for i, j, z in zip(r, c, d))
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


def _npy_bytes(arr: np.ndarray) -> bytes:
    import io

    buf = io.BytesIO()
    np.save(buf, arr, allow_pickle=True)
    return buf.getvalue()


def _json_dumps(obj) -> str:
    import json

    return json.dumps(obj, ensure_ascii=False, default=str)
