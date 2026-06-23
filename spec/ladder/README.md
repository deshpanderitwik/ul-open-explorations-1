# The capability ladder

You don't evolve "a DAW" — there is no single fitness for that. You evolve
**components against contracts** and **compound the winners** into one growing
engine, climbing this ladder one rung at a time. Each rung is a self-contained
folder:

```
spec/ladder/rung-NN-name/
  contract.md   what the rung adds to the engine + the control protocol
  budget.md     the perf/correctness bar, per platform profile (see spec/profiles.md)
  tests/        golden command-scripts + expected event streams (must-pass gates)
```

A rung is **done** when a candidate implementation passes:
1. that rung's golden tests (correctness gates),
2. that rung's perf budget (fitness),
3. the full **regression suite** — every earlier rung's golden + perf gates
   (so rung N can't silently break rung N-1).

Then the integrator merges it into `engine/` and the next rung opens. Every rung
graduation is **human-gated** (you approve the contract before generation and the
merge before it lands).

## Mobile MVP — the groovebox ladder

The first summit is a simplified, touch-friendly groovebox: sample/loop tracks,
a step sequencer, a mixer, transport. Rungs:

| # | rung | adds | status |
|---|---|---|---|
| 1 | **synth / voice core** | polyphonic sine voices, real-time-safe render, throughput | ✅ done (gen-1) |
| 2 | **transport & clock** | sample-accurate tempo/play/stop/seek/position | ✅ done |
| 3 | **mixer** | multitrack gain/pan/sum, master bus, stereo meters | ✅ done |
| 4 | **sample playback** | load PCM, one-shot + looped sample voices, real-time-safe streaming | ✅ done |
| 5 | **step sequencer** | pattern grid (steps × tracks) firing samples on the clock | ← next |
| 6 | **effects chain** | insert-node interface + a few nodes (gain/filter/delay) | |
| 7 | **record & quantize** | capture taps into pattern steps on the grid | |
| 8 | **persistence** | save/load project (patterns, mixer, sample refs) | |
| 9 | **real audio I/O** | leave the simulator: AAudio/CoreAudio/cpal backend | |
| 10 | **protocol complete** | the full groovebox is drivable over the control protocol | |

At rung 10 the **mobile UI** (a protocol client) can drive a complete groovebox.

## Desktop — scaling up (after the mobile summit)

Same engine core, looser budgets, heavier rungs: plugin hosting (CLAP/AU/VST),
multicore graph scheduling, latency compensation, automation lanes,
large-session memory management, higher track/voice counts. These reuse the same
contracts, tests, and regression suite — only `spec/profiles.md` thresholds and
feature flags change between mobile and desktop.

## Why this scales where "evolve a DAW" wouldn't

- Every rung has an **objective signal** (golden correctness + a perf budget), so
  the swarm always knows if it succeeded.
- Components stay behind **stable interfaces** (the spine: audio-across-nodes,
  params-across-threads, the control protocol), so they evolve independently.
- The **regression suite** is the ratchet: progress can only accumulate, never
  silently regress.
