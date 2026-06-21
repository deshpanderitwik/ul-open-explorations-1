//! CANONICAL BENCHMARK HARNESS — OWNED BY THE EVALUATOR.
//!
//! The loop injects this exact file into every candidate (overwriting
//! `src/bin/bench.rs`) before it is scored. Candidates MUST NOT edit it — it is
//! the measuring stick, and it is the same for everyone. It calls only the
//! candidate's public `Engine` API and prints ONE line of JSON (its last line of
//! stdout) with raw measurements. The evaluator computes fitness from that JSON;
//! the candidate never reports its own score.
//!
//! What it measures:
//!   * correctness  — the rendered block is finite, in range, and not silent
//!   * realtime     — heap allocations that happen ON the render path (must be 0)
//!   * latency      — per-block time distribution at a fixed load (mean..max)
//!   * dropouts     — blocks that blew the 5.33 ms (and 0.67 ms low-latency) budget
//!   * throughput   — the exact voice ceiling under budget, found by binary search

use std::alloc::{GlobalAlloc, Layout, System};
use std::hint::black_box;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use daw_engine::Synth;

// ---- allocation tripwire ---------------------------------------------------
// A global allocator that counts every allocation/reallocation process-wide.
// We snapshot it around the timed render loop: a real-time-safe engine must add
// ZERO allocations there. This is the cardinal rule of audio threads, made
// unfakeable — the candidate cannot remove this allocator (the evaluator owns
// this file), and any `Vec::push`/`Box::new`/resize on the render path shows up.
struct Counting;
static ALLOCS: AtomicU64 = AtomicU64::new(0);
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        ALLOCS.fetch_add(1, Ordering::Relaxed);
        System.alloc(l)
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        System.dealloc(p, l)
    }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 {
        ALLOCS.fetch_add(1, Ordering::Relaxed);
        System.realloc(p, l, n)
    }
}
#[global_allocator]
static GLOBAL: Counting = Counting;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 256;
const HEADLINE_VOICES: usize = 64;
const ITERS: usize = 50_000;
const BUDGET_NS: f64 = (BLOCK as f64 / SAMPLE_RATE as f64) * 1e9; // 5.33 ms
const LOWLAT_NS: f64 = (32.0 / SAMPLE_RATE as f64) * 1e9; // 0.67 ms low-latency
const VOICE_CAP: usize = 1 << 16; // hard ceiling on the throughput search

fn build(n: usize) -> Synth {
    let mut e = Synth::new(SAMPLE_RATE, BLOCK);
    for v in 0..n {
        // A spread of detuned voices, like a fat chord — deterministic, not random.
        e.add_voice(110.0 + 6.5 * v as f32);
    }
    e
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
    let i = ((p / 100.0) * (sorted.len() - 1) as f64).round() as usize;
    sorted[i]
}

/// Mean per-block render time (ns) for an `n`-voice graph.
fn mean_block_ns(n: usize, out: &mut [f32]) -> f64 {
    let mut g = build(n);
    for _ in 0..64 {
        g.render(out); // warm caches / branch predictor
    }
    let blocks = 500;
    let t = Instant::now();
    for _ in 0..blocks {
        g.render(out);
        black_box(out[0]);
    }
    t.elapsed().as_secs_f64() * 1e9 / blocks as f64
}

/// The largest voice count whose mean block fits under `threshold_ns`.
/// Exponential search for a failing upper bound, then binary search — so a small
/// efficiency gain moves this number, unlike a coarse power-of-two sweep.
fn max_voices_under(threshold_ns: f64, out: &mut [f32]) -> usize {
    let mut lo = 1usize; // a single voice is assumed to fit
    if mean_block_ns(lo, out) > threshold_ns {
        return 0;
    }
    let mut hi = 2usize;
    while hi <= VOICE_CAP && mean_block_ns(hi, out) <= threshold_ns {
        lo = hi;
        hi *= 2;
    }
    if hi > VOICE_CAP {
        return VOICE_CAP; // never failed within the cap
    }
    // Invariant: lo passes, hi fails. Bisect to the boundary.
    while hi - lo > 1 {
        let mid = lo + (hi - lo) / 2;
        if mean_block_ns(mid, out) <= threshold_ns {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    lo
}

fn main() {
    let mut out = vec![0.0f32; BLOCK];

    // ---- correctness: render a headline graph and inspect the output --------
    let mut e = build(HEADLINE_VOICES);
    for _ in 0..500 {
        e.render(&mut out); // warm caches / branch predictor
    }
    let finite = out.iter().all(|x| x.is_finite());
    let in_range = out.iter().all(|x| x.abs() <= 1.5); // a little headroom over full-scale
    let nonzero = out.iter().any(|x| x.abs() > 1e-6); // must actually produce signal

    // ---- tail latency at the headline load, alloc tripwire armed ------------
    // Pre-reserve the timing buffer BEFORE snapshotting allocs, so its own
    // growth is never miscounted as a render-path allocation.
    let mut times: Vec<f64> = Vec::with_capacity(ITERS);
    let allocs_before = ALLOCS.load(Ordering::Relaxed);
    for _ in 0..ITERS {
        let t = Instant::now();
        e.render(&mut out);
        let dt = t.elapsed().as_nanos() as f64;
        black_box(out[0]);
        times.push(dt);
    }
    let alloc_during_render = ALLOCS.load(Ordering::Relaxed) - allocs_before;

    let mean = times.iter().sum::<f64>() / times.len() as f64;
    times.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let maxv = times[times.len() - 1];
    let drop_comfy = times.iter().filter(|&&t| t > BUDGET_NS).count();
    let drop_low = times.iter().filter(|&&t| t > LOWLAT_NS).count();

    // ---- throughput: the exact voice ceiling, by binary search --------------
    let max_50 = max_voices_under(BUDGET_NS * 0.5, &mut out); // headroom for the tail
    let max_full = max_voices_under(BUDGET_NS, &mut out);

    // ---- emit one JSON line (no serde: zero deps, can't drift) --------------
    println!(
        "{{\"schema\":\"daw-bench/v2\",\"ok\":true,\
\"config\":{{\"sample_rate\":{},\"block_size\":{},\"headline_voices\":{},\"iters\":{}}},\
\"correctness\":{{\"finite\":{},\"in_range\":{},\"nonzero\":{}}},\
\"realtime\":{{\"alloc_calls_during_render\":{}}},\
\"latency_us\":{{\"mean\":{:.3},\"p50\":{:.3},\"p99\":{:.3},\"p99_9\":{:.3},\"max\":{:.3}}},\
\"dropouts\":{{\"budget_5_33ms\":{},\"budget_0_67ms\":{}}},\
\"throughput\":{{\"max_voices_50pct\":{},\"max_voices_full\":{}}}}}",
        SAMPLE_RATE, BLOCK, HEADLINE_VOICES, ITERS,
        finite, in_range, nonzero,
        alloc_during_render,
        mean / 1e3, percentile(&times, 50.0) / 1e3, percentile(&times, 99.0) / 1e3,
        percentile(&times, 99.9) / 1e3, maxv / 1e3,
        drop_comfy, drop_low,
        max_50, max_full,
    );
}
