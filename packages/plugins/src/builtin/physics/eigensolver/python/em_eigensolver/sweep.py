"""Parameter sweep → service diagnostics (PRD 4.2).

Upgrades the single-shot solve into an engineering *diagnostic curve*: scan a
cavity geometry / material parameter, re-solve at each point, and report the
eigenvalue trajectories with certified residuals — the "parameter → resonant
frequency band" view the EM service context asks for.

Scans are fully reproducible: the same parameter list and seed always rebuild
the same matrices, and every point carries its true residual and runtime, so
the output doubles as a traceability record.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import numpy as np

from .samples import SAMPLE_BUILDERS, build_sample
from .solver import SolverConfig, solve


@dataclass
class SweepPoint:
    value: float                      # scanned parameter value
    eigenvalues: list[float] = field(default_factory=list)
    residuals: list[float] = field(default_factory=list)
    converged: bool = False
    iterations: int = 0
    matvecs: int = 0
    seconds: float = 0.0
    n: int = 0
    nnz: int = 0
    error: str | None = None

    def to_dict(self) -> dict:
        d = {
            "value": self.value,
            "eigenvalues": self.eigenvalues,
            "residuals": self.residuals,
            "converged": self.converged,
            "iterations": self.iterations,
            "matvecs": self.matvecs,
            "seconds": round(self.seconds, 3),
            "n": self.n,
            "nnz": self.nnz,
        }
        if self.error is not None:
            d["error"] = self.error
        return d


@dataclass
class SweepResult:
    kind: str                # sample family ("cavity", "cluster_zero", ...)
    param: str               # scanned knob name
    values: list[float]
    points: list[SweepPoint]
    seconds: float = 0.0

    def to_dict(self) -> dict:
        return {
            "kind": self.kind,
            "param": self.param,
            "values": self.values,
            "seconds": round(self.seconds, 3),
            "points": [p.to_dict() for p in self.points],
        }


def sweep_eigenvalues(
    kind: str = "cavity",
    param: str = "size",
    values: list[float] | None = None,
    config: SolverConfig | None = None,
    on_progress=None,
) -> SweepResult:
    """Re-solve a parameterised sample for every value of one knob.

    Parameters
    ----------
    kind
        ``"cavity"`` scans the 2-D grid Laplacian family (knobs below);
        any other value must name a :data:`SAMPLE_BUILDERS` entry and only
        ``"seed"`` is scannable there.
    param
        For ``kind="cavity"``: ``"size"`` (grid ``n = size*size``),
        ``"mu"`` (material offset shifting the whole spectrum), or
        ``"scale"`` (coupling strength). Otherwise ``"seed"``.
    values
        Parameter values to scan (defaults keep the run small).
    config
        Solver config reused for every point.  For non-cavity kinds with no
        ``sigma`` the sample's recommended sigma is used per point; cavity
        sweeps without ``sigma`` stay extremal (plain Lanczos), matching the
        ``which`` selection.
    """
    values = [float(v) for v in (values or [])] or (
        [12.0, 16.0, 20.0, 24.0] if param == "size" else [0.0, 0.5, 1.0, 1.5]
    )
    cfg = (config or SolverConfig()).normalized()
    kind_l = kind.lower()
    is_cavity = kind_l in ("cavity", "cavity_small", "grid")

    points: list[SweepPoint] = []
    t0 = time.perf_counter()
    for vi, val in enumerate(values):
        pt = SweepPoint(value=val)
        try:
            # Per-point config: never mutate `cfg` — a sigma defaulted for one
            # point must not leak into later points (which would silently turn
            # an extremal/SA sweep into a shift-invert JD sweep).
            pt_cfg = cfg
            if is_cavity:
                from .samples import _grid_laplacian
                kwargs = {"seed": cfg.seed}
                if param == "size":
                    size = max(4, int(round(val)))
                    kwargs.update(nx=size, ny=size, mu=0.5, scale=1.0)
                elif param == "mu":
                    kwargs.update(nx=20, ny=20, mu=float(val), scale=1.0)
                elif param == "scale":
                    kwargs.update(nx=20, ny=20, mu=0.5, scale=max(float(val), 1e-6))
                else:
                    raise ValueError(
                        f"cavity sweep scans size/mu/scale, got {param!r}")
                A = _grid_laplacian(**kwargs)
            else:
                if param != "seed":
                    raise ValueError(
                        f"{kind_l} only scans the 'seed' knob, got {param!r}")
                sample = build_sample(kind_l, seed=int(val))
                A = sample.A
                if pt_cfg.sigma is None:
                    pt_cfg = SolverConfig(**{**pt_cfg.__dict__,
                                             "sigma": sample.recommended_sigma})

            tp = time.perf_counter()
            res = solve(A, pt_cfg, on_progress)
            pt.seconds = time.perf_counter() - tp
            pt.eigenvalues = [float(v) for v in np.real(res.eigenvalues)]
            pt.residuals = [float(v) for v in res.residuals]
            pt.converged = bool(res.converged)
            pt.iterations = int(res.iterations)
            pt.matvecs = int(res.matvecs)
            pt.n = int(A.shape[0])
            pt.nnz = int(A.nnz if hasattr(A, "nnz") else -1)
        except Exception as exc:  # noqa: BLE001 — one bad point must not kill the scan
            pt.error = f"{type(exc).__name__}: {exc}"
        if on_progress is not None:
            on_progress({"sweep": True, "index": vi, "value": val,
                         "converged": pt.converged})
        points.append(pt)
    return SweepResult(kind=kind_l, param=param, values=values,
                       points=points, seconds=time.perf_counter() - t0)


def sweep_json(payload: str) -> str:
    """Worker/CLI bridge: ``{"kind", "param", "values", "config"}`` → JSON."""
    import json
    req = json.loads(payload)
    cfg_d = req.get("config", {}) or {}
    cfg = SolverConfig(
        k=int(cfg_d.get("k", 4)),
        sigma=cfg_d.get("sigma"),
        tol=float(cfg_d.get("tol", 1e-8)),
        seed=int(cfg_d.get("seed", 0)),
        dense_threshold=int(cfg_d.get("dense_threshold", 0)),
        method=str(cfg_d.get("method", "auto")),
    )
    result = sweep_eigenvalues(
        kind=str(req.get("kind", "cavity")),
        param=str(req.get("param", "size")),
        values=[float(v) for v in req.get("values", [])],
        config=cfg,
    )
    return json.dumps(result.to_dict(), default=float)
