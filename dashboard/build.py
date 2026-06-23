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
import re
import subprocess

REPO = pathlib.Path(__file__).resolve().parent.parent
ARCHIVE = REPO / "archive" / "runs.jsonl"
LADDER = REPO / "spec" / "ladder" / "ladder.json"
ENGINE_SRC = REPO / "engine" / "src"
PROTOCOL_RS = ENGINE_SRC / "protocol.rs"
OUT = REPO / "dashboard" / "public" / "data.json"

# What each part of the repo is, in one line. The Codebase tab renders these;
# the facts beside them (file list, line counts, protocol surface) are read live
# from the source so the tab can't drift as rungs land.
REPO_MAP = [
    {"path": "engine/",        "desc": "The compounding Rust audio engine. Every merged rung lives here — one growing library."},
    {"path": "spec/ladder/",   "desc": "The capability ladder: one folder per rung (contract, budget, golden tests)."},
    {"path": "evaluator/",     "desc": "The ground-truth judge — golden-test runner + perf scorer. The swarm may not touch it."},
    {"path": "archive/runs.jsonl", "desc": "Immutable, append-only record of every scored build — the program's memory."},
    {"path": "dashboard/",     "desc": "This static microsite, generated from the repo's own records on every push."},
    {"path": ".github/workflows/", "desc": "CI: the regression gate on every PR, and the job that publishes this dashboard."},
]

# Per-module one-liners, keyed by path under engine/src. Files without an entry
# still appear (with line counts) — only the description falls back to blank.
MODULE_DESC = {
    "lib.rs":         "The Daw facade: owns mixer + transport + sample bank, turns protocol commands into events.",
    "synth.rs":       "Polyphonic sine-voice bank — the real-time DSP core that the perf harness benchmarks. (rung 1)",
    "transport.rs":   "Sample-accurate clock: tempo, play/stop, seek, position. (rung 2)",
    "mixer.rs":       "Multitrack mixer: per-track gain + equal-power pan, master bus, stereo metering. (rung 3)",
    "samples.rs":     "Sample playback: named PCM buffers, one-shot / looped sample voices. (rung 4)",
    "protocol.rs":    "The JSON control protocol — the Command and Event wire types (serde-tagged NDJSON).",
    "bin/headless.rs":"The engine binary: reads commands on stdin, writes events on stdout — what the tests drive.",
    "bin/bench.rs":   "The canonical perf harness, injected by the evaluator so throughput numbers can't be faked.",
}



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
    """The current mainline engine = the most recent passing run.

    We deliberately do NOT take the global max-fitness record: throughput is a
    timing measurement that drifts between machine windows, so an old high
    reading must not outrank the latest integrated engine. The newest passing
    run is, by construction, the current state of the mainline.
    """
    passed = [r for r in runs if r["reason"] == "ok" and r["fitness"] > 0]
    return passed[-1] if passed else None  # runs are in chronological order


def _snake(name: str) -> str:
    """PascalCase variant -> serde's snake_case wire name (LoadSample -> load_sample)."""
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()


def _enum_variants(src: str, enum_name: str) -> list[str]:
    """The wire names of an enum's variants, in declaration order.

    Variants are indented exactly four spaces; fields/attributes are deeper or
    start with '#'. Handles both `Variant { .. }` and bare `Variant,` (e.g. Bye).
    """
    m = re.search(r"pub enum " + re.escape(enum_name) + r"\s*\{", src)
    if not m:
        return []
    names = []
    for line in src[m.end():].splitlines():
        if line.startswith("}"):  # end of the enum block
            break
        vm = re.match(r" {4}([A-Z][A-Za-z0-9]*)\b", line)
        if vm:
            names.append(_snake(vm.group(1)))
    return names


def engine_modules() -> tuple[list[dict], int]:
    """Every .rs file under engine/src with its line count and one-liner."""
    mods = []
    total = 0
    for p in sorted(ENGINE_SRC.rglob("*.rs")):
        rel = p.relative_to(ENGINE_SRC).as_posix()
        loc = len(p.read_text().splitlines())
        total += loc
        mods.append({"file": rel, "loc": loc, "desc": MODULE_DESC.get(rel, "")})
    return mods, total


def codebase() -> dict:
    """The structured facts the Codebase tab renders — read live from source."""
    mods, total_loc = engine_modules()
    proto_src = PROTOCOL_RS.read_text() if PROTOCOL_RS.exists() else ""
    return {
        "repo_map": REPO_MAP,
        "modules": mods,
        "engine_loc": total_loc,
        "protocol": {
            "commands": _enum_variants(proto_src, "Command"),
            "events": _enum_variants(proto_src, "Event"),
        },
    }


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
        "codebase": codebase(),
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
