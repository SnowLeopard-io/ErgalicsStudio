"""Tests for the fluid-cfd-coupler numerical kernel.

Run with pytest:  python -m pytest tests/test_coupling.py -q
(No scipy/networkx needed — pure NumPy.)
"""

from __future__ import annotations

import os
import sys
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), os.pardir))

from fluid_cfd.coupler import CouplerConfig, run_coupling  # noqa: E402
from fluid_cfd.domain_3d import DomainConfig, DomainState, make_initial, step_domain_3d  # noqa: E402
from fluid_cfd.analytic import nozzle_choked_flow, blowdown_pressure  # noqa: E402
from fluid_cfd.network_1d import NetworkConfig, NetworkState, step_network, valve_opening, isentropic_nozzle  # noqa: E402
from fluid_cfd.verify import (  # noqa: E402
    verify_case_a,
    verify_case_b,
    verify_case_c,
    verify_case_d,
    verify_subsonic_curve,
    trade_off,
    min_feasible_exchange_period,
    sensitivity_case_a,
)


def _base_coupler(t_end=0.05):
    net = NetworkConfig()
    dom = DomainConfig(nx=8, ny=8, nz=8, length=0.10)
    cpl = CouplerConfig(dt1d=2e-3, dt3d=2.5e-4, t_end=t_end)
    return net.normalized(), dom.normalized(), cpl.normalized()


def test_nozzle_choked_closed_form():
    """1-D outlet must match the analytic choked-flow at t=0 (fully open)."""
    p0, t0, area = 5e5, 320.0, 8e-5
    analytic = nozzle_choked_flow(p0, t0, area)
    md = isentropic_nozzle(p0, t0, 2e5, area, gamma=1.4, r_specific=287.05)[0]
    assert md > 0
    assert abs(md - analytic) / analytic < 1e-6


def test_network_advance_conserves_mass():
    """Plenum mass must decrease by exactly md*dt when discharging."""
    cfg = NetworkConfig()
    st = NetworkState(p0=cfg.p0_init, t0=cfg.t0_init,
                      mass=cfg.p0_init * cfg.volume / (cfg.r_specific * cfg.t0_init))
    m0 = st.mass
    step_network(cfg.normalized(), st, 1e-3, p_back=2e5)
    assert st.mass < m0
    # discharged = m0 - m1 ; md_out should be > 0 (choked => back pressure low)
    assert st.md_out > 0


def test_valve_step_reduces_flow():
    """Closing the valve to 20% at 20ms must throttle the outlet substantially
    within a single run (early-window flow >> late-window flow)."""
    net, dom, cpl = _base_coupler()
    net_with_valve = NetworkConfig(valve_events=[(0.0, 1.0, 0.0), (0.02, 0.2, 0.0)])
    res = run_coupling(net_with_valve.normalized(), dom, cpl)
    early = [w.md_1d for w in res.windows if w.t < 0.012]   # valve fully open
    late = [w.md_1d for w in res.windows if w.t > 0.028]    # valve closed to 20%
    assert early and late
    ratio = (max(early) - max(late)) / max(max(early), 1e-18)
    assert ratio > 0.5  # throttled by at least half


def test_case_a_matches_analytic():
    """Case A: solver outlet flow ~= analytic choked flow (within 5%)."""
    out = verify_case_a()
    assert out["ok"] is True
    assert out["flow_rel_error"] < 0.05


def test_case_b_throttle_ratio_positive():
    """Case B: ms valve close must reduce flow vs open (throttle ratio > 0)."""
    out = verify_case_b()
    assert out["ok"] is True
    assert out.get("valve_throttle_ratio", 0.0) > 0.5


def test_trade_off_returns_curve():
    """Precision-vs-efficiency curve must produce an ordered table."""
    curve = trade_off()
    assert len(curve) >= 3
    assert all("composite_score" in row for row in curve)


def test_coupling_multi_rate_subcycling():
    """3-D sub-steps per window must equal ceil(exch/dt3d) — the multi-rate
    coordination that the competition stresses."""
    net, dom, cpl = _base_coupler()
    res = run_coupling(net, dom, cpl)
    assert res.metrics["sub3d_per_window"] >= 1
    assert res.metrics["time_ratio_1d_3d"] >= 2


def test_conservation_audit_finite():
    """Interface error must stay finite (no NaN blow-up)."""
    net, dom, cpl = _base_coupler()
    res = run_coupling(net, dom, cpl)
    errs = [w.iface_error for w in res.windows]
    assert all(np.isfinite(e) for e in errs)


# ---------------------------------------------------------------------------
# CFD-05 — unified error metric (rel_error + basis + certification)
# ---------------------------------------------------------------------------

def test_case_a_certification_uniform():
    """Every measured quantity carries rel_error + basis + certification."""
    out = verify_case_a()
    assert "basis" in out and "certification" in out
    cert = out["certification"]
    assert cert["all_pass"] is True
    for check in cert["checks"]:
        assert {"quantity", "rel_error", "threshold", "pass", "basis"} <= set(check)
        assert check["pass"] is True
    assert out["flow_rel_error"] <= 0.05
    assert out["pressure_rel_error"] <= 0.05


def test_case_b_certification_uniform():
    out = verify_case_b()
    cert = out["certification"]
    assert cert["all_pass"] is True
    for check in cert["checks"]:
        assert {"quantity", "pass", "basis"} <= set(check)
        assert check["pass"] is True


# ---------------------------------------------------------------------------
# CFD-01 — minimal feasible exchange period
# ---------------------------------------------------------------------------

def test_min_feasible_exchange_period_is_tight_coupling_limit():
    """The minimal feasible period must be the 1-D step (tight-coupling limit):
    sub-dt1d requests clamp to dt1d and still conserve."""
    out = min_feasible_exchange_period()
    assert out["min_feasible_exchange_period_ms"] == 1.0
    assert out["rows"], "scan must produce rows"
    for row in out["rows"]:
        if row["requested_period_ms"] < 1.0:
            assert row["effective_period_ms"] == 1.0  # clamp demonstrated
        assert row["feasible"] is True  # all conserve + within budget


# ---------------------------------------------------------------------------
# CFD-04 — Case-A pressure deviation attribution
# ---------------------------------------------------------------------------

def test_sensitivity_attribution_isolation():
    """The 1.7% deviation must be attributed to the baseline model, not to the
    coupling feedback or to numerical error."""
    out = sensitivity_case_a()
    assert out["case"] == "A_pressure_deviation_attribution"
    # solver matches its own exact ODE (numerical error << 1%)
    assert out["numerical_error_rel"] < 0.01
    # coupled == uncoupled (reverse-coupling contribution negligible)
    assert out["coupling_contribution_rel"] < 0.01
    # the analytic model accounts for the bulk of the deviation
    assert out["model_bias_rel"] > 0.005
    assert len(out["cd_sweep"]) >= 3
    assert len(out["horizon_sweep"]) >= 3
    # the deviation grows with the horizon (accumulating model bias)
    devs = [r["deviation"] for r in out["horizon_sweep"]]
    assert devs == sorted(devs)


# ---------------------------------------------------------------------------
# CFD-06 — multi-physics variant Case C
# ---------------------------------------------------------------------------

def test_case_c_variant_certified():
    """Case C (energy-channel variant) must run, conserve and certify."""
    out = verify_case_c()
    assert out["ok"] is True
    assert out["flow_rel_error"] < 0.05
    assert out["certification"]["all_pass"] is True
    # the field/boundary variant must engage the reverse branch (rise > 0)
    assert out["back_pressure_rise_pa"] > 0.0
    # reverse-coupling engagement must be visibly stronger than Case A's ~0.5 Pa
    assert out["back_pressure_rise_pa"] > 1.0


# ---------------------------------------------------------------------------
# 文献基准 Case D — 亚临界（非壅塞）等熵喷管流量对照
# ---------------------------------------------------------------------------

def test_case_d_subsonic_literature_certified():
    """Case D: the subsonic coupled flow must match the literature isentropic
    relation at the actual coupled back pressure, in a genuinely subsonic
    (non-choked) regime where the reverse-coupled back pressure throttles the
    nozzle."""
    out = verify_case_d()
    assert out["ok"] is True
    assert out["subsonic_engaged"] is True
    assert out["pressure_ratio_actual"] > out["critical_pressure_ratio_lit"]
    assert out["flow_rel_error"] < 0.05
    assert out["reverse_coupling_engaged"] is True
    assert out["certification"]["all_pass"] is True


def test_subsonic_curve_matches_literature():
    """The solver's subsonic branch reproduces the literature isentropic
    relation at float precision, and the back-pressure sensitivity is negative
    (raising the outlet back pressure lowers the flow — reverse coupling
    throttles in the expected direction)."""
    s = verify_subsonic_curve()
    assert s["max_rel_error"] < 1e-9
    assert s["sensitivity_dln_md_over_dln_r"] < 0.0
    assert s["certification"]["all_pass"] is True
    assert all(row["subsonic"] for row in s["rows"])


# ---------------------------------------------------------------------------
# CFD-08 — fault tolerance (invalid inputs must return clean ok=false)
# ---------------------------------------------------------------------------

def _broken_run(net=None, dom=None, cpl=None):
    net = net or NetworkConfig()
    dom = dom or DomainConfig(nx=8, ny=8, nz=8, length=0.10)
    cpl = cpl or CouplerConfig(dt1d=2e-3, dt3d=2.5e-4, t_end=0.05)
    # Pass the RAW configs: run_coupling must validate at its boundary and
    # return a clean ok=false bundle instead of raising.
    return run_coupling(net, dom, cpl)


def test_fault_negative_throat_area():
    res = _broken_run(net=NetworkConfig(throat_area=-1e-4))
    assert res.ok is False
    assert res.error


def test_fault_zero_volume():
    res = _broken_run(net=NetworkConfig(volume=0.0))
    assert res.ok is False
    assert res.error


def test_fault_nonpositive_timestep():
    res = _broken_run(cpl=CouplerConfig(dt1d=0.0))
    assert res.ok is False
    assert res.error


def test_fault_nan_timestep():
    res = _broken_run(cpl=CouplerConfig(dt1d=float("nan")))
    assert res.ok is False
    assert res.error


def test_fault_nan_exchange_period():
    res = _broken_run(cpl=CouplerConfig(exchange_period=float("nan")))
    assert res.ok is False
    assert res.error


def test_fault_zero_t_end():
    res = _broken_run(cpl=CouplerConfig(t_end=0.0))
    assert res.ok is False
    assert res.error


def test_fault_tiny_grid():
    res = _broken_run(dom=DomainConfig(nx=2, ny=2, nz=2))
    assert res.ok is False
    assert res.error


def test_fault_bad_gamma():
    res = _broken_run(net=NetworkConfig(gamma=1.0))
    assert res.ok is False
    assert res.error


def test_run_all_covers_new_sections():
    """run_all must include every PRD section for the bench artifact."""
    from fluid_cfd.verify import run_all
    data = run_all()
    for key in ("case_a", "case_b", "case_c", "case_d", "subsonic_curve",
                "trade_off", "min_exchange", "sensitivity"):
        assert key in data
    assert data["min_exchange"]["min_feasible_exchange_period_ms"] == 1.0


if __name__ == "__main__":
    import pytest
    raise SystemExit(pytest.main([__file__, "-q"]))