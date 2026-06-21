#!/usr/bin/env python3
"""Golden-test runner for the control protocol.

This is the generalized correctness gate for every protocol-level rung. A golden
test (a JSON file under spec/ladder/rung-*/tests/) feeds a deterministic command
script to the headless engine and asserts the emitted event stream matches.

Test file shape:
    {
      "name": "...",
      "tolerance": 0.02,                 # float comparison tolerance (default 1e-6)
      "commands": [ {...}, ... ],         # fed to the engine, one line each
      "expect":   [ {...}, ... ],         # matched 1:1, in order, against events
      "assert":   [ {"path": "meter.peak", "min": 0.05, "max": 1.5} ]  # optional
    }

Matching rules:
  * `expect` is matched positionally against the emitted events; counts must be
    equal. Each matcher is a SUBSET: every field it names must be present and
    equal in the corresponding event (floats within tolerance); extra event
    fields are ignored.
  * `assert` checks a field on the LAST event of a given type ("meter.peak" =>
    the last `meter` event's `peak`) against optional min/max bounds.

Usage:
    python evaluator/protocol_test.py spec/ladder/rung-02-transport/tests/*.json
    python evaluator/protocol_test.py --engine engine spec/ladder/**/tests/*.json
Exit code 0 iff every test passes.
"""

from __future__ import annotations

import argparse
import glob
import json
import pathlib
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent


def _build_engine(engine_dir: pathlib.Path) -> pathlib.Path:
    """Build the headless binary once; return its path."""
    r = subprocess.run(
        ["cargo", "build", "--release", "--bin", "headless"],
        cwd=engine_dir, capture_output=True, text=True,
    )
    if r.returncode != 0:
        sys.exit(f"engine build failed:\n{r.stderr[-2000:]}")
    return engine_dir / "target" / "release" / "headless"


def _run_script(binary: pathlib.Path, commands: list[dict]) -> list[dict]:
    stdin = "".join(json.dumps(c) + "\n" for c in commands)
    r = subprocess.run([str(binary)], input=stdin, capture_output=True, text=True, timeout=60)
    events = []
    for line in r.stdout.splitlines():
        line = line.strip()
        if line:
            events.append(json.loads(line))
    return events


def _matches(expect: dict, event: dict, tol: float) -> bool:
    for k, want in expect.items():
        if k not in event:
            return False
        got = event[k]
        if isinstance(want, (int, float)) and isinstance(got, (int, float)):
            if abs(float(want) - float(got)) > tol:
                return False
        elif want != got:
            return False
    return True


def _check_asserts(asserts: list[dict], events: list[dict]) -> list[str]:
    fails = []
    for a in asserts:
        etype, _, field = a["path"].partition(".")
        matches = [e for e in events if e.get("event") == etype]
        if not matches:
            fails.append(f"assert {a['path']}: no '{etype}' event emitted")
            continue
        val = matches[-1].get(field)
        if val is None:
            fails.append(f"assert {a['path']}: field '{field}' missing")
            continue
        if "min" in a and val < a["min"]:
            fails.append(f"assert {a['path']}={val} < min {a['min']}")
        if "max" in a and val > a["max"]:
            fails.append(f"assert {a['path']}={val} > max {a['max']}")
    return fails


def run_test(path: pathlib.Path, binary: pathlib.Path) -> tuple[bool, str]:
    spec = json.loads(path.read_text())
    tol = spec.get("tolerance", 1e-6)
    events = _run_script(binary, spec["commands"])
    expect = spec.get("expect", [])

    if len(events) != len(expect):
        return False, (f"event count {len(events)} != expected {len(expect)}\n"
                       f"  got: {[e.get('event') for e in events]}\n"
                       f"  exp: {[e.get('event') for e in expect]}")
    for i, (exp, ev) in enumerate(zip(expect, events)):
        if not _matches(exp, ev, tol):
            return False, f"event[{i}] mismatch\n  expected subset: {exp}\n  got: {ev}"

    fails = _check_asserts(spec.get("assert", []), events)
    if fails:
        return False, "; ".join(fails)
    return True, "ok"


def main() -> None:
    ap = argparse.ArgumentParser(description="Run protocol golden tests.")
    ap.add_argument("tests", nargs="+", help="golden test JSON files (globs ok)")
    ap.add_argument("--engine", default="engine", help="engine crate dir")
    args = ap.parse_args()

    binary = _build_engine(REPO / args.engine)

    paths: list[pathlib.Path] = []
    for pat in args.tests:
        paths += [pathlib.Path(p).resolve() for p in glob.glob(pat, recursive=True)]
    paths = sorted(set(paths))
    if not paths:
        sys.exit("no test files matched")

    n_pass = 0
    for p in paths:
        ok, msg = run_test(p, binary)
        mark = "PASS" if ok else "FAIL"
        try:
            label = p.relative_to(REPO)
        except ValueError:
            label = p
        print(f"[{mark}] {label}" + ("" if ok else f"\n       {msg}"))
        n_pass += ok

    print(f"\n{n_pass}/{len(paths)} golden tests passed")
    sys.exit(0 if n_pass == len(paths) else 1)


if __name__ == "__main__":
    main()
