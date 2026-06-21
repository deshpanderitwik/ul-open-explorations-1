# Constraints — the rules of the game

These are the invariants a candidate engine must satisfy. The evaluator enforces
the ones it can measure; the rest are design rules an agent must respect.

## The API contract (must not change shape)

Every candidate is a crate with library name `daw_candidate` exposing a struct
`Engine`:

```rust
impl Engine {
    pub fn new(sample_rate: f32, block_size: usize) -> Self;  // construct; allocate HERE
    pub fn add_voice(&mut self, freq: f32);                    // setup only; allocate HERE
    pub fn render(&mut self, out: &mut [f32]);                 // hot path; allocate NOWHERE
}
```

You may rewrite the internals however you like — different data layouts, SIMD,
wavetables, threading, anything — as long as these three signatures keep working
and `render` fills `out` with one block of the mixed, gain-applied signal.

## The real-time rules (the heart of it)

`render` runs under a hard deadline. On the render path there must be:

- **No heap allocation** — no `Vec::push`/`Box::new`/`String`/resize/`format!`.
  Allocate everything in `new`/`add_voice`. *(Measured: the harness counts every
  allocation during the timed render loop; non-zero → fitness 0.)*
- **No locks** — no `Mutex`/`RwLock` on the audio path. A blocked audio thread is
  a dropout.
- **No I/O or syscalls** — no file/network/print, nothing with unbounded latency.
- **Bounded, predictable work per block** — the worst block is what matters.

## Correctness

`render` must produce audio that is:

- **finite** (no `NaN`/`inf`),
- **in range** (`|sample| <= 1.5`; stay near full-scale without exploding),
- **non-silent** (it must actually synthesize the voices, not output zeros).

## Budget

- Sample rate 48 kHz, block size 256 → **5.33 ms** per block (the comfortable
  budget). A 32-sample low-latency budget (0.67 ms) is also reported.
- Fitness rewards fitting under **half** the comfortable budget, so there is
  headroom for the OS-scheduler tail every real system has.

## Off-limits files

`spec/`, `evaluator/`, and `src/bin/bench.rs` are owned by the evaluator. The
loop overwrites `bench.rs` before scoring, so editing it does nothing but signal
an attempt to game the benchmark.
