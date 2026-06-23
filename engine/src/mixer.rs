//! The mixer — rung 3.
//!
//! A `Mixer` owns a set of `Track`s. Each track holds its own `Synth` voice bank
//! (reused UNCHANGED from `synth.rs`), a linear `gain` and an equal-power `pan`.
//! Tracks render mono, are placed into the stereo bus by their pan law and gain,
//! summed, then scaled by the master gain.
//!
//! Real-time rules: ALL scratch (the per-track mono buffer and the L/R
//! accumulation buffers) is pre-allocated in `new`/`add_track`. `render_stereo`
//! allocates nothing, takes no locks, does no I/O.

use crate::samples::{PlayMode, SampleBank, SampleVoices};
use crate::synth::Synth;

use std::f32::consts::PI;

/// One mixer track: a voice bank plus its level and stereo position.
pub struct Track {
    pub synth: Synth,
    /// Sample-player voices on this track (rung 4).
    pub samples: SampleVoices,
    /// Linear gain, default 1.0.
    pub gain: f32,
    /// Pan in [-1, 1]; -1 = full left, 0 = center, +1 = full right.
    pub pan: f32,
}

impl Track {
    fn new(sample_rate: f32, block_size: usize, gain: f32, pan: f32) -> Self {
        Track {
            synth: Synth::new(sample_rate, block_size),
            samples: SampleVoices::new(),
            gain,
            pan: pan.clamp(-1.0, 1.0),
        }
    }

    /// Equal-power pan law: left = cos(t), right = sin(t),
    /// where t = (pan + 1) / 2 * PI/2. Returns (left_gain, right_gain),
    /// already folded together with the track gain.
    #[inline(always)]
    fn channel_gains(&self) -> (f32, f32) {
        let t = (self.pan + 1.0) * 0.5 * (PI * 0.5);
        (self.gain * t.cos(), self.gain * t.sin())
    }
}

pub struct Mixer {
    sample_rate: f32,
    block_size: usize,
    tracks: Vec<Track>,
    /// Loaded PCM buffers shared by all sample voices (rung 4).
    sample_bank: SampleBank,
    /// Master bus gain, applied last. Default 0.8.
    master_gain: f32,
    /// Pre-allocated per-track mono render buffer. Reused every block.
    mono_scratch: Vec<f32>,
    /// Pre-allocated stereo accumulation buffers (planar). Reused every block.
    acc_l: Vec<f32>,
    acc_r: Vec<f32>,
}

impl Mixer {
    pub fn new(sample_rate: f32, block_size: usize) -> Self {
        Mixer {
            sample_rate,
            block_size,
            tracks: Vec::new(),
            sample_bank: SampleBank::new(),
            master_gain: 0.8,
            mono_scratch: vec![0.0; block_size],
            acc_l: vec![0.0; block_size],
            acc_r: vec![0.0; block_size],
        }
    }

    /// Reset to a single default track at index 0 (so existing rung-1/2 behavior
    /// with `add_voice` and no explicit track keeps working).
    pub fn reset_default(&mut self) {
        self.tracks.clear();
        self.sample_bank.clear();
        self.master_gain = 0.8;
        self.tracks
            .push(Track::new(self.sample_rate, self.block_size, 1.0, 0.0));
    }

    /// Load (or replace) a named PCM buffer. Setup-time only. Returns frames.
    pub fn load_sample(&mut self, id: &str, data: Vec<f32>) -> usize {
        self.sample_bank.load(id, data)
    }

    /// Route a sample voice to a track. Returns false if either the track index
    /// or the sample id is unknown.
    pub fn add_sample_voice(
        &mut self,
        track: usize,
        sample: &str,
        gain: f32,
        mode: PlayMode,
    ) -> bool {
        let buffer = match self.sample_bank.index_of(sample) {
            Some(i) => i,
            None => return false,
        };
        match self.tracks.get_mut(track) {
            Some(t) => {
                t.samples.add(buffer, gain, mode);
                true
            }
            None => false,
        }
    }

    /// Whether a sample id is loaded (lets the caller distinguish an unknown
    /// sample from an unknown track when adding a voice).
    pub fn index_of_sample(&self, sample: &str) -> Option<usize> {
        self.sample_bank.index_of(sample)
    }

    /// (id, frames) for each loaded buffer, for `get_state`.
    pub fn samples_iter(&self) -> impl Iterator<Item = (&str, usize)> + '_ {
        self.sample_bank.iter()
    }

    /// Add a track; returns its index. Setup-time only — allocation is fine here.
    pub fn add_track(&mut self, gain: f32, pan: f32) -> usize {
        self.tracks
            .push(Track::new(self.sample_rate, self.block_size, gain, pan));
        self.tracks.len() - 1
    }

    pub fn track_count(&self) -> usize {
        self.tracks.len()
    }

    /// Route a voice to a track's Synth. Returns false if the index is invalid.
    pub fn add_voice(&mut self, track: usize, freq: f32) -> bool {
        match self.tracks.get_mut(track) {
            Some(t) => {
                t.synth.add_voice(freq);
                true
            }
            None => false,
        }
    }

    /// Clear voices on one track, or all tracks if `track` is None.
    pub fn clear_voices(&mut self, track: Option<usize>) {
        match track {
            Some(i) => {
                if let Some(t) = self.tracks.get_mut(i) {
                    t.synth.clear();
                    t.samples.clear();
                }
            }
            None => {
                for t in self.tracks.iter_mut() {
                    t.synth.clear();
                    t.samples.clear();
                }
            }
        }
    }

    pub fn set_track_gain(&mut self, track: usize, gain: f32) -> bool {
        match self.tracks.get_mut(track) {
            Some(t) => {
                t.gain = gain;
                true
            }
            None => false,
        }
    }

    pub fn set_track_pan(&mut self, track: usize, pan: f32) -> bool {
        match self.tracks.get_mut(track) {
            Some(t) => {
                t.pan = pan.clamp(-1.0, 1.0);
                true
            }
            None => false,
        }
    }

    pub fn set_master_gain(&mut self, gain: f32) {
        self.master_gain = gain;
    }

    pub fn master_gain(&self) -> f32 {
        self.master_gain
    }

    /// Total voice count across all tracks (synth + sample voices).
    pub fn total_voices(&self) -> usize {
        self.tracks
            .iter()
            .map(|t| t.synth.voice_count() + t.samples.count())
            .sum()
    }

    /// Per-track summary for `get_state`.
    pub fn tracks_iter(&self) -> impl Iterator<Item = (usize, f32, f32, usize)> + '_ {
        self.tracks
            .iter()
            .enumerate()
            .map(|(i, t)| (i, t.gain, t.pan, t.synth.voice_count() + t.samples.count()))
    }

    /// Render one stereo block into the pre-allocated L/R accumulators.
    ///
    /// The hot path: no allocation, no locks, no I/O. Each track renders mono
    /// into `mono_scratch`, is placed into L/R via its (gain-folded) pan law, and
    /// summed. The master gain is applied last.
    pub fn render_stereo(&mut self) {
        for s in self.acc_l.iter_mut() {
            *s = 0.0;
        }
        for s in self.acc_r.iter_mut() {
            *s = 0.0;
        }

        let bank = &self.sample_bank;
        for track in self.tracks.iter_mut() {
            // Synth renders mono (zeroing the buffer), then sample voices sum on
            // top, so both voice kinds share the track's gain and pan law.
            track.synth.render(&mut self.mono_scratch);
            track.samples.mix_into(&mut self.mono_scratch, bank);
            let (gl, gr) = track.channel_gains();
            for ((l, r), &m) in self
                .acc_l
                .iter_mut()
                .zip(self.acc_r.iter_mut())
                .zip(self.mono_scratch.iter())
            {
                *l += gl * m;
                *r += gr * m;
            }
        }

        let mg = self.master_gain;
        for s in self.acc_l.iter_mut() {
            *s *= mg;
        }
        for s in self.acc_r.iter_mut() {
            *s *= mg;
        }
    }

    /// The most recently rendered stereo block (planar L, R).
    pub fn stereo_block(&self) -> (&[f32], &[f32]) {
        (&self.acc_l, &self.acc_r)
    }
}
