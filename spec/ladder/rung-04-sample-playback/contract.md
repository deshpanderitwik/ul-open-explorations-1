# Rung 4 — sample playback  ← NEXT

Give the engine a second kind of voice: a **sample player**. Until now every
voice is a synthesized oscillator (rung 1). This rung lets a track play back
**recorded PCM audio** — the other half of a groovebox. Together with the rung-3
mixer this unlocks the first milestone: *load a sound, hear it on a track.*

## Design stance — the engine plays PCM, it does not decode files

The engine stays **format-agnostic and real-time-safe**. Audio files (WAV, AIFF,
mp3…) are decoded to raw float PCM **outside** the engine (the app layer / Core
Audio does this), and the resulting samples are handed to the engine as a plain
float array. This keeps file-format parsing, disk I/O, and codec dependencies
out of the audio engine entirely, and keeps the golden tests hermetic (no
external fixture files). WAV/file decoding is explicitly **not** part of this
rung.

Samples are **mono** and assumed to already be at the engine's sample rate.
Stereo samples and arbitrary-rate / pitched playback (resampling) are later
rungs — this rung is native-rate playback that composes cleanly with the
existing mono-track-then-pan mixer.

## What it adds

### Sample buffers
- `load_sample { sample, data }` stores a named PCM buffer. `sample` is a string
  id; `data` is a JSON array of floats (the mono PCM). The buffer is allocated at
  **load time** (off the render path) and reused for the engine's life.
- Loading an empty `data` array is an error.

### Sample voices
A sample voice reads from a loaded buffer through a playback cursor, scaled by an
optional `gain` (linear, default `1.0`), summed into its track's mono signal
(then panned by the rung-3 mixer like any other voice).

- **one-shot** (default): plays start → end of the buffer once, then the voice
  **deactivates and is removed** (it stops producing sound and no longer counts
  as an active voice).
- **loop**: plays start → end, then wraps to the start and continues indefinitely
  until cleared (`clear_voices`).

### Protocol surface (additions only — must not break rungs 1–3)
- `load_sample { sample, data }` → `sample_loaded { sample, frames }`
  (`frames` = number of PCM samples stored). Empty/duplicate-handling:
  empty `data` → `error`; re-loading the same id replaces the buffer.
- `add_sample_voice { sample, track?, gain?, mode? }` → `ok`
  - `track` optional, defaults to `0`; unknown track → `error`.
  - `mode` is `"one_shot"` (default) or `"loop"`.
  - unknown `sample` id → `error`.
- `clear_voices { track? }` clears sample voices too (they are voices).
- `get_state` additionally reports `samples: [{ sample, frames }]` (existing
  fields unchanged); `voices` counts active sample voices alongside synth voices.

## Behavior (the contract)
- A one-shot voice produces its buffer once and is gone afterward: after enough
  blocks to exhaust it, `voices` drops back down and output returns to silence.
- A loop voice never exhausts: it keeps producing sound across arbitrarily many
  blocks and stays counted in `voices`.
- Sample voices obey their track's gain and pan exactly like synth voices (a
  sample on a hard-left track is silent in the right channel).
- Output stays finite, in range (`|x| <= 1.5` per channel), and non-silent while
  a voice is active.

## Gates (correctness)
- All rung-1, rung-2, and rung-3 golden tests still pass (regression).
- The rung-4 golden tests in `tests/` pass.
- **Zero allocations on the render path.** Sample buffers are allocated in
  `load_sample` and voices may be set up in `add_sample_voice` (both control-path,
  between renders), but `render` — including advancing cursors, wrapping loops,
  and removing finished one-shots — must not allocate.

## Fitness
Correctness-dominated, like rung 3. The perf harness still benchmarks the
unchanged mono **synth** voice bank, so a clean sample-playback implementation
keeps synth throughput flat: fitness must not regress below the profile budget
(≥ 0.95 × gen-1). Among passing candidates, the one that best retains synth
throughput wins (sample playback must not perturb the synth/mixer hot path).

## Out of scope (later rungs)
File/codec decoding (WAV/AIFF/mp3), stereo samples, pitched / arbitrary-rate
playback and resampling, sample start/length offsets and loop points, envelopes
on samples, streaming from disk. Keep this rung a clean native-rate one-shot/loop
PCM player.
