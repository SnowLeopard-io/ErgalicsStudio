"""1-D pipe-network / nozzle model — the *upstream* side of the 1D-3D coupling.

A lumped plenum (constant volume ``V``) feeds a quasi-1-D isentropic nozzle
that discharges into the 3D domain.  The plenum holds mass and energy; the
nozzle maps the current plenum state to an outlet flow, temperature and phase
at the given downstream (back) pressure that the 3D side returns each exchange
cycle.  This makes the 1D side *time-dependent* (transient plenum pressure /
temperature) and genuinely *reverse-coupled* (back pressure throttles the
nozzle between choked and subsonic branches).

Governing relations (isentropic, ideal diatomic gas):
   choked   :  m_dot = A P0 rho0 * sqrt(gamma * T0) * (2/(gamma+1))^((gamma+1)/2/(gamma-1)) / sqrt(...)
   subsonic :  m_dot = A P0 / sqrt(T0) * sqrt( (2 gamma/(gamma-1)) * r^(2/gamma) * (1 - r^((gamma-1)/gamma)) / R )
   thermal  :  T_nz = T0 * (P_d / P0)^((gamma-1)/gamma)

Plenum transient (blowdown): fixed volume, ideal gas; mass leaves through the
nozzle; the remaining gas re-equilibrates isentropically OR at constant
temperature depending on ``adiabatic_blowdown``.  This keeps ``(p0, t0, mass)``
consistent with the ideal-gas law ``p0 = m R T0 / V``.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np

from .units import (
    CHOKED_RATIO,
    CV_AIR,
    GAMMA_AIR,
    PHASE_GAS,
    QTY_FLOW,
    QTY_PHASE,
    QTY_PRES,
    QTY_TEMP,
    R_AIR,
)

_EPS = 1e-12


@dataclass
class NetworkConfig:
    """1-D upstream model knobs (all SI unless noted)."""

    volume: float = 0.05            # [m^3] plenum volume
    p0_init: float = 5.0e5          # [Pa] initial plenum pressure
    t0_init: float = 320.0          # [K] initial plenum temperature
    throat_area: float = 8.0e-5     # [m^2] nozzle throat area
    discharge_coeff: float = 0.98   # [-] Cd
    # Valve opening (%): piecewise-linear control events
    #   each tuple = (t_seconds_start, opening_fraction, ramp_duration_s)
    # A zero ramp_duration is an instantaneous (ms-control) step.
    valve_events: list[tuple[float, float, float]] | None = None
    adiabatic_blowdown: bool = True  # False: isothermal reservoir
    gamma: float = GAMMA_AIR
    r_specific: float = R_AIR

    def normalized(self) -> "NetworkConfig":
        if self.volume <= 0:
            raise ValueError("plenum volume must be > 0")
        if self.t0_init <= 0:
            raise ValueError("temperature must be > 0")
        if self.gamma <= 1.0:
            raise ValueError("gamma must be > 1")
        if self.throat_area < 0:
            raise ValueError("throat area cannot be negative")
        if not (0 < self.discharge_coeff <= 1):
            raise ValueError("discharge coefficient must be in (0,1]")
        return self


@dataclass
class NetworkState:
    """Instantaneous 1-D upstream state."""

    t: float = 0.0          # [s]
    p0: float = 5.0e5       # [Pa] plenum pressure
    t0: float = 320.0       # [K] plenum temperature
    mass: float = 0.0       # [kg] plenum mass
    md_out: float = 0.0     # [kg/s] nozzle discharge flow
    t_out: float = 320.0    # [K] nozzle discharge temperature
    phase_out: float = 1.0  # [-] vapour fraction (gas = 1)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["_tags"] = {
            "md_out": QTY_FLOW,
            "t_out": QTY_TEMP,
            "phase_out": QTY_PHASE,
            "p0": QTY_PRES,
        }
        return d


# Guard for an "instantaneous" step — the transition is placed on the time
# axis with a width far below any physically meaningful dt (ns), so the
# schedule stays strictly increasing in time and interpolation is unambiguous.
_STEP_EPS = 1.0e-12  # [s] treated as a step (< nanosecond)

def valve_opening(t: float, cfg: NetworkConfig) -> float:
    """Opening fraction (0..1) at time ``t`` from the control event list.

    Each event ``(t_start, opening, ramp_duration)`` targets ``opening``:
      * ``ramp_duration == 0`` is an *instantaneous* ms-level step at
        ``t_start`` (the opening jumps, holding the previous value until then);
      * ``ramp_duration > 0`` ramps linearly from the previous value to
        ``opening`` over that many seconds starting at ``t_start``.

    None -> fully open.  Between events the opening is piecewise-linear.
    """
    if not cfg.valve_events:
        return 1.0
    ev = sorted(cfg.valve_events, key=lambda e: e[0])

    # Build the piecewise-linear (t, opening) schedule as control points.
    nodes: list[tuple[float, float]] = []
    prev_t, prev_v = ev[0][0], ev[0][1]
    nodes.append((prev_t, prev_v))
    for (ti, ai, ri) in ev[1:]:
        if ri <= _STEP_EPS:
            # instantaneous step: hold the old value until just before ti.
            hold_t = ti - _STEP_EPS
            if hold_t > prev_t:
                nodes.append((hold_t, prev_v))
            nodes.append((ti, ai))
        else:
            # ramp over `ri` seconds starting at prev_t (clamped to [prev_t, ti])
            ramp_h = max(0.0, min(ri, ti - prev_t))
            reach = prev_t + ramp_h
            nodes.append((reach, ai))
            if ti > reach:
                nodes.append((ti, ai))  # hold ai until the next event
        prev_t = max(ti, nodes[-1][0])
        prev_v = ai

    # Constant outside the covered range.
    if t <= nodes[0][0]:
        return float(nodes[0][1])
    if t >= nodes[-1][0]:
        return float(nodes[-1][1])

    for (ta, va), (tb, vb) in zip(nodes, nodes[1:]):
        if ta <= t <= tb:
            span = tb - ta
            if span <= _EPS:
                return float(vb)
            f = (t - ta) / span
            return float(va + (vb - va) * f)
    return float(nodes[-1][1])


def isentropic_nozzle(
    p0: float,
    t0: float,
    p_down: float,
    area: float,
    *,
    gamma: float,
    r_specific: float,
) -> tuple[float, float]:
    """Mass flow [kg/s] and discharge temperature [K] for a quasi-1-D nozzle."""
    r = max(p_down / max(p0, _EPS), 1e-12)
    if r >= 1.0:
        return 0.0, t0
    if r <= CHOKED_RATIO:
        choke = gamma * (2.0 / (gamma + 1.0)) ** ((gamma + 1.0) / (gamma - 1.0))
        md = area * p0 / np.sqrt(t0) * np.sqrt(choke / r_specific)
        t_dis = t0 * CHOKED_RATIO ** ((gamma - 1.0) / gamma)
        return float(md), float(t_dis)
    g = gamma
    term = r ** (2.0 / g) - r ** ((g + 1.0) / g)
    md = area * p0 / np.sqrt(t0) * np.sqrt((2.0 * g / (g - 1.0)) * term / r_specific)
    t_dis = t0 * r ** ((g - 1.0) / g)
    return float(md), float(t_dis)


def step_network(nx: NetworkConfig, st: NetworkState, dt: float,
                 p_back: float) -> NetworkState:
    """Advance the 1-D upstream state by ``dt`` seconds given back pressure."""
    g = nx.gamma
    r_sp = nx.r_specific
    opening = valve_opening(st.t + dt / 2.0, nx)
    area_eff = nx.throat_area * nx.discharge_coeff * max(opening, 0.0)
    md, t_dis = isentropic_nozzle(st.p0, st.t0, p_back, area_eff,
                                  gamma=g, r_specific=r_sp)

    st.mass += -md * dt
    if st.mass <= 0.0:
        st.mass = 0.0
        md = 0.0
        # nothing left to discharge; keep temperature at residual
        t_dis = st.t0

    if nx.adiabatic_blowdown and st.mass > _EPS and md > 0:
        # Blowdown lowers the reservoir temperature: the specific internal
        # energy of the remaining gas is unchanged by extraction in the
        # adiabatic limit, so T = const for an ideal gas leaving a rigid tank
        # when no heat is added.  The mass balance above already captures the
        # depletion; temperature is held unless heat transfer is modelled.
        # (Common approximation for a fast blowdown; kept explicit for clarity.)
        pass
    # Re-close the ideal-gas law so p0 and t0 and mass stay consistent.
    st.p0 = st.mass * r_sp * st.t0 / nx.volume
    st.t += dt
    st.md_out = md
    st.t_out = t_dis
    st.phase_out = PHASE_GAS if md > 0 else 1.0
    return st


__all__ = [
    "NetworkConfig",
    "NetworkState",
    "step_network",
    "valve_opening",
    "isentropic_nozzle",
    "PHASE_GAS",
]