#!/usr/bin/env python3
"""Ground-truth evaluator for a candidate DAW engine.

This is the part the agents may NOT touch. It is the only thing that decides
whether a candidate is good. Given a candidate crate directory it:

  1. Injects the canonical harness (evaluator/contract/bench.rs) over the
     candidate's src/bin/bench.rs, so measurements cannot be faked.
  2. Builds it in --release (a build failure is a score of 0).
  3. Runs it and parses the single JSON line of raw metrics.
  4. Applies the gates and computes a scalar fitness (see spec/metrics.md).
  5. Appends an immutable record to the program database (archive/runs.jsonl).

Usage:
    python evaluator/score.py candidates/seed
    python evaluator/score.py candidates/<id> --parent seed
    python evaluator/score.py candidates/<id> --no-record   # don't write archive

Exit code is 0 on success (candidate ran and was scored, even if fitness is 0),
non-zero only on harness/usage errors.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import pathlib
import shutil
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
CANONICAL_HARNESS = REPO / "evaluator" / "contract" / "bench.rs"
ARCHIVE = REPO / "archive" / "runs.jsonl"

# Build/run time caps so a pathological candidate can't hang the loop.
BUILD_TIMEOUT_S = 300
RUN_TIMEOUT_S = 300


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat()


def gate_and_fitness(metrics: dict) -> tuple[float, str]:
    """Apply the hard gates, then compute fitness. See spec/metrics.md.

    Gates (any failure -> fitness 0): the engine must be correct AND real-time
    safe AND drop no blocks at the comfortable budget. Only then does throughput
    count. Primary fitness = the most voices that fit under HALF the budget
    (headroom for the tail). This is unfakeable: the harness, not the candidate,
    produced every number below.
    """
    c = metrics.get("correctness", {})
    rt = metrics.get("realtime", {})
    drops = metrics.get("dropouts", {})

    gates = [
        ("correctness.finite", bool(c.get("finite"))),
        ("correctness.in_range", bool(c.get("in_range"))),
        ("correctness.nonzero", bool(c.get("nonzero"))),
        ("realtime.no_render_alloc", rt.get("alloc_calls_during_render", 1) == 0),
        ("dropouts.none_at_budget", drops.get("budget_5_33ms", 1) == 0),
    ]
    for name, ok in gates:
        if not ok:
            return 0.0, f"gate_failed:{name}"

    voices = float(metrics.get("throughput", {}).get("max_voices_50pct", 0))
    return voices, "ok"


def evaluate(candidate: pathlib.Path, parent: str | None, record: bool) -> dict:
    candidate = candidate.resolve()
    cargo = candidate / "Cargo.toml"
    if not cargo.exists():
        raise SystemExit(f"error: no Cargo.toml in {candidate}")

    bench_dst = candidate / "src" / "bin" / "bench.rs"
    if "name = \"bench\"" not in cargo.read_text():
        raise SystemExit(
            f"error: {cargo} must declare the [[bin]] named \"bench\". "
            "Candidates may rewrite the engine but must keep the bench entry."
        )

    # 1. Inject the canonical harness (overwrite whatever the candidate shipped).
    bench_dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(CANONICAL_HARNESS, bench_dst)

    record_base = {
        "id": candidate.name,
        "parent": parent,
        "ts": _now(),
    }

    # 2. Build.
    build = subprocess.run(
        ["cargo", "build", "--release", "--bin", "bench"],
        cwd=candidate, capture_output=True, text=True, timeout=BUILD_TIMEOUT_S,
    )
    if build.returncode != 0:
        return {**record_base, "fitness": 0.0, "reason": "build_failed",
                "build_ok": False, "stderr": build.stderr[-2000:]}

    # 3. Run + parse the last JSON line.
    run = subprocess.run(
        ["cargo", "run", "--release", "--bin", "bench"],
        cwd=candidate, capture_output=True, text=True, timeout=RUN_TIMEOUT_S,
    )
    if run.returncode != 0:
        return {**record_base, "fitness": 0.0, "reason": "run_failed",
                "build_ok": True, "stderr": run.stderr[-2000:]}

    last = next((ln for ln in reversed(run.stdout.splitlines()) if ln.strip()), "")
    try:
        metrics = json.loads(last)
    except json.JSONDecodeError:
        return {**record_base, "fitness": 0.0, "reason": "bad_output",
                "build_ok": True, "stdout_tail": run.stdout[-2000:]}

    # 4. Gate + score.
    fitness, reason = gate_and_fitness(metrics)
    return {**record_base, "fitness": fitness, "reason": reason,
            "build_ok": True, "metrics": metrics}


def main() -> None:
    ap = argparse.ArgumentParser(description="Score a candidate DAW engine.")
    ap.add_argument("candidate", help="path to the candidate crate directory")
    ap.add_argument("--parent", default=None, help="id of the parent candidate (lineage)")
    ap.add_argument("--no-record", action="store_true", help="don't append to the archive")
    args = ap.parse_args()

    result = evaluate(pathlib.Path(args.candidate), args.parent, not args.no_record)

    if not args.no_record:
        ARCHIVE.parent.mkdir(parents=True, exist_ok=True)
        with ARCHIVE.open("a") as fh:
            fh.write(json.dumps(result) + "\n")

    # Human-readable summary to stderr; the JSON record to stdout (pipeable).
    fit, reason = result["fitness"], result["reason"]
    print(f"[{result['id']}] fitness={fit:g}  ({reason})", file=sys.stderr)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
