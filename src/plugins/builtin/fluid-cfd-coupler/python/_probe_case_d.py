import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fluid_cfd import verify

d = verify.verify_case_d()
print("=== verify_case_d ===")
for k in ("ok","pressure_ratio_actual","critical_pressure_ratio_lit","subsonic_engaged",
          "md_solver_kg_s","md_literature_kg_s","flow_rel_error","back_pressure_pa",
          "plenum_pressure_final_pa","reverse_coupling_engaged","mean_interface_error"):
    print(" ", k, "=", d[k])
print("  certification =", d["certification"])

s = verify.verify_subsonic_curve()
print("=== verify_subsonic_curve ===")
print("  PR* =", s["critical_pressure_ratio_lit"], "max_rel_error =", s["max_rel_error"],
      "sens =", s["sensitivity_dln_md_over_dln_r"])
for r_ in s["rows"]:
    print("   r=%s subsonic=%s md_lit=%s md_solver=%s rel=%s" % (
        r_["pressure_ratio"], r_["subsonic"], r_["md_literature_kg_s"], r_["md_solver_kg_s"], r_["rel_error"]))