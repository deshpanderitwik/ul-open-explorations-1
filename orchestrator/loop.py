#!/usr/bin/env python3
"""The agent loop driver (Phase 1: single track).

generate -> evaluate -> select, repeated. Each iteration:

  1. SELECT a parent — the best candidate in the archive so far (the seed on the
     first run).
  2. GENERATE — copy the parent to a new candidate dir and ask a coding agent to
     improve the engine (faster `render`, more voices) without breaking the
     contract or the real-time rules.
  3. EVALUATE — run evaluator/score.py, which builds, benchmarks, gates, scores,
     and appends the result to archive/runs.jsonl.

It is deliberately simple. Phase 2 grows this into a population with parallel
workers and islands for diversity; the pieces here (select / generate / evaluate
/ record) are the same ones that scale.

Usage:
    python orchestrator/loop.py --iters 5
    python orchestrator/loop.py --iters 5 --model haiku
    python orchestrator/loop.py --iters 1 --dry-run   # no LLM call; tests the plumbing

The GENERATE step shells out to Claude Code in headless mode. Verify the exact
flags for your installed version (`claude --help`); they are isolated in
`generate()` so they are easy to swap for the Agent SDK later.
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
CANDIDATES = REPO / "candidates"
ARCHIVE = REPO / "archive" / "runs.jsonl"
SCORE = REPO / "evaluator" / "score.py"
PROMPT_TEMPLATE = REPO / "orchestrator" / "prompts" / "generate.md"


def best_parent() -> str:
    """Pick the highest-fitness candidate recorded so far; default to the seed."""
    best_id, best_fit = "seed", float("-inf")
    if ARCHIVE.exists():
        for line in ARCHIVE.read_text().splitlines():
            if not line.strip():
                continue
            rec = json.loads(line)
            if rec.get("fitness", 0) > best_fit:
                best_id, best_fit = rec["id"], rec["fitness"]
    return best_id


def new_candidate_id() -> str:
    return "gen-" + _dt.datetime.now().strftime("%Y%m%d-%H%M%S")


def build_prompt(parent_id: str) -> str:
    """Fill the generation prompt with the parent's latest metrics, if any."""
    template = PROMPT_TEMPLATE.read_text()
    metrics_blurb = "(no prior metrics — this is the seed baseline)"
    if ARCHIVE.exists():
        for line in reversed(ARCHIVE.read_text().splitlines()):
            if line.strip() and json.loads(line)["id"] == parent_id:
                rec = json.loads(line)
                metrics_blurb = json.dumps(rec.get("metrics", {}), indent=2)
                break
    return template.replace("{{PARENT_METRICS}}", metrics_blurb)


def generate(candidate_dir: pathlib.Path, prompt: str, model: str, dry_run: bool) -> None:
    """Ask a coding agent to mutate the engine in `candidate_dir`.

    Headless Claude Code. The agent's working directory is the candidate crate,
    so it edits src/lib.rs there in place. It is told (via the prompt and
    AGENTS.md) not to touch the harness or the spec.
    """
    if dry_run:
        print("  [dry-run] skipping LLM call; candidate is an unmodified copy of the parent")
        return
    cmd = [
        "claude", "-p", prompt,
        "--model", model,
        "--permission-mode", "acceptEdits",  # verify flag name for your version
        "--output-format", "json",
    ]
    subprocess.run(cmd, cwd=candidate_dir, check=True)


def evaluate(candidate_dir: pathlib.Path, parent_id: str) -> dict:
    out = subprocess.run(
        [sys.executable, str(SCORE), str(candidate_dir), "--parent", parent_id],
        capture_output=True, text=True,
    )
    sys.stderr.write(out.stderr)
    return json.loads(out.stdout.splitlines()[-1]) if out.stdout.strip() else {"fitness": 0}


def main() -> None:
    ap = argparse.ArgumentParser(description="Run the DAW-architecture agent loop.")
    ap.add_argument("--iters", type=int, default=1, help="how many candidates to generate")
    ap.add_argument("--model", default="sonnet", help="model for the generate step")
    ap.add_argument("--dry-run", action="store_true", help="skip the LLM call (test plumbing)")
    args = ap.parse_args()

    for i in range(args.iters):
        parent = best_parent()
        cid = new_candidate_id()
        dst = CANDIDATES / cid
        print(f"\n=== iteration {i + 1}/{args.iters}: {cid}  (parent: {parent}) ===")

        # SELECT + clone the parent as the starting point.
        shutil.copytree(CANDIDATES / parent, dst, ignore=shutil.ignore_patterns("target"))

        # GENERATE.
        generate(dst, build_prompt(parent), args.model, args.dry_run)

        # EVALUATE (records to the archive).
        result = evaluate(dst, parent)
        print(f"  -> fitness={result.get('fitness'):g}  ({result.get('reason')})")


if __name__ == "__main__":
    main()
