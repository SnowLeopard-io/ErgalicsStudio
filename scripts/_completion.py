import sys, json
sys.path.insert(0, 'src/plugins/builtin/chem-reaction/python')
import reactmd.driver as D

def dist(a, b):
    return ((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2) ** 0.5

run = [r for r in json.loads(sys.stdin.read()) if r['id'] == 'caco3-cao'][0]
base = dict(run['payload'])
base['temperature'] = 900
base['seed'] = 20260922
base['frames'] = 60

for name, over in [
    ('stock        ', {}),
    ('k120 fmax60  ', {'K_BOND':120.0,'FBMAX':60.0}),
    ('k200 fmax120 ', {'K_BOND':200.0,'FBMAX':120.0}),
    ('k200 fmax200 ', {'K_BOND':200.0,'FBMAX':200.0}),
    ('k300 fmax200 ', {'K_BOND':300.0,'FBMAX':200.0}),
]:
    for key,val in over.items():
        setattr(D, key, val)
    for steps in (5000, 12000):
        p = dict(base); p['steps'] = steps
        r = D.simulate(p)
        pos = r['positions'][-1]
        seg = [dist(pos[b['a']], pos[b['b']])/b['r0'] for b in p['bonds'] if b['kind']=='keep']
        agg = f"{min(seg):.2f}/{sum(seg)/len(seg):.2f}/{max(seg):.2f}" if seg else "n/a"
        formed = sum(1 for f in r['form_flags'] if f)
        print(f"{name} steps={steps:6d} keep(min/mean/max)={agg} formed={formed}")