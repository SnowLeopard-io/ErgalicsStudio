import sys, os
dirp = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(dirp, "python"))
import numpy as np
from reactmd.driver import simulate

R = {"H": 0.31, "Cl": 1.02}
atoms = [{"symbol": "H","x":-4.0,"y":0,"z":0},{"symbol": "H","x":-3.26,"y":0,"z":0},
         {"symbol": "Cl","x":-1.0,"y":0,"z":0},{"symbol": "Cl","x":0.99,"y":0,"z":0}]
target = [{"x":3.0,"y":0,"z":0},{"x":2.27,"y":0,"z":0},{"x":1.0,"y":0,"z":0},{"x":4.27,"y":0,"z":0}]
bonds = [{"a":0,"b":1,"kind":"break","order":1,"ea":436,"r0":0.74},
         {"a":2,"b":3,"kind":"break","order":1,"ea":243,"r0":1.99},
         {"a":0,"b":3,"kind":"form","order":1,"ea":431,"r0":1.27},
         {"a":1,"b":2,"kind":"form","order":1,"ea":431,"r0":1.27}]
payload = {"atoms":atoms,"target":target,"bonds":bonds,
           "mass":[1.008,1.008,35.45,35.45],"radius":[0.31,0.31,1.02,1.02],
           "temperature":1200,"seed":7,"steps":1100,"frames":11}
r = simulate(payload)
arr = np.array(r["positions"])
print("x-trace (frames 0..10):")
hdr = "frame " + "".join(f"{'a%d'%i:>8}" for i in range(4))
print(hdr)
for fi in range(arr.shape[0]):
    xs = "".join(f"{arr[fi,i,0]:8.2f}" for i in range(4))
    print(f"{fi:>5} {xs}")
print("form_events", r["form_events"])