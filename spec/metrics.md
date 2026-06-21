# Metrics & fitness

The single source of truth for how a candidate is scored. Implemented in
`evaluator/score.py`; raw numbers produced by `evaluator/contract/bench.rs`.

## Raw measurements (the harness emits these as one JSON line)

```jsonc
{
  "schema": "daw-bench/v1",
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
- **throughput** — largest tested voice count whose mean block fits under half
  the budget (`max_voices_50pct`) and under the full budget (`max_voices_full`).

## Gates (any failure ⇒ fitness = 0)

1. `build_ok` — compiles in `--release`.
2. `correctness.finite` ∧ `correctness.in_range` ∧ `correctness.nonzero`.
3. `realtime.alloc_calls_during_render == 0` — the cardinal real-time rule.
4. `dropouts.budget_5_33ms == 0` — no dropouts at the comfortable budget.

## Fitness (when all gates pass)

```
fitness = throughput.max_voices_50pct
```

The most voices a core can sustain with headroom for the tail. Higher is better.
`latency_us` and `max_voices_full` are recorded as secondary signals (useful for
tie-breaking and for humans reading the leaderboard) but do not change fitness in
v0. Keep this formula stable so scores stay comparable across the whole run; if
it must change, bump the `schema` version and note it here.

## Why these and not others

- **Throughput over raw speed**: "voices per core" is the number a DAW user
  actually feels, and it folds in per-sample efficiency, memory layout, and
  vectorization at once.
- **Half-budget headroom, not full**: optimizing to the full budget leaves a
  system that dies the moment the OS hiccups. The tail is real; we budget for it.
- **Allocation as a hard gate, not a penalty**: one allocation on the audio
  thread is categorically wrong, not "a bit slower." Gates encode "never," scores
  encode "more/less."
