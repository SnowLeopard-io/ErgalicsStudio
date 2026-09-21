"""em_cfd — 1D pipe-network / 3D-field bidirectional coupling prototype.

Competition deliverable (AI CFD track): implements the multi-rate
time-step coordination and bidirectional boundary coupling between a
coarse-time 1-D pipe/nozzle network and a fine-time 3-D field solver,
with a millisecond-scale control-logic interface, conservation auditing,
and performance metrics (exchange latency, minimal feasible period,
sync error, precision-vs-efficiency trade-off).
"""

from __future__ import annotations

__version__ = "0.1.0"

from .analytic import (  # noqa: F401
    blowdown_pressure,
    interface_tradeoff_curve,
    nozzle_choked_flow,
    thermally_relaxed_back_pressure,
)
from .coupler import (  # noqa: F401
    CouplerConfig,
    CouplingResult,
    CouplingWindowRecord,
    run_coupling,
)
from .domain_3d import (  # noqa: F401
    DomainConfig,
    DomainState,
    compute_back_pressure,
    make_initial,
    step_domain_3d,
)
from .network_1d import (  # noqa: F401
    NetworkConfig,
    NetworkState,
    isentropic_nozzle,
    step_network,
    valve_opening,
)
from .verify import run_all, trade_off, verify_case_a, verify_case_b  # noqa: F401

__all__ = [
    "NetworkConfig",
    "NetworkState",
    "DomainConfig",
    "DomainState",
    "CouplerConfig",
    "CouplingResult",
    "CouplingWindowRecord",
    "run_coupling",
    "run_all",
    "verify_case_a",
    "verify_case_b",
    "trade_off",
    "nozzle_choked_flow",
    "blowdown_pressure",
    "thermally_relaxed_back_pressure",
    "interface_tradeoff_curve",
]