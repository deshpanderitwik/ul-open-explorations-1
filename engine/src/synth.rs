//! The synth component — a faithful port of the seed/gen-1 DSP.
//!
//! Keeps the branchless cubic sine approximation (`fast_sin_from_phase`) and the
//! per-voice phase-accumulator render loop. `render` is the real-time path: no
//! allocation, no locks, no I/O.

/// Fast, branchless, accurate sine approximation evaluated directly from a
/// phase `p` in [0,1). Max absolute error ~0.0918%, output in [-1, 1].
#[inline(always)]
fn fast_sin_from_phase(p: f32) -> f32 {
    let t0 = 2.0 * p; // 0..2
    let t = t0 - 2.0 * ((t0 >= 1.0) as i32 as f32); // t in [-1, 1)
    let y = 4.0 * t * (1.0 - t.abs());
    0.225 * (y * y.abs() - y) + y
}

pub struct Synth {
    sample_rate: f32,
    block_size: usize,
    /// Phase of each voice, normalized to 0.0..1.0, persisted across blocks so
    /// the waveform stays continuous.
    phases: Vec<f32>,
    /// Per-sample phase increment for each voice (freq / sample_rate).
    incs: Vec<f32>,
    /// Master gain applied before output.
    gain: f32,
}

impl Synth {
    pub fn new(sample_rate: f32, block_size: usize) -> Self {
        Synth {
            sample_rate,
            block_size,
            phases: Vec::new(),
            incs: Vec::new(),
            gain: 0.8,
        }
    }

    /// Register one voice. Setup-time only — allocation here is fine.
    pub fn add_voice(&mut self, freq: f32) {
        self.phases.push(0.0);
        self.incs.push(freq / self.sample_rate);
    }

    /// Remove all voices.
    pub fn clear(&mut self) {
        self.phases.clear();
        self.incs.clear();
    }

    pub fn voice_count(&self) -> usize {
        self.phases.len()
    }

    /// Render one block. The hot path. Sum every voice's sine into `out`,
    /// normalized by voice count so a dense chord stays in range.
    ///
    /// Real-time-safe by construction: only arithmetic over a buffer the caller
    /// already owns. No allocation, no locks, no syscalls.
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
                *s += g * fast_sin_from_phase(p);
                p += inc;
                if p >= 1.0 {
                    p -= 1.0;
                }
            }
            self.phases[v] = p;
        }
    }
}
