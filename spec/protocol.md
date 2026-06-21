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
| `load` | — | 1 | reset the engine to an empty project |
| `add_voice` | `freq` (f32) | 1 | add a sine voice |
| `clear_voices` | — | 1 | remove all voices |
| `set_tempo` | `bpm` (f32) | 2 | set transport tempo |
| `transport` | `action` ("play"/"stop"/"seek"), `pos`? (samples) | 2 | drive the clock |
| `render` | `blocks` (u32) | 1 | render N audio blocks; emit a `meter` |
| `get_state` | — | 1 | emit current `state` |
| `quit` | — | 1 | shut down (emits `bye`) |

## Events (engine → client)

| event | fields | meaning |
|---|---|---|
| `ready` | `version` | emitted once at startup |
| `ok` | `id`? | command acknowledged |
| `error` | `message`, `id`? | command rejected (unknown cmd, bad args) |
| `meter` | `rms`, `peak`, `voices` | post-render level summary |
| `state` | `sample_rate`, `block_size`, `tempo_bpm`, `playing`, `position_samples`, `voices` | full engine state |
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
