"""Local (CPython) tuning harness for reactmd — H2 + Cl2 -> 2 HCl.

Verifies the physics core behaves as required before wiring into the plugin:
  * at HIGH temperature the reaction completes (both H-Cl bonds form),
  * at LOW temperature it does not (bonds stay intact),
  * positions stay finite (no NaN / explosion).
Run:  python local_tune.py
"""
import sys, os
dirp = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(dirp, "python"))
import numpy as np
from reactmd.driver import simulate

R = {"H": 0.31, "Cl": 1.02}
# H2 at x~left, Cl2 just right; react + product target sites on the right.
atoms = [
    {"symbol": "H",  "x": -4.0, "y": 0, "z": 0},
    {"symbol": "H",  "x": -3.26, "y": 0, "z": 0},
    {"symbol": "Cl", "x": -1.0, "y": 0, "z": 0},
    {"symbol": "Cl", "x": 0.99, "y": 0, "z": 0},
]
target = [
    {"x": 3.0, "y": 0,   "z": 0},   # H0 : partner Cl1
    {"x": 2.27, "y": 0,  "z": 0},   # H1 : partner Cl0
    {"x": 1.0, "y": 0,   "z": 0},   # Cl0 : partner H1
    {"x": 4.27, "y": 0,  "z": 0},   # Cl1 : partner H0
]
bonds = [
    {"a": 0, "b": 1, "kind": "break", "order": 1, "ea": 436, "r0": 0.74},
    {"a": 2, "b": 3, "kind": "break", "order": 1, "ea": 243, "r0": 1.99},
    {"a": 0, "b": 3, "kind": "form",  "order": 1, "ea": 431, "r0": 1.27},
    {"a": 1, "b": 2, "kind": "form",  "order": 1, "ea": 431, "r0": 1.27},
]

def base(temperature):
    return {
        "atoms": atoms, "target": target, "bonds": bonds,
        "mass": [1.008, 1.008, 35.45, 35.45],
        "radius": [R["H"], R["H"], R["Cl"], R["Cl"]],
        "temperature": temperature, "seed": 7,
        "steps": 1100, "frames": 300,
    }

for T in (250, 700, 1200, 1500):
    r = simulate(base(T))
    arr = np.array(r["positions"])
    fin = bool(np.all(np.isfinite(arr)))
    nform = r["form_flags"].count(True)
    done = nform == 2
    print(f"T={T:>4}  finite={fin}  broken={sum(r['break_counts'])}  formed={nform}/2  "
          f"progress_last={round(r['progress'][-1],2)}  {'DONE' if done else ''}")
print("total dist drift:", round(float(np.linalg.norm(arr[-1]-arr[0])),2))