# daw-lab

A runnable, measurable companion to the DAW audio-engine learning thread. Each demo is a
small Rust program you can execute yourself and watch/measure, std-only for now (we can add
`rtrb` for real lock-free queues and `cpal` for real speaker output later).

This lab is intentionally separate from the rest of this repo (which is a web tutorial on
audio-analysis features). It's a parallel curiosity track about *engine internals*.

See [`NOTION.md`](./NOTION.md) for the roadmap: how the demos ladder up from one
component toward a full DAW, and the two distinct kinds of "talk" (parameters
across threads vs. audio across nodes) that the whole design turns on.

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

## Layout

```
src/lib.rs            AtomicF32 (the membrane primitive), SineOsc (a source node), sparkline
src/bin/membrane.rs   Demo (A)
```
