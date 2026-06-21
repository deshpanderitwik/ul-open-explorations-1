//! The mainline headless DAW engine — protocol-driven, deterministic `render`.

pub mod protocol;
pub mod synth;
pub mod transport;

use protocol::{Command, Event};
use transport::Transport;

// Public re-export: the core synth type the perf harness and FFI/UI consumers use.
pub use synth::Synth;

pub struct Daw {
    synth: Synth,
    transport: Transport,
    sample_rate: f32,
    block_size: usize,
    /// Preallocated render scratch, length `block_size`. Never reallocated on the
    /// render path.
    scratch: Vec<f32>,
}

impl Default for Daw {
    fn default() -> Self {
        Self::new()
    }
}

impl Daw {
    pub fn new() -> Self {
        let sample_rate = 48000.0;
        let block_size = 256;
        Daw {
            synth: Synth::new(sample_rate, block_size),
            transport: Transport::new(sample_rate),
            sample_rate,
            block_size,
            scratch: vec![0.0; block_size],
        }
    }

    /// Handle one command, returning the events it produces.
    pub fn handle(&mut self, cmd: Command) -> Vec<Event> {
        match cmd {
            Command::Load { id } => {
                self.synth.clear();
                self.transport.stop();
                self.transport.seek(0);
                vec![Event::Ok { id }]
            }
            Command::AddVoice { freq, id } => {
                self.synth.add_voice(freq);
                vec![Event::Ok { id }]
            }
            Command::ClearVoices { id } => {
                self.synth.clear();
                vec![Event::Ok { id }]
            }
            Command::SetTempo { bpm, id } => {
                self.transport.set_tempo(bpm);
                vec![Event::Ok { id }]
            }
            Command::Transport { action, pos, id } => match action.as_str() {
                "play" => {
                    self.transport.play();
                    vec![Event::Ok { id }]
                }
                "stop" => {
                    self.transport.stop();
                    vec![Event::Ok { id }]
                }
                "seek" => {
                    self.transport.seek(pos.unwrap_or(0));
                    vec![Event::Ok { id }]
                }
                other => vec![Event::Error {
                    message: format!("unknown transport action: {other}"),
                    id,
                }],
            },
            Command::Render { blocks, id } => {
                let mut peak: f32 = 0.0;
                let mut sum_sq: f64 = 0.0;
                let mut count: u64 = 0;
                for _ in 0..blocks {
                    self.synth.render(&mut self.scratch);
                    for &s in self.scratch.iter() {
                        let a = s.abs();
                        if a > peak {
                            peak = a;
                        }
                        sum_sq += (s as f64) * (s as f64);
                        count += 1;
                    }
                }
                self.transport
                    .advance(blocks as u64 * self.block_size as u64);
                let rms = if count > 0 {
                    (sum_sq / count as f64).sqrt() as f32
                } else {
                    0.0
                };
                vec![Event::Meter {
                    rms,
                    peak,
                    voices: self.synth.voice_count(),
                    id,
                }]
            }
            Command::GetState { id } => vec![Event::State {
                sample_rate: self.sample_rate,
                block_size: self.block_size,
                tempo_bpm: self.transport.bpm(),
                playing: self.transport.playing(),
                position_samples: self.transport.position_samples(),
                voices: self.synth.voice_count(),
                id,
            }],
            Command::Quit { .. } => vec![Event::Bye],
        }
    }
}
