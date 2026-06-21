# Autonomous DAW-architecture loop

An agentic loop that evolves better **audio-engine architectures** for a
next-generation DAW. A coding agent proposes an engine, an objective benchmark
scores it, the best survive and get mutated again — `generate → evaluate →
select`, repeated.

The whole thing works because the *evaluation* is ground truth, not opinion: a
candidate engine is judged by how many voices it can render per CPU core without
missing the real-time deadline or breaking the real-time rules — and those
numbers are produced by an evaluator-owned harness the agents cannot fake.

## The loop

```
        ┌───────────────────────────────────────────────┐
        │                                               │
   ┌────▼─────┐   ┌──────────┐   ┌──────────┐   ┌───────┴──────┐
   │ GENERATE │──▶│  BUILD   │──▶│ BENCHMARK│──▶│   SELECT     │
   │ (agent   │   │ (cargo   │   │ + GATE   │   │ best parent, │
   │  edits   │   │  release)│   │ (score)  │   │ record run   │
   │  engine) │   └──────────┘   └──────────┘   └──────────────┘
   └──────────┘
```

## Layout

```
spec/                 the fixed objective (human-owned — agents may not edit)
  objective.md          what "better" means
  constraints.md        the Engine API contract + real-time rules
  metrics.md            exact measurements, gates, and the fitness formula
evaluator/            the ground-truth scorer (human-owned)
  contract/bench.rs     canonical benchmark harness, injected into every candidate
  score.py              build → run → gate → score → append to the archive
candidates/           the engines under evolution
  seed/                 candidate #0: a correct, real-time-safe, slow baseline
archive/              the program database (runs.jsonl) — the loop's memory
orchestrator/         the loop driver
  loop.py               generate → evaluate → select (Phase 1: single track)
  prompts/generate.md   the brief each generation agent receives
reference/daw-lab/    the original learning-lab demos this grew out of (read-only)
AGENTS.md             rules of the game for any agent in the loop
```

## Why this can work (and how it avoids being gamed)

- **The eval is objective.** Voices/core under a hard deadline is physics, not
  taste. See `spec/metrics.md`.
- **The harness is off-limits.** `evaluator/score.py` overwrites each candidate's
  `bench.rs` with its own canonical copy before scoring and links against the
  candidate's `Engine` API — so agents can rewrite the engine freely but can't
  fabricate measurements or hide an allocation on the audio path.
- **Allocation is a hard gate.** A counting global allocator in the harness fails
  any candidate that allocates during `render` — the cardinal real-time sin.
- **Memory across iterations.** Every run is appended to `archive/runs.jsonl`
  with its lineage, so the loop builds on what worked.

## Run it

Requires a Rust toolchain (`cargo`) and Python 3.10+.

```sh
# Score the baseline (builds the seed, benchmarks it, records to the archive):
python evaluator/score.py candidates/seed

# Test the loop plumbing with no LLM call:
python orchestrator/loop.py --iters 1 --dry-run

# Run the real loop (shells out to headless Claude Code for the generate step):
python orchestrator/loop.py --iters 5 --model sonnet
```

Baseline seed (this machine, 4 cores): **0 allocations** on the render path,
zero dropouts at 64 voices, fits **~1024 voices under half-budget**. That's the
number the loop is trying to beat.

## Roadmap

- **Phase 0 — the rig** ✅ spec, evaluator, seed, archive, single-loop driver.
- **Phase 1 — single loop** wire the generate step to a real agent and let it
  iterate on the seed.
- **Phase 2 — swarm** parallel workers in git worktrees, a population with
  islands for diversity, graduate the driver to the Claude Agent SDK.
- **Later** widen the workload: effects chains, multi-core graphs, real audio I/O.
