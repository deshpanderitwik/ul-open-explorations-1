# Rung 2 — budget

Correctness-dominated rung. The bar:

| gate | mobile | desktop |
|---|---|---|
| rung-2 golden tests pass exactly | required | required |
| `position_samples` arithmetic exact | required (no tolerance) | required |
| render-path allocations | 0 | 0 |
| rung-1 regression (golden + perf) | must still pass | must still pass |
| synth throughput (`max_voices_50pct`) vs gen-1 | ≥ 0.95 × gen-1 | ≥ 0.95 × gen-1 |

Fitness for selection among passing candidates: highest retained
`max_voices_50pct` (transport must be near-free on the render path). A candidate
that fails any golden test or drops throughput below 95% of gen-1 is rejected.
