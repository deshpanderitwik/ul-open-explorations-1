#!/usr/bin/env python3
"""Generate the dashboard's data.json from the repo's own records.

The dashboard is a static site (dashboard/public/). This script assembles
everything it shows into one JSON file the page fetches at load:

  * champion  — the current best engine and its headline numbers
  * runs      — every evaluation from archive/runs.jsonl (the fitness history)
  * ladder    — the rungs and milestones from spec/ladder/ladder.json (+ status)
  * commits   — recent git commits (what's been happening between builds)
  * stats     — totals (runs, passed, rejected)

No server, no database — the repo IS the database. Run on every push to main by
.github/workflows/pages.yml, then published to GitHub Pages.

    python dashboard/build.py            # writes dashboard/public/data.json
"""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import subprocess

REPO = pathlib.Path(__file__).resolve().parent.parent
ARCHIVE = REPO / "archive" / "runs.jsonl"
LADDER = REPO / "spec" / "ladder" / "ladder.json"
OUT = REPO / "dashboard" / "public" / "data.json"


def _f(d: dict, *path, default=None):
    """Safe nested getter."""
    cur = d
    for k in path:
        if not isinstance(cur, dict) or k not in cur:
            return default
        cur = cur[k]
    return cur


def load_runs() -> list[dict]:
    runs = []
    if ARCHIVE.exists():
        for line in ARCHIVE.read_text().splitlines():
            if not line.strip():
                continue
            r = json.loads(line)
            m = r.get("metrics", {})
            runs.append({
                "id": r.get("id"),
                "parent": r.get("parent"),
                "ts": r.get("ts"),
                "fitness": round(float(r.get("fitness", 0.0)), 3),
                "reason": r.get("reason", "?"),
                "voices_50pct": _f(m, "throughput", "max_voices_50pct"),
                "voices_full": _f(m, "throughput", "max_voices_full"),
                "mean_us": _f(m, "latency_us", "mean"),
                "p99_9_us": _f(m, "latency_us", "p99_9"),
                "alloc": _f(m, "realtime", "alloc_calls_during_render"),
                "dropouts": _f(m, "dropouts", "budget_5_33ms"),
            })
    # chronological order (archive is already append order, but be explicit)
    runs.sort(key=lambda r: r.get("ts") or "")
    return runs


def pick_champion(runs: list[dict]) -> dict | None:
    passed = [r for r in runs if r["reason"] == "ok" and r["fitness"] > 0]
    return max(passed, key=lambda r: r["fitness"]) if passed else None


def recent_commits(n: int = 20) -> list[dict]:
    try:
        out = subprocess.run(
            ["git", "log", f"-{n}", "--no-merges",
             "--pretty=format:%h\x1f%s\x1f%cI"],
            cwd=REPO, capture_output=True, text=True, check=True,
        ).stdout
    except Exception:
        return []
    commits = []
    for line in out.splitlines():
        parts = line.split("\x1f")
        if len(parts) == 3:
            commits.append({"hash": parts[0], "subject": parts[1], "date": parts[2]})
    return commits


def main() -> None:
    runs = load_runs()
    champ = pick_champion(runs)
    ladder = json.loads(LADDER.read_text()) if LADDER.exists() else {"rungs": [], "milestones": []}

    rungs = ladder.get("rungs", [])
    done = sum(1 for r in rungs if r.get("status") == "done")

    data = {
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "summit": ladder.get("summit", ""),
        "champion": champ,
        "runs": runs,
        "ladder": ladder,
        "commits": recent_commits(),
        "stats": {
            "total_runs": len(runs),
            "passed": sum(1 for r in runs if r["reason"] == "ok" and r["fitness"] > 0),
            "rejected": sum(1 for r in runs if not (r["reason"] == "ok" and r["fitness"] > 0)),
            "rungs_done": done,
            "rungs_total": len(rungs),
        },
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, indent=2))
    print(f"wrote {OUT.relative_to(REPO)}  "
          f"({len(runs)} runs, {done}/{len(rungs)} rungs"
          + (f", champion fitness {champ['fitness']:g}" if champ else "") + ")")


if __name__ == "__main__":
    main()
