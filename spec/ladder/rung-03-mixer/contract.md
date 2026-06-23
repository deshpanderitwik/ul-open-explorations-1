# Rung 3 — mixer  ← NEXT

Turn the engine from a single voice bank into a **multitrack mixer**: several
independent tracks, each with its own level and stereo position, summed through a
master bus, with metering. This is the first rung where output becomes **stereo**
(pan needs two channels) and where "a track" becomes a first-class thing — the
backbone every later groovebox rung (sampler, sequencer) plugs into.

## What it adds

### Output goes stereo
`render` now produces a **stereo** block (left + right). The protocol's `meter`
keeps its existing `rms`/`peak` (now the max across channels, for backward
compatibility) and **adds** per-channel `rms_l`, `rms_r`, `peak_l`, `peak_r`.

### Tracks
- Each track has a **gain** (linear, default `1.0`) and a **pan** (`-1.0` full
  left … `0.0` center … `+1.0` full right, default `0.0`), using an **equal-power
  pan law** (center = -3 dB per side, so total power is constant across the pan
  sweep). At full left the right channel is silent, and vice-versa.
- A **master gain** (default `0.8`) is applied to the summed bus.
- `load` creates one default track at index `0`, so existing rung-1/2 behavior
  (`add_voice` with no track) keeps working unchanged.

### Protocol surface (additions only — must not break rungs 1–2)
- `add_track { gain?, pan? }` → `track_added { index }`
- `set_track_gain { track, gain }` → `ok`
- `set_track_pan { track, pan }` → `ok`  (pan clamped to [-1, 1])
- `set_master_gain { gain }` → `ok`
- `add_voice { freq, track? }` — `track` optional, defaults to `0`
- `clear_voices { track? }` — `track` optional; omitted = clear all tracks
- `render { blocks }` → `meter` now also carries `rms_l/rms_r/peak_l/peak_r`
- `get_state` → now also reports `channels: 2`, `master_gain`, and
  `tracks: [{ index, gain, pan, voices }]` (existing fields unchanged)

## Behavior (the contract)
- Each track renders its own voices (mono), is placed into L/R by its pan law and
  scaled by its gain; tracks are summed; master gain is applied last.
- Output stays finite, in range (`|x| <= 1.5` per channel), and non-silent when
  voices are playing.
- `set_track_gain` to `0.0` silences that track; full-left pan puts all of a
  track's signal in the left channel (right ≈ 0), full-right the reverse.

## Gates (correctness)
- All rung-1 and rung-2 golden tests still pass (regression).
- The rung-3 golden tests in `tests/` pass.
- **Zero allocations on the render path** (the mixer must pre-allocate its track
  and stereo scratch buffers in setup, never in `render`).

## Fitness
Correctness-dominated, like rung 2. Fitness = rung-1's `max_voices_50pct` on the
integrated engine: **the mixer must not regress synth throughput** below the
profile budget (≥ 0.95 × gen-1). The synth voice bank itself is unchanged and
still benchmarked mono, so a clean mixer keeps fitness flat.

## Out of scope (later rungs)
Sends/returns/buses beyond a single master, solo/mute groups, per-track effects
(rung 6), automation of gain/pan (later). Keep this rung a clean static mixer.
