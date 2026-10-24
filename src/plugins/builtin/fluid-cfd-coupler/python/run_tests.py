#!/usr/bin/env python3
"""Plain-assert test runner for fluid_cfd (no pytest required).

Collects every ``test_*`` function from tests/test_coupling.py and runs it,
so the competition kernel can be validated on a bare Python + NumPy install
(the bundled runtime has no pytest). Exit code 0 iff every test passes.

Usage:
    python run_tests.py        # run the full suite (mirrors pytest)
    python run_tests.py smoke  # run only the fast Case-A/Case-B checks
"""

from __future__ import annotations

import os
import runpy
import sys
import traceback

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "tests"))


def main() -> int:
    smoke = "smoke" in sys.argv[1:]
    ns = runpy.run_path(os.path.join(ROOT, "tests", "test_coupling.py"))
    tests = {}
    for name in sorted(ns):
        if name.startswith("test_") and callable(ns[name]):
            if smoke and "case" not in name and "trade" not in name and "throttle" not in name:
                continue
            tests[name] = ns[name]

    passed, failed = 0, []
    for name, fn in tests.items():
        try:
            fn()
            passed += 1
            print(f"  ok  {name}")
        except Exception:
            failed.append(name)
            print(f"FAIL  {name}")
            traceback.print_exc()

    print(f"\n{passed} passed, {len(failed)} failed ({len(tests)} total)")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())