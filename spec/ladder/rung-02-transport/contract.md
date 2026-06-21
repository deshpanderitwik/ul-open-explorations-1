# Rung 2 — transport & sample-accurate clock  ← NEXT

Give the engine a clock: a tempo, a play/stop state, and a sample-accurate
playhead position. Nothing plays back on a timeline yet (that arrives with the
sequencer at rung 5) — this rung is the *clock* every later rung schedules
against.

## What it adds

### Protocol surface (additions only — must not break rung 1)
- `set_tempo { bpm }` → set transport tempo. → `ok`
- `transport { action, pos? }` where `action` ∈ {`play`, `stop`, `seek`}; `seek`
  uses `pos` (sample position). → `ok` (or `error` on a bad action)
- `state` now reports accurate `tempo_bpm`, `playing`, `position_samples`.

### Behavior (the contract)
- `render { blocks }` advances `position_samples` by `blocks * block_size`
  **only while playing**; when stopped, position does not move.
- `seek` sets the position immediately, whether playing or stopped.
- `stop` freezes position; `play` resumes advancing it from where it is.
- Default state after `load`: 120 bpm, stopped, position 0.

## Gates (correctness)
- All rung-1 gates still pass (regression).
- The golden tests in `tests/` pass exactly (position arithmetic is integer and
  must be exact — no tolerance on `position_samples`).
- Transport bookkeeping adds **zero allocations to the render path**.

## Fitness
This rung is correctness-dominated, not a throughput race. Fitness = rung-1's
`max_voices_50pct` measured on the integrated engine — i.e. **adding the
transport must not regress synth throughput** beyond the profile budget. A
candidate that passes the golden tests and holds throughput wins.

## Out of scope (later rungs)
Tempo ramps/automation, time signatures, bar/beat display, loop regions — these
land with the sequencer and automation rungs. Keep this rung a clean clock.
