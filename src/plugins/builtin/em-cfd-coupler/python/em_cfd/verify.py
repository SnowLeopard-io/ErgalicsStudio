"""Verification suite — analytical baseline comparison + two benchmark cases.

The competition requires:
  * at least two typical bidirectional-coupling cases checked against an
    analytical/experimental baseline;
  * interface error, exchange-latency statistics;
  * a precision-vs-efficiency trade-off curve across exchange frequencies.

``Case A (steady choked)`` — 1-D nozzle fully open, low back pressure; verifies
the 1-D outlet flow matches the analytical choked-flow value and the plenum
follows the analytical blowdown.

``Case B (valve-step / ms-control)`` — a millisecond valve action closes then
re-opens the nozzle; verifies the control-logic sync error and that the
transient back pressure drives the reverse coupling.

``trade_off`` runs the same workload at several exchange periods and returns
the latency/error/frequency table appended to the bench JSON.
"""

from __future__ import annotations

import numpy as np

from .analytic import nozzle_choked_flow, interface_tradeoff_curve
from .coupler import CouplerConfig, run_coupling
from .domain_3d import DomainConfig
from .network_1d import NetworkConfig


def case_a_config() -> dict:
    """Steady choked case: fully open nozzle, low sub-atmospheric back BC."""
    return {
        "net": NetworkConfig(
            volume=0.05,
            p0_init=5.0e5,
            t0_init=320.0,
            throat_area=8.0e-5,
            discharge_coeff=0.98,
            valve_events=None,
        ),
        "dom": DomainConfig(nx=10, ny=10, nz=10, length=0.12,
                            diffusivity=1.0e-4, advection=0.04),
        "cpl": CouplerConfig(dt1d=2.0e-3, dt3d=2.5e-4, t_end=0.12),
    }


def case_b_config() -> dict:
    """Value-step control case: valve starts fully open, snaps to 20% at 40ms
    then reopens to 100% at 90ms — a millisecond-scale control intervention.

    The ``(0.0, 1.0, 0.0)`` leading event guarantees the valve is *open* at
    t=0; otherwise ``valve_opening`` would return the first event's opening
    (20%) before 40ms and the "open" sampling band would actually measure a
    throttled flow, flipping the throttle ratio negative.
    """
    events = [(0.000, 1.00, 0.0),  # fully open at t=0
              (0.040, 0.20, 0.0),  # rapid close at 40ms  (step)
              (0.090, 1.00, 0.0)]  # reopen at 90ms       (step)
    return {
        "net": NetworkConfig(
            volume=0.06,
            p0_init=6.0e5,
            t0_init=330.0,
            throat_area=1.0e-4,
            discharge_coeff=0.96,
            valve_events=list(events),
        ),
        "dom": DomainConfig(nx=10, ny=10, nz=10, length=0.12,
                            diffusivity=1.5e-4, advection=0.05),
        "cpl": CouplerConfig(dt1d=2.0e-3, dt3d=2.5e-4, t_end=0.16,
                             valve_events=list(events)),
    }


def verify_case_a() -> dict:
    """Run Case A and compare the 1-D outlet flow + plenum blowdown against
    the analytical references."""
    cfg = case_a_config()
    net_cfg = cfg["net"].normalized()
    res = run_coupling(net_cfg, cfg["dom"].normalized(), cfg["cpl"].normalized())
    # analytical reference at the start (choked phase)
    p0 = net_cfg.p0_init
    t0 = net_cfg.t0_init
    area_eff = net_cfg.throat_area * net_cfg.discharge_coeff
    md_analytic = nozzle_choked_flow(p0, t0, area_eff, gamma=net_cfg.gamma,
                                     r_specific=net_cfg.r_specific)
    md_solver = (max(w.md_1d for w in res.windows) if res.windows else 0.0)
    rel_err_flow = abs(md_solver - md_analytic) / max(md_analytic, 1e-18)

    # plenum blowdown compares final pressure vs analytical at final time
    tf = res.metrics["total_sim_time"]
    p_blow = _analytical_blowdown(net_cfg, tf)
    p_final = res.metrics["final_plenum_pressure"]
    rel_err_p = abs(p_final - p_blow) / max(p_blow, 1e-18)

    return {
        "case": "A_steady_choked",
        "ok": res.ok,
        "md_analytic_kg_s": md_analytic,
        "md_solver_kg_s": md_solver,
        "flow_rel_error": rel_err_flow,
        "p_blowdown_analytic": p_blow,
        "p_solver_final": p_final,
        "pressure_rel_error": rel_err_p,
        "metrics": res.metrics,
        "windows": [w.to_dict() for w in res.windows],
    }


def _analytical_blowdown(net_cfg: NetworkConfig, t: float) -> float:
    from .analytic import blowdown_pressure
    area_eff = net_cfg.throat_area * net_cfg.discharge_coeff
    return blowdown_pressure(
        net_cfg.p0_init, net_cfg.t0_init, net_cfg.volume, area_eff, t,
        gamma=net_cfg.gamma, r_specific=net_cfg.r_specific,
    )


def verify_case_b() -> dict:
    """Run Case B (ms valve control) and report control sync + reverse coupling
    strength (drop in outlet flow when the valve closes, recovered after)."""
    cfg = case_b_config()
    net_cfg = cfg["net"].normalized()
    res = run_coupling(net_cfg, cfg["dom"].normalized(), cfg["cpl"].normalized())
    windows = res.windows
    # outlet flow right after the 40ms close vs before, and after reopen
    before = [w.md_1d for w in windows if w.t < 0.039]
    closed = [w.md_1d for w in windows if 0.041 < w.t < 0.088]
    reopened = [w.md_1d for w in windows if 0.092 < w.t]
    md_open = max(before) if before else 0.0
    md_closed = max(closed) if closed else 0.0
    md_reopen = max(reopened) if reopened else 0.0
    # ms-control / solver-grid sync: worst & mean offset of the valve events
    # from the nearest 1-D step gridline (0 = every event is grid-aligned).
    sync_max = res.metrics.get("control_sync_max_ms", 0.0)
    sync_mean = res.metrics.get("control_sync_mean_ms", 0.0)

    return {
        "case": "B_valve_step_ms_control",
        "ok": res.ok,
        "back_pressure_final": res.metrics["final_back_pressure"],
        "plenum_pressure_final": res.metrics["final_plenum_pressure"],
        "flow_open_kg_s": md_open,
        "flow_closed_kg_s": md_closed,
        "flow_reopen_kg_s": md_reopen,
        "valve_throttle_ratio": (md_open - md_closed) / max(md_open, 1e-18),
        "control_sync_max_ms": sync_max,
        "control_sync_mean_ms": sync_mean,
        "metrics": res.metrics,
        "windows": [w.to_dict() for w in res.windows],
    }


def trade_off() -> list[dict]:
    """Precision-vs-efficiency curve: run a fixed workload at several exchange
    periods and gather (period, latency, error, frequency)."""
    periods = np.array([0.5, 1.0, 2.0, 3.5, 5.0]) * 1e-3
    lats, errs = [], []
    for p in periods:
        net_cfg = NetworkConfig(volume=0.05, p0_init=5e5, t0_init=320,
                                throat_area=8e-5, discharge_coeff=0.98)
        dom_cfg = DomainConfig(nx=8, ny=8, nz=8, length=0.10)
        cpl_cfg = CouplerConfig(dt1d=1e-3, dt3d=1.5e-4, t_end=0.08,
                                exchange_period=float(p))
        res = run_coupling(net_cfg.normalized(), dom_cfg.normalized(),
                           cpl_cfg.normalized())
        lats.append(res.metrics["mean_exchange_latency_ms"])
        errs.append(max((w.iface_error for w in res.windows), default=0.0))
    return interface_tradeoff_curve(
        periods * 1e3, lats, errs,
    )


def run_all() -> dict:
    """Run Case A + Case B + trade-off. Returns a dict suitable for the bench
    JSON file (see python/benchmarks/bench_coupling.py)."""
    return {
        "case_a": verify_case_a(),
        "case_b": verify_case_b(),
        "trade_off": trade_off(),
    }


__all__ = ["case_a_config", "case_b_config", "verify_case_a", "verify_case_b",
           "trade_off", "run_all"]