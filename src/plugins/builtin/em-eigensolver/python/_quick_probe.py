import os, sys, time
import numpy as np
from scipy.sparse import dia_array

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from em_eigensolver.samples import _grid_laplacian
from em_eigensolver.csr import NumpyCSR, _coo_reduce

n = 102400
nx = 320
A_g = _grid_laplacian(nx, nx, mu=0.0)
r = np.repeat(np.arange(A_g.shape[0]), np.diff(A_g.indptr))
indptr, indices, values = _coo_reduce(
    r.astype(np.int64), A_g.indices.astype(np.int64), A_g.data, A_g.shape[0], A_g.shape[1])
Ac = NumpyCSR(indptr, indices, values, A_g.shape)
As = A_g  # scipy csr

x = np.ones(n)


def best(fn, reps=7):
    fn()
    ts = []
    for _ in range(reps):
        t0 = time.perf_counter(); fn(); ts.append(time.perf_counter() - t0)
    return min(ts) * 1e3


print(f"n={n} nnz={As.nnz}")

for pin in ("1", "4", "8"):
    os.environ["EM_EIGENSOLVER_THREADS"] = pin
    from em_eigensolver.csr import _worker_count
    wc = _worker_count()
    ms = best(lambda: Ac.dot(x))
    print(f"[NumpyCSR] EM_EIGENSOLVER_THREADS={pin} workers={wc} A@x = {ms:.3f} ms")

ms_s = best(lambda: As.dot(x))
print(f"[scipy row1] A@x = {ms_s:.3f} ms")

# multi-column block: our loop vs scipy direct
X = np.ones((n, 16))
ms_block = best(lambda: Ac.dot(X))
print(f"[NumpyCSR] 16-col block A@X (our col-loop) = {ms_block:.3f} ms")
ms_sblock = best(lambda: As.dot(X))
print(f"[scipy direct] 16-col block A@X = {ms_sblock:.3f} ms")