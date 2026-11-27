"""JSON driver — the deterministic entry point shared by the Python CLI, the
Pyodide worker and the standalone benchmark script.  One code path, three
runners, so results produced in-browser are byte-identical to the CLI ones
(modulo the real wall-clock latency label, which the worker overlays).

The worker bridge (fluid-worker.ts) imports this module and calls the same
``solve_json`` / ``verify_json`` functions with a serialisable payload, which is
exactly what keeps the reproduCIBILITY story honest across environments.
"""

from __future__ import annotations

import json
import math

import numpy as np

from . import verify


# Optional progress hook bridged to the browser worker. ``fn(done, total)`` is
# called on 1-D/3-D exchange-window boundaries so a long coupling can stream
# a progress indicator. Left ``None`` under the CLI (no-op).
_progress_sink = None


def _sanitize_json(obj, hit: list[bool]):
    """Recursively replace NaN/Inf floats with ``None``.

    ``json.dumps`` would happily emit bare ``NaN``/``Infinity`` tokens, which
    crash ``JSON.parse`` on the host (fluid-worker.ts) — a diverged coupling must
    fail with a readable ``nonfinite`` flag instead of a syntax error. NumPy
    scalars are normalised so the worker's plain ``json.dumps`` (no ``default``)
    never trips on ``np.int64``/``np.float32`` either.
    """
    if isinstance(obj, (bool, np.bool_)):
        return bool(obj)
    if isinstance(obj, (float, np.floating)):
        if not math.isfinite(float(obj)):
            hit[0] = True
            return None
        return float(obj)
    if isinstance(obj, (int, np.integer)):
        return int(obj)
    if isinstance(obj, dict):
        return {k: _sanitize_json(v, hit) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize_json(v, hit) for v in obj]
    return obj


def _clean(data: dict) -> dict:
    hit: list[bool] = [False]
    clean = _sanitize_json(data, hit)
    if hit[0]:
        clean["nonfinite"] = True
    return clean


def set_progress_sink(fn) -> None:
    """Install a callable ``fn(done:int, total:int)`` to receive percentages."""
    global _progress_sink
    _progress_sink = fn


def solve_json(payload: dict) -> dict:
    """Run a single coupling from a JSON payload and return JSON-serialisable
    results.

    Payload keys (all optional):
        case : 'a' | 'b' | 'c' | 'd' | None   short run using the benchmark configs
        net  : dict                     overrides for NetworkConfig
        dom  : dict                     overrides for DomainConfig
        cpl  : dict                     overrides for CouplerConfig
    """
    from .coupler import CouplerConfig, run_coupling
    from .domain_3d import DomainConfig
    from .network_1d import NetworkConfig

    case = payload.get("case")
    if case == "a":
        from .verify import case_a_config
        net, dom, cpl = _unpack(case_a_config())
    elif case == "b":
        from .verify import case_b_config
        net, dom, cpl = _unpack(case_b_config())
    elif case == "c":
        from .verify import case_c_config
        net, dom, cpl = _unpack(case_c_config())
    elif case == "d":
        from .verify import case_d_config
        net, dom, cpl = _unpack(case_d_config())
    else:
        net = NetworkConfig(**payload.get("net", {}))
        dom = DomainConfig(**payload.get("dom", {}))
        cpl = CouplerConfig(**payload.get("cpl", {}))

    net = net.normalized()
    dom = dom.normalized()
    cpl = cpl.normalized()

    def progress(done: int, total: int) -> None:
        global _progress_sink
        if _progress_sink is not None:
            try:
                _progress_sink(done, total)
            except Exception:  # a broken sink must never fail the solve
                _progress_sink = None

    res = run_coupling(net, dom, cpl, progress=progress)
    return _clean(res.to_dict())


def _unpack(cfg: dict):
    return cfg["net"], cfg["dom"], cfg["cpl"]


def verify_json(payload: dict | None = None) -> dict:
    """Run the full benchmark suite (Case A + Case B + Case C + Case D +
    subsonic curve + trade-off + minimal feasible period + sensitivity
    attribution)."""
    from . import verify
    out = {
        "case_a": verify.verify_case_a(),
        "case_b": verify.verify_case_b(),
        "case_c": verify.verify_case_c(),
        "case_d": verify.verify_case_d(),
        "subsonic_curve": verify.verify_subsonic_curve(),
        "trade_off": verify.trade_off(),
        "min_exchange": verify.min_feasible_exchange_period(),
        "sensitivity": verify.sensitivity_case_a(),
    }
    return _clean(out)


def main() -> int:
    import sys

    cmd = sys.argv[1] if len(sys.argv) > 1 else "verify"
    if cmd == "verify":
        data = verify_json()
    elif cmd == "solve":
        payload = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
        data = solve_json(payload)
    else:
        print("usage: python -m fluid_cfd.driver [verify|solve <json>]")
        return 2
    print(json.dumps(data, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())