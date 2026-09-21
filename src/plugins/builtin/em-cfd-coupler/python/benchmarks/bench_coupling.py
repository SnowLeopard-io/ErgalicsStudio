#!/usr/bin/env python3
"""Benchmark / repro runner for the em-cfd-coupler plugin.

Writes an EmCfdBench JSON artifact with the full verification suite
(Case A + Case B + precision-vs-efficiency trade-off) so the in-browser
plugin and the CLI produce the same numbers.

Usage:
    python bench_coupling.py [output.json]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

# allow running from the package folder
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from em_cfd import __version__, verify  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("out", nargs="?", default=None,
                    help="output JSON path (default: project-root bench/)")
    args = ap.parse_args()

    t0 = time.perf_counter()
    data = verify.run_all()
    elapsed = time.perf_counter() - t0

    out = {
        "plugin": "em-cfd-coupler",
        "plugin_version": __version__,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "wall_clock_s": round(elapsed, 3),
        "suite": data,
    }

    dest = args.out
    if not dest:
        # default to the project-root bench folder, sibling of the package
        root = Path(__file__).resolve().parent.parent.parent.parent.parent.parent
        bench_dir = root / "bench"
        bench_dir.mkdir(exist_ok=True)
        dest = str(bench_dir / "em-cfd-results.json")
    with open(dest, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2, ensure_ascii=False)
    print(f"wrote {dest}")
    print(f"wall clock: {elapsed:.3f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())