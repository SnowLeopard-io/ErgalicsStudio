"""Compute backend detection.

The same solver source runs in two environments:

* **standalone CPython** — ``scipy.sparse`` is preferred (mature CSR, BLAS
  threaded vector kernels);
* **browser (Pyodide)** — only NumPy is vendored, so :mod:`em_eigensolver.csr`
  provides a dependency-free CSR with the small subset of the SciPy API the
  solver relies on.

No code path imports a closed-source component; the core algorithms are pure
Python + NumPy and are identical in both environments.
"""

from __future__ import annotations

try:  # pragma: no cover - exercised in one of the two environments
    import scipy.sparse as _sp  # type: ignore

    HAVE_SCIPY = True
except Exception:  # pragma: no cover
    _sp = None
    HAVE_SCIPY = False


def backend_name() -> str:
    """Human-readable backend identifier used in reports."""
    if HAVE_SCIPY:
        import scipy  # type: ignore

        return f"scipy {scipy.__version__} (CPython)"
    return "numpy-only (Pyodide degraded mode)"
