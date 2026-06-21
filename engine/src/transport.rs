//! Minimal transport — the clock. Seed for rung 2.

pub struct Transport {
    /// Retained for rung-2 tempo/sample math (bars↔samples); not yet read.
    #[allow(dead_code)]
    sample_rate: f32,
    bpm: f32,
    playing: bool,
    position_samples: u64,
}

impl Transport {
    /// Default 120 bpm, stopped, position 0.
    pub fn new(sample_rate: f32) -> Self {
        Transport {
            sample_rate,
            bpm: 120.0,
            playing: false,
            position_samples: 0,
        }
    }

    pub fn set_tempo(&mut self, bpm: f32) {
        self.bpm = bpm;
    }

    pub fn play(&mut self) {
        self.playing = true;
    }

    pub fn stop(&mut self) {
        self.playing = false;
    }

    pub fn seek(&mut self, pos_samples: u64) {
        self.position_samples = pos_samples;
    }

    /// If playing, advance the position by `frames`.
    pub fn advance(&mut self, frames: u64) {
        if self.playing {
            self.position_samples += frames;
        }
    }

    pub fn bpm(&self) -> f32 {
        self.bpm
    }

    pub fn playing(&self) -> bool {
        self.playing
    }

    pub fn position_samples(&self) -> u64 {
        self.position_samples
    }
}
