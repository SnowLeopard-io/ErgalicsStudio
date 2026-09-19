"""em_eigensolver — large-scale *indefinite Hermitian* sparse eigenproblems.

A reproducible, low-memory Krylov eigensolver stack built for the resonant
(generalised Maxwell / microwave-device) eigenproblem ``A x = lambda x`` that
results from FEM/MoM discretisations, where ``A`` is sparse, Hermitian and
**non-positive-definite**.

Modules
-------
backend  : backend detection (``scipy.sparse`` when present, pure NumPy otherwise)
csr      : minimal CSR sparse matrix used in the degraded (Pyodide) mode
io_matrix: NumPy/SciPy matrix readers (``.npy`` / ``.npz`` / ``.mtx``) and
           eigenresult writers, triangular <-> full materialisation
minres   : MINRES inner solver for Hermitian, possibly indefinite, systems
lanczos  : thick-restart (Krylov-Schur style) Lanczos with shift-invert
           spectral transformation and adaptive shift
lobpcg   : block LOBPCG (robust for clustered / repeated eigenvalues)
jacdavid : Jacobi-Davidson with projected correction equations (robust for
           near-singular target shifts)
samples  : synthetic EM-like indefinite Hermitian test matrices
solver   : unified facade, convergence control, resource guards, diagnostics
cli      : standalone command line entry point

The package never densifies the input matrix: the only dense eigendecomposition
performed is on the small projected matrix of size ``basis_dim`` (<= a few
hundred).
"""

from .backend import HAVE_SCIPY, backend_name  # noqa: F401

try:  # solver depends on lanczos/lobpcg/jacdavid; keep importable while WIP
    from .solver import SolverConfig, EigenResult, solve  # noqa: F401
    _HAS_SOLVER = True
except ImportError:  # pragma: no cover
    _HAS_SOLVER = False

__version__ = "1.0.0"
__all__ = ["HAVE_SCIPY", "backend_name", "__version__"]
if _HAS_SOLVER:
    __all__ += ["SolverConfig", "EigenResult", "solve"]
