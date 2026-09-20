"""Full test suite for the em_eigensolver package.

Runs standalone (``python tests/test_all.py``) or under pytest.
Covers: csr backend, matrix IO round-trips, MINRES, the three eigenkernels
(verified against dense LAPACK references), samples, solver facade and CLI.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from em_eigensolver.backend import HAVE_SCIPY, backend_name
from em_eigensolver.csr import (NumpyCSR, coo_of, csr_from_coo,
                                hermiticity_measure, sparse_memory_bytes)
from em_eigensolver.io_matrix import (hermitize, materialize_triangle,
                                      read_mtx, read_npz, write_csr_npz,
                                      write_eigen_npz, write_mtx)
from em_eigensolver.jacdavid import jd_solve
from em_eigensolver.lanczos import lanczos_solve
from em_eigensolver.lobpcg import lobpcg_solve
from em_eigensolver.minres import minres_solve
from em_eigensolver.samples import SAMPLE_BUILDERS, build_sample
from em_eigensolver.solver import SolverConfig, solve


def rand_herm_sparse(n, density=0.05, complex_=False, seed=0):
    r_ = np.random.default_rng(seed)
    cnt = int(n * n * density)
    i = r_.integers(0, n, cnt)
    j = r_.integers(0, n, cnt)
    d = r_.standard_normal(cnt) + (1j * r_.standard_normal(cnt) if complex_ else 0)
    i2 = np.concatenate([i, j, np.arange(n)])
    j2 = np.concatenate([j, i, np.arange(n)])
    d2 = np.concatenate([d, np.conj(d), r_.standard_normal(n).astype(d.dtype)])
    A = csr_from_coo(i2, j2, d2, n, n)
    Ad = np.zeros((n, n), dtype=d.dtype)
    rr, cc, dd = coo_of(A)
    Ad[rr, cc] = dd
    return A, Ad


def block_herm(mus, w=0.1, size=50, complex_=False, seed=0, identical=False):
    r_ = np.random.default_rng(seed)
    blocks = []
    for bi, mu in enumerate(mus):
        rr = r_ if (not identical or bi == 0) else np.random.default_rng(seed)
        d = mu + w * rr.standard_normal(size)
        off = 0.5 * w * (rr.standard_normal(size - 1)
                         + (1j * rr.standard_normal(size - 1) if complex_ else 0))
        B = np.zeros((size, size), dtype=complex if complex_ else float)
        B[np.arange(size), np.arange(size)] = d
        B[np.arange(size - 1), np.arange(1, size)] = off
        B[np.arange(1, size), np.arange(size - 1)] = np.conj(off)
        blocks.append(B)
    A = csr_from_coo(
        np.concatenate([np.nonzero(B)[0] + bi * B.shape[0] for bi, B in enumerate(blocks)]).astype(np.int64),
        np.concatenate([np.nonzero(B)[1] + bi * B.shape[0] for bi, B in enumerate(blocks)]).astype(np.int64),
        np.concatenate([B[np.nonzero(B)] for B in blocks]),
        sum(B.shape[0] for B in blocks), sum(B.shape[0] for B in blocks))
    Ad = np.zeros((A.shape[0],) * 2, dtype=blocks[0].dtype)
    b0 = 0
    for B in blocks:
        s = B.shape[0]
        Ad[b0:b0 + s, b0:b0 + s] = B
        b0 += s
    return A, Ad


# ============================ csr / backend ==================================

def test_csr_matvec_and_hermiticity():
    A, Ad = rand_herm_sparse(60, 0.1, True, seed=101)
    x = np.random.default_rng(102).standard_normal(60)
    x = x + 1j * np.random.default_rng(103).standard_normal(60)
    assert np.allclose(A @ x, Ad @ x)
    assert hermiticity_measure(A, rng=np.random.default_rng(104)) < 1e-12
    assert sparse_memory_bytes(A) > 0


def test_numpy_csr_backend_matches_scipy():
    """Pure-NumPy CSR and the scipy CSR must agree on the same COO input.

    Regression: this test once returned early because the two backends'
    construction APIs differ. Both are now built through the shared
    csr_from_coo / _coo_reduce path and compared on matvec results and
    shapes (tolerance 1e-12).
    """
    from em_eigensolver.csr import _coo_reduce

    A, Ad = rand_herm_sparse(40, 0.15, False, seed=105)
    r, c, d = coo_of(A)
    indptr, indices, values = _coo_reduce(
        r.astype(np.int64), c.astype(np.int64), d, 40, 40)
    N = NumpyCSR(indptr, indices, values, (40, 40))
    x = np.random.default_rng(106).standard_normal(40)
    y = np.random.default_rng(107).standard_normal(40)
    # ``A`` is the backend csr (scipy when available); ``Ad`` is its dense copy
    assert N.shape == A.shape and N.nnz == A.nnz
    assert np.max(np.abs(Ad @ x - A @ x)) < 1e-12
    assert np.max(np.abs(N @ x - A @ x)) < 1e-12
    assert np.max(np.abs(N.T @ y - A.T @ y)) < 1e-12
    assert np.max(np.abs(N @ (N @ x) - A @ (A @ x))) < 1e-12


def test_hermiticity_measure_defaults():
    """No-rng call must not raise (regression: ``np.default_rng`` typo) and
    ``sample_size`` must actually budget the probe count."""
    A, _ = rand_herm_sparse(50, 0.1, True, seed=170)
    m_default = hermiticity_measure(A)          # rng + sample_size defaults
    assert 0.0 <= m_default < 1e-12
    assert hermiticity_measure(A, sample_size=50, rng=np.random.default_rng(1)) < 1e-12
    assert hermiticity_measure(A, sample_size=1_000_000, rng=np.random.default_rng(2)) < 1e-12
    # non-Hermitian input (missing conjugate block) yields a positive measure
    Ar, _ = rand_herm_sparse(50, 0.1, False, seed=171)
    r, c, d = coo_of(Ar)
    keep = r >= c                       # drop the upper triangle off-diagonal
    half = csr_from_coo(r[keep].astype(np.int64), c[keep].astype(np.int64),
                        d[keep], 50, 50)
    assert hermiticity_measure(half) > 1e-8


def test_numpy_csr_parallel_matvec_matches_serial():
    """Multithreaded row-block matvec must agree with the serial path.

    The worker count is forced explicitly so the test is deterministic on
    any machine (including 1-core CI): the parallel branch of ``dot`` is
    taken with 4 workers and compared against the serial reduction.
    """
    from em_eigensolver import csr as csr_mod
    from em_eigensolver.samples import _grid_laplacian

    A = _grid_laplacian(100, 100, mu=0.5)          # n = 10000, 5-point stencil
    r = np.repeat(np.arange(A.shape[0]), np.diff(A.indptr))
    indptr, indices, values = csr_mod._coo_reduce(
        r.astype(np.int64), A.indices.astype(np.int64), A.data, 10000, 10000)
    N = csr_mod.NumpyCSR(indptr, indices, values, (10000, 10000))
    assert not np.iscomplexobj(N.data)
    x = np.random.default_rng(180).standard_normal(10000)

    real_count = csr_mod._worker_count
    real_threshold = csr_mod._PARALLEL_MIN_ROWS
    try:
        csr_mod._PARALLEL_MIN_ROWS = 1000   # force the parallel branch for n=10000
        csr_mod._worker_count = lambda: 1
        y_serial = N @ x
        csr_mod._worker_count = lambda: 4
        y_parallel = N @ x
    finally:
        csr_mod._worker_count = real_count
        csr_mod._PARALLEL_MIN_ROWS = real_threshold
    assert np.max(np.abs(y_parallel - y_serial)) == 0.0  # per-row reductions identical
    # empty rows reduce to zero through both paths
    indptr_e = np.array([0, 0, 3, 3], dtype=np.int64)
    Ne = csr_mod.NumpyCSR(indptr_e, np.array([0, 1, 2], dtype=np.int64),
                          np.array([1.0, 2.0, 3.0]), (3, 3))
    ye = Ne @ np.ones(3)
    assert np.allclose(ye, [0.0, 6.0, 0.0])


def test_jd_inner_tolerance_is_relaxed():
    """P0-2: the JD inner MINRES rtol is documented as deliberately relaxed,
    so the facade must pass ``max(cfg.minres_rtol, 1e-4)`` — with the default
    ``cfg.minres_rtol=1e-6`` that is 1e-4, not 1e-6 (stricter than JD)."""
    import em_eigensolver.solver as solver_mod
    captured: dict = {}
    real_jd = solver_mod.jd_solve

    def spy(matvec, n, k, **kw):
        captured["minres_rtol"] = kw.get("minres_rtol")
        return real_jd(matvec, n, k, **kw)

    solver_mod.jd_solve = spy
    try:
        s = build_sample("cavity_small")
        cfg = SolverConfig(method="jacobi-davidson", k=1, sigma=0.6,
                           tol=1e-6, dense_threshold=0)
        res = solve(s.A, cfg)
        assert res.converged
    finally:
        solver_mod.jd_solve = real_jd
    assert captured["minres_rtol"] == 1e-4


def test_driver_config_accepts_camel_case():
    """The TS host sends camelCase keys (maxCycles/basisDim/...); the driver
    must honour them instead of silently falling back to defaults."""
    from em_eigensolver import driver
    cfg = driver._build_config({"k": 2, "basisDim": 128, "maxCycles": 7,
                                "maxIter": 11, "denseThreshold": 5,
                                "tol": 1e-6, "sigma": 0.6})
    assert cfg.basis_dim == 128 and cfg.max_cycles == 7
    assert cfg.max_iter == 11 and cfg.dense_threshold == 5
    cfg2 = driver._build_config({"k": 2, "basis_dim": 64})   # snake_case still fine
    assert cfg2.basis_dim == 64


def test_export_npz_contains_residuals():
    """P0-3: the exported/archived .npz must carry `residuals` exactly as the
    CLI docstring and stdout promise."""
    from em_eigensolver import driver

    payload = {"source": "sample", "sample": "cavity_small",
               "config": {"k": 2, "tol": 1e-8, "dense_threshold": 5000}}
    driver.solve_json(json.dumps(payload))
    tmp = tempfile.mkdtemp()
    out = os.path.join(tmp, "r.npz")
    driver.export_npz(out)
    data = np.load(out, allow_pickle=False)
    assert {"eigenvalues", "eigenvectors", "residuals"} <= set(data.files)
    assert len(data["residuals"]) == 2
    assert np.all(np.isfinite(data["residuals"]))


# ============================ matrix IO ======================================

def test_mtx_npz_roundtrip(tmp_path=None):
    A, _ = rand_herm_sparse(50, 0.1, True, seed=107)
    tmp = tmp_path or tempfile.mkdtemp()
    p_mtx = os.path.join(tmp, "m.mtx")
    p_npz = os.path.join(tmp, "m.npz")
    write_mtx(p_mtx, A, name="t")
    A2 = read_mtx(p_mtx)
    x = np.random.default_rng(108).standard_normal(50) \
        + 1j * np.random.default_rng(109).standard_normal(50)
    assert np.linalg.norm(A2 @ x - A @ x) / np.linalg.norm(A @ x) < 1e-12
    write_csr_npz(p_npz, A)
    A3 = read_npz(p_npz)
    assert np.linalg.norm(A3 @ x - A @ x) / np.linalg.norm(A @ x) < 1e-12


def test_hermitize_and_materialize():
    A, Ad = rand_herm_sparse(40, 0.1, True, seed=110)
    upper = np.triu(Ad)
    ur, uc = np.nonzero(upper)
    As = csr_from_coo(ur.astype(np.int64), uc.astype(np.int64), upper[ur, uc], 40, 40)
    H = materialize_triangle(As, part="upper")
    x = np.random.default_rng(111).standard_normal(40)
    assert np.linalg.norm(H @ x - Ad @ x) / np.linalg.norm(Ad @ x) < 1e-12
    H2, drift = hermitize(A)
    assert drift < 1e-12
    assert np.linalg.norm(H2 @ x - Ad @ x) / np.linalg.norm(Ad @ x) < 1e-12


# ============================ MINRES =========================================

def test_minres_indefinite():
    n = 80
    A, Ad = rand_herm_sparse(n, 0.05, False, seed=112)
    b = np.random.default_rng(113).standard_normal(n)
    res = minres_solve(lambda v: A @ v, b, shift=0.0, rtol=1e-10,
                       maxiter=400, restart=100)
    assert res.converged
    assert np.linalg.norm(A @ res.x - b) / np.linalg.norm(b) < 1e-8


# ============================ three kernels ==================================

def test_lanczos_plain_and_shift_invert():
    n = 240
    A, Ad = rand_herm_sparse(n, 0.02, False, seed=120)
    lam = np.sort(np.linalg.eigvalsh(Ad))
    out = lanczos_solve(lambda x: A @ x, n, 4, which="LM", tol=1e-9,
                        basis_dim=36, seed=121)
    assert out.converged, f"plain LM not converged: rel={out.residuals}"
    ref1 = lam[np.argsort(-np.abs(lam))[:4]]
    assert np.allclose(np.sort(ref1), np.sort(out.eigenvalues), atol=1e-6), \
        f"got {np.sort(out.eigenvalues)} want {np.sort(ref1)}"

    mus = [-3.0, -1.5, 0.0, 1.5]
    Ab, Adb = block_herm(mus, w=0.1, size=60, seed=122)
    lamb = np.sort(np.linalg.eigvalsh(Adb))
    out2 = lanczos_solve(lambda x: Ab @ x, Ab.shape[0], 4, sigma=0.75,
                         tol=1e-8, basis_dim=36, seed=123)
    assert out2.converged, f"shift-invert not converged: {out2.residuals}"
    ref2 = lamb[np.argsort(np.abs(lamb - 0.75))[:4]]
    assert np.allclose(np.sort(ref2), np.sort(out2.eigenvalues), atol=1e-6), \
        f"got {np.sort(out2.eigenvalues)} want {np.sort(ref2)}"


def test_lobpcg_extremal_and_repeated():
    n = 240
    A, Ad = rand_herm_sparse(n, 0.02, False, seed=130)
    lam = np.sort(np.linalg.eigvalsh(Ad))
    out = lobpcg_solve(lambda x: A @ x, n, 4, largest=False, tol=1e-9,
                       max_iter=200, seed=131)
    assert out.converged
    assert np.allclose(lam[:4], np.sort(out.eigenvalues), atol=1e-7)

    Ai, Adi = block_herm([-1.0, -1.0, 2.0], w=0.1, size=40, seed=132,
                         identical=True)
    lami = np.sort(np.linalg.eigvalsh(Adi))
    out2 = lobpcg_solve(lambda x: Ai @ x, Ai.shape[0], 4, largest=False,
                        tol=1e-9, max_iter=300, seed=133)
    assert np.allclose(lami[:4], np.sort(out2.eigenvalues), atol=1e-6)
    G = out2.eigenvectors.conj().T @ out2.eigenvectors
    assert np.allclose(G, np.eye(4), atol=1e-8)


def test_jacobi_davidson_dense_interior_and_deflation():
    mus = [-3.0, -1.5, 0.0, 1.5]
    Ab, Adb = block_herm(mus, w=0.1, size=50, seed=140)
    lamb = np.sort(np.linalg.eigvalsh(Adb))
    out = jd_solve(lambda x: Ab @ x, Ab.shape[0], 4, sigma=0.0, tol=1e-8,
                   basis_dim=40, seed=141)
    assert out.converged
    ref = lamb[np.argsort(np.abs(lamb))[:4]]
    assert np.allclose(np.sort(ref), np.sort(out.eigenvalues), atol=1e-6)

    Ai, Adi = block_herm([-1.0, -1.0, 2.0], w=0.1, size=40, seed=142,
                         identical=True)
    lami = np.sort(np.linalg.eigvalsh(Adi))
    out2 = jd_solve(lambda x: Ai @ x, Ai.shape[0], 4, sigma=-1.0, tol=1e-8,
                    basis_dim=40, seed=143)
    assert out2.converged
    ref2 = lami[np.argsort(np.abs(lami + 1.0))[:4]]
    assert np.allclose(np.sort(ref2), np.sort(out2.eigenvalues), atol=1e-6)
    G = out2.eigenvectors.conj().T @ out2.eigenvectors
    assert np.allclose(G, np.eye(4), atol=1e-8)


# ============================ samples / facade ===============================

def test_samples_hermitian():
    for kind in ("cavity_small", "cluster_zero", "degenerate_pair",
                 "cavity_complex"):
        s = build_sample(kind)
        rng = np.random.default_rng(150)
        x = rng.standard_normal(s.A.shape[0])
        assert np.linalg.norm(s.A @ x - s.A.conj().T @ x) < 1e-10


def test_solver_facade_all_methods():
    s = build_sample("cluster_zero")
    for method in ("auto", "jacobi-davidson"):
        cfg = SolverConfig(method=method, k=4, sigma=0.0, tol=1e-7,
                           dense_threshold=0)
        res = solve(s.A, cfg)
        assert res.converged, f"method={method} did not converge: {res.residuals}"
        assert np.all(res.residuals <= 1e-5), \
            f"method={method} residuals too big: {res.residuals}"
    cfg = SolverConfig(method="lobpcg", k=3, which="LM", tol=1e-8,
                       dense_threshold=0, max_iter=200)
    s2 = build_sample("cavity_small")
    res2 = solve(s2.A, cfg)
    assert res2.converged

    # dense fallback path on a tiny matrix
    cfg3 = SolverConfig(k=3, dense_threshold=5000)
    res3 = solve(s2.A, cfg3)
    assert res3.method == "dense-lapack", f"got method {res3.method}"


def test_cli_end_to_end():
    tmp = tempfile.mkdtemp()
    inp = os.path.join(tmp, "m.npz")
    out = os.path.join(tmp, "e.npz")
    cfgp = os.path.join(tmp, "cfg.json")
    A, _ = rand_herm_sparse(60, 0.1, False, seed=160)
    write_csr_npz(inp, A)
    with open(cfgp, "w", encoding="utf-8") as fh:
        json.dump({"k": 3, "sigma": 0.0, "method": "jacobi-davidson",
                   "tol": 1e-6, "dense_threshold": 0}, fh)
    cmd = [sys.executable, "-m", "em_eigensolver.cli", "--input", inp,
           "--config", cfgp, "--out", out]
    env = dict(os.environ)
    pkg_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    env["PYTHONPATH"] = pkg_root + os.pathsep + env.get("PYTHONPATH", "")
    proc = subprocess.run(cmd, capture_output=True, text=True, env=env,
                          cwd=pkg_root)
    assert proc.returncode == 0, proc.stderr[-2000:]
    data = np.load(out, allow_pickle=False)
    assert "eigenvalues" in data and "eigenvectors" in data
    assert len(data["eigenvalues"]) == 3


def test_driver_solve_json_flat_payload():
    """Worker bridge (driver.py): flat payload schema and report shape.

    Regression: the browser worker once sent a nested {request:..., config:...}
    payload, so every solve fell into the file branch and raised
    KeyError 'path' even for samples.
    """
    from em_eigensolver import driver
    payload = {"source": "sample", "sample": "cavity_small",
               "config": {"k": 3, "tol": 1e-9, "dense_threshold": 5000}}
    report = json.loads(driver.solve_json(json.dumps(payload)))
    assert report["converged"]
    assert len(report["eigenvalues"]) == 3 and len(report["residuals"]) == 3
    assert report["meta"]["name"] == "cavity_small"
    assert report["meta"]["shape"] == [900, 900]
    assert "eigenvectors" not in report
    # nested payloads must fail loudly (KeyError), never silently solve
    try:
        driver.solve_json(json.dumps({"request": payload, "config": {}}))
    except KeyError:
        pass
    else:
        raise AssertionError("nested payload must be rejected: schema is flat")


def test_driver_mode_fields():
    """3D visualisation bridge (driver.py): downsampled mode-field report.

    Grid samples recover the exact square mesh (approx=False); band samples
    get a nearest-factor layout flagged approx=True. Values are normalised
    to max |1| and capped at 64x64 cells per mode.
    """
    from em_eigensolver import driver
    payload = {"source": "sample", "sample": "cavity_small",
               "config": {"k": 4, "tol": 1e-9, "dense_threshold": 5000}}
    report = json.loads(driver.solve_json(json.dumps(payload)))
    # camelCase key: the report crosses to the TS host verbatim.
    fields = report["modeFields"]
    assert len(fields) == 4
    for j, f in enumerate(fields):
        assert f["index"] == j
        assert (f["rows"], f["cols"]) == (30, 30)
        assert f["approx"] is False
        assert len(f["values"]) == f["rows"] * f["cols"]
        peak = max(abs(v) for v in f["values"])
        assert abs(peak - 1.0) < 1e-9
        assert abs(f["eigenvalue"] - report["eigenvalues"][j]) < 1e-9

    # Band-assembled sample: 6 bands x 120 -> 720 unknowns -> 24x30 layout.
    report2 = json.loads(driver.solve_json(json.dumps(
        {"source": "sample", "sample": "cluster_zero",
         "config": {"k": 2, "sigma": 0.0, "tol": 1e-6, "dense_threshold": 0}})))
    f2 = report2["modeFields"]
    assert len(f2) == 2 and (f2[0]["rows"], f2[0]["cols"]) == (24, 30)
    assert f2[0]["approx"] is True

    # Large grid downsamples to the 64x64 cap.  Extremal Lanczos (no sigma):
    # an interior JD shift at this scale would push MINRES into an indefinite
    # system and crawl — the point here is the downsample cap, not the shift.
    report3 = json.loads(driver.solve_json(json.dumps(
        {"source": "sample", "sample": "cavity_large",
         "config": {"k": 1, "method": "lanczos", "which": "LM",
                    "tol": 1e-4, "basis_dim": 24}})))
    f3 = report3["modeFields"][0]
    assert f3["rows"] <= 64 and f3["cols"] <= 64
    assert len(f3["values"]) == f3["rows"] * f3["cols"]

    # Complex Hermitian sample: fields are |field| magnitudes (non-negative).
    report4 = json.loads(driver.solve_json(json.dumps(
        {"source": "sample", "sample": "cavity_complex",
         "config": {"k": 1, "sigma": 1.2, "tol": 1e-9, "dense_threshold": 5000}})))
    vals = report4["modeFields"][0]["values"]
    assert min(vals) >= 0.0


def test_nearest_grid_prime_falls_back():
    """Prime n must not collapse to a (1, n) strip: both sides >= 2, padded.

    A 1-row layout yields zero quads in the TS surface mesh (blank 3D view),
    so _nearest_grid falls back to an approximate 2-row grid that mode_fields
    zero-pads via the approximate-layout path.
    """
    from em_eigensolver import driver
    for n in (2, 3, 5, 7, 11, 101, 3071):
        rows, cols = driver._nearest_grid(n)
        assert rows >= 2 and cols >= 2, f"n={n} -> {(rows, cols)}"
        assert rows * cols >= n, f"n={n} -> {(rows, cols)}"
    # exact factors still recover the square mesh
    assert driver._nearest_grid(900) == (30, 30)
    assert driver._nearest_grid(720) == (24, 30)
    assert driver._nearest_grid(1) == (1, 1)


def test_sanitize_json_replaces_nonfinite():
    """NaN/Inf must become null + hit flag, never bare JSON tokens."""
    from em_eigensolver import driver
    hit: list[bool] = [False]
    clean = driver._sanitize_json(
        {"a": float("nan"), "b": [1.0, float("inf")], "c": {"d": -float("inf")},
         "e": "x", "f": 2.5}, hit)
    assert clean == {"a": None, "b": [1.0, None], "c": {"d": None},
                     "e": "x", "f": 2.5}
    assert hit[0]
    # strictly valid JSON round-trips through the host parser
    text = json.dumps(clean)
    assert "NaN" not in text and "Infinity" not in text


# ==================== PRD 4.2/4.3/4.4: sweep + validation ====================

def test_parameter_sweep_curves():
    """4.2: a cavity size sweep must produce eigenvalue curves with certified
    residuals, JSON-serialisable, and one bad value must not kill the scan."""
    from em_eigensolver.sweep import sweep_eigenvalues
    out = sweep_eigenvalues("cavity", "size", [12.0, 16.0, 20.0],
                            config=SolverConfig(k=2, sigma=0.6, tol=1e-8,
                                                dense_threshold=0))
    assert out.kind == "cavity" and len(out.points) == 3
    for pt in out.points:
        assert pt.error is None and pt.converged
        assert len(pt.eigenvalues) == 2 and len(pt.residuals) == 2
        assert max(pt.residuals) <= 1e-6
        # grid Laplacian spectrum lives in [mu, mu + 8*scale] = [0.5, 8.5]
        assert all(0.5 <= v <= 8.5 for v in pt.eigenvalues)
        d = pt.to_dict()
        json.dumps(d)  # must stay JSON-safe
    # the 'mu' knob shifts the whole spectrum by mu: the smallest eigenvalue
    # (selected with which='SA', no sigma) moves from lam0 to lam0 + mu
    mu_out = sweep_eigenvalues("cavity", "mu", [0.0, 1.0],
                               config=SolverConfig(k=1, which="SA", tol=1e-8,
                                                   dense_threshold=0))
    lams = [pt.eigenvalues[0] for pt in mu_out.points]
    assert abs((lams[1] - lams[0]) - 1.0) < 1e-6
    assert sweep_eigenvalues("cavity", "bogus", [10.0]).points[0].error


def test_validate_correctness_fast_subset():
    """4.3 + 4.4: run the fast validation subset (dense-reference comparison
    plus the adversarial stress bench) — everything must PASS."""
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))), "benchmarks"))
    import validate_correctness as vc
    refs = vc.run_reference_cases(fast=True)
    stress = vc.run_stress_bench(fast=True)
    bad = [r["case"] for r in refs + stress if r["status"] != "PASS"]
    assert not bad, f"validation failures: {bad}"
    # reference comparison really is tight vs LAPACK
    for r in refs:
        assert r["max_eigenvalue_error_rel"] < 1e-8
        assert r["max_residual"] <= 1e-6


def main() -> int:
    tests = [v for k, v in sorted(globals().items())
             if k.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  [PASS] {t.__name__}")
        except AssertionError as exc:
            failed += 1
            print(f"  [FAIL] {t.__name__}: {exc}")
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"  [ERROR] {t.__name__}: {type(exc).__name__}: {exc}")
    print(f"\nBACKEND: {backend_name()} | {'ALL PASS' if not failed else f'{failed} FAILURES'}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
