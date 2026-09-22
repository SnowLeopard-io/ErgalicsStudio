# ==========================================================================
# reactmd — reactive molecular dynamics core (pure NumPy)
#
# A small Langevin (velocity-Verlet) molecular dynamics integrator that drives
# a reaction through *real* physics, not timelined animation:
#
#   • atoms move under bond springs, a hard-core atom-atom repulsion, and a
#     weak guide toward their product site;
#   • a Langevin thermostat injects thermal energy proportional to T, so the
#     molecule visibly vibrates harder the hotter it is;
#   • a reactant bond fractures when thermal fluctuations take it over its
#     activation barrier — an Arrhenius Poisson crossing, so the rate grows
#     steeply with temperature exactly as k = A·exp(−Eₐ/RT);
#   • a product bond snaps together when both its atoms are radicalized and
#     drift within bonding distance — bond formation is the downhill step.
#
# The physical numbers are supplied by the host engine (bond energies in
# kJ/mol, covalent radii, equilibrium bond lengths). This module is a pure
# integrator: no reaction tables live here, so the single source of truth
# stays with the TS thermo/element engine that emits the payload.
#
# Runs untouched from CPython (CLI / tests) and Pyodide (NumPy vendored).
# ==========================================================================

import json
import math
import numpy as np
from collections import deque


def run_json(payload_text: str) -> dict:
    """Entry point the JS worker calls; payload crosses as a JSON string."""
    payload = json.loads(payload_text)
    result = simulate(payload)
    return json.loads(json.dumps(result))


# ---- reduced-unit tuning constants (plain numbers, no unit plumbing) -------
DT = 0.006            # integrator time step (t-units)
GAMMA = 3.5           # heavy overdamping: smooth drift, no energy blow-up
KB_EFF = 0.005        # kT = KB_EFF * T(K): Arrhenius barrier statistics
KB_THERMO_FACT = 0.1  # visual thermostat energy = FACT × kT (calm vibration)
EA_SCALE = 0.03       # display barrier = EA_SCALE × Ea(kJ/mol)
NU0 = 8.0             # Arrhenius attempt frequency (1 / t-unit)
K_BOND = 60.0         # spring constant base (energy / Å²) per bond order
FBMAX = 12.0          # bond spring force cap (no catapulting)
LJ_CORE = 22.0        # soft core repulsion
SIGMA_FACT = 0.82     # repulsion core at SIGMA_FACT × (rA + rB)
KCENTER = 0.35        # weak "vessel" restoration toward the cluster centroid (Å·/t² per Å)
VEL_CAP = 3.0         # global per-atom speed clamp -> numerically safe
FORM_PURSUE = 6.0     # start reeling once distance < r0 × FORM_PURSUE (capture radius)
FORM_SET = 2.2        # form bond "formed" once distance < r0 × FORM_SET
CAP_ABSOLUTE = 30.0   # absolute capture ceiling (Å): spans the whole reactant cluster
K_FORM = 1.5          # approach speed (Å/t) while radical pair is outside lock radius
K_CAPTURE = 0.30      # damping blend toward "point at partner" velocity (per step)


def simulate(payload: dict):
    """Integrate one reactive trajectory and return a JSON-serializable dict."""
    if isinstance(payload, str):
        payload = json.loads(payload)

    atoms = payload["atoms"]
    n = len(atoms)
    mass = np.asarray(payload["mass"], dtype=float)
    radius = np.asarray(payload["radius"], dtype=float)
    rng = np.random.default_rng(payload.get("seed", 1234))

    pos = np.array([(a["x"], a["y"], a["z"]) for a in atoms], dtype=float)
    vel = np.zeros((n, 3), dtype=float)

    # The reaction is integrated in a *centred* frame: every step we cancel the
    # bulk (geometric-average) velocity and re-anchor the cluster's geometric
    # centre to where it started, so a Langevin impulse or an asymmetric capture
    # can never send the whole assembly wandering (the "smooth rightward slide"
    # artifact). Fragments are still free to separate outward from a fixed point
    # and recoil symmetrically — a genuinely free reaction, seen without drift.
    center0 = pos.mean(axis=0)

    bonds = []
    for b in payload.get("bonds", []):
        k = b.get("kind", "keep")            # keep | break | form
        order = int(b.get("order", 1))
        ea = float(b.get("ea", 100.0))        # kJ/mol (host-engine value)
        r0 = float(b.get("r0", 1.5))
        bonds.append({
            "a": int(b["a"]), "b": int(b["b"]),
            "kind": k,
            "order": order,
            "r0": r0,
            "k": K_BOND * order,
            "ea_eff": EA_SCALE * ea,
            "alive": k in ("keep", "break"),  # keep/break start as springs
            "broken": False,
            "pursue": False,
            "formed": False,
        })

    # atoms involved in any reactant bond (keep/break) start bound; a monatomic
    # reactant with no bond of its own (e.g. a metallic Zn) is already a free
    # centre, so its form bonds can actually trigger.
    has_react_bond = np.zeros(n, dtype=bool)
    for b in bonds:
        if b["kind"] in ("keep", "break"):
            has_react_bond[b["a"]] = has_react_bond[b["b"]] = True
    free = ~has_react_bond
    n_form = sum(1 for b in bonds if b["kind"] == "form")

    temperature = float(payload.get("temperature", 800.0))
    steps = int(payload.get("steps", int(payload.get("phyTime", 6.0) / DT)))
    frames = int(payload.get("frames", 300))

    rng_break = np.random.random(len(bonds))
    rng_noise_step = 0.0

    # ---- force evaluation --------------------------------------------------
    def forces():
        acc = np.zeros((n, 3), dtype=float)
        inv = 1.0 / mass
        # bond forces (keep / not-yet-broken break / formed springs; pursuing = gentle reel)
        for b in bonds:
            a, d = b["a"], b["b"]
            dvecb = pos[d] - pos[a]
            rb = math_len(dvecb)
            if rb < 1e-6:
                continue
            u = dvecb / rb
            if b["formed"] or b["alive"]:
                f = b["k"] * (rb - b["r0"]) * u
                f = np.clip(f, -FBMAX, FBMAX)
                acc[a] += f * inv[a]
                acc[d] -= f * inv[d]
            elif b["pursue"]:
                # capture is applied as a velocity-level symmetric pull in the
                # integrator (see below); no force contribution here.
                pass
        # hard-core atom-atom repulsion (keeps nuclei from collapsing)
        for i in range(n):
            for j in range(i + 1, n):
                dvec = pos[j] - pos[i]
                r = math_len(dvec)
                if r < 1e-6:
                    continue
                sig = SIGMA_FACT * (radius[i] + radius[j])
                if r >= sig:
                    continue
                u = dvec / r
                f = LJ_CORE * (1 - r / sig) * u
                mi, mj = inv[i], inv[j]
                acc[i] -= f * mi
                acc[j] += f * mj
        # weak vessel restoration toward the cluster centre (uniform, not per-atom steer)
        acc += KCENTER * (center0 - pos) * inv[:, None]
        return acc

    def math_len(v):
        return float(np.sqrt(float(np.dot(v, v))))

    # ---- reaction-bookkeeping events --------------------------------------
    break_events = []
    form_events = []
    progress_out = []

    # kT drives the Arrhenius barrier; the visual thermostat is calmer
    kT = KB_EFF * temperature
    kT_thermo = KB_EFF * temperature * KB_THERMO_FACT
    noise_std = np.sqrt(2.0 * GAMMA * kT_thermo / mass)

    # ---- main integration loop --------------------------------------------
    pos_traj = deque()
    sample_every = max(1, steps // frames)
    for step in range(steps):
        # 1) Arrhenius bond fracture
        for idx, b in enumerate(bonds):
            if b["kind"] != "break" or not b["alive"]:
                continue
            rate = NU0 * math.exp(-b["ea_eff"] / kT)
            p_break = 1.0 - math.exp(-rate * DT)
            if rng.random() < p_break:
                # fracture: release the spring; separation follows steering/drift
                a, d = b["a"], b["b"]
                b["alive"] = False
                b["broken"] = True
                free[a] = free[d] = True
                break_events.append({"a": a, "b": d, "t": step})

        # 2) product-bond formation (downhill, radical recombination)
        for b in bonds:
            if b["kind"] != "form" or b["formed"]:
                continue
            a, d = b["a"], b["b"]
            if not (free[a] and free[d]):
                continue
            # both radicals free: reel when near, lock at bond length. The capture
            # radius is a hard Å ceiling so pairs spread across the compact cluster
            # still find each other, while the pair pulls symmetrically (no drift).
            dist = math_len(pos[d] - pos[a])
            if dist < b["r0"] * FORM_SET:
                b["formed"] = True
                b["pursue"] = False
                form_events.append({"a": a, "b": d, "t": step})
            elif dist < max(b["r0"] * FORM_PURSUE, CAP_ABSOLUTE):
                b["pursue"] = True

        # 3) velocity-Verlet + Langevin thermostat
        acc = forces()
        vel += 0.5 * acc * DT
        # friction + thermal noise (Ornstein-Uhlenbeck form)
        vel *= (1.0 - GAMMA * DT)
        vel += noise_std[:, None] * rng.normal(size=(n, 3))
        # symmetric capture: pursuing radical pairs are blended toward each
        # other at velocity level so thermal noise cannot shake them apart.
        # equal-and-opposite per pair  ->  zero net translation of the cluster.
        for b in bonds:
            if b["kind"] != "form" or not b["pursue"] or b["formed"]:
                continue
            a, d = b["a"], b["b"]
            if not (free[a] and free[d]):
                continue
            dv = pos[d] - pos[a]
            dl = math_len(dv)
            if dl < 1e-6:
                continue
            uu = dv / dl
            # weaken the pull once inside lock radius so bonding settles smoothly
            approach = K_FORM if dl > b["r0"] * FORM_SET else 0.0
            # steer each radical's velocity to point at the other (damping blend,
            # equal-and-opposite => no net cluster translation), stopping at the
            # lock radius where the real bond spring takes over.
            va = vel[a].dot(uu)
            vd = vel[d].dot(uu)
            vel[a] += uu * ((approach - va) * K_CAPTURE)
            vel[d] += uu * ((-approach - vd) * K_CAPTURE)
            if approach <= 0:
                pass
        pos += vel * DT
        acc = forces()
        vel += 0.5 * acc * DT
        # global per-atom speed clamp -> no numerical blow-up
        sp = np.linalg.norm(vel, axis=1)
        too_fast = sp > VEL_CAP
        if np.any(too_fast):
            vel[too_fast] *= VEL_CAP / sp[too_fast, None]

        # centred frame: cancel the bulk (geometric-average) velocity and pin
        # the cluster's geometric centre to the origin. This is what keeps the
        # reaction evolving in place — no net translation — while fragments are
        # free to separate outward with symmetric recoil.
        vel -= vel.mean(axis=0)
        pos += center0 - pos.mean(axis=0)

        if step % sample_every == 0:
            pos_traj.append(pos.copy())
            formed = sum(1 for b in bonds if b["formed"])
            progress_out.append(float(formed / max(1, n_form)))

    pos_traj.append(pos.copy())
    progress_out.append(float(sum(1 for b in bonds if b["formed"]) / max(1, n_form)))

    arr = np.stack(pos_traj, axis=0) if pos_traj else np.zeros((1, n, 3))

    return {
        "ok": True,
        "n_atoms": n,
        "n_frames": int(arr.shape[0]),
        "temperatures": temperature,
        "positions": arr.tolist(),
        "progress": progress_out,
        "break_events": break_events,
        "form_events": form_events,
        "break_counts": [b["broken"] for b in bonds],
        "form_flags": [b["formed"] for b in bonds],
    }