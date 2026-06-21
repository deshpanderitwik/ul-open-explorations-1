You are optimizing a real-time audio engine for a next-generation DAW. Your
working directory is a single candidate crate. Your job: make it render MORE
simultaneous voices per CPU core without missing the deadline or breaking the
real-time rules.

## Read first
- `../../spec/objective.md` — the goal.
- `../../spec/constraints.md` — the API contract and the real-time rules.
- `../../spec/metrics.md` — exactly how you are scored.
- `../../AGENTS.md` — the rules of the game.
- `src/lib.rs` — the engine you are improving.

## The parent's latest measurements
```json
{{PARENT_METRICS}}
```

## Your task
Edit `src/lib.rs` to raise `throughput.max_voices_50pct` while keeping every
gate green. Ideas worth trying (pick ONE coherent change, don't shotgun):
- vectorize the per-sample inner loop (SIMD / autovectorization-friendly layout),
- replace `sin()` with a wavetable or polynomial approximation (watch accuracy —
  output must stay correct and in range),
- restructure the voice/data layout for cache and SIMD (e.g. SoA, block math),
- reduce per-sample branching in the phase wrap.

## Hard rules (violating any = automatic score of 0)
- Keep the `Engine` API exactly: `new`, `add_voice`, `render`.
- NO allocation / locks / I/O inside `render`. Allocate in `new`/`add_voice`.
- Output must stay finite, within `|x| <= 1.5`, and non-silent.
- Do NOT edit `src/bin/bench.rs`, anything in `spec/`, or anything in
  `evaluator/`. The harness is overwritten before scoring — editing it is futile.

Make the change, ensure `cargo build --release` succeeds, and stop. The loop
will benchmark you.
