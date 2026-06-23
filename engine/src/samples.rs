//! Sample playback — rung 4.
//!
//! The engine plays raw mono PCM; it does not decode files. A `SampleBank` owns
//! the named PCM buffers (allocated at load time, off the render path). A
//! `SampleVoices` bank lives on each mixer track and reads those buffers through
//! playback cursors, summing into the track's mono signal before the rung-3 pan.
//!
//! Real-time rules: buffers are allocated only in `load`. Advancing cursors,
//! wrapping loops, and removing finished one-shots in `mix_into` allocate
//! nothing (finished one-shots are dropped in place with `swap_remove`).

/// One loaded PCM buffer, keyed by a string id.
pub struct SampleBuffer {
    pub id: String,
    pub data: Vec<f32>,
}

/// The set of loaded sample buffers. Lookups are by string id; an interned
/// index is handed to voices so the render path never touches strings.
pub struct SampleBank {
    buffers: Vec<SampleBuffer>,
}

impl SampleBank {
    pub fn new() -> Self {
        SampleBank {
            buffers: Vec::new(),
        }
    }

    pub fn clear(&mut self) {
        self.buffers.clear();
    }

    /// Load (or replace) a named buffer. Allocation happens here, off the render
    /// path. Returns the frame count. An empty buffer is rejected by the caller.
    pub fn load(&mut self, id: &str, data: Vec<f32>) -> usize {
        let frames = data.len();
        if let Some(b) = self.buffers.iter_mut().find(|b| b.id == id) {
            b.data = data;
        } else {
            self.buffers.push(SampleBuffer {
                id: id.to_string(),
                data,
            });
        }
        frames
    }

    /// Index of a loaded buffer by id, or None if unknown.
    pub fn index_of(&self, id: &str) -> Option<usize> {
        self.buffers.iter().position(|b| b.id == id)
    }

    #[inline(always)]
    pub fn data(&self, index: usize) -> &[f32] {
        &self.buffers[index].data
    }

    /// (id, frames) for each loaded buffer, for `get_state`.
    pub fn iter(&self) -> impl Iterator<Item = (&str, usize)> + '_ {
        self.buffers
            .iter()
            .map(|b| (b.id.as_str(), b.data.len()))
    }
}

impl Default for SampleBank {
    fn default() -> Self {
        Self::new()
    }
}

/// How a sample voice plays out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlayMode {
    OneShot,
    Loop,
}

/// One active sample voice: a cursor into a loaded buffer.
struct SampleVoice {
    /// Index into the owning bank's `SampleBank`.
    buffer: usize,
    /// Read position, in frames.
    cursor: usize,
    gain: f32,
    mode: PlayMode,
}

/// The sample voices on a single mixer track.
pub struct SampleVoices {
    voices: Vec<SampleVoice>,
}

impl SampleVoices {
    pub fn new() -> Self {
        SampleVoices { voices: Vec::new() }
    }

    /// Register a voice. Setup-time only — allocation here is fine.
    pub fn add(&mut self, buffer: usize, gain: f32, mode: PlayMode) {
        self.voices.push(SampleVoice {
            buffer,
            cursor: 0,
            gain,
            mode,
        });
    }

    pub fn clear(&mut self) {
        self.voices.clear();
    }

    pub fn count(&self) -> usize {
        self.voices.len()
    }

    /// Sum every active voice into `out` (the track's mono signal), advancing
    /// each cursor. Loop voices wrap; finished one-shots are removed in place.
    ///
    /// Real-time-safe: no allocation. `swap_remove` keeps removal O(1) without
    /// reallocating; iterating an index lets us remove while walking.
    pub fn mix_into(&mut self, out: &mut [f32], bank: &SampleBank) {
        let mut v = 0;
        while v < self.voices.len() {
            let voice = &mut self.voices[v];
            let data = bank.data(voice.buffer);
            let len = data.len();
            if len == 0 {
                // Defensive: empty buffers are rejected at load, but never spin.
                self.voices.swap_remove(v);
                continue;
            }
            let g = voice.gain;
            let mut cursor = voice.cursor;
            let mut finished = false;
            for s in out.iter_mut() {
                if cursor >= len {
                    match voice.mode {
                        PlayMode::Loop => cursor = 0,
                        PlayMode::OneShot => {
                            finished = true;
                            break;
                        }
                    }
                }
                *s += g * data[cursor];
                cursor += 1;
            }
            if finished {
                self.voices.swap_remove(v);
                // Do not advance v: the swapped-in voice now occupies this slot.
            } else {
                voice.cursor = cursor;
                v += 1;
            }
        }
    }
}

impl Default for SampleVoices {
    fn default() -> Self {
        Self::new()
    }
}
