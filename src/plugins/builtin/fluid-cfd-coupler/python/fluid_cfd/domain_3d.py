"""3-D incompressible Navier-Stokes solver — the *local fine/full* side of the
1D-3D coupling (upgraded from a passive scalar transport field).

The domain is a Cartesian box of ``nx × ny × nz`` cells.  A fractional-step
(projection) method advances a **velocity field** ``(u, v, w)`` and the
pressure ``p``; a scalar temperature field ``T`` (the sensible-enthalpy proxy
that scales with local heat content) is advected by the *actual* velocity field
and diffused, with an inlet injection supplied by the 1D nozzle.  Boussinesq
buoyancy (temperature difference) drives vertical motion, so a hot 1D discharge
produces a genuine thermal plume — a real flow, not a filled scalar proxy.
Averages over the outlet face plus the outlet velocity/temperature define the
**back pressure** returned to the 1D side, which throttles the nozzle — the
reverse-coupling branch.

Numerics (pure NumPy, Pyodide-friendly, no scipy):
  * fractional-step projection (Chorin):
        predictor:  u* = u^n - dt[(u·grad)u] + dt·nu·lap(u)  (+ buoyancy)
        projection: lap(p) = rho/dt · div(u*)   (red-black SOR, 6-pt Laplacian)
                    u^{n+1} = u* - dt/rho·grad(p)
  * cell-centre layout for (u,v,w,p,T); the projection enforces a divergence-free
    velocity, which is exactly the continuity constraint of incompressible flow.
  * explicit convection with 1st-order upwind face fluxes (bounded, monotone,
    Pyodide-fast), explicit diffusion with the stability limit clamped.
  * adaptive sub-cycling inside each coupling step: ``dt3d`` is split into as
    many inner steps as needed to respect the CFL limit, so a fast nozzle
    discharge never blows the explicit scheme up.  This inner sub-cycling is
    itself a finer layer of the multi-rate time coordination.
  * boundaries: no-slip walls on y/z faces, inlet patch (velocity + temperature
    Dirichlet) on the x0 face, zero-gradient outflow on the x1 face.  The
    pressure Poisson uses zero-gradient (Neumann) walls (ghost == boundary via
    edge padding) and a zero-mean gauge.

Time model: the 3-D side steps *finer* in time (``dt3d``) than the 1-D side
(``dt1d``); the coupler runs many 3-D sub-steps per exchange window.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np

from .units import QTY_PRES, R_AIR

_EPS = 1e-12


def _flat_field(a: np.ndarray | None) -> list:
    """Flatten a 3-D array into the renderer's z-major layout.

    NumPy's ``.tolist()`` is x-major (outer axis = x), but the front-end
    ``render3d.fieldIndex`` walks z-major (``iz*ny*nx + iy*nx + ix``).  Emitting
    the field here in z-major means the renderer indexes straight into the flat
    list with no transpose on the JS side, keeping the browser and CLI byte-
    identical.  Empty arrays flatten to ``[]`` (JSON-safe).
    """
    if a is None or a.size == 0:
        return []
    return np.ascontiguousarray(a.transpose(2, 1, 0)).ravel().tolist()


@dataclass
class DomainConfig:
    """3-D Cartesian box knobs (all SI)."""

    nx: int = 12
    ny: int = 12
    nz: int = 12
    length: float = 0.15        # [m] box edge length
    diffusivity: float = 1.0e-4   # [m^2/s] thermal diffusivity
    viscosity: float = 1.0e-3     # [m^2/s] kinematic viscosity (demo-stable)
    rho_ref: float = 1.2          # [kg/m^3] reference density (Boussinesq)
    gravity: float = 9.81         # [m/s^2] z-axis gravity (0 disables buoyancy)
    t_ref: float = 300.0          # [K] Boussinesq reference temperature
    advection: float = 0.05       # [m/s] background x velocity (initial seed)
    inlet_frac: float = 0.5       # inlet patch width as a fraction of the face
    outlet_face: str = "x1"       # face whose average defines back pressure
    initial: float = 1e5          # [Pa] base (ambient) pressure for back pressure
    back_pressure_coeff: float = 0.5  # outlet throttle/recovery coefficient
    sor_iters: int = 20           # red-black SOR iterations per Poisson solve
    sor_omega: float = 1.55       # SOR relaxation factor
    max_cfl: float = 0.5          # inner sub-step CFL limit
    max_u_inlet: float = 3.0      # [m/s] clamp on the inlet velocity (stability)

    def normalized(self) -> "DomainConfig":
        if min(self.nx, self.ny, self.nz) < 4:
            raise ValueError("3D grid must be at least 4 per axis")
        if self.length <= 0 or self.length > 10:
            raise ValueError("invalid box length")
        if self.viscosity <= 0:
            raise ValueError("viscosity must be > 0")
        if self.rho_ref <= 0:
            raise ValueError("rho_ref must be > 0")
        return self

    @property
    def n(self) -> int:
        return self.nx * self.ny * self.nz

    @property
    def volume(self) -> float:
        return self.length ** 3


@dataclass
class DomainState:
    """Instantaneous 3-D flow state + outlet back pressure (interface out)."""

    t: float = 0.0
    field: np.ndarray | None = None     # [nx,ny,nz] temperature field (heat proxy)
    u: np.ndarray | None = None         # [nx,ny,nz] x-velocity
    v: np.ndarray | None = None         # [nx,ny,nz] y-velocity
    w: np.ndarray | None = None         # [nx,ny,nz] z-velocity
    p: np.ndarray | None = None         # [nx,ny,nz] pressure gauge (zero-mean)
    back_pressure: float = 1e5          # [Pa] outlet-averaged pressure
    inlet_md: float = 0.0               # [kg/s] last injected mass flow
    inlet_temp: float = 320.0           # [K] last injected temperature
    steps: int = 0

    @property
    def n_cells(self) -> int:
        return 0 if self.field is None else int(self.field.size)

    def to_dict(self) -> dict:
        f = self.field
        d = {
            "t": float(self.t),
            "back_pressure": float(self.back_pressure),
            "inlet_md": float(self.inlet_md),
            "inlet_temp": float(self.inlet_temp),
            "steps": int(self.steps),
        }
        if isinstance(f, np.ndarray) and f.size:
            d["field"] = _flat_field(f)          # z-major flat (renderer layout)
            d["field_min"] = float(f.min())
            d["field_max"] = float(f.max())
            d["field_mean"] = float(f.mean())
            d["speed"] = _flat_field(self._speed_array())   # z-major flat
            d["speed_max"] = float(np.max(self._speed_array()))
        # raw velocity/pressure arrays stay on the Python state (the front end
        # only consumes field + speed to avoid a huge JSON payload, but the
        # full fields remain available to `sample_snapshot` for animation).
        d["_tags"] = {"back_pressure": QTY_PRES}
        return d

    def _speed_array(self) -> np.ndarray:
        if self.u is None or self.v is None or self.w is None:
            return np.zeros((self.n_cells,), dtype=np.float64)
        return np.sqrt(self.u ** 2 + self.v ** 2 + self.w ** 2)

    def speed(self) -> np.ndarray:
        if self.u is None or self.v is None or self.w is None:
            return np.zeros((0,), dtype=np.float64)
        return np.sqrt(self.u ** 2 + self.v ** 2 + self.w ** 2)


def make_initial(cfg: DomainConfig) -> DomainState:
    st = DomainState()
    st.field = np.full((cfg.nx, cfg.ny, cfg.nz), cfg.t_ref, dtype=np.float64)
    st.u = np.full((cfg.nx, cfg.ny, cfg.nz), cfg.advection, dtype=np.float64)
    st.v = np.zeros((cfg.nx, cfg.ny, cfg.nz), dtype=np.float64)
    st.w = np.zeros((cfg.nx, cfg.ny, cfg.nz), dtype=np.float64)
    st.p = np.zeros((cfg.nx, cfg.ny, cfg.nz), dtype=np.float64)
    st.back_pressure = cfg.initial
    st.inlet_md = 0.0
    st.inlet_temp = cfg.t_ref
    return st


# ---------------------------------------------------------------------------
# Finite-difference helpers (pure NumPy, axis-aware, shape-safe)
# ---------------------------------------------------------------------------

def _grad(p, dx):
    """Central gradient of a cell-centred field -> vector (gx, gy, gz).

    Zero-gradient (Neumann) on every face, so the correction never pushes
    velocity through a wall (the physical BCs are re-applied afterwards).
    """
    gx = np.zeros_like(p)
    gy = np.zeros_like(p)
    gz = np.zeros_like(p)
    gx[1:-1, :, :] = (p[2:, :, :] - p[:-2, :, :]) / (2 * dx)
    gy[:, 1:-1, :] = (p[:, 2:, :] - p[:, :-2, :]) / (2 * dx)
    gz[:, :, 1:-1] = (p[:, :, 2:] - p[:, :, :-2]) / (2 * dx)
    return gx, gy, gz


def _div(u, v, w, dx):
    """Cell-centred divergence (one-sided at the faces)."""
    d = np.zeros_like(u)
    # x
    d[1:-1, :, :] = (u[2:, :, :] - u[:-2, :, :]) / (2 * dx)
    d[0, :, :] = (u[1, :, :] - u[0, :, :]) / dx
    d[-1, :, :] = (u[-1, :, :] - u[-2, :, :]) / dx
    # y
    d[:, 1:-1, :] += (v[:, 2:, :] - v[:, :-2, :]) / (2 * dx)
    d[:, 0, :] += (v[:, 1, :] - v[:, 0, :]) / dx
    d[:, -1, :] += (v[:, -1, :] - v[:, -2, :]) / dx
    # z
    d[:, :, 1:-1] += (w[:, :, 2:] - w[:, :, :-2]) / (2 * dx)
    d[:, :, 0] += (w[:, :, 1] - w[:, :, 0]) / dx
    d[:, :, -1] += (w[:, :, -1] - w[:, :, -2]) / dx
    return d


def _upwind_face_flux(q, u):
    """First-order upwind face flux ``F = u^+ q_left + u^- q_right`` per axis.

    Returns three face-flux arrays aligned with the cell grid:
      * Fx[i] = flux on the x-face between cell i-1 and i  (shape (nx, ...))
      * Fy[j] / Fz[k] analogous.
    Face velocity is the average of the two neighbouring cell velocities, and
    the first slot of each axis stays zero (no convective flux through a wall
    face — inlet injection is imposed by the Dirichlet BC afterwards).
    """
    ux = 0.5 * (u[:-1, :, :] + u[1:, :, :])   # nx-1 internal x-faces
    fx = np.zeros_like(q)
    fx[1:, :, :] = (np.maximum(ux, 0.0) * q[:-1, :, :]
                    + np.minimum(ux, 0.0) * q[1:, :, :])
    vy = 0.5 * (u[:, :-1, :] + u[:, 1:, :])   # ny-1 internal y-faces
    fy = np.zeros_like(q)
    fy[:, 1:, :] = (np.maximum(vy, 0.0) * q[:, :-1, :]
                    + np.minimum(vy, 0.0) * q[:, 1:, :])
    wz = 0.5 * (u[:, :, :-1] + u[:, :, 1:])   # nz-1 internal z-faces
    fz = np.zeros_like(q)
    fz[:, :, 1:] = (np.maximum(wz, 0.0) * q[:, :, :-1]
                    + np.minimum(wz, 0.0) * q[:, :, 1:])
    return fx, fy, fz


def _upwind_div(q, u, v, w, dx):
    """Divergence of the upwind flux ``u·q`` (convective derivative of ``q``).

    Cell i sees (F_{i+1/2} - F_{i-1/2}) / dx; the outer wall faces carry no
    convective flux (F = 0), matching the Dirichlet/zero-gradient BCs.
    """
    fx, _, _ = _upwind_face_flux(q, u)
    _, fy, _ = _upwind_face_flux(q, v)
    _, _, fz = _upwind_face_flux(q, w)
    out = np.zeros_like(q)
    out[1:-1, :, :] = (fx[2:, :, :] - fx[1:-1, :, :]) / dx
    out[0, :, :] = (fx[1, :, :] - 0.0) / dx
    out[-1, :, :] = (0.0 - fx[-1, :, :]) / dx
    out[:, 1:-1, :] += (fy[:, 2:, :] - fy[:, 1:-1, :]) / dx
    out[:, 0, :] += (fy[:, 1, :] - 0.0) / dx
    out[:, -1, :] += (0.0 - fy[:, -1, :]) / dx
    out[:, :, 1:-1] += (fz[:, :, 2:] - fz[:, :, 1:-1]) / dx
    out[:, :, 0] += (fz[:, :, 1] - 0.0) / dx
    out[:, :, -1] += (0.0 - fz[:, :, -1]) / dx
    return out


def _laplacian(q):
    """Standard 7-point Laplacian, zero-gradient on walls (edge-padded)."""
    qp = np.pad(q, 1, mode="edge")
    return (
        qp[2:, 1:-1, 1:-1] + qp[:-2, 1:-1, 1:-1]
        + qp[1:-1, 2:, 1:-1] + qp[1:-1, :-2, 1:-1]
        + qp[1:-1, 1:-1, 2:] + qp[1:-1, 1:-1, :-2]
        - 6 * q
    )


def _solve_poisson(cfg: DomainConfig, b, p0, dx):
    """Red-black SOR for ``lap(p) = b`` with wall-normal Neumann boundaries.

    The 6-pt Laplacian uses edge padding (ghost cell == boundary cell), which
    is exactly the zero-gradient condition.  The RHS mean is removed up front
    (incompressible pressure is only defined up to a constant — pure-Neumann
    compatibility), and the sweep is a *true* red-black Gauss-Seidel: each
    parity re-computes the residual from the most recent ``p`` so the black
    update actually sees the fresh red values (a half-Jacobi variant with
    stale residuals diverges for omega > ~1.04 on a 3-D grid).  Returns a
    zero-mean pressure gauge.
    """
    p = p0.copy()
    nx, ny, nz = cfg.nx, cfg.ny, cfg.nz
    omega = cfg.sor_omega
    scale = dx * dx
    par = np.indices((nx, ny, nz)).sum(axis=0) % 2
    b = b - b.mean()  # pure-Neumann compatibility (gauge freedom)
    for _ in range(cfg.sor_iters):
        for parity in (0, 1):
            qp = np.pad(p, 1, mode="edge")
            lap = (
                qp[2:, 1:-1, 1:-1] + qp[:-2, 1:-1, 1:-1]
                + qp[1:-1, 2:, 1:-1] + qp[1:-1, :-2, 1:-1]
                + qp[1:-1, 1:-1, 2:] + qp[1:-1, 1:-1, :-2]
                - 6 * p
            )
            res = lap - b * scale
            mask = par == parity
            p = np.where(mask, p + omega / 6.0 * res, p)
    return p - p.mean()


# ---------------------------------------------------------------------------
# One projection sub-step
# ---------------------------------------------------------------------------

def _ns_substep(cfg: DomainConfig, st: DomainState, dt: float,
                u_in: float, t_in: float) -> None:
    """Advance the cell-centred velocity + temperature by one projection step.

    Mutates ``st`` in place.  ``u_in`` is the inlet normal velocity (x0 face
    patch), ``t_in`` the inlet temperature.
    """
    nx, ny, nz = cfg.nx, cfg.ny, cfg.nz
    dx = cfg.length / nx
    rho = cfg.rho_ref
    nu = cfg.viscosity
    alpha = cfg.diffusivity
    dt = max(dt, _EPS)

    u0 = st.u.copy()
    v0 = st.v.copy()
    w0 = st.w.copy()
    tc0 = st.field.copy()

    # ---- convective acceleration (cell-centred upwind) ---------------------
    # advective form u·grad(q) = div(u·q) - q·div(u): identical to the
    # conservative flux form where the projection is divergence-free, but the
    # explicit div-term subtraction keeps boundary cells from being drained by
    # the collocated-grid boundary residual (one-sided div vs Neumann Poisson).
    div0 = _div(u0, v0, w0, dx)
    du_conv = _upwind_div(u0, u0, v0, w0, dx) - u0 * div0
    dv_conv = _upwind_div(v0, u0, v0, w0, dx) - v0 * div0
    dw_conv = _upwind_div(w0, u0, v0, w0, dx) - w0 * div0

    # ---- diffusion (explicit, stability-clamped) ---------------------------
    lap_u = _laplacian(u0)
    lap_v = _laplacian(v0)
    lap_w = _laplacian(w0)
    visc = min(nu * dt / dx ** 2, 0.24)

    # ---- predictor ----------------------------------------------------------
    u = u0 - dt * du_conv + visc * lap_u
    v = v0 - dt * dv_conv + visc * lap_v
    w = w0 - dt * dw_conv + visc * lap_w

    # Boussinesq buoyancy: hot fluid rises.  F_buoy = +g·β·(T − T_ref) on w.
    if cfg.gravity > 0:
        beta = 1.0 / max(cfg.t_ref, _EPS)
        w = w + dt * (cfg.gravity * beta * (tc0 - cfg.t_ref))

    # ---- apply physical boundary conditions on the predictor ---------------
    half = max(int(max(ny, nz) * cfg.inlet_frac) // 2, 1)
    cy, cz = ny // 2, nz // 2
    ylo, yhi = max(cy - half, 0), min(cy + half, ny)
    zlo, zhi = max(cz - half, 0), min(cz + half, nz)
    # inlet (x0): Dirichlet normal velocity on the patch, zero elsewhere
    u[0, :, :] = 0.0
    u[0, ylo:yhi, zlo:zhi] = u_in
    v[0, :, :] = 0.0
    w[0, :, :] = 0.0
    # outlet (x1): zero-gradient outflow
    u[-1, :, :] = u[-2, :, :]
    v[-1, :, :] = v[-2, :, :]
    w[-1, :, :] = w[-2, :, :]
    # lateral walls: no-slip
    v[:, 0, :] = 0.0
    v[:, -1, :] = 0.0
    w[:, :, 0] = 0.0
    w[:, :, -1] = 0.0
    u[:, 0, :] = 0.0
    u[:, -1, :] = 0.0
    u[:, :, 0] = 0.0
    u[:, :, -1] = 0.0
    v[:, :, 0] = 0.0
    v[:, :, -1] = 0.0

    # ---- pressure projection (divergence-free) -----------------------------
    div = _div(u, v, w, dx)
    p_new = _solve_poisson(cfg, div * rho / dt, st.p, dx)
    gxp, gyp, gzp = _grad(p_new, dx)
    u = u - dt / rho * gxp
    v = v - dt / rho * gyp
    w = w - dt / rho * gzp

    # ---- re-apply BCs after the correction ---------------------------------
    u[0, :, :] = 0.0
    u[0, ylo:yhi, zlo:zhi] = u_in
    v[0, :, :] = 0.0
    w[0, :, :] = 0.0
    u[-1, :, :] = u[-2, :, :]
    v[-1, :, :] = v[-2, :, :]
    w[-1, :, :] = w[-2, :, :]
    v[:, 0, :] = 0.0
    v[:, -1, :] = 0.0
    w[:, :, 0] = 0.0
    w[:, :, -1] = 0.0
    u[:, 0, :] = 0.0
    u[:, -1, :] = 0.0
    u[:, :, 0] = 0.0
    u[:, :, -1] = 0.0
    v[:, :, 0] = 0.0
    v[:, :, -1] = 0.0

    # ---- temperature transport (advected by the real velocity field) --------
    # advective form again: subtract T·div(u) so the residual collocated
    # boundary divergence drains no heat from stagnant wall cells.
    conv_t = _upwind_div(tc0, u, v, w, dx) - tc0 * _div(u, v, w, dx)
    # no-slip adiabatic walls: the convective heat flux is zero at a wall, so
    # the boundary layers evolve by diffusion only (otherwise the stagnant
    # wall cells get drained by boundary-layer convection).
    conv_t[0, :, :] = 0.0
    conv_t[:, 0, :] = 0.0
    conv_t[:, -1, :] = 0.0
    conv_t[:, :, 0] = 0.0
    conv_t[:, :, -1] = 0.0
    # free outflow: upwind-frozen advection through the outlet face (the flow
    # carries heat out of the domain; a zero outlet flux would bank it up).
    u_out = np.maximum(u[-1, :, :], 0.0)
    conv_t[-1, :, :] = u_out * (tc0[-1, :, :] - tc0[-2, :, :]) / dx
    visc_t = min(alpha * dt / dx ** 2, 0.24)
    T = tc0 - dt * conv_t + visc_t * _laplacian(tc0)
    # inlet Dirichlet: injected fluid sets the temperature on the patch
    T[0, ylo:yhi, zlo:zhi] = t_in
    T = np.clip(T, 1.0, None)

    st.u = u
    st.v = v
    st.w = w
    st.p = p_new
    st.field = T
    st.t += dt
    st.steps += 1


def step_domain_3d(
    cfg: DomainConfig,
    st: DomainState,
    dt3d: float,
    inlet_md: float,
    inlet_temp: float,
) -> DomainState:
    """Advance the 3-D flow one coupling step: adaptive inner CFL sub-cycling
    with one projection solve per inner step.  The 1D nozzle's mass flow is
    injected as an inlet velocity + temperature Dirichlet condition."""
    nx, ny, nz = cfg.nx, cfg.ny, cfg.nz
    dx = cfg.length / nx
    rho = cfg.rho_ref
    half = max(int(max(ny, nz) * cfg.inlet_frac) // 2, 1)
    ny_p, nz_p = min(2 * half, ny), min(2 * half, nz)
    a_patch = max(float(ny_p * nz_p) * dx * dx, _EPS)
    u_in = min(inlet_md / max(rho * a_patch, _EPS), cfg.max_u_inlet)
    if inlet_md > 0:
        st.inlet_md = inlet_md
        st.inlet_temp = inlet_temp

    # adaptive sub-cycling to satisfy the CFL bound
    u_max = max(float(np.max(np.abs(st.u))) if st.u is not None else 0.0,
                float(np.max(np.abs(st.v))) if st.v is not None else 0.0,
                float(np.max(np.abs(st.w))) if st.w is not None else 0.0,
                abs(u_in), 1e-9)
    n_sub = max(int(np.ceil(u_max * max(dt3d, _EPS) / (cfg.max_cfl * dx))), 1)
    dt_in = max(dt3d, _EPS) / n_sub
    for _ in range(n_sub):
        _ns_substep(cfg, st, dt_in, u_in, inlet_temp)
    return st


def compute_back_pressure(cfg: DomainConfig, st: DomainState,
                          ambient: float = 1e5) -> float:
    """Outlet-averaged pressure returned to the 1D side (reverse coupling).

    The 3-D pressure gauge is zero-mean by construction (incompressible gauge
    freedom), so it cannot carry the *uniform* chamber pressurisation that the
    1-D nozzle actually feels — the back pressure is built from the resolved
    flow state instead:
      * jet stagnation ``0.5 rho u_in^2`` — the discharge's own dynamic head,
        which scales with the 1-D mass flow (the engine of the reverse branch);
      * thermal term ``rho R (T_out-T_ref)`` — ideal-gas isochoric
        pressurisation (a heated discharge raises the chamber pressure);
      * resolved gauge — the outlet-face pressure-field excess (small on a
        coarse grid, kept as a consistency bonus).
    ``back_pressure_coeff`` bounds the total (analogous to a discharge
    coefficient) and the result never drops below ambient.
    """
    t_c = st.field
    if t_c is None:
        return ambient
    if cfg.outlet_face == "x1":
        face_t = t_c[:, :, -1]
        face_p = st.p[:, :, -1] if st.p is not None else None
    else:
        face_t = t_c[:, :, 0]
        face_p = st.p[:, :, 0] if st.p is not None else None
    rho = cfg.rho_ref
    t_out = float(face_t.mean())
    gauge = float(face_p.mean()) if face_p is not None else 0.0
    # jet stagnation from the last injected 1-D mass flow (patch area)
    dx = cfg.length / cfg.nx
    half = max(int(max(cfg.ny, cfg.nz) * cfg.inlet_frac) // 2, 1)
    ny_p, nz_p = min(2 * half, cfg.ny), min(2 * half, cfg.nz)
    a_patch = max(float(ny_p * nz_p) * dx * dx, _EPS)
    u_in = min(st.inlet_md / max(rho * a_patch, _EPS), cfg.max_u_inlet)
    dynamic = 0.5 * rho * u_in ** 2
    thermal = rho * R_AIR * (t_out - cfg.t_ref)
    coeff = max(min(cfg.back_pressure_coeff, 1.0), 0.0)
    p = ambient + coeff * (dynamic + max(thermal, 0.0) + max(gauge, 0.0))
    p = max(p, ambient)
    st.back_pressure = float(p)
    return st.back_pressure


def sample_snapshot(cfg: DomainConfig, st: DomainState) -> dict:
    """Compact serialisable snapshot for the 3-D dynamic playback (front end).

    Returns the temperature field and the velocity-magnitude field on the cell
    lattice, with grid dims and the current sim time.
    """
    return {
        "t": round(float(st.t), 6),
        "field": _flat_field(st.field),
        "speed": _flat_field(st.speed() if st.field is not None else None),
        "nx": cfg.nx,
        "ny": cfg.ny,
        "nz": cfg.nz,
    }


__all__ = [
    "DomainConfig",
    "DomainState",
    "make_initial",
    "step_domain_3d",
    "compute_back_pressure",
    "sample_snapshot",
]
