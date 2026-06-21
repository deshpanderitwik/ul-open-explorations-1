//! The SEED engine — candidate #0, the baseline every later architecture is
//! measured against.
//!
//! THE CONTRACT (do not change the shape of this — only the implementation):
//!   * `Engine::new(sample_rate, block_size)` — construct, pre-allocate here.
//!   * `Engine::add_voice(freq)`              — register one sine voice (setup only).
//!   * `Engine::render(out)`                  — fill ONE block. This is the
//!     real-time path under test: NO allocation, NO locks, NO I/O in here.
//!
//! This baseline is deliberately naive: a flat list of phase accumulators, one
//! sine per voice summed into the output with a per-voice gain. It is correct
//! and real-time-safe, but slow — that headroom is the point. The loop's job is
//! to evolve faster architectures (SIMD, blocked phase math, parallel voices,
//! wavetables, …) without breaking the contract or the real-time rules.

use std::f32::consts::TAU;

pub struct Engine {
    sample_rate: f32,
    block_size: usize,
    /// Phase of each voice, normalized to 0.0..1.0, persisted across blocks so
    /// the waveform stays continuous (resetting it every block would click).
    phases: Vec<f32>,
    /// Per-sample phase increment for each voice (freq / sample_rate).
    incs: Vec<f32>,
    /// Master gain applied before output.
    gain: f32,
}

impl Engine {
    pub fn new(sample_rate: f32, block_size: usize) -> Self {
        Engine {
            sample_rate,
            block_size,
            phases: Vec::new(),
            incs: Vec::new(),
            gain: 0.8,
        }
    }

    /// Register one voice. Setup-time only — never called on the render path,
    /// so allocation here (growing the Vecs) is fine.
    pub fn add_voice(&mut self, freq: f32) {
        self.phases.push(0.0);
        self.incs.push(freq / self.sample_rate);
    }

    /// Render one block. The hot path. Sum every voice's sine into `out`,
    /// normalized by voice count so a dense chord stays in range.
    ///
    /// Real-time-safe by construction: it only does arithmetic over a buffer the
    /// caller already owns. No allocation, no locks, no syscalls.
    pub fn render(&mut self, out: &mut [f32]) {
        debug_assert_eq!(out.len(), self.block_size);
        let n = self.phases.len().max(1);
        let g = self.gain / n as f32;
        for s in out.iter_mut() {
            *s = 0.0;
        }
        for v in 0..self.phases.len() {
            let inc = self.incs[v];
            let mut p = self.phases[v];
            for s in out.iter_mut() {
                *s += g * (p * TAU).sin();
                p += inc;
                if p >= 1.0 {
                    p -= 1.0;
                }
            }
            self.phases[v] = p;
        }
    }
}
