# Electromagnetic Resonance Eigensolver — translation in progress

This draft is incomplete and is not published by VitePress.

![3D mode field: cavity_small electric-field mode with block LOBPCG](../assets/screenshots/plugins/em-eigensolver/mode3d-cavity.png)

*3D mode field after solving `cavity_small` (30 × 30) with block LOBPCG: spatial displacement surface for mode λ = 8.42e+0, with an Okabe-Ito diverging scale using vermilion for positive peaks and blue for negative troughs, on the rendering path described in 8.3.*

The EM Eigensolver is a built-in plugin (`src/plugins/builtin/em-eigensolver/`, registered id `example.em-eigensolver`, category “physics simulation physics,” sandbox level `trusted`) solving **large sparse indefinite Hermitian matrix eigenvalue problems** `A x = λ x` obtained by FEM or MoM discretization in microwave devices, antennas, electromagnetic compatibility and photonic crystals. The host provides a parameter panel and solve report; an independent Web Worker runs the accompanying pure Python package `em_eigensolver` in Pyodide and renders spectra, true residuals, outer-iteration convergence traces and resonance mode fields to the canvas or a Three.js scene.

The solver uses no closed-source components: core algorithms are pure Python + NumPy; SciPy, when present, is used only for more mature sparse storage and vector kernels. The flow never constructs or densifies an `n × n` operator; the only dense decomposition acts on a projected matrix no larger than `basis_dim`.

## I. Problem definition and applicability limits

### 1.1 From Maxwell's equations to a Hermitian eigenproblem

After discretization, electromagnetic resonance analysis reduces to a sparse Hermitian eigenproblem. This plugin handles the **standard form** `A x = λ x`, with `A` an `n × n` sparse Hermitian matrix (real symmetric or complex Hermitian) and `n` up to order 100,000. Material dispersion, complex boundaries such as PML, and high-/low-frequency effects make `A` indefinite; the shift `σ` for a target frequency may lie inside the spectrum, making `A − σI` nearly singular—distinguishing the plugin from tools that handle only positive-definite matrices.

### 1.2 Three difficult scenarios

| Scenario | Mathematical form | Failure of naive methods |
| --- | --- | --- |
| Dense spectrum near zero (low-frequency breakdown) | Many eigenvalues crowd near `σ`, even `σ = 0` | Shift-invert inner linear systems become ill-conditioned, causing exploding iteration counts or wrong results |
| Repeated eigenvalues | One eigenvalue has multiplicity (degenerate modes) | Single-vector iteration converges repeatedly to one vector and loses other degenerate modes |
| Nearly singular shift | `σ` nearly coincides with an eigenvalue | `(A − σI)⁻¹` entries become large, amplifying residuals and distorting convergence criteria |

Built-in examples cover all three: `cluster_zero` has 153 eigenvalues with `abs(λ) < 0.05` out of order 720; each eigenvalue in `degenerate_pair` has multiplicity at least two, and both default shifts lie inside the spectrum. The plugin addresses them with block iteration and deflation, adaptive shifts, and convergence criteria certified by true residuals.

### 1.3 Applicability limits

| Dimension | Supported scope | Notes |
| --- | --- | --- |
| Matrix type | Real symmetric or complex Hermitian (`A = Aᴴ`) | Non-Hermitian, nonsymmetric matrices are out of scope |
| Problem form | Standard eigenproblem `A x = λ x` | Generalized `A x = λB x` is not implemented; users must first transform using a factor of `B` |
| Size | `n` from single digits to order `1e5` | Built-in `cavity_large`: `n = 102400`, `nnz = 510720` |
| Spectrum location | Extreme eigenvalues or interior target shift | Shift specified by `σ`, with adaptive offset |
| Storage | `.mtx` (Matrix Market), `.npz` (SciPy sparse or dense archive), `.npy` (dense, size-guarded); local CPython additionally supports optional direct reads of `.h5`/`.hdf5` (h5py), `.fits` (astropy), `.nc` (SciPy NetCDF) | Dense input is immediately sparsified and accepted only if `n² ≤ 4×10⁶`; missing packages for engineering formats raise `MatrixIOError` naming the missing package |
| Runtime | CPython + NumPy (SciPy optional); browser Pyodide | CPython uses SciPy sparse storage and vector kernels; pure NumPy includes row-chunk multithreaded matvec (section VI); WebGPU SpMV is a platform-level kernel |

## II. Solver kernels

Three iterative kernels plus a dense direct fallback are routed through `SolverConfig` and the `solve()` facade (`python/em_eigensolver/solver.py`).

| Kernel | Implementation | Recurrence and projection space | Main use |
| --- | --- | --- | --- |
| Thick-restart Lanczos | `lanczos.py` | Tridiagonal Krylov subspace, thick restart retaining `k` Ritz vectors plus the last Lanczos vector | Extreme eigenvalues; shift-invert when target lies in a spectral gap |
| Block LOBPCG | `lobpcg.py` | Three-block Rayleigh-Ritz in `span{X, R, P}` (block width `B`) | Extreme eigenvalues with clusters or multiplicity |
| Jacobi-Davidson | `jacdavid.py` | Search space `V` plus projected correction equation and deflation locking | Targets in dense interior clusters, nearly singular shifts |
| Dense direct | `solver.py` | `numpy.linalg.eigh` | Small problems `n ≤ dense_threshold` (default 800) |

### 2.1 Method routing

With `method = auto` (default), routing depends on whether a shift is supplied; explicitly selecting a kernel calls it directly. Without a shift, `which` selects the end (`LM` largest magnitude, `LA` largest algebraic, `SA` smallest algebraic).

<!-- SOURCE_FENCE_1 -->

The UI algorithm dropdown explicitly exposes this route (“auto: σ → JD, no σ → Lanczos”) and allows forcing any of the three kernels. The plugin always requests `which = 'LM'` and offers no extreme-type selector; the full `which` range is available only in the Python package and CLI.

### 2.2 Thick-restart Lanczos (Krylov-Schur)

Each `lanczos_solve()` cycle expands the Krylov basis to width `m = max(basis_dim, k + 8)` (capped at `n`), performs Rayleigh-Ritz on the `m × m` tridiagonal projection, then rebuilds the basis using Wu & Simon thick restart: retain the `k` target Ritz vectors and last Lanczos vector, carrying converged information forward instead of discarding the whole Krylov space. The projected matrix is forcibly symmetrized (`H = (H + Hᴴ)/2`) to offset accumulated floating-point non-Hermiticity.

- **Orthogonalization**: two-pass full DGKS reorthogonalization each step (`for pas in (0, 1)`), accumulating projection coefficients into `H` across both passes. A basis-vector norm below `1e-14` indicates an invariant subspace; expansion continues with a random direction and the column's subdiagonal entry is set to 0.
- **Two spectral transforms**: without `sigma`, repeatedly compute `A q` (plain, extreme eigenvalues); with `sigma`, repeatedly use MINRES to solve `(A − σI)⁻¹ q` (shift-invert), mapping Ritz values back as `λ = σ + 1/θ`.
- **Convergence**: each cycle recomputes `‖A y − λ y‖` with true matvec and divides by the maximum `|λ|` returned in that solve; all must be below tolerance.
- **Diagnostics**: cycle count, basis width, current shift and maximum residual-estimate upper bound (last-row coupling `|lastrow · S|`) are written to `diagnostics`.

### 2.3 MINRES inner solver

Shift-invert and the JD correction equation both require Hermitian **indefinite** linear solves, where conjugate gradients are no longer applicable, so MINRES (`minres.py`) is used throughout.

| Design point | Approach |
| --- | --- |
| Minimization | Hermitian Lanczos three-term recurrence builds the basis, solving least squares `min ‖β₁e₁ − T_k y‖` on the `(k+1) × k` tridiagonal projection |
| Solve | Call LAPACK `lstsq` every `check_every = 4` steps; `T_k` is bounded by `restart` (default 80), so cost is negligible |
| Restart | Stop when basis reaches `restart` or least-squares residual meets target, materialize the incremental solution and **recompute true residual with an extra matvec** |
| Criterion | True residual, not accumulated recurrence quantities; return `converged` / `maxiter` |
| Preconditioning | Deliberately omitted by default; reasons below |

The inner solve is **deliberately inexact**: outer Rayleigh-Ritz reorthogonalization recovers accuracy while near-singular `A − σI` consumes a bounded number of inner iterations. For shift-invert the effective outer tolerance is relaxed to `max(tol, 20 × minres_rtol)`. Conversely, if the user sets tolerance to `1e-12` but the inner relative residual is `1e-6`, the outer accuracy limit is `2×10⁻⁵`—an inherent cost of inexact shift-invert and the reason convergence reports may show about two orders of magnitude between residual and tolerance.

Inner preconditioning is deliberately omitted after testing both alternatives: Jacobi `M = diag(A)` for an indefinite operator is not positive definite, so a negative `M` inner product produces NaN; symmetric diagonal scaling `A' = PAP` (`P = diag(1/√|d|)`) can worsen conditioning near zero diagonal entries—a measured case changed from clean convergence to failure after 400 MINRES iterations. For matrices with suitable diagonal structure, the documentation recommends an explicit symmetric transformation before solving rather than automatic inner preconditioning. Block LOBPCG retains the SPD `precond` hook, but facade `solve()` currently passes no preconditioner.

### 2.4 Block LOBPCG

`lobpcg_solve()` implements classical three-basis Rayleigh-Ritz in `span{X, R, P}`: `X` is the current Ritz block, `R = AX − X·diag(θ)` the residual block, and `P` the previous direction block. The facade chooses block width `B = max(basis_dim // 3, k + 4)`; the projected matrix is `3B × 3B`, keeping dense work at `O(B³)`.

The block form handles repeated eigenvalues: multiple orthogonal modes for one degenerate eigenvalue can coexist in `X` and converge together without deflation. Orthogonalization uses modified Gram-Schmidt with reorthogonalization; linearly dependent columns are replaced by random directions, and when the space is exhausted the implementation **narrows the block rather than filling it with noise**. Convergence requires all `k` smallest-residual columns not yet selected to meet tolerance; afterward, Rayleigh-Ritz on `XᴴAX` and a recomputation of `k` true residuals complete the solve.

This kernel finds only extreme eigenvalues: the facade maps `which != 'SA'` to the largest or smallest side, and shift `σ` has no effect. If LOBPCG is selected in the UI with `σ` supplied, `σ` is ignored.

### 2.5 Jacobi-Davidson

`jd_solve()` is the main kernel for dense interior clusters and near-singular shifts, following the standard Sleijpen & van der Vorst iteration:

1. Perform Rayleigh-Ritz on search space `V` (`H = VᴴAV`, symmetrize then `eigh`), selecting the Ritz pair nearest `σ`.
2. Compute exact residual `r = A u − θ u` with explicit `AV` columns.
3. Approximately solve `(I − uuᴴ − WWᴴ)(A − θI)(I − uuᴴ − WWᴴ) t = −r'`, where `W` is the locked-eigenvector basis. The two oblique projections remove `θ` from the spectrum, so the correction system remains solvable even for `θ ≈ λ`; MINRES is still inexact because JD only needs a descent direction.
4. Expand `V` with the orthogonalized correction; at `basis_dim`, restart by retaining the best Ritz vectors and filling gaps with random directions.

**Deflation and degenerate modes**: converged pairs are locked into `W` and projected out of subsequent search. A Ritz pair is considered already locked only if **both** its eigenvalue relatively matches (`|θ − λ_locked| ≤ 1e-9 · max(scale, |θ|)`) and its vector has parallelism above 0.9 with a locked vector. An eigenvalue-only criterion would skip orthogonal copies of a repeated eigenvalue as already found, losing degenerate modes.

Effective inner budget: the facade passes `minres_rtol = max(cfg.minres_rtol, 1e-4)` (inner tolerance never stricter than `1e-4`—JD needs only a descent direction and tighter solves waste iterations) and `minres_maxiter = min(cfg.minres_maxiter, 160)`. With default `minres_rtol = 1e-6`, JD actually uses `rtol = max(1e-6, 1e-4) = 1e-4` and `maxiter = min(250, 160) = 160`. The test `test_jd_inner_tolerance_is_relaxed` asserts this `max(·, 1e-4)` tightening logic.

### 2.6 Dense direct path

When `n ≤ dense_threshold` (the plugin fixes 800) and the matrix provides `todense()` or `toarray()`, `solve()` directly uses `numpy.linalg.eigh`. This is a **bounded** path, not a violation of the rule against explicitly densifying sparse matrices: it triggers only for problems small enough that dense eigendecomposition is cheaper than iterative paths, with `O(n²)` workspace (about 5 MB at `n = 800`) smaller than the iterative `n × basis_dim` basis block. It returns `method = 'dense-lapack'`, with `iterations` and `matvecs` both 0.

This affects user experience: built-in `em-cavity-degenerate.mtx` has order 600, below 800, so selecting it in the sample dropdown and solving uses dense direct solve; the algorithm field reports `dense-lapack`, not any of the three iterative kernels.

## III. Shift strategy and adaptive shifts

Shift `σ` is a core input for electromagnetic resonance: it corresponds to the target frequency, and the goal is the eigenvalues nearest `σ`. When `σ` numerically lands on an eigenvalue, `A − σI` is nearly singular, causing inner MINRES iterations to rise sharply or fail within budget.

`lanczos_solve()` monitors this at outer cycle boundaries and shifts `σ` automatically:

| Trigger | Criterion |
| --- | --- |
| Excessive inner iteration rate | More than 30% of the latest 16 inner solves reach `near_singular_threshold = 120` steps |
| Inner non-convergence | Any MINRES call returns unconverged |

On triggering, it moves in a fixed direction with doubling step: initial `step = max(1e-3 × ‖A‖, 1e-2 × |σ|)`, direction `sign(σ)` (positive when `σ = 0`), then double the step on each trigger. At most `max_shift_moves = 5` moves occur; each is appended to `shift_history` and the Krylov basis is rebuilt because the transformed operator differs and the old basis is invalid. The inner-count window is cleared and `inner_converged` reset after a move.

Two rejected alternatives have measured reasons: a proportional step approaches zero when `σ ≈ 0`, leaving the shift nearly stationary; alternating positive/negative direction oscillates around the spectrum without escaping the singular region.

Adaptive shifts apply only to **shift-invert Lanczos**. Jacobi-Davidson's projected correction naturally avoids near singularity (`θ` is projected out of the spectrum), so it needs no `σ` offset; LOBPCG does not use shifts. In the plugin's “shift σ (blank = extreme eigenvalues)” field, blank means no shift and extreme eigenvalues instead.

## IV. Convergence control and accuracy certification

All three kernels use **true residuals**: recompute `‖A y − λ y‖` with a fresh matvec rather than a projected-space estimate. This is a hard implementation rule: Lanczos `exact_residuals()` performs one matvec per target Ritz vector per cycle; LOBPCG uses the current `AX` to calculate `R = AX − Xθ`; JD checks each output vector with a new matvec after locking.

| Kernel | Residual | Relative denominator | Convergence condition | Iteration count |
| --- | --- | --- | --- | --- |
| Lanczos | `‖A y − λ y‖` | Maximum `\|λ\|` returned in the solve | All `k` residuals ≤ effective tolerance | Outer restart cycles |
| LOBPCG | `‖A x − θ x‖` | Maximum absolute current Ritz value | All selected `k` columns ≤ tolerance | Iteration steps |
| Jacobi-Davidson | `‖A u − θ u‖` | `max(max\|λ_locked\|, 1e-3 × scale)` | Every locked pair meets target, at least `k` locked | Outer expansion steps |
| Dense direct | `‖A y − λ y‖` | Maximum absolute eigenvalue | All residuals ≤ tolerance | 0 (not applicable) |

Using the **maximum** `|λ|` returned in a solve rather than a separate denominator for each eigenvalue makes the relative-residual criterion for small eigenvalues stricter and more conservative. This choice makes reported residuals slightly larger and avoids inflated accuracy claims.

Users should know two effective-tolerance details: shift-invert Lanczos relaxes outer tolerance to `max(tol, 20 × minres_rtol)` (default inner `1e-6`, so lower bound `2×10⁻⁵`); LOBPCG and JD use `tol` directly. `SolverConfig.normalized()` also rejects `k < 1`, `tol ≤ 0`, and unknown `method`, and supplies `σ = 0` for `jacobi-davidson` if no shift is specified (JD needs a target).

Every result's `diagnostics` dictionary contains `k`, `n`, `tol`, `sigma`, `inner_iterations` (total inner MINRES iterations), `shift_history`, `memory_hint_mb` (basis-block estimate), and kernel-specific fields (Lanczos `cycles` / `basis` / `backend_shift` / `residual_estimate_max`; LOBPCG `block`; JD `locked` / `last_rel`).

## V. Memory and complexity

Each iteration concentrates cost in an `O(nnz)` sparse matrix–vector multiplication and orthogonalization of a width-`m` basis (`O(n × m)`). The only dense eigendecomposition is `m × m` (`m = basis_dim`, default 48, selectable 16–200), so an `n × n` operator is never constructed or densified through the flow.

| Quantity | Expression | Value for `n = 102400`, `basis_dim = 48` (real matrix) |
| --- | --- | --- |
| Operator storage | CSR, `nnz × (value + index)` | 6.5 MB (`nnz = 510720`, real values) |
| Krylov / search basis block | `n × basis_dim × 8` (16 for complex) | 39.3 MB |
| Projected matrix | Order `basis_dim²` | About 18 KB |
| Inner basis block | `n × restart × 8` (`restart = 80`, shift-invert only) | 65.5 MB |

`solver.py` calculates `n × basis_dim × (16 or 8)` and writes `diagnostics.memory_hint_mb`; `csr.py: sparse_memory_bytes()` estimates sparse storage, with sample values in section IX. The main memory control is `basis_dim` (“basis width (memory tier)” in the UI), which jointly determines basis memory, per-cycle orthogonalization cost and convergence speed.

No densification is a hard rule expressed in three places: CSR construction (`csr_from_coo` / `_coo_reduce`) uses only `O(nnz log nnz)` workspace; `NumpyCSR.dot()` iterates columns for multi-column right-hand sides (peak memory `O(nnz + n·k)`) without a dense intermediate matrix; dense input has an explicit `max_dense_cells = 4×10⁶` guard and raises `MatrixIOError` rather than allocating beyond it.

## VI. Parallelism and execution environments

The same solver source runs in two environments, detected at import by `backend.py`:

| Environment | Sparse storage | Backend label | Threads |
| --- | --- | --- | --- |
| CPython (local CLI / scripts) | `scipy.sparse.csr_matrix` | `scipy <version> (CPython)` | Automatic NumPy/BLAS multithreading (`OMP_NUM_THREADS` / `MKL_NUM_THREADS`) |
| Browser (Pyodide) | `scipy.sparse.csr_matrix` if SciPy is available, otherwise `NumpyCSR` (pure NumPy) | `scipy <version>…` when `HAVE_SCIPY`, otherwise `numpy-only (Pyodide degraded mode)` | Single-threaded WASM |

The browser now vendors and loads scipy with numpy (`em-worker.ts` runs `py.loadPackage(['numpy','scipy'])`; the scipy wheel is `public/pyodide/scipy-*.whl`, loaded locally by Pyodide's channel rather than a CDN). Thus browser `backend.py` normally has `HAVE_SCIPY` true and uses SciPy sparse storage; only failed or missing scipy falls back to pure-NumPy `NumpyCSR`. This is a designed fallback rather than a failure path: `csr.py` implements required CSR operations (`A @ x`, `A.H`, `diagonal`, `coo_of`, etc.), and both backends expose the same duck-typed interface and consistent numerical results.

The parallelism boundary must be stated accurately: **there is no MPI path**. Multithreading comes from NumPy/BLAS vector kernels (automatically used by `matvec` and small `eigh`) and row-chunk multithreaded matvec in the pure NumPy backend (`NumpyCSR.dot`). Large matrices are partitioned by rows and run in `ThreadPoolExecutor` (large NumPy ufuncs release the GIL); `EM_EIGENSOLVER_THREADS` can override the thread count. **Row-chunk multithreading exists only in the pure NumPy degraded backend** (the browser fallback without scipy); the SciPy backend (local CPython and browser with scipy loaded) relies on NumPy/SciPy's own vector threading. In a diagnostic that temporarily lowered the threshold and forced small problems down the parallel path, 10,201 rows measured only 0.25× due to pool submission/synchronization overhead. Production routing enables the pool at 40,000 rows with modest gains (about 1.06–1.4× at 4e4–1e5; section 9.4), so `_PARALLEL_MIN_ROWS = 40000` keeps smaller problems serial: the pool starts only around n ≳ 4×10⁴.

**Another independent MatVec optimization is block sparse multiplication** (`lobpcg.py::_mat_cols`): for operators accepting a 2D right-hand side, one `A @ X` (`X` is an `n × B` block) traverses CSR indices once, combining `B` single-column calls and avoiding repeated Python column extraction, stack frames and memory traffic. On CPython + SciPy with block width `B = 10`, measured pre-convergence speedup over per-column calls is 1.2–3.8× (about 2.4× at n = 1e4, 3.8× at n = 1e5; section 9.4). It does not change computational work, only matvec wall time per iteration. In the pure NumPy degraded backend (with scipy never loaded, such as tests deliberately blocking imports), a 2D `reduceat` block kernel was measured 1.1–1.8× slower than per-column, so that backend retains the per-column path; results are numerically identical.

WebGPU: the host platform (`src/core/wgsl.ts` + `src/core/gpu-kernels.ts`) provides a CSR SpMV compute kernel (one thread per row, 6-binding layout, automatic CPU fallback) as a platform GPU asset alongside matmul/FFT/k-means/binning, fully covered by Vitest. The accurate public statement is: **the GPU SpMV kernel is implemented and exposed as an independent API, while the main solver loop remains on the CPU f64 precision path**. Python solving in Pyodide is synchronous and blocks the event loop, whereas WebGPU readback is asynchronous, making synchronous GPU delegation per matvec infeasible in the present architecture; the browser solve loop cannot currently use it. Python retains a general synchronous bridge hook (`csr.set_gpu_spmv`) for a future synchronous host; `SolverConfig.gpu_spmv` diagnostics report this boundary when enabled. Accordingly, there is no “fallback due to missing specific GPU hardware”: GPU is not a prerequisite and behavior is consistent across environments.

Online solving uses Pyodide (single-threaded WASM), subject to browser memory limits and network loading of kernel packages, and suits small/medium demonstrations; large solves around order 100,000 are recommended via local CLI.
