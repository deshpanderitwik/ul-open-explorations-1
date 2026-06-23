//! Wire types for the control protocol — see spec/protocol.md.
//!
//! Commands deserialize from one NDJSON line (`{"cmd": "...", ...}`); events
//! serialize to one NDJSON line (`{"event": "...", ...}`).

use serde::{Deserialize, Serialize};

/// A command from the client. Tagged on the `cmd` field.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
pub enum Command {
    Load {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<i64>,
    },
    AddVoice {
        freq: f32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        track: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<i64>,
    },
    ClearVoices {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        track: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<i64>,
    },
    LoadSample {
        sample: String,
        data: Vec<f32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<i64>,
    },
    AddSampleVoice {
        sample: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        track: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        gain: Option<f32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        mode: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<i64>,
    },
    SetTempo {
        bpm: f32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<i64>,
    },
    Transport {
        action: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pos: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<i64>,
    },
    AddTrack {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        gain: Option<f32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pan: Option<f32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<i64>,
    },
    SetTrackGain {
        track: u32,
        gain: f32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<i64>,
    },
    SetTrackPan {
        track: u32,
        pan: f32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<i64>,
    },
    SetMasterGain {
        gain: f32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<i64>,
    },
    Render {
        blocks: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<i64>,
    },
    GetState {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<i64>,
    },
    Quit {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<i64>,
    },
}

/// An event from the engine. Tagged on the `event` field.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum Event {
    Ready {
        version: String,
    },
    Ok {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<i64>,
    },
    Error {
        message: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<i64>,
    },
    TrackAdded {
        index: usize,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<i64>,
    },
    SampleLoaded {
        sample: String,
        frames: usize,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<i64>,
    },
    Meter {
        rms: f32,
        peak: f32,
        voices: usize,
        rms_l: f32,
        rms_r: f32,
        peak_l: f32,
        peak_r: f32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<i64>,
    },
    State {
        sample_rate: f32,
        block_size: usize,
        tempo_bpm: f32,
        playing: bool,
        position_samples: u64,
        voices: usize,
        channels: u32,
        master_gain: f32,
        tracks: Vec<TrackInfo>,
        samples: Vec<SampleInfo>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<i64>,
    },
    Bye,
}

/// Per-sample summary carried in the `state` event's `samples` list.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SampleInfo {
    pub sample: String,
    pub frames: usize,
}

/// Per-track summary carried in the `state` event's `tracks` list.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TrackInfo {
    pub index: usize,
    pub gain: f32,
    pub pan: f32,
    pub voices: usize,
}

impl Command {
    /// Parse a command from one JSON line. Returns an error on unknown/invalid
    /// commands rather than panicking.
    pub fn parse(line: &str) -> Result<Command, serde_json::Error> {
        serde_json::from_str(line)
    }
}

impl Event {
    /// Serialize this event to one JSON line (no trailing newline).
    pub fn to_line(&self) -> String {
        // Event serialization never fails for these types.
        serde_json::to_string(self).expect("event serialization is infallible")
    }
}
