# Rung 3 — budget

Correctness-dominated. The bar:

| gate | mobile | desktop |
|---|---|---|
| rung-3 golden tests pass | required | required |
| rung-1 + rung-2 regression (golden) | must still pass | must still pass |
| render-path allocations | 0 | 0 |
| output finite & in range per channel (\|x\| ≤ 1.5) | required | required |
| track budget | ≥ 8 tracks | ≥ 64 tracks |
| synth throughput (`max_voices_50pct`) vs gen-1 | ≥ 0.95 × gen-1 | ≥ 0.95 × gen-1 |

Selection among passing candidates: highest retained `max_voices_50pct` (the
mixer should be near-free on the render path). A candidate that fails any golden
test, allocates on the render path, or drops throughput below the floor is
rejected.
