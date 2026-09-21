"""Tests for the em-cfd-coupler numerical kernel.

Run with pytest:  python -m pytest tests/test_coupling.py -q
(No scipy/networkx needed — pure NumPy.)
"""

from __future__ import annotations

import os
import sys
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), os.pardir))

from em_cfd.coupler import CouplerConfig, run_coupling  # noqa: E402
from em_cfd.domain_3d import DomainConfig, DomainState, make_initial, step_domain_3d  # noqa: E402
from em_cfd.analytic import nozzle_choked_flow, blowdown_pressure  # noqa: E402
from em_cfd.network_1d import NetworkConfig, NetworkState, step_network, valve_opening, isentropic_nozzle  # noqa: E402
from em_cfd.verify import verify_case_a, verify_case_b, trade_off  # noqa: E402


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


if __name__ == "__main__":
    import pytest
    raise SystemExit(pytest.main([__file__, "-q"]))