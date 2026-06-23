//! The mainline headless DAW engine — protocol-driven, deterministic `render`.

pub mod mixer;
pub mod protocol;
pub mod synth;
pub mod transport;

use mixer::Mixer;
use protocol::{Command, Event, TrackInfo};
use transport::Transport;

// Public re-export: the core synth type the perf harness and FFI/UI consumers use.
pub use synth::Synth;

pub struct Daw {
    mixer: Mixer,
    transport: Transport,
    sample_rate: f32,
    block_size: usize,
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
        let mut mixer = Mixer::new(sample_rate, block_size);
        // A fresh engine starts with one default track at index 0, so rung-1/2
        // behavior (`add_voice` with no track) works unchanged.
        mixer.reset_default();
        Daw {
            mixer,
            transport: Transport::new(sample_rate),
            sample_rate,
            block_size,
        }
    }

    /// Handle one command, returning the events it produces.
    pub fn handle(&mut self, cmd: Command) -> Vec<Event> {
        match cmd {
            Command::Load { id } => {
                self.mixer.reset_default();
                self.transport.stop();
                self.transport.seek(0);
                vec![Event::Ok { id }]
            }
            Command::AddVoice { freq, track, id } => {
                let t = track.unwrap_or(0) as usize;
                if self.mixer.add_voice(t, freq) {
                    vec![Event::Ok { id }]
                } else {
                    vec![Event::Error {
                        message: format!("no such track: {t}"),
                        id,
                    }]
                }
            }
            Command::ClearVoices { track, id } => {
                self.mixer.clear_voices(track.map(|t| t as usize));
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
            Command::AddTrack { gain, pan, id } => {
                let index = self
                    .mixer
                    .add_track(gain.unwrap_or(1.0), pan.unwrap_or(0.0));
                vec![Event::TrackAdded { index, id }]
            }
            Command::SetTrackGain { track, gain, id } => {
                let t = track as usize;
                if self.mixer.set_track_gain(t, gain) {
                    vec![Event::Ok { id }]
                } else {
                    vec![Event::Error {
                        message: format!("no such track: {t}"),
                        id,
                    }]
                }
            }
            Command::SetTrackPan { track, pan, id } => {
                let t = track as usize;
                if self.mixer.set_track_pan(t, pan) {
                    vec![Event::Ok { id }]
                } else {
                    vec![Event::Error {
                        message: format!("no such track: {t}"),
                        id,
                    }]
                }
            }
            Command::SetMasterGain { gain, id } => {
                self.mixer.set_master_gain(gain);
                vec![Event::Ok { id }]
            }
            Command::Render { blocks, id } => {
                let mut peak_l: f32 = 0.0;
                let mut peak_r: f32 = 0.0;
                let mut sum_sq_l: f64 = 0.0;
                let mut sum_sq_r: f64 = 0.0;
                let mut count: u64 = 0;
                for _ in 0..blocks {
                    self.mixer.render_stereo();
                    let (l, r) = self.mixer.stereo_block();
                    for (&sl, &sr) in l.iter().zip(r.iter()) {
                        let al = sl.abs();
                        let ar = sr.abs();
                        if al > peak_l {
                            peak_l = al;
                        }
                        if ar > peak_r {
                            peak_r = ar;
                        }
                        sum_sq_l += (sl as f64) * (sl as f64);
                        sum_sq_r += (sr as f64) * (sr as f64);
                        count += 1;
                    }
                }
                self.transport
                    .advance(blocks as u64 * self.block_size as u64);
                let (rms_l, rms_r) = if count > 0 {
                    (
                        (sum_sq_l / count as f64).sqrt() as f32,
                        (sum_sq_r / count as f64).sqrt() as f32,
                    )
                } else {
                    (0.0, 0.0)
                };
                vec![Event::Meter {
                    rms: rms_l.max(rms_r),
                    peak: peak_l.max(peak_r),
                    voices: self.mixer.total_voices(),
                    rms_l,
                    rms_r,
                    peak_l,
                    peak_r,
                    id,
                }]
            }
            Command::GetState { id } => {
                let tracks: Vec<TrackInfo> = self
                    .mixer
                    .tracks_iter()
                    .map(|(index, gain, pan, voices)| TrackInfo {
                        index,
                        gain,
                        pan,
                        voices,
                    })
                    .collect();
                vec![Event::State {
                    sample_rate: self.sample_rate,
                    block_size: self.block_size,
                    tempo_bpm: self.transport.bpm(),
                    playing: self.transport.playing(),
                    position_samples: self.transport.position_samples(),
                    voices: self.mixer.total_voices(),
                    channels: 2,
                    master_gain: self.mixer.master_gain(),
                    tracks,
                    id,
                }]
            }
            Command::Quit { .. } => vec![Event::Bye],
        }
    }
}
