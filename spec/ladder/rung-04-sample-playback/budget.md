# Rung 4 — budget

Correctness-dominated. The bar:

| gate | mobile | desktop |
|---|---|---|
| rung-4 golden tests pass | required | required |
| rung-1 + rung-2 + rung-3 regression (golden) | must still pass | must still pass |
| render-path allocations | 0 | 0 |
| output finite & in range per channel (\|x\| ≤ 1.5) | required | required |
| sample-voice polyphony | ≥ 8 | ≥ 64 |
| synth throughput (`max_voices_50pct`) vs gen-1 | ≥ 0.95 × gen-1 | ≥ 0.95 × gen-1 |

Selection among passing candidates: highest retained synth `max_voices_50pct`
(sample playback must not perturb the synth/mixer hot path). A candidate that
fails any golden test, allocates on the render path, or drops synth throughput
below the floor is rejected.
