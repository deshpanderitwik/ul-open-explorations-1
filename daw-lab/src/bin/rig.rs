//! Experiment 3: the worst-case rig — measure the tail, not the mean.
//!
//! WHAT WE'RE PROVING
//! ------------------
//! Experiments 1 and 2 reported *averages*. But a DAW lives or dies by its WORST
//! block, not its average one: a cook who is fast on average but freezes once an
//! hour still puts an audible click in your recording. So this rig stops trusting
//! the mean. It times every single block, sorts them, and reports the tail —
//! p99, p99.9, and the absolute max — plus the count of blocks that blew the
//! deadline (an "xrun" = a dropout = a click).
//!
//! Three parts:
//!   1. THE HONEST DISTRIBUTION — a clean graph's mean vs. its tail. Even with
//!      zero mistakes, the OS scheduler gives us a tail. We just want to see it.
//!   2. THE CHOKE — scale the voice count until the average block alone blows the
//!      budget. (A preview of the parallelism rung.)
//!   3. WHY THE COMMANDMENTS EXIST — take a clean graph and inject ONE forbidden
//!      operation (a heap allocation) on a tiny fraction of blocks. The mean barely
//!      flinches; the tail detonates. This is why the audio thread may never
//!      allocate, lock, or do I/O.
//!
//! HONEST CAVEAT
//! -------------
//! We time each block with `Instant`, which itself costs ~tens of ns — negligible
//! against blocks measured in microseconds, but it's there. The "forbidden alloc"
//! in part 3 is an exaggerated stand-in for any unbounded op (a buffer resize, a
//! file read, a lock wait) that accidentally lands on the audio thread.

use std::hint::black_box;
use std::time::Instant;

use daw_lab::{Gain, Node, SineOsc};

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK_SIZE: usize = 256;
const ITERS: usize = 50_000;

// Two deadlines to judge against: a comfortable 256-sample buffer, and an
// aggressive 32-sample low-latency buffer (the kind you'd use to play live).
const BUDGET_NS: f64 = (BLOCK_SIZE as f64 / SAMPLE_RATE as f64) * 1e9; // 5.33 ms
const LOWLAT_NS: f64 = (32.0 / SAMPLE_RATE as f64) * 1e9; // 0.667 ms

// The forbidden op for part 3: allocate 4 MB and touch every element, on the
// audio thread, once every VILLAIN_EVERY blocks.
const FORBIDDEN_FLOATS: usize = 1 << 20; // 4 MB
const VILLAIN_EVERY: usize = 1000;

/// A representative graph under test: N oscillators summed (the per-voice layout
/// Experiment 2 found fastest) and run through a master gain.
struct Graph {
    oscs: Vec<SineOsc>,
    freqs: Vec<f32>,
    g: f32,
    bufs: Vec<Vec<f32>>,
    master: Vec<f32>,
    gain: Gain,
}

impl Graph {
    fn new(n: usize) -> Self {
        Graph {
            oscs: (0..n).map(|_| SineOsc::new(SAMPLE_RATE)).collect(),
            freqs: (0..n).map(|v| 110.0 + 6.5 * v as f32).collect(),
            g: 1.0 / n as f32,
            bufs: vec![vec![0.0f32; BLOCK_SIZE]; n],
            master: vec![0.0f32; BLOCK_SIZE],
            gain: Gain::new(0.8),
        }
    }

    fn render(&mut self) {
        for s in self.master.iter_mut() {
            *s = 0.0;
        }
        for (v, osc) in self.oscs.iter_mut().enumerate() {
            osc.fill(&mut self.bufs[v], self.freqs[v]);
        }
        for v in 0..self.oscs.len() {
            let vb = &self.bufs[v];
            let g = self.g;
            for i in 0..self.master.len() {
                self.master[i] += g * vb[i];
            }
        }
        self.gain.process(&mut self.master);
    }
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
    let idx = ((p / 100.0) * (sorted.len() - 1) as f64).round() as usize;
    sorted[idx]
}

/// Sort the per-block times and print the distribution: mean against the tail,
/// plus deadline misses at both budgets.
fn summarize(label: &str, times: &mut [f64]) {
    let n = times.len();
    let mean = times.iter().sum::<f64>() / n as f64;
    times.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let max = times[n - 1];
    let xruns_comfy = times.iter().filter(|&&t| t > BUDGET_NS).count();
    let xruns_lowlat = times.iter().filter(|&&t| t > LOWLAT_NS).count();

    println!("  {}", label);
    let row = |name: &str, ns: f64| {
        println!(
            "      {:6}  {:8.1} µs   ({:6.3}% of the 5.3 ms budget)",
            name,
            ns / 1e3,
            ns / BUDGET_NS * 100.0
        );
    };
    row("mean", mean);
    row("p50", percentile(times, 50.0));
    row("p99", percentile(times, 99.0));
    row("p99.9", percentile(times, 99.9));
    row("max", max);
    println!(
        "      dropouts:  {} at 5.3 ms (256-smp)   |   {} at 0.67 ms (32-smp, low-latency)\n",
        xruns_comfy, xruns_lowlat
    );
}

fn measure(graph: &mut Graph, villain: bool) -> Vec<f64> {
    for _ in 0..500 {
        graph.render(); // warm up caches / branch predictor
    }
    let mut times = Vec::with_capacity(ITERS);
    for i in 0..ITERS {
        let t = Instant::now();
        graph.render();
        if villain && i % VILLAIN_EVERY == 0 {
            // FORBIDDEN on the audio thread: allocate and touch memory.
            let mut junk = vec![0.0f32; FORBIDDEN_FLOATS];
            for x in junk.iter_mut() {
                *x += 1.0;
            }
            black_box(junk.as_ptr());
        }
        times.push(t.elapsed().as_nanos() as f64);
        black_box(graph.master[0]);
    }
    times
}

fn main() {
    println!("EXPERIMENT 3: the worst-case rig — measure the tail, not the mean");
    println!("----------------------------------------------------------------");
    println!(
        "block {} samples | {} blocks timed individually | budget {:.3} ms\n",
        BLOCK_SIZE,
        ITERS,
        BUDGET_NS / 1e6
    );

    // ---- PART 1: the honest distribution of a clean graph -----------------
    println!("PART 1 — a clean 16-voice graph: the mean hides a tail\n");
    let mut g = Graph::new(16);
    let mut clean = measure(&mut g, false);
    summarize("16 voices, no mistakes", &mut clean);
    println!("  → even with a perfectly clean render, the worst block is several times the");
    println!("    mean. That spread is the OS scheduler, not our code — and it's exactly what");
    println!("    a single average would have hidden from us.\n");

    // ---- PART 2: the choke -------------------------------------------------
    println!("PART 2 — the choke: scale voices until the AVERAGE block blows the budget\n");
    println!("  voices |  mean block  | % of budget | verdict");
    println!("  -------+--------------+-------------+-----------------------------");
    for &n in &[64usize, 256, 1024, 4096] {
        let mut gg = Graph::new(n);
        for _ in 0..50 {
            gg.render();
        }
        let blocks = 300;
        let t = Instant::now();
        for _ in 0..blocks {
            gg.render();
            black_box(gg.master[0]);
        }
        let per = t.elapsed().as_secs_f64() * 1e9 / blocks as f64;
        let pct = per / BUDGET_NS * 100.0;
        let verdict = if per > BUDGET_NS {
            "✗ OVER — every block is a dropout"
        } else if pct > 50.0 {
            "⚠ no headroom left for the tail"
        } else {
            "✓ fits"
        };
        println!(
            "  {:>6} | {:>9.0} µs | {:>9.1}% | {}",
            n,
            per / 1e3,
            pct,
            verdict
        );
    }
    println!("\n  → one core saturates somewhere in the low thousands of voices. That ceiling");
    println!("    is what the parallel-graph and SIMD rungs are for — more voices per core.\n");

    // ---- PART 3: why the commandments exist --------------------------------
    println!("PART 3 — one forbidden allocation, every {} blocks (0.1% of them)\n", VILLAIN_EVERY);
    let mut g2 = Graph::new(16);
    let mut dirty = measure(&mut g2, true);
    summarize("16 voices + a 4 MB alloc on the audio thread", &mut dirty);

    let clean_mean = clean.iter().sum::<f64>() / clean.len() as f64;
    let dirty_mean = dirty.iter().sum::<f64>() / dirty.len() as f64;
    let clean_max = clean[clean.len() - 1];
    let dirty_max = dirty[dirty.len() - 1];
    println!("  the punchline:");
    println!(
        "  • mean moved {:.0}µs → {:.0}µs ({:+.0}%) — you'd never notice in an average.",
        clean_mean / 1e3,
        dirty_mean / 1e3,
        (dirty_mean - clean_mean) / clean_mean * 100.0
    );
    println!(
        "  • but the WORST block went {:.0}µs → {:.0}µs ({:.0}× bigger).",
        clean_max / 1e3,
        dirty_max / 1e3,
        dirty_max / clean_max
    );
    println!("  • THIS is why the audio thread may never allocate, lock, or touch the disk:");
    println!("    one rare unbounded op is invisible to the average and fatal to the tail.");
}
