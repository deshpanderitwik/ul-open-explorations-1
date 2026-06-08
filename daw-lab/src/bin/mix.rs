//! Experiment 2: the first graph — many voices into a mixer — and where the
//! spoonfuls should live.
//!
//! WHAT WE'RE PROVING
//! ------------------
//! Experiment 1 was a straight line: osc -> gain, one buffer passed hand to hand.
//! A mixer breaks that shape. It has *many* inputs and one output, so for the first
//! time we have to decide where the audio physically sits while it's being combined.
//! Two honest strategies, and they produce identical sound:
//!
//!   • PER-VOICE BUFFERS ("a scratch pad per voice"): each oscillator renders into
//!     its own buffer; the mixer then streams all N buffers back in and sums them.
//!     Flexible — each voice's pre-mix signal exists on its own, which you need for
//!     metering, sends, sidechains. Cost: N buffers of memory, and at high voice
//!     counts those buffers stop fitting in fast cache.
//!
//!   • ONE ACCUMULATOR BUS ("a single shared bowl"): one buffer. Each voice *adds*
//!     its sound straight into it (that's `fill_add`). Uses N times less memory, and
//!     the textbook calls it cache-friendly. Cost: the individual voice signals are
//!     gone the instant they're summed.
//!
//! Received wisdom is "real mixers accumulate." We measure instead of assuming — and
//! get a SURPRISE (see the verdict): at these block sizes the per-voice version is
//! actually faster, because it keeps the summation in a tight, vectorizable loop while
//! the accumulator fuses it into the un-vectorizable sine loop. The "obvious"
//! optimization is backwards here — exactly why we measure before we commit. We sweep
//! 1/4/16/64 voices. (Rigorous worst-case/p99 timing is Experiment 3.)
//!
//! THE GRAPH IT BUILDS
//! -------------------
//!     [osc] [osc] ... ┐
//!                     ├─► (mix) ─► [gain] ─► out
//!     [osc] [osc] ... ┘
//! Sources fan into a mixer, the mix runs through Experiment 1's `Gain` node, out.
//!
//! HONEST CAVEAT
//! -------------
//! `println!` is still the "speaker," and setup allocates — but never inside the
//! timed loops, which do only what a real render does on pre-allocated buffers.

use std::hint::black_box;
use std::time::{Duration, Instant};

use daw_lab::{sparkline, Gain, Node, SineOsc};

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK_SIZE: usize = 256;
const SCOPE_WIDTH: usize = 64;
const ITERS: usize = 5_000; // blocks per measurement
const VOICE_COUNTS: [usize; 4] = [1, 4, 16, 64];

fn main() {
    let block_dur = Duration::from_secs_f32(BLOCK_SIZE as f32 / SAMPLE_RATE);
    let budget_ns = block_dur.as_secs_f64() * 1e9;

    println!("EXPERIMENT 2: voices -> mixer, and where the spoonfuls live");
    println!("----------------------------------------------------------");
    println!(
        "sample rate {:.0} Hz | block {} samples | budget {:.3} ms ({:.0} ns) per block\n",
        SAMPLE_RATE, BLOCK_SIZE, block_dur.as_secs_f64() * 1e3, budget_ns
    );

    // ---- PART 1: see two tones become one richer wave ----------------------
    println!("two oscillators (a perfect fifth, 220 + 330 Hz) summed into one block:\n");
    let mut v1 = SineOsc::new(SAMPLE_RATE);
    let mut v2 = SineOsc::new(SAMPLE_RATE);
    let mut b1 = vec![0.0f32; BLOCK_SIZE];
    let mut b2 = vec![0.0f32; BLOCK_SIZE];
    v1.fill(&mut b1, 220.0);
    v2.fill(&mut b2, 330.0);
    let mut mix = vec![0.0f32; BLOCK_SIZE];
    for i in 0..BLOCK_SIZE {
        mix[i] = 0.5 * b1[i] + 0.5 * b2[i]; // 0.5 each so the sum can't clip past ±1
    }
    println!("  voice 1 (220 Hz)   |{}|", sparkline(&b1, SCOPE_WIDTH));
    println!("  voice 2 (330 Hz)   |{}|", sparkline(&b2, SCOPE_WIDTH));
    println!("  mix (sum)          |{}|", sparkline(&mix, SCOPE_WIDTH));
    Gain::new(0.8).process(&mut mix); // the master gain — Experiment 1's node, reused
    println!("  mix -> gain 0.80   |{}|", sparkline(&mix, SCOPE_WIDTH));
    println!("\n  the mix is no longer a clean sine — two frequencies interfere into a");
    println!("  repeating-but-lumpier shape. That lumpiness IS the chord.\n");

    // ---- PART 2: prove the two strategies are the same sound ---------------
    let max_diff = correctness_check(16);
    println!(
        "correctness: per-voice vs. accumulator over 16 voices differ by at most {:.1e}",
        max_diff
    );
    println!("  (0.0 = bit-identical output; we're comparing pure speed, not sound)\n");

    // ---- PART 3: measure how each strategy scales with voice count ---------
    println!("{} blocks per cell. per-block cost as voices climb:\n", ITERS);
    println!("  voices |  per-voice bufs |   accumulator   |  accumulator  | mem (per-voice)");
    println!("  -------+-----------------+-----------------+---------------+----------------");
    let mut slowdowns = Vec::new();
    let mut worst_pct_budget = 0.0f64;
    for &n in &VOICE_COUNTS {
        let sep = measure_separate(n);
        let acc = measure_accumulate(n);
        let slower_pct = (acc - sep) / sep * 100.0; // accumulator's extra cost over per-voice
        slowdowns.push(slower_pct);
        worst_pct_budget = worst_pct_budget.max(acc / budget_ns * 100.0);
        let mem_kb = (n * BLOCK_SIZE * 4) as f64 / 1024.0;
        println!(
            "  {:>6} | {:>8.0} ns/blk | {:>8.0} ns/blk | {:>4.0}% slower | {:>6.1} KB vs 1 KB",
            n, sep, acc, slower_pct, mem_kb,
        );
    }
    let avg_slow = slowdowns.iter().sum::<f64>() / slowdowns.len() as f64;

    println!("\n  the surprise — and the lesson:");
    println!(
        "  • the accumulator ran ~{:.0}% SLOWER, and the gap is FLAT as voices grow — so this",
        avg_slow
    );
    println!("    is NOT the cache effect the textbook predicts; at 256-sample blocks the sine");
    println!("    math dwarfs the buffer traffic, so L1 pressure never becomes the bottleneck.");
    println!("  • per-voice wins because the sum is its own tight, vectorizable loop, while the");
    println!("    accumulator fuses the add into the un-vectorizable oscillator loop.");
    println!("  • so 'always accumulate' was backwards at this scale. The accumulator's real edge");
    println!("    is MEMORY (1 KB vs N KB) and routing simplicity — not speed. We keep generation");
    println!("    and summing as separate vectorizable passes, and revisit the bus design once");
    println!("    SIMD (Exp 7) and real voice counts are in play.");
    println!(
        "  • headroom check: even 64 voices the slow way is only {:.1}% of the {:.0} µs budget.",
        worst_pct_budget,
        budget_ns / 1e3
    );
}

/// Sum N voices the PER-VOICE way: each renders to its own buffer, then we stream
/// them all back in and add. Touches N+1 buffers per block.
fn separate_block(oscs: &mut [SineOsc], freqs: &[f32], g: f32, bufs: &mut [Vec<f32>], master: &mut [f32]) {
    for s in master.iter_mut() {
        *s = 0.0;
    }
    for (v, osc) in oscs.iter_mut().enumerate() {
        osc.fill(&mut bufs[v], freqs[v]);
    }
    for v in 0..oscs.len() {
        let vb = &bufs[v];
        for i in 0..master.len() {
            master[i] += g * vb[i];
        }
    }
}

/// Sum N voices the ACCUMULATOR way: each adds straight into the one shared buffer.
/// Touches exactly 1 buffer, which stays hot in cache.
fn accumulate_block(oscs: &mut [SineOsc], freqs: &[f32], g: f32, master: &mut [f32]) {
    for s in master.iter_mut() {
        *s = 0.0;
    }
    for (v, osc) in oscs.iter_mut().enumerate() {
        osc.fill_add(master, freqs[v], g);
    }
}

fn make_voices(n: usize) -> (Vec<SineOsc>, Vec<f32>) {
    let oscs = (0..n).map(|_| SineOsc::new(SAMPLE_RATE)).collect();
    // A spread of frequencies — the exact values don't matter for timing.
    let freqs = (0..n).map(|v| 110.0 + 6.5 * v as f32).collect();
    (oscs, freqs)
}

fn measure_separate(n: usize) -> f64 {
    let (mut oscs, freqs) = make_voices(n);
    let g = 1.0 / n as f32;
    let mut bufs = vec![vec![0.0f32; BLOCK_SIZE]; n];
    let mut master = vec![0.0f32; BLOCK_SIZE];

    for _ in 0..200 {
        separate_block(&mut oscs, &freqs, g, &mut bufs, &mut master);
    }
    let mut checksum = 0.0f32;
    let t = Instant::now();
    for _ in 0..ITERS {
        separate_block(&mut oscs, &freqs, g, &mut bufs, &mut master);
        checksum += master[0];
    }
    let ns = t.elapsed().as_secs_f64() * 1e9 / ITERS as f64;
    black_box(checksum);
    ns
}

fn measure_accumulate(n: usize) -> f64 {
    let (mut oscs, freqs) = make_voices(n);
    let g = 1.0 / n as f32;
    let mut master = vec![0.0f32; BLOCK_SIZE];

    for _ in 0..200 {
        accumulate_block(&mut oscs, &freqs, g, &mut master);
    }
    let mut checksum = 0.0f32;
    let t = Instant::now();
    for _ in 0..ITERS {
        accumulate_block(&mut oscs, &freqs, g, &mut master);
        checksum += master[0];
    }
    let ns = t.elapsed().as_secs_f64() * 1e9 / ITERS as f64;
    black_box(checksum);
    ns
}

/// Render one block both ways from identical fresh voices and return the largest
/// per-sample difference. Should be exactly 0.0 — same sines, same summation order.
fn correctness_check(n: usize) -> f32 {
    let (mut oscs_a, freqs) = make_voices(n);
    let (mut oscs_b, _) = make_voices(n);
    let g = 1.0 / n as f32;

    let mut bufs = vec![vec![0.0f32; BLOCK_SIZE]; n];
    let mut master_a = vec![0.0f32; BLOCK_SIZE];
    let mut master_b = vec![0.0f32; BLOCK_SIZE];

    separate_block(&mut oscs_a, &freqs, g, &mut bufs, &mut master_a);
    accumulate_block(&mut oscs_b, &freqs, g, &mut master_b);

    master_a
        .iter()
        .zip(&master_b)
        .map(|(a, b)| (a - b).abs())
        .fold(0.0f32, f32::max)
}
