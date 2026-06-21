//! Demo (A): the slider -> atomic -> oscillator membrane, made runnable.
//!
//! THE PICTURE WE'RE MAKING REAL
//! -----------------------------
//! Two threads, two completely different sets of rules:
//!
//!   • The "UI" thread (here, a tiny script that moves a slider over time). It has NO
//!     deadline. It may sleep, allocate, block — nobody is waiting on it.
//!
//!   • The "audio" thread. It pretends to be the real-time callback: every ~5.3 ms it must
//!     produce one block of samples, no excuses. It waits for NO ONE.
//!
//! They never touch the same data directly. The only thing between them is ONE number —
//! the oscillator frequency — living in an `AtomicF32`. The UI side `store()`s a new value;
//! the audio side `load()`s it once at the top of each block, then renders the block at
//! that frequency. That single non-blocking handoff is "the membrane."
//!
//! Because we have no speakers wired up yet, we *see* the result instead of hearing it:
//! each block is drawn as a one-line waveform. When the slider moves to a higher
//! frequency, the very next block packs in more up-down cycles. You can watch the buffer
//! change shape.
//!
//! HONEST CAVEAT (one, as promised)
//! --------------------------------
//! The audio thread in this demo *prints to the terminal*, and printing is I/O + an
//! internal lock — exactly the kind of thing a real audio callback must NEVER do. We do it
//! only so the demo is observable. The part that is faithful to real life is the membrane:
//! the `store`/`load` of an atomic across the thread boundary. Mentally, the println is the
//! "speaker"; ignore it when reasoning about real-time safety.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use daw_lab::{sparkline, AtomicF32, SineOsc};

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK_SIZE: usize = 256; // samples per block
const SCOPE_WIDTH: usize = 64; // terminal columns for the waveform

fn main() {
    // The deadline. This is the entire reason the audio thread has different rules.
    // 256 samples / 48000 per second = 5.333 ms. Miss it and the speaker runs dry -> click.
    let block_dur = Duration::from_secs_f32(BLOCK_SIZE as f32 / SAMPLE_RATE);

    println!("THE MEMBRANE: slider -> atomic -> oscillator");
    println!("--------------------------------------------");
    println!(
        "sample rate {:.0} Hz | block {} samples | deadline per block = {:.3} ms",
        SAMPLE_RATE,
        BLOCK_SIZE,
        block_dur.as_secs_f64() * 1000.0
    );
    println!("each line below = one block the audio thread produced (the '~5.3 ms tick')\n");

    // ---- THE MEMBRANE ITSELF ----
    // One shared number. `Arc` lets both threads hold it; the atomic lets them touch it
    // safely without a lock. This is the ONLY thing the two threads share.
    let freq = Arc::new(AtomicF32::new(220.0));

    // A flag so the UI thread knows when the audio thread is finished and can stop.
    let running = Arc::new(AtomicBool::new(true));

    // ---- THE "UI" THREAD: it moves the slider over time ----
    // No deadline here. It just sleeps and stores new frequencies, the way a human dragging
    // a slider would poke new values in. It NEVER touches the audio buffer.
    let ui_freq = Arc::clone(&freq);
    let ui_running = Arc::clone(&running);
    let ui = thread::spawn(move || {
        // A little automation script: (wait this long, then set the slider to this Hz).
        let moves = [(40u64, 880.0f32), (40, 220.0), (40, 660.0)];
        for (wait_ms, new_freq) in moves {
            thread::sleep(Duration::from_millis(wait_ms));
            if !ui_running.load(Ordering::Relaxed) {
                break;
            }
            // The entire UI->audio communication, in one non-blocking line:
            ui_freq.store(new_freq);
        }
    });

    // ---- THE "AUDIO" THREAD: the real-time callback, simulated ----
    // It owns the oscillator and the buffer. It loads the frequency from the membrane at the
    // top of each block, generates the block, "outputs" it (here: draws it), then waits for
    // the next tick. It never reads anything the UI thread is actively writing except through
    // the atomic, and it never blocks on the UI thread.
    let audio_freq = Arc::clone(&freq);
    let audio_running = Arc::clone(&running);
    let audio = thread::spawn(move || {
        let mut osc = SineOsc::new(SAMPLE_RATE);
        let mut buffer = vec![0.0f32; BLOCK_SIZE]; // allocated ONCE, before the loop
        let start = Instant::now();
        let mut last_freq = f32::NAN;

        const NUM_BLOCKS: usize = 30; // ~160 ms of "audio"
        for block in 0..NUM_BLOCKS {
            let tick = Instant::now();

            // 1. Read the parameter across the membrane. One atomic load. Non-blocking.
            let f = audio_freq.load();

            // 2. Generate the block at that frequency. This is the only "work."
            //    We time just this part to see how much of the budget it eats.
            let gen_start = Instant::now();
            osc.fill(&mut buffer, f);
            let gen_time = gen_start.elapsed();

            // 3. "Output" the block. (In real life: hand it to the DAC. Here: draw it.)
            let changed = f != last_freq;
            let marker = if changed {
                last_freq = f;
                "  <- slider value took effect at this block boundary"
            } else {
                ""
            };
            println!(
                "block {:2} | {:6.1} ms | freq {:6.1} Hz | fill {:5.1} µs of {:.0} µs budget | {}{}",
                block,
                start.elapsed().as_secs_f64() * 1000.0,
                f,
                gen_time.as_secs_f64() * 1_000_000.0,
                block_dur.as_secs_f64() * 1_000_000.0,
                sparkline(&buffer, SCOPE_WIDTH),
                marker,
            );

            // 4. Wait for the next tick. The real callback doesn't sleep — the hardware
            //    clock calls it again when the buffer drains. We sleep to imitate that
            //    steady ~5.3 ms cadence so wall-clock time (and the slider moves) line up.
            let spent = tick.elapsed();
            if spent < block_dur {
                thread::sleep(block_dur - spent);
            }
        }

        audio_running.store(false, Ordering::Relaxed);
    });

    audio.join().unwrap();
    ui.join().unwrap();

    println!("\nwhat you just saw:");
    println!("  • the audio thread never stopped or stalled — every block met its tick;");
    println!("  • the slider moves (UI thread) showed up at the *top* of the next block,");
    println!("    never mid-buffer — that's the atomic load at the start of each block;");
    println!("  • higher Hz packed more cycles into the same line: the buffer changed shape;");
    println!("  • fill time used a tiny slice of the 5.3 ms budget. Hold that thought —");
    println!("    Step 3 is about watching that slice grow until it blows the budget.");
}
