# AGENTS.md — rules of the game

You are one agent in a loop that is evolving better DAW audio-engine
architectures. Read this before you touch anything.

## The setup

- You are given **one candidate crate** (under `candidates/<id>/`) as your
  working directory. It is a copy of the best engine found so far.
- Your job is to **improve the engine** so it renders more voices per core under
  the real-time deadline.
- An automated benchmark then scores you. You cannot argue with it; you can only
  produce a better engine.

## The contract (never break these)

1. Keep the public API in `src/lib.rs`: `Engine::new(sample_rate, block_size)`,
   `Engine::add_voice(freq)`, `Engine::render(out)`.
2. `render` is the real-time path: **no heap allocation, no locks, no I/O.** Do
   all allocation in `new` / `add_voice`.
3. Output must stay **finite, in range (`|x| <= 1.5`), and non-silent.**

## Off-limits (editing these does nothing but waste a turn)

- `spec/**` — the objective and rules. Human-owned.
- `evaluator/**` — the scorer.
- `src/bin/bench.rs` — the harness. The evaluator **overwrites it** with its own
  canonical copy before every run, so your edits are discarded. The only path to
  a higher score is a genuinely better `src/lib.rs`.

## How you are scored

See `spec/metrics.md`. In short: pass the gates (compiles, correct, zero
render-path allocations, zero dropouts), then fitness = the most voices that fit
under half the per-block budget. Higher is better.

## Good practice

- Make **one coherent change** per turn, not a scattershot of edits — the loop
  learns faster from clean attributions.
- Always leave the crate in a state where `cargo build --release` succeeds.
- Prefer changes grounded in real audio-DSP / systems technique (SIMD, wavetables,
  cache-friendly layout) over micro-tweaks.
