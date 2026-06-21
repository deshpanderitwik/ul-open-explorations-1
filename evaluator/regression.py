#!/usr/bin/env python3
"""The regression gate — run before any candidate is merged into the mainline.

This is the ratchet that lets progress only accumulate: a candidate for rung N
must pass EVERY earlier rung's golden tests AND hold the synth perf bar, or it is
rejected. It aggregates the two evaluation surfaces:

  * protocol_test.py — all golden tests under spec/ladder/**/tests/*.json
  * score.py         — the rung-1 perf benchmark (gates + fitness)

Usage:
    python evaluator/regression.py                 # check the mainline engine/
    python evaluator/regression.py --candidate candidates/gen-xyz
    python evaluator/regression.py --min-fitness 2145   # enforce a throughput floor

Exit code 0 iff all golden tests pass, perf gates pass, and fitness >= min.
"""

from __future__ import annotations

import argparse
import glob
import json
import pathlib
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent


def main() -> None:
    ap = argparse.ArgumentParser(description="Run the full regression gate.")
    ap.add_argument("--candidate", default="engine", help="crate dir to check (default: mainline engine)")
    ap.add_argument("--min-fitness", type=float, default=0.0, help="reject if fitness below this")
    args = ap.parse_args()

    cand = (REPO / args.candidate).resolve()
    golden = sorted(glob.glob(str(REPO / "spec/ladder/**/tests/*.json"), recursive=True))

    print(f"== regression: {args.candidate} ==")

    # 1. Golden correctness across all rungs (built against this candidate's engine).
    gt = subprocess.run(
        [sys.executable, str(REPO / "evaluator/protocol_test.py"), "--engine", str(cand), *golden],
        capture_output=True, text=True,
    )
    sys.stdout.write(gt.stdout)
    golden_ok = gt.returncode == 0

    # 2. Perf benchmark (rung 1): gates + fitness.
    sc = subprocess.run(
        [sys.executable, str(REPO / "evaluator/score.py"), str(cand), "--no-record"],
        capture_output=True, text=True,
    )
    perf = json.loads(sc.stdout.splitlines()[-1]) if sc.stdout.strip() else {"fitness": 0, "reason": "no_output"}
    fitness, reason = perf.get("fitness", 0.0), perf.get("reason", "?")
    print(f"perf: fitness={fitness:g} ({reason})")

    perf_ok = fitness > 0 and fitness >= args.min_fitness
    overall = golden_ok and perf_ok

    print("-" * 40)
    print(f"golden: {'PASS' if golden_ok else 'FAIL'}   "
          f"perf: {'PASS' if perf_ok else 'FAIL'}"
          + (f" (need >= {args.min_fitness:g})" if args.min_fitness else ""))
    print(f"REGRESSION: {'PASS' if overall else 'FAIL'}")
    sys.exit(0 if overall else 1)


if __name__ == "__main__":
    main()
