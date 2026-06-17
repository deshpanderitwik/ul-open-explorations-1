//! Experiment 1: the first edge — `osc -> gain` — and the dispatch question.
//!
//! WHAT WE'RE PROVING
//! ------------------
//! This is the smallest possible "two components that talk": an oscillator (a
//! source) feeds a gain (a transform). The oscillator fills the block; the gain
//! reads that same block and scales it in place. That hand-off, node to node,
//! within one block, is the graph's "horizontal talk" — distinct from the
//! membrane's cross-thread "vertical talk" in the `membrane` demo.
//!
//! To do this uniformly we introduced the `Node` trait: every station exposes
//! the same `process(&mut buffer)` method, so a graph can drive a mixed list of
//! them without knowing what each one is. But uniformity has a potential cost.
//! There are two ways to call a list of nodes:
//!
//!   • STATIC dispatch — we name the concrete types, the compiler inlines each
//!     call. Fast, but the chain's shape is frozen at compile time.
//!   • DYNAMIC dispatch — we keep `Vec<Box<dyn Node>>`, so the chain can be built
//!     at runtime (the whole point of a DAW). Each call goes through a vtable: one
//!     extra indirection per node, and the compiler can't inline across it.
//!
//! A DAW *must* build its graph at runtime, so we'll live with dynamic dispatch —
//! but only if it's cheap. This demo measures the difference so the decision rests
//! on a number, not a hunch. (Rigorous worst-case/p99 timing is Experiment 3; here
//! we just want the average per-block cost of the two dispatch styles.)
//!
//! HONEST CAVEAT
//! -------------
//! `println!` is still our "speaker" and the setup code allocates — but none of
//! that happens inside the timed loops. The timed loops do only what a real render
//! would: call `process` on a pre-allocated buffer.

use std::hint::black_box;
use std::time::{Duration, Instant};

use daw_lab::{sparkline, Gain, Node, SineOsc};

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK_SIZE: usize = 256;
const SCOPE_WIDTH: usize = 64;
const ITERS: usize = 100_000; // blocks per measurement (~546 ms of "audio" each)

fn main() {
    let block_dur = Duration::from_secs_f32(BLOCK_SIZE as f32 / SAMPLE_RATE);
    let budget_ns = block_dur.as_secs_f64() * 1e9;

    println!("EXPERIMENT 1: osc -> gain, and what dispatch costs");
    println!("--------------------------------------------------");
    println!(
        "sample rate {:.0} Hz | block {} samples | budget {:.3} ms ({:.0} ns) per block\n",
        SAMPLE_RATE, BLOCK_SIZE, block_dur.as_secs_f64() * 1e3, budget_ns
    );

    // ---- PART 1: see the edge ----------------------------------------------
    // Render one block of a 440 Hz tone, then watch the gain node flatten it.
    // (Setup allocations here are fine — this is not the timed path.)
    println!("the gain node reading and rewriting the oscillator's block:\n");
    let mut osc = SineOsc::new(SAMPLE_RATE);
    osc.set_freq(440.0);
    let mut buf = vec![0.0f32; BLOCK_SIZE];
    osc.process(&mut buf); // source: writes a fresh block

    println!("  osc only         |{}|", sparkline(&buf, SCOPE_WIDTH));
    for g in [1.0f32, 0.6, 0.25] {
        let mut b = buf.clone(); // copy so each row scales the same source block
        Gain::new(g).process(&mut b); // transform: reads + rewrites in place
        println!("  osc -> gain {:>4.2} |{}|", g, sparkline(&b, SCOPE_WIDTH));
    }
    println!("\n  (lower gain packs the wave toward the middle band — same shape, less swing)\n");

    // ---- PART 2: static vs. dynamic dispatch -------------------------------
    println!("running {} blocks through the chain, two ways:\n", ITERS);

    let static_ns = measure_static();
    let dynamic_ns = measure_dynamic();

    let static_per = static_ns / ITERS as f64;
    let dyn_per = dynamic_ns / ITERS as f64;
    let delta = dyn_per - static_per;

    report("static  (compiler inlines each call)", static_per, budget_ns);
    report("dynamic (Vec<Box<dyn Node>>, vtable)", dyn_per, budget_ns);

    let pct = delta / static_per * 100.0;
    println!();
    if pct.abs() < 5.0 {
        // The honest common case: the gap is smaller than run-to-run jitter.
        println!(
            "  the two are within measurement noise (Δ {:+.1} ns/block, {:+.1}%) — at this",
            delta, pct
        );
        println!("  scale the vtable indirection vanishes next to the sine math itself.");
    } else {
        println!(
            "  dynamic costs {:+.1} ns/block ({:+.1}%), ~{:.1} ns per node call — the",
            delta, pct, delta / 2.0
        );
        println!("  price of a graph whose shape is decided at runtime.");
    }
    println!(
        "  either way the whole chain is {:.4}% of the per-block budget.",
        dyn_per / budget_ns * 100.0
    );
    println!("\n  verdict: a DAW needs a runtime-built graph, and the vtable cost is in");
    println!("  the noise next to the actual DSP. We'll build on Vec<Box<dyn Node>>.");
}

/// Time `ITERS` blocks of `osc -> gain` with the concrete types named directly,
/// so the compiler can inline both `process` calls. Returns total nanoseconds.
fn measure_static() -> f64 {
    let mut osc = SineOsc::new(SAMPLE_RATE);
    osc.set_freq(440.0);
    let mut gain = Gain::new(0.8);
    let mut buf = vec![0.0f32; BLOCK_SIZE];

    // Warm up: prime caches / branch predictor so the timed run is representative.
    for _ in 0..1_000 {
        osc.process(&mut buf);
        gain.process(&mut buf);
    }

    let mut checksum = 0.0f32;
    let t = Instant::now();
    for _ in 0..ITERS {
        // black_box on the buffer stops the optimizer from hoisting work out of
        // the loop or fusing the two calls — we want a faithful per-block cost.
        osc.process(black_box(&mut buf));
        gain.process(black_box(&mut buf));
        checksum += buf[0];
    }
    let elapsed = t.elapsed();
    black_box(checksum); // make sure the loop's result is "observed"
    elapsed.as_secs_f64() * 1e9
}

/// Time the same work, but driven the way a real graph will: a runtime list of
/// trait objects, each call going through the vtable. Returns total nanoseconds.
fn measure_dynamic() -> f64 {
    let mut osc = SineOsc::new(SAMPLE_RATE);
    osc.set_freq(440.0);
    let mut chain: Vec<Box<dyn Node>> = vec![Box::new(osc), Box::new(Gain::new(0.8))];
    let mut buf = vec![0.0f32; BLOCK_SIZE];

    for _ in 0..1_000 {
        for node in chain.iter_mut() {
            node.process(&mut buf);
        }
    }

    let mut checksum = 0.0f32;
    let t = Instant::now();
    for _ in 0..ITERS {
        for node in chain.iter_mut() {
            node.process(black_box(&mut buf));
        }
        checksum += buf[0];
    }
    let elapsed = t.elapsed();
    black_box(checksum);
    elapsed.as_secs_f64() * 1e9
}

fn report(label: &str, per_block_ns: f64, budget_ns: f64) {
    println!(
        "  {:36} {:7.1} ns/block | {:.4}% of budget",
        label,
        per_block_ns,
        per_block_ns / budget_ns * 100.0
    );
}
