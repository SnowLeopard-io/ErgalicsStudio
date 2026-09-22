import sys, os
dirp = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(dirp, "python"))
import numpy as np
from reactmd.driver import simulate

atoms = [{"symbol":"Cu","x":0,"y":0,"z":0},{"symbol":"O","x":1.85,"y":0,"z":0},
         {"symbol":"H","x":3.5,"y":0,"z":0},{"symbol":"H","x":4.24,"y":0,"z":0}]
target = [{"x":6,"y":0,"z":0},{"x":8,"y":0,"z":0},{"x":8.96,"y":0,"z":0},{"x":7.76,"y":0.93,"z":0}]
bonds = [{"a":0,"b":1,"kind":"break","order":1,"ea":409,"r0":1.85},
         {"a":2,"b":3,"kind":"break","order":1,"ea":436,"r0":0.74},
         {"a":1,"b":2,"kind":"form","order":1,"ea":463,"r0":0.96},
         {"a":1,"b":3,"kind":"form","order":1,"ea":463,"r0":0.96}]
def run(T, steps=1400, seed=11):
    p={"atoms":atoms,"target":target,"bonds":bonds,"mass":[63.55,16,1.008,1.008],
       "radius":[1.32,0.66,0.31,0.31],"temperature":T,"seed":seed,"steps":steps,"frames":300}
    r=simulate(p); arr=np.array(r["positions"])
    print(f"T={T} seed={seed} broken={sum(r['break_counts'])} form_flags={r['form_flags']} form_events={r['form_events']}")
    f=arr[-1]
    print("  O",np.round(f[1],2)," H2",np.round(f[2],2)," H3",np.round(f[3],2))
    print("  d(O,H2)",round(float(np.linalg.norm(f[2]-f[1])),2)," d(O,H3)",round(float(np.linalg.norm(f[3]-f[1])),2))
for seed in (11,23,7):
    run(1200, seed=seed)