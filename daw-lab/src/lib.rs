//! daw_lab — shared building blocks for the audio-engine learning lab.
//!
//! Everything here is deliberately tiny and std-only. The goal is not to be a real
//! audio engine yet; it's to make the *concepts* runnable and measurable. Three things
//! live here:
//!
//!   1. `AtomicF32` — the simplest possible "membrane" primitive: a single number that
//!      one thread can write and another can read, with no lock and no tearing.
//!   2. `SineOsc`   — a minimal source node: it generates a sine wave one block at a time.
//!   3. `sparkline` — a way to *see* a buffer as a tiny waveform in the terminal, since we
//!      don't have real speakers wired up yet.
//!
//! The big idea we're making concrete: the thread that changes a parameter (the "UI")
//! and the thread that generates audio never touch the same memory directly. They meet
//! only through a primitive like `AtomicF32`. That handoff is "the membrane."

use std::f32::consts::TAU;
use std::sync::atomic::{AtomicU32, Ordering};

/// A floating-point value that can be shared across threads and updated atomically.
///
/// Rust gives us `AtomicU32` but not `AtomicF32`, so we do the classic trick: store the
/// f32's raw 32 bits inside an `AtomicU32`. `f32::to_bits` / `f32::from_bits` are pure
/// bit reinterpretations (no rounding, no math), so the value survives the round trip
/// exactly.
///
/// Why this is the right tool for a single parameter on the audio thread:
///   - **Indivisible**: a load or store is a single CPU instruction. The audio thread can
///     never observe "half" of a new value (no *tearing*).
///   - **Non-blocking**: there is no lock. The audio thread never waits on the UI thread,
///     so it can't miss its deadline because some other thread fell asleep holding a lock.
///   - **Bounded**: the worst-case time of a load/store is a fixed handful of cycles —
///     exactly the predictability the real-time rules demand.
///
/// We use `Ordering::Relaxed` everywhere: we only care that each individual read/write is
/// atomic, not that this value is synchronized *relative to other* memory. For a lone
/// "current frequency" knob that's all we need.
pub struct AtomicF32(AtomicU32);

impl AtomicF32 {
    pub fn new(value: f32) -> Self {
        AtomicF32(AtomicU32::new(value.to_bits()))
    }

    /// Called by the writer (the "UI" / slider side). Never blocks.
    pub fn store(&self, value: f32) {
        self.0.store(value.to_bits(), Ordering::Relaxed);
    }

    /// Called by the reader (the audio side), once at the top of each block. Never blocks.
    pub fn load(&self) -> f32 {
        f32::from_bits(self.0.load(Ordering::Relaxed))
    }
}

/// The uniform contract every station on the assembly line implements.
///
/// A node does exactly one thing: take one block and leave it in a new state. A
/// *source* (like `SineOsc`) ignores the incoming contents and writes fresh
/// samples; a *transform* (like `Gain`) reads what's there and rewrites it in
/// place. Either way the signature is identical — and that sameness is the whole
/// point: a graph can hold a mixed list of nodes and drive them all through this
/// one method without knowing what each one is.
///
/// `process` must obey the render-thread rules: no allocation, no locks, no I/O.
/// It works only on the buffer the caller already owns.
pub trait Node {
    fn process(&mut self, buffer: &mut [f32]);
}

/// A minimal source node: a sine-wave oscillator.
///
/// It owns only what it must remember *between* blocks: where it is in the wave (`phase`)
/// and how fast samples are consumed (`sample_rate`). Crucially, it does NOT own the
/// frequency — that's a parameter the outside world controls, so we pass it into `fill`.
/// This mirrors the real design: the audio thread loads the current frequency from the
/// membrane at the top of the block, then asks the node to render the block at that value.
pub struct SineOsc {
    /// Position in the cycle, normalized to 0.0..1.0 (one full turn). Persists across
    /// blocks so the waveform is continuous — if we reset it every block we'd get a click.
    phase: f32,
    sample_rate: f32,
    /// The frequency used by the `Node` interface. The low-level `fill` still takes
    /// `freq` explicitly (that's the membrane demo's path); this field is what a graph
    /// sets via `set_freq` when it drives the node through `process`, which has no room
    /// for arguments. A later rung wires this to an `AtomicF32` membrane.
    freq: f32,
}

impl SineOsc {
    pub fn new(sample_rate: f32) -> Self {
        SineOsc {
            phase: 0.0,
            sample_rate,
            freq: 220.0,
        }
    }

    /// Set the frequency used by the `Node` interface (`process`).
    pub fn set_freq(&mut self, freq: f32) {
        self.freq = freq;
    }

    /// Fill `buffer` with one block of a sine wave at `freq` Hz.
    ///
    /// This is the whole "signal generation" story in five lines: advance the phase by
    /// `freq / sample_rate` per sample (that's how much of a cycle elapses between two
    /// samples), and write `sin(phase * 2π)`.
    ///
    /// Real-time-safe by construction: no allocation, no locks, no I/O, no syscalls —
    /// just arithmetic over a buffer the caller already owns. Its worst-case cost is
    /// simply `buffer.len()` sine evaluations. Bounded and predictable.
    pub fn fill(&mut self, buffer: &mut [f32], freq: f32) {
        let phase_inc = freq / self.sample_rate;
        for sample in buffer.iter_mut() {
            *sample = (self.phase * TAU).sin();
            self.phase += phase_inc;
            // Wrap to keep `phase` in 0.0..1.0 forever. Using subtraction (not modulo)
            // keeps precision good and cost trivial.
            if self.phase >= 1.0 {
                self.phase -= 1.0;
            }
        }
    }
}

impl Node for SineOsc {
    /// As a node, the oscillator is a *source*: it ignores whatever is in the buffer
    /// and writes a fresh block at its current frequency. We just reuse `fill`.
    fn process(&mut self, buffer: &mut [f32]) {
        let freq = self.freq;
        self.fill(buffer, freq);
    }
}

/// A transform node: multiply every sample by a constant gain.
///
/// The simplest possible "second station." Unlike the oscillator it does not invent
/// signal — it *reads* the block the previous node produced and rewrites it in place.
/// Gain 1.0 is a pass-through; below 1.0 the waveform gets quieter (the sparkline
/// flattens toward the middle); above 1.0 it gets louder (and will clip at ±1.0).
pub struct Gain {
    pub gain: f32,
}

impl Gain {
    pub fn new(gain: f32) -> Self {
        Gain { gain }
    }
}

impl Node for Gain {
    /// Real-time-safe by construction: one multiply per sample, no allocation, no
    /// branches in the inner loop. Worst-case cost is simply `buffer.len()` multiplies.
    fn process(&mut self, buffer: &mut [f32]) {
        for sample in buffer.iter_mut() {
            *sample *= self.gain;
        }
    }
}

/// Render a buffer as a one-line "waveform" using the eight vertical block glyphs
/// (▁▂▃▄▅▆▇█). We have no speakers wired up yet, so this is how we *see* the buffer
/// change shape when the slider moves: a higher frequency packs more up-down cycles into
/// the same line.
///
/// `width` is how many columns to draw. If the buffer is longer than `width` we sample it
/// evenly (we're not trying to be a precise scope — just to make the shape legible).
pub fn sparkline(buffer: &[f32], width: usize) -> String {
    // Eight levels, so a sample in -1.0..1.0 maps to one of these glyphs.
    const LEVELS: [char; 8] = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
    if buffer.is_empty() || width == 0 {
        return String::new();
    }
    let mut out = String::with_capacity(width * 3);
    for col in 0..width {
        // Map this column back to a sample index in the buffer.
        let idx = col * buffer.len() / width;
        let s = buffer[idx].clamp(-1.0, 1.0);
        // -1.0..1.0  ->  0.0..1.0  ->  0..=7
        let level = (((s + 1.0) * 0.5) * (LEVELS.len() - 1) as f32).round() as usize;
        out.push(LEVELS[level.min(LEVELS.len() - 1)]);
    }
    out
}
