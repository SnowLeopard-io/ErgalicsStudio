import json,sys
sys.path.insert(0,'src/plugins/builtin/chem-reaction/python')
from reactmd.driver import simulate
runs=json.loads(sys.stdin.read())
for run in runs:
    id=run['id']
    base=run['payload']
    def go(T):
        p=dict(base); p['temperature']=T; p['seed']=20260922; p['steps']=5000; p['frames']=360
        r=simulate(p)
        forms=r['form_flags'].count(True)
        total=sum(1 for b in base['bonds'] if b['kind']=='form')
        prog=r['progress'][-1]
        return prog,total,forms
    p_lo,_n,forms_lo=go(300)
    p_hi,_m,forms_hi=go(1200)
    print(f"{id:16s}  low(T=300): prog={p_lo:.2f} formed={forms_lo}/<_ guard>   |   high(T=1200): prog={p_hi:.2f} formed={forms_hi}")
