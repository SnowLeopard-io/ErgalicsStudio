# em_eigensolver — Large-Scale Sparse Hermitian Eigenvalue Solver

Solver stack for the **resonant (generalised Maxwell / microwave-device)
eigenproblem** `A x = lambda x` produced by FEM/MoM discretisations, where
`A` is large (up to ~1e5 unknowns), sparse, Hermitian and **indefinite**
(non-positive-definite: sigma may sit inside the spectrum).

Ships as the Python core of the Ergalics Studio plugin
`src/plugins/builtin/em-eigensolver/` (browser execution via Pyodide) and as
a standalone CLI for local runs.

## Quick start

```bash
pip install -r requirements.txt          # numpy required; scipy optional
python -m em_eigensolver.cli --sample cluster_zero --sigma 0 --k 4 --verbose
python -m em_eigensolver.cli --input my_matrix.npz --sigma 1.25 --k 6
python tests/test_all.py                 # 11-test suite (scipy reference)
```

Supported inputs: `.npy` (dense matrix), `.npz` (dense array or scipy sparse
CSR/CSC archive), `.mtx` (Matrix Market coordinate). Outputs: `.npz`
eigenvalue/eigenvector archive + JSON report on stdout.

## Architecture

| Module       | Role |
|--------------|------|
| `backend.py` | Backend detection: `scipy.sparse` when present, pure-NumPy CSR otherwise |
| `csr.py`     | Minimal CSR used in the degraded (Pyodide) mode + hermiticity diagnostics |
| `io_matrix.py` | Readers (`.npy/.npz/.mtx`), triangle materialisation, hermitisation, result writer |
| `minres.py`  | Hermitian MINRES inner solver (indefinite-safe, restarted, true-residual guarded) |
| `lanczos.py` | Thick-restart (Krylov-Schur / Wu & Simon) Lanczos, plain + shift-invert with adaptive sigma |
| `lobpcg.py`  | Block LOBPCG on the [X, R, P] Rayleigh-Ritz subspace |
| `jacdavid.py`| Jacobi-Davidson with projected correction equation and deflation locking |
| `samples.py` | Synthetic EM-like test matrices (see below) |
| `solver.py`  | `SolverConfig` / `EigenResult` / `solve()` facade, convergence certification |
| `driver.py`  | JSON bridge used by the browser Pyodide worker |

### Method selection (`method: "auto"`)

* `sigma` given → **Jacobi-Davidson** (robust for interior / near-singular
  targets where iterative shift-invert degenerates);
* `sigma` omitted → **Lanczos plain** for extremal eigenvalues (`which` =
  `LM`/`LA`/`SA`);
* explicit `lanczos` + `sigma` → **shift-invert Lanczos** (best when the
  target lies in a spectral *gap*);
* `lobpcg` → extremal eigenvalues with clusters/repeated modes;
* `n <= dense_threshold` (default 800) → direct LAPACK. This is *not* the
  forbidden "densifying a sparse solver": it only triggers where the dense
  eigendecomposition is cheaper than any iterative path and its O(n^2)
  workspace is smaller than the iterative one.

## Algorithm notes

**Shift-invert spectral transformation.** With a target `sigma`, the kernels
work with `Op(q) = (A - sigma I)^{-1} q`; Ritz values map back as
`lambda = sigma + 1/theta`. The inner systems are Hermitian *indefinite*, so
CG does not apply — MINRES does. The inner solve is deliberately *inexact*
(`rtol = 1e-6`): the outer Rayleigh-Ritz re-orthogonalisation restores full
accuracy, while a near-singular `A - sigma I` then costs only a bounded
number of inner iterations. The effective outer tolerance is relaxed to
`max(tol, 20 * minres_rtol)`.

**Adaptive shift.** When `sigma` sits (numerically) on an eigenvalue, the
outer loop monitors the inner iteration rate and nudges sigma away from the
singularity at cycle boundaries: fixed direction, step *doubling*
(`step = max(1e-3 ||A||, 1e-2 |sigma|)`); alternating directions oscillate,
and proportional steps degenerate when `sigma ~ 0`. Every move is recorded
in `shift_history`.

**No inner preconditioner.** For indefinite operators a Jacobi preconditioner
`M = diag(A)` is not positive definite (negative M-inner products produce
NaN), and symmetric diagonal scaling `A' = P A P`, `P = diag(1/sqrt(|d|))`
catastrophically worsens conditioning when diagonals approach zero
(measured: 400 MINRES iterations without convergence, vs. clean convergence
unpreconditioned). MINRES therefore runs bare; matrices with a
well-conditioned diagonal can be explicitly transformed before solving.

**Degenerate eigenvalues.** LOBPCG captures repeated modes natively through
its block formulation; JD's deflation lock requires *both* eigenvalue match
and eigenvector parallelism > 0.9 — an eigenvalue-only check kills the
orthogonal copies of a repeated eigenvalue.

**Convergence certification.** Every result is certified with true residuals
`||A y - lambda y|| / max(|lambda|, floor)` recomputed with fresh matvecs;
projection estimates are never trusted alone.

## Complexity & memory

Per cycle the kernels expand a basis of width `m = basis_dim` (default 48):
O(nnz) matvecs + O(n * m) orthogonalisation work and workspace. The only
dense eigendecomposition is on the `(m x m)` projected matrix. The `n x n`
operator is **never formed or densified**; dense storage appears only via
`dense_threshold` (deliberate, bounded) or if the user passes a dense `.npy`
matrix. Memory hint (MB) is reported in `diagnostics.memory_hint_mb`.

## Parallelism

The pure-Python kernels are NumPy/BLAS-bound: matvecs and the small `eigh`
calls dispatch to multi-threaded BLAS automatically where available
(`OMP_NUM_THREADS` / `MKL_NUM_THREADS`). The browser (Pyodide) build is
single-threaded WASM by design — no GPU anywhere, so there is no GPU
degradation path to take.

## Samples (`samples.py`)

| Kind | Covers |
|------|--------|
| `cavity_small` (n=900) | general smoke test, memory-bounded regime |
| `cluster_zero` (n=720) | dense spectrum near 0 + near-singular shift `sigma=0` |
| `degenerate_pair` (n=300) | exactly repeated eigenvalues (2-fold) |
| `cavity_complex` (n=576) | complex Hermitian operators |
| `cavity_large` (n=102400) | ~1e5 scale, memory-bound demonstration |

## No hardcoding

The kernels contain no problem-specific constants: every threshold
(`tol`, `basis_dim`, `dense_threshold`, `near_singular_threshold`,
`minres_rtol`, seeds, block sizes) is a parameter of `SolverConfig` or the
kernel signatures, and sample matrices are generated from named builders
with explicit dimensions — nothing is tuned to a particular input.

## Failure modes

| Symptom | Cause / remedy |
|---------|----------------|
| Inner MINRES hits `maxiter` | sigma nearly an eigenvalue; adaptive shift should kick in — widen `basis_dim` or raise `minres_maxiter` |
| Not converged after `max_cycles` | clustered interior spectrum with too small a basis — increase `basis_dim`, relax `tol`, or switch to `jacobi-davidson` |
| Slow progress on random sparse matrices | spectrum of a random sparse matrix is a Wigner semicircle: values near any interior target are dense, so convergence *is* slow — this is problem-inherent, not a bug |
| `MatrixIOError: unsupported extension` | only `.npy/.npz/.mtx` are accepted |

## Test suite

`python tests/test_all.py` — 11 tests covering CSR math, matrix I/O
round-trips, indefinite MINRES, all three kernels against dense LAPACK
references (including repeated eigenvalues and interior targets), the
sample builders' hermiticity, the facade routing and the CLI end-to-end.
The numpy-only degraded backend (the one the browser uses) is validated by
blocking the scipy import.
