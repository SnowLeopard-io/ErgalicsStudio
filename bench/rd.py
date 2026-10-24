import json
d = json.load(open("em-cfd-results.json", encoding="utf-8"))
b = d["suite"]["case_b"]
print("CASE_B throttle_ratio", round(b["valve_throttle_ratio"],4))
print("CASE_B flow open/closed/reopen", round(b["flow_open_kg_s"],5), round(b["flow_closed_kg_s"],5), round(b["flow_reopen_kg_s"],5))
print("CASE_B sync max/mean", b.get("control_sync_max_ms"), b.get("control_sync_mean_ms"))
print("CASE_B metrics keys:", sorted(b["metrics"].keys()))
print("trade_off:")
for r in d["suite"]["trade_off"]:
    if isinstance(r.get("exchange_period_ms", None), float): print({k:(round(v,6) if isinstance(v,float) else v) for k,v in r.items()})
    else: print(r)
