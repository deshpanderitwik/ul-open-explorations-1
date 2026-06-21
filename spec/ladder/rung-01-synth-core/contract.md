# Rung 1 — synth / voice core  ✅ done (gen-1)

The polyphonic sine-voice engine and its real-time render path. This is the
foundation the whole engine sits on, and the only rung evolved purely for
throughput.

## Engine API
```rust
Synth::new(sample_rate, block_size)
Synth::add_voice(freq)      // setup only; may allocate
Synth::clear()
Synth::voice_count()
Synth::render(out)          // real-time path: no alloc/lock/IO
```

## Protocol surface
`load`, `add_voice`, `clear_voices`, `render`, `get_state`, `quit` (+ `ready`,
`ok`, `error`, `meter`, `state`, `bye`). See `spec/protocol.md`.

## Gates (correctness)
- render output finite, in range (|x| <= 1.5), non-silent
- zero heap allocations on the render path
- zero dropouts at the profile budget

## Fitness
`max_voices_50pct` — the voice ceiling under half the block budget (binary
search). See `spec/metrics.md`. Current champion (gen-1, cubic poly-sine):
~2255 voices/core on the dev box.
