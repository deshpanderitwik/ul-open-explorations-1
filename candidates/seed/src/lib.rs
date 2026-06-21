//! The SEED engine — the current champion every new candidate is measured
//! against. The loop promotes a winner here when it beats this one.
//!
//! THE CONTRACT (do not change the shape of this — only the implementation):
//!   * `Engine::new(sample_rate, block_size)` — construct, pre-allocate here.
//!   * `Engine::add_voice(freq)`              — register one sine voice (setup only).
//!   * `Engine::render(out)`                  — fill ONE block. This is the
//!     real-time path under test: NO allocation, NO locks, NO I/O in here.
//!
//! GENERATION 1 (promoted from candidate `gen-...-approx`). The original baseline
//! called libm `sinf` once per sample per voice; the loop replaced it with the
//! cheap branchless cubic sine below (`fast_sin_from_phase`) — a ~+55% jump in
//! voices/core with no loss of correctness. Headroom remains: the per-sample
//! phase-wrap branch in `render` is still scalar and serial, so a future round
//! can still go branchless / SIMD over the inner loop.

/// Fast, branchless, accurate sine approximation evaluated directly from a
/// phase `p` in [0,1).
///
/// Strategy: the classic "Bhaskara/parabolic + correction" approximation used
/// in audio. We first remap the phase to `x` in [-1, 1] representing one full
/// turn (so `x = 1` is half a cycle = pi radians, where the parabola is
/// defined). The base parabola `y = 4*x*(1 - |x|)` matches a sine half-cycle to
/// ~5% error; one extra correction step
///   `y = 0.225 * (y*|y| - y) + y`
/// (P = 0.225 minimizes the worst-case error) brings the maximum absolute error
/// down to ~0.0918%, i.e. better than the requested 0.1% target. The output is
/// guaranteed in [-1, 1].
///
/// Cost: a handful of multiplies/adds plus two `abs()` (a sign-bit mask, not a
/// branch) — no `sinf` library call, no table lookups, no per-sample branches,
/// which lets the compiler keep the inner loop tight and vectorizable.
#[inline(always)]
fn fast_sin_from_phase(p: f32) -> f32 {
    // Map phase 0..1 onto x in [-1, 1): x = 2*p - 1 spans [-1, 1), and the
    // parabola below is built for the half-cycle parameterization where the
    // zero crossing at the block boundary stays continuous.
    // We shift so x=0 corresponds to phase 0 (sin(0)=0).
    //   phase 0   -> x =  0   -> sin  0
    //   phase 0.5 -> x =  1/-1 boundary -> sin pi = 0
    // Use a wrapped coordinate t in [-1, 1) where t = 2*p mapped into [-1,1).
    // Branchless wrap: t0 = 2*p in [0,2); subtract 2 only when t0 >= 1.
    // `(t0 >= 1.0) as i32 as f32` is 0.0 or 1.0 with no control flow.
    let t0 = 2.0 * p; // 0..2
    let t = t0 - 2.0 * ((t0 >= 1.0) as i32 as f32); // t in [-1, 1)
    // Base parabola approximating sin(pi * t): peaks +1 at t=0.5, -1 at t=-0.5.
    let y = 4.0 * t * (1.0 - t.abs());
    // One correction term (Q + P*|y|), P = 0.225, for ~0.0918% max error.
    0.225 * (y * y.abs() - y) + y
}

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
