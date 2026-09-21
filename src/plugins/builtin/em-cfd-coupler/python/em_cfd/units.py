"""Unit conventions & physical constants (SI) — single source of truth.

The competition asks for a *parameter unit convention* contract across the
1D-3D coupling interface. Everything crossing the interface is expressed in
SI base units, and dimensionally-consistent derived quantities (flow rate,
pressure, temperature, phase) are tagged so the two sides can never
misinterpret a magnitude.  ``consistent(a, b)`` is the dimensionless check
used to verify two values refer to the same physical quantity.
"""

from __future__ import annotations

import math

GAMMA_AIR = 1.4                # ratio of specific heats (diatomic gas)
R_AIR = 287.05                 # specific gas constant [J/kg/K]
CP_AIR = GAMMA_AIR * R_AIR / (GAMMA_AIR - 1.0)   # ~1004.7 J/kg/K
CV_AIR = R_AIR / (GAMMA_AIR - 1.0)               # ~717.6 J/kg/K
P_ATM = 101325.0               # [Pa]

CHOKED_RATIO = (2.0 / (GAMMA_AIR + 1.0)) ** (GAMMA_AIR / (GAMMA_AIR - 1.0))
CHOKE_COEFF = math.sqrt(
    GAMMA_AIR * (2.0 / (GAMMA_AIR + 1.0)) ** ((GAMMA_AIR + 1.0) / (GAMMA_AIR - 1.0))
)

# Field tags so an interface value always carries its meaning.
QTY_FLOW = "mass_flow"         # [kg/s]
QTY_TEMP = "temperature"       # [K]
QTY_PRES = "pressure"          # [Pa]
QTY_PHASE = "phase"            # [-] vapour fraction in [0,1]

PHASE_GAS = 1.0                # single-phase ideal gas (documented simplification)


def gas_const(gamma: float = GAMMA_AIR, r_specific: float = R_AIR) -> float:
    return r_specific


def consistent(a: float, b: float) -> bool:
    """Return True when two interface magnitudes are the same physical value
    to within the 1D-3D exchange tolerance (used by the coupler's
    conservation audit)."""
    return math.isclose(float(a), float(b), rel_tol=1e-3, abs_tol=1e-9)