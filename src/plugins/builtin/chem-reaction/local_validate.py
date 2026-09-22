"""End-to-end engine validation on a real catalog reaction (CuO + H2 -> Cu + H2O),
with proper product-geometry targets (what payload.ts will emit): products sit
side-by-side on the right, so radical recombination is unblocked.
"""
import sys, os
dirp = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(dirp, "python"))
import numpy as np
from reactmd.driver import simulate

atoms = [
    {"symbol": "Cu", "x": 0.0, "y": 0, "z": 0},   # 0
    {"symbol": "O",  "x": 1.85, "y": 0, "z": 0},  # 1
    {"symbol": "H",  "x": 3.5, "y": 0, "z": 0},   # 2
    {"symbol": "H",  "x": 4.24, "y": 0, "z": 0},  # 3
]
# product geometry on the right: Cu + H2O (O apex, two H)
target = [
    {"x": 6.00, "y": 0, "z": 0},      # Cu -> Cu
    {"x": 8.00, "y": 0, "z": 0},      # O  -> H2O O
    {"x": 8.96, "y": 0, "z": 0},      # H  -> H2O H
    {"x": 7.76, "y": 0.93, "z": 0},   # H  -> H2O H
]
bonds = [
    {"a": 0, "b": 1, "kind": "break", "order": 1, "ea": 409, "r0": 1.85},
    {"a": 2, "b": 3, "kind": "break", "order": 1, "ea": 436, "r0": 0.74},
    {"a": 1, "b": 2, "kind": "form", "order": 1, "ea": 463, "r0": 0.96},
    {"a": 1, "b": 3, "kind": "form", "order": 1, "ea": 463, "r0": 0.96},
]
payload = {
    "atoms": atoms, "target": target, "bonds": bonds,
    "mass": [63.55, 16.00, 1.008, 1.008],
    "radius": [1.32, 0.66, 0.31, 0.31],
}

for T in (250, 600, 900, 1200, 1500):
    p = dict(payload); p["temperature"] = T; p["seed"] = 11; p["steps"] = 1200; p["frames"] = 300
    r = simulate(p)
    arr = np.array(r["positions"])
    fin = bool(np.all(np.isfinite(arr)))
    print(f"T={T:>4} finite={fin} broken={sum(r['break_counts'])} formed={r['form_flags'].count(True)}/2 "
          f"prog={round(r['progress'][-1],2)}")