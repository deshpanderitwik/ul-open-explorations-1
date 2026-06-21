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
        id: Option<i64>,
    },
    ClearVoices {
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
    Meter {
        rms: f32,
        peak: f32,
        voices: usize,
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
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<i64>,
    },
    Bye,
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
