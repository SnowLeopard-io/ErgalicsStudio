"""JSON driver — the deterministic entry point shared by the Python CLI, the
Pyodide worker and the standalone benchmark script.  One code path, three
runners, so results produced in-browser are byte-identical to the CLI ones
(modulo the real wall-clock latency label, which the worker overlays).

The worker bridge (em-worker.ts) imports this module and calls the same
``solve_json`` / ``verify_json`` functions with a serialisable payload, which is
exactly what keeps the reproduCIBILITY story honest across environments.
"""

from __future__ import annotations

import json

from .verify import run_all, trade_off, verify_case_a, verify_case_b


# Optional progress hook bridged to the browser worker. ``fn(done, total)`` is
# called on 1-D/3-D exchange-window boundaries so a long coupling can stream
# a progress indicator. Left ``None`` under the CLI (no-op).
_progress_sink = None


def set_progress_sink(fn) -> None:
    """Install a callable ``fn(done:int, total:int)`` to receive percentages."""
    global _progress_sink
    _progress_sink = fn


def solve_json(payload: dict) -> dict:
    """Run a single coupling from a JSON payload and return JSON-serialisable
    results.

    Payload keys (all optional):
        case : 'a' | 'b' | None        short run using the benchmark configs
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
    return res.to_dict()


def _unpack(cfg: dict):
    return cfg["net"], cfg["dom"], cfg["cpl"]


def verify_json(payload: dict | None = None) -> dict:
    """Run the full benchmark suite (Case A + Case B + trade-off)."""
    out = {
        "case_a": verify_case_a(),
        "case_b": verify_case_b(),
        "trade_off": trade_off(),
    }
    return out


def main() -> int:
    import sys

    cmd = sys.argv[1] if len(sys.argv) > 1 else "verify"
    if cmd == "verify":
        data = verify_json()
    elif cmd == "solve":
        payload = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
        data = solve_json(payload)
    else:
        print("usage: python -m em_cfd.driver [verify|solve <json>]")
        return 2
    print(json.dumps(data, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())