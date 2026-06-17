# daw-lab

A runnable, measurable companion to the DAW audio-engine learning thread. Each demo is a
small Rust program you can execute yourself and watch/measure, std-only for now (we can add
`rtrb` for real lock-free queues and `cpal` for real speaker output later).

This lab is intentionally separate from the rest of this repo (which is a web tutorial on
audio-analysis features). It's a parallel curiosity track about *engine internals*.

New here? Read [`PRIMER.md`](./PRIMER.md) first — a plain-English, no-prerequisites
on-ramp to the engine fundamentals. Then [`NOTION.md`](./NOTION.md) for the
technical roadmap: how the demos ladder up from one component toward a full DAW,
and the two distinct kinds of "talk" (parameters across threads vs. audio across
nodes) that the whole design turns on.

## The learning arc

1. The real-time deadline & the audio callback ✅
2. The signal path — inside one buffer ✅
3. **Why it chokes as projects grow** ← next
4. Threading across cores without breaking real-time rules
5. Memory & data movement
6. How real DAWs make architectural bets
7. Modern approaches (Rust, SIMD, why GPU mostly doesn't help)
8. What to learn / who to partner with

## Demos

### `membrane` — slider → atomic → oscillator

Run it (always `--release`; debug builds lie about timing):

```sh
cargo run --release --bin membrane
```

Two threads with different rules — a "UI" thread that moves a slider over time, and an
"audio" thread that must produce one block every ~5.3 ms — share exactly **one** number (the
oscillator frequency) through an `AtomicF32`. No locks, no blocking. Each block is drawn as a
one-line waveform, so you can watch the buffer change shape the instant the slider moves: a
higher frequency packs more cycles into the same line, and the change always lands at a block
boundary (the atomic `load` at the top of each block), never mid-buffer.

The per-block `fill` time is printed against the 5.3 ms budget — right now it's a rounding
error. Step 3 is about watching that number grow until it blows the budget.

### `chain` — osc → gain (Experiment 1)

```sh
cargo run --release --bin chain
```

The first node-to-node hand-off — "two components that talk." An oscillator (a source)
fills a block; a `Gain` (a transform) reads that same block and scales it in place. Both
implement the new `Node` trait, so a graph can drive a mixed list of them through one
`process(&mut buffer)` method. You can *see* the gain flatten the waveform's swing, then the
demo measures **static vs. dynamic dispatch** — calling the nodes directly vs. through a
runtime `Vec<Box<dyn Node>>`. The result: within measurement noise, so the runtime-built
graph a real DAW needs costs nothing meaningful.

### `mix` — voices → mixer → gain (Experiment 2)

```sh
cargo run --release --bin mix
```

The first graph with fan-in: several oscillators sum into a mixer, then run through the
`Gain` node. You can see two tones interfere into a lumpier "chord" waveform. Then it settles
the first architecture bet — **where the audio physically lives** — by measuring two summing
strategies (a buffer per voice vs. one shared accumulator bus) across 1–64 voices. The
surprise: per-voice buffers are ~45% *faster* (the sum vectorizes; the accumulator doesn't),
so "always accumulate" is backwards at this scale — the bus's real advantage is memory and
routing, not speed. A worked example of measuring before committing.

### `rig` — the worst-case measurement rig (Experiment 3)

```sh
cargo run --release --bin rig
```

Stops trusting the average. It times every block individually and reports the **tail**
(p99 / p99.9 / max) and **dropouts** (deadline misses), because a DAW is defined by its worst
block, not its mean. Three parts: the honest distribution of a clean graph (even clean code has
an OS-scheduler tail); the **choke** (scale voices until one core's average block blows the
budget — happens in the low thousands); and the clincher — inject **one forbidden allocation**
on 0.1% of blocks and watch the mean move ~1% while the worst block balloons ~18×. That's why
the audio thread may never allocate, lock, or do I/O.

## Layout

```
src/lib.rs            AtomicF32 (membrane), Node trait, SineOsc (source), Gain (transform), sparkline
src/bin/membrane.rs   Demo (A) — the membrane
src/bin/chain.rs      Experiment 1 — osc → gain + dispatch measurement
src/bin/mix.rs        Experiment 2 — voices → mixer → gain + buffer-layout measurement
src/bin/rig.rs        Experiment 3 — worst-case rig: tail latency, the choke, why no alloc
```
