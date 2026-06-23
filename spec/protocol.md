# The control protocol — the engine/UI boundary

This is the keystone of the whole project. The DAW engine is **headless**: it has
no UI of its own. Everything — every UI on every platform, and every automated
test — drives it through this one protocol. That means:

- The swarm builds and **golden-tests the protocol**, never pixels.
- Your UI (mobile first, desktop later) is a **client** of this protocol.
- A feature isn't "done" until it's a set of commands + events with golden tests.

## Transport

Newline-delimited JSON (NDJSON) over stdio for now (`engine/src/bin/headless.rs`).
The exact same message shapes are intended to travel later over an FFI bridge
(C ABI) or an IPC socket without changing — only the carrier changes. One command
per input line; zero or more event lines out per command.

## Envelopes

**Command** (client → engine):
```jsonc
{ "cmd": "<name>", "id": 7, /* optional fields */ }
```
`id` is an optional client-chosen integer; if present it is echoed on the
acknowledging event so clients can correlate.

**Event** (engine → client):
```jsonc
{ "event": "<name>", "id": 7, /* optional fields */ }
```

## Commands (current surface — grows one rung at a time)

| cmd | fields | rung | effect |
|---|---|---|---|
| `load` | — | 1 | reset the engine to an empty project (creates default track 0) |
| `add_voice` | `freq` (f32), `track`? (u32, default 0) | 1 | add a sine voice to a track |
| `clear_voices` | `track`? (u32; omitted = all) | 1 | remove voices |
| `set_tempo` | `bpm` (f32) | 2 | set transport tempo |
| `transport` | `action` ("play"/"stop"/"seek"), `pos`? (samples) | 2 | drive the clock |
| `add_track` | `gain`? (f32, default 1.0), `pan`? (f32 [-1,1], default 0) | 3 | add a mixer track; emits `track_added` |
| `set_track_gain` | `track` (u32), `gain` (f32) | 3 | set a track's linear gain |
| `set_track_pan` | `track` (u32), `pan` (f32 [-1,1]) | 3 | set a track's stereo pan |
| `set_master_gain` | `gain` (f32) | 3 | set the master bus gain |
| `render` | `blocks` (u32) | 1 | render N audio blocks; emit a `meter` |
| `get_state` | — | 1 | emit current `state` |
| `quit` | — | 1 | shut down (emits `bye`) |

## Events (engine → client)

| event | fields | meaning |
|---|---|---|
| `ready` | `version` | emitted once at startup |
| `ok` | `id`? | command acknowledged |
| `error` | `message`, `id`? | command rejected (unknown cmd, bad args) |
| `track_added` | `index`, `id`? | a mixer track was created (rung 3) |
| `meter` | `rms`, `peak`, `voices`, `rms_l`, `rms_r`, `peak_l`, `peak_r` | post-render level summary; `rms`/`peak` are the max across channels (rung 3 added the per-channel fields) |
| `state` | `sample_rate`, `block_size`, `tempo_bpm`, `playing`, `position_samples`, `voices`, `channels`, `master_gain`, `tracks` | full engine state; `channels`/`master_gain`/`tracks` added in rung 3. `tracks` is a list of `{index, gain, pan, voices}` |
| `bye` | — | shutting down |

## Determinism (why golden tests work)

Until real audio I/O lands (a later rung), `render` is **synchronous and
deterministic**: the same command script always produces the same events. So a
golden test is just "feed this command script, assert the event stream matches
(numbers within a tolerance)." That is the generalized evaluation surface for
every protocol-level rung — see `spec/ladder/` and `evaluator/`.

## Rules

- The protocol is **append-only and versioned**. Adding a rung adds commands and
  events; it must not break existing ones (the regression suite enforces this).
- Engine-side, command handling on the audio render path still obeys the
  real-time rules (no alloc/lock/IO in `render`); setup commands (`add_voice`,
  `load`) may allocate.
