# Metrics & fitness

The single source of truth for how a candidate is scored. Implemented in
`evaluator/score.py`; raw numbers produced by `evaluator/contract/bench.rs`.

## Raw measurements (the harness emits these as one JSON line)

```jsonc
{
  "schema": "daw-bench/v2",
  "ok": true,
  "config":      { "sample_rate": 48000, "block_size": 256, "headline_voices": 64, "iters": 50000 },
  "correctness": { "finite": true, "in_range": true, "nonzero": true },
  "realtime":    { "alloc_calls_during_render": 0 },
  "latency_us":  { "mean": ..., "p50": ..., "p99": ..., "p99_9": ..., "max": ... },
  "dropouts":    { "budget_5_33ms": 0, "budget_0_67ms": 0 },
  "throughput":  { "max_voices_50pct": 1024, "max_voices_full": 2048 }
}
```

- **latency_us** — per-block render time at `headline_voices`, over `iters`
  blocks: mean and the tail (p99 / p99.9 / max). The tail is what kills DAWs.
- **dropouts** — blocks that exceeded the budget (an xrun = an audible click).
- **throughput** — the exact largest voice count whose mean block fits under
  half the budget (`max_voices_50pct`) and under the full budget
  (`max_voices_full`), found by **binary search** (not a coarse power-of-two
  sweep), so a small efficiency gain actually moves the number.

## Gates (any failure ⇒ fitness = 0)

1. `build_ok` — compiles in `--release`.
2. `correctness.finite` ∧ `correctness.in_range` ∧ `correctness.nonzero`.
3. `realtime.alloc_calls_during_render == 0` — the cardinal real-time rule.
4. `dropouts.budget_5_33ms == 0` — no dropouts at the comfortable budget.

## Fitness (when all gates pass)

```
tail_ratio = clamp(latency_us.p99_9 / budget_us, 0, 1)   # budget_us = 5333.3
fitness    = throughput.max_voices_50pct + (1 - tail_ratio)
```

The integer voice ceiling is the headline and dominates the score. The sub-1
tail term only ever breaks ties between engines of **equal** throughput,
rewarding the one with the tighter p99.9 tail. So a real efficiency gain shows up
as more voices; a same-throughput change that tightens the tail still scores
higher. `max_voices_full` and the rest of `latency_us` are recorded as secondary
signals for humans. Keep this formula stable so scores stay comparable across a
run; if it must change, bump the `schema` version (now `v2`) and note it here.

## Why these and not others

- **Throughput over raw speed**: "voices per core" is the number a DAW user
  actually feels, and it folds in per-sample efficiency, memory layout, and
  vectorization at once.
- **Half-budget headroom, not full**: optimizing to the full budget leaves a
  system that dies the moment the OS hiccups. The tail is real; we budget for it.
- **Allocation as a hard gate, not a penalty**: one allocation on the audio
  thread is categorically wrong, not "a bit slower." Gates encode "never," scores
  encode "more/less."
