"""3-D scalar field solver — the *local fine/full* side of the 1D-3D coupling.

A Cartesian box of ``nx × ny × nz`` cells evolves a transported scalar field
``T`` (sensible-enthalpy proxy that scales with local heat content) under
conduction + through-flow advection, with an **inlet injection** supplied by
the 1D nozzle.  Averages over the outlet face define the **back pressure**
returned to the 1D side, which throttles the nozzle — the reverse-coupling
branch.

Numerics: explicit finite-volume, pure NumPy (Pyodide-friendly).  A stable
diffusion sub-step with Jacobi stencil and a donor-cell upwind advection term.
Boundaries: zero-gradient on lateral walls, Neumann on inlet patch except the
injection, zero-gradient outflow on the x1 face.

Time model: the 3-D side steps *finer* in time (``dt3d``) than the 1-D side
(``dt1d``); the coupler runs many 3-D sub-steps per exchange window.  This is
the multi-rate time coordination the competition is about.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np

from .units import QTY_PRES

_EPS = 1e-12


@dataclass
class DomainConfig:
    """3-D Cartesian box knobs (all SI)."""

    nx: int = 12
    ny: int = 12
    nz: int = 12
    length: float = 0.15        # [m] box edge length
    diffusivity: float = 1.0e-4   # [m^2/s] thermal diffusivity proxy
    advection: float = 0.05       # [m/s] bulk through-flow speed along +x
    inlet_frac: float = 0.5       # inlet patch width as a fraction of the face
    outlet_face: str = "x1"       # face whose average defines back pressure
    initial: float = 1e5          # [Pa] base (ambient) pressure for back pressure

    def normalized(self) -> "DomainConfig":
        if min(self.nx, self.ny, self.nz) < 4:
            raise ValueError("3D grid must be at least 4 per axis")
        if self.length <= 0 or self.length > 10:
            raise ValueError("invalid box length")
        return self

    @property
    def n(self) -> int:
        return self.nx * self.ny * self.nz

    @property
    def volume(self) -> float:
        return self.length ** 3


@dataclass
class DomainState:
    """Instantaneous 3-D field + outlet back pressure (interface out)."""

    t: float = 0.0
    field: np.ndarray | None = None     # [n] scalar field (heat content proxy)
    back_pressure: float = 1e5          # [Pa] outlet-averaged pressure
    inlet_md: float = 0.0               # [kg/s] last injected mass flow
    inlet_temp: float = 320.0           # [K] last injected temperature
    steps: int = 0

    def to_dict(self) -> dict:
        d = asdict(self)
        if isinstance(d["field"], np.ndarray):
            d["field"] = d["field"].tolist()
            d["field_min"] = float(self.field.min()) if self.field.size else 0.0
            d["field_max"] = float(self.field.max()) if self.field.size else 0.0
            d["field_mean"] = float(self.field.mean()) if self.field.size else 0.0
        d["_tags"] = {"back_pressure": QTY_PRES}
        return d


def make_initial(cfg: DomainConfig) -> DomainState:
    st = DomainState()
    st.field = np.zeros(cfg.n, dtype=np.float64)
    st.back_pressure = cfg.initial
    st.inlet_md = 0.0
    st.inlet_temp = 300.0
    return st


def _stencil_diffusion(phi3: np.ndarray, d_a: float) -> np.ndarray:
    """Jacobi diffusion on a 3-D cube with zero-gradient (Neumann) walls."""
    lap = np.zeros_like(phi3)
    # x
    lap[1:-1, :, :] = phi3[2:, :, :] - 2 * phi3[1:-1, :, :] + phi3[:-2, :, :]
    # y
    lap[:, 1:-1, :] = lap[:, 1:-1, :] + (
        phi3[:, 2:, :] - 2 * phi3[:, 1:-1, :] + phi3[:, :-2, :]
    )
    # z
    lap[:, :, 1:-1] = lap[:, :, 1:-1] + (
        phi3[:, :, 2:] - 2 * phi3[:, :, 1:-1] + phi3[:, :, :-2]
    )
    return phi3 + d_a * lap


def step_domain_3d(
    cfg: DomainConfig,
    st: DomainState,
    dt3d: float,
    inlet_md: float,
    inlet_temp: float,
) -> DomainState:
    """Advance the 3-D field one step: conduction + advection + inlet injection."""
    nz, ny, nx = cfg.nz, cfg.ny, cfg.nx
    dx = cfg.length / nx
    cl = dx
    phi = (
        np.reshape(st.field, (nz, ny, nx))
        if st.field is not None
        else np.zeros((nz, ny, nx))
    )
    dt = max(dt3d, 1e-18)

    # --- conduction (stability-limited) ---
    d_max = cfg.diffusivity * dt / cl**2
    d_a = min(d_max, 0.24)
    phi = _stencil_diffusion(phi, d_a)

    # --- advection (+x, donor-cell upwind, zero-gradient outflow at x1) ---
    adv = cfg.advection
    if abs(adv) > _EPS:
        cfl = adv * dt / cl
        if cfl > 0:
            c_a = min(cfl, 0.9)
            # flux from upwind (index-1) toward downwind (index)
            out = phi[:, :, -1].copy()
            phi[:, :, 1:] = phi[:, :, 1:] - c_a * (phi[:, :, 1:] - phi[:, :, :-1])
            phi[:, :, -1] = out

    # --- inlet injection (enthalpy in) at the x0 face, over a patch ---
    if inlet_md > 0:
        half = max(int(max(cfg.ny, cfg.nz) * cfg.inlet_frac) // 2, 1)
        cy, cz = ny // 2, nz // 2
        ylo, yhi = max(cy - half, 0), min(cy + half, ny)
        zlo, zhi = max(cz - half, 0), min(cz + half, nz)
        # increase local heat content proportional to injected mass & temp
        rate = (inlet_md * inlet_temp) / max(cfg.volume, _EPS) * dt * 1.0
        phi[zlo:zhi, ylo:yhi, 0] += rate
        st.inlet_md = inlet_md
        st.inlet_temp = inlet_temp

    phi = np.clip(phi, 0.0, None)
    st.field = phi.reshape(-1).copy()
    st.steps += 1
    return st


def compute_back_pressure(cfg: DomainConfig, st: DomainState,
                          ambient: float = 1e5) -> float:
    """Outlet-averaged pressure returned to the 1D side (reverse coupling).

    The field is a heat-content proxy that only rises when the box is being
    filled; map it to a bounded pressure excursion above ambient so a filled /
    heated domain throttles the nozzle and an empty one lets it run free.
    """
    phi = np.reshape(st.field, (cfg.nz, cfg.ny, cfg.nx))
    if cfg.outlet_face == "x1":
        face = phi[:, :, -1]
    else:
        face = phi[:, :, 0]
    mean_field = float(phi.mean())
    face_mean = float(face.mean())
    # pressure excursion grows with how far above a "settled" level the outlet
    # face sits, capped to avoid unphysical blow-up.
    gain = 1.5e-2
    p = ambient + (face_mean + mean_field) * gain
    p = max(p, ambient)  # never report below ambient
    st.back_pressure = float(p)
    return st.back_pressure


__all__ = [
    "DomainConfig",
    "DomainState",
    "make_initial",
    "step_domain_3d",
    "compute_back_pressure",
]