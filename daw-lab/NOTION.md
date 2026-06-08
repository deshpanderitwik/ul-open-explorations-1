# NOTION — where daw-lab is going

The plan in one sentence: **grow a DAW one runnable component at a time, and
never add a component you can't watch and measure.** Demo A (`membrane`) is rung
one. This doc lays the rest of the ladder so each experiment has an obvious
"what am I proving, and what's next."

## The clarity: there are TWO kinds of "talk," not one

Your instinct — "start with one component, then two that talk, then go from
there" — is exactly right. The trap is that "talk" means two completely
different things in an audio engine, and they live on different axes. Demo A
already nails one of them; the *next* rung is the other.

### 1. The membrane — vertical talk (parameters, across threads)
The non-real-time **UI thread** pokes a new value at the real-time **audio
thread**. One `AtomicF32` per knob. Non-blocking, bounded, no tearing. This is
`store()` on one side and `load()` at the top of each block on the other.

> **Status: built.** This is the entire point of Demo A.

### 2. The graph — horizontal talk (audio buffers, between nodes)
One processing **node** hands its output block to the **next node** downstream,
*inside the same audio block, on the same thread*. An oscillator fills a buffer;
a gain node reads that buffer and scales it; the result flows to the sink. The
"connection" is just "node B's input is node A's output buffer."

> **Status: NOT built yet. This is your "two components that talk."**

These axes are orthogonal, and that's the load-bearing insight:

```
                 vertical talk = the membrane (params, cross-thread)
                          │
        UI thread ───────►│ AtomicF32 (freq, gain, cutoff, ...)
                          │
   ───────────────────────────────────────────────────────────
   audio thread:   [Osc] ──buffer──► [Gain] ──buffer──► [Sink]
                          horizontal talk = the graph (audio, same thread)
```

**A full DAW is a graph (horizontal) of nodes whose knobs are fed by membranes
(vertical).** Everything below is just adding nodes to the horizontal axis and
membranes to the vertical one, then making it survive scale.

## The vocabulary (the nouns we'll grow)

A deliberately small set. Each rung adds at most one.

| Noun | What it is | Status |
|------|------------|--------|
| **Sample / Block / Buffer** | the units of audio (`[f32]`, `BLOCK_SIZE`) | have it |
| **Node** | anything that fills or transforms a block | `SineOsc` is one, un-generalized |
| **Port / edge** | a node's output buffer wired to the next node's input | rung 2 |
| **Graph** | an ordered set of nodes + their connections; produces the final block | rung 3 |
| **Parameter / Membrane** | one `AtomicF32` per automatable value | have it (one knob) |
| **Transport / clock** | play position, tempo, sample counting | rung 5 |
| **Sink** | where the final block goes (`sparkline` now; a real speaker later) | have it (visual) |

The first real abstraction step is generalizing `SineOsc::fill(&mut buffer, freq)`
into a `Node` trait — something like `fn process(&mut self, io: &mut Ports)` —
so the graph can hold a list of *different* nodes and run them uniformly.

## The ladder (each rung = one runnable bin, measured against the 5.3 ms budget)

1. **One node + one membrane.** ✅ `bin/membrane` — slider → atomic → osc.
2. **Two nodes that talk: `osc → gain`.** ✅ `bin/chain` — introduces the `Node`
   trait and the first node-to-node hand-off (osc fills the buffer, gain reads
   and scales it in place). Also settles the dispatch question: static vs.
   `Vec<Box<dyn Node>>` is within measurement noise, so the runtime-built graph
   a DAW needs costs nothing meaningful. The whole chain is ~0.03% of budget.
3. **The first graph: voices → mixer → gain.** ✅ `bin/mix` — sources fan into a
   mixer (the first multi-input node), then through the `Gain` node. Settles the
   buffer-layout bet by measurement, with a surprise: per-voice buffers beat a
   single accumulator bus by ~45% (flat across 1–64 voices), because the sum
   isolates into a vectorizable loop while accumulation fuses into the
   un-vectorizable oscillator loop. "Always accumulate" was backwards at this
   scale — the bus's real edge is memory (1 KB vs N KB) and routing, not speed.
4. **Knobs on everything.** A membrane per node parameter; one UI thread
   automating several at once. Now both axes are live simultaneously.
5. **Time.** A `Transport`/clock (sample position, tempo) and a sequencer node
   that decides note on/off per block and drives the osc's freq/gate. First
   thing that sounds like *music* instead of a tone.
6. **The choke** (README's step 3). Scale node count until per-block fill blows
   the 5.3 ms budget. Measure *where* it breaks. This is the motivation for...
7. **Threading the graph** (README's step 4). Split the graph into parallel
   branches across cores without breaking the real-time rules.
8. **Real I/O.** Swap the sparkline sink for `cpal` (actual speaker) and the
   atomic for `rtrb` lock-free queues where a single number no longer suffices.
   Now you *hear* it.

From rung 8 the remaining DAW features are mostly *more nodes and more graph*:
a plugin is a node, a track is a sub-graph, a bus is a mixer node, recording is
a sink that also writes a file. The vocabulary doesn't change — it scales.

## What "a full DAW" decomposes into (so the top of the ladder is visible)

- **Graph engine** — nodes + connections + scheduling. ← we build this first
- **Transport** — clock, tempo, loop, play/record position.
- **Plugin hosting** — third-party nodes (VST/CLAP); same `Node` contract.
- **I/O** — audio device in/out, MIDI in, file read/write.
- **Project model** — tracks, clips, automation lanes, undo, save/load.
- **UI** — the only part that's allowed to be slow.

Everything except the last two is a node, an edge, or a membrane.

## Rules of the lab (carried over, non-negotiable)

- **Always `--release` for any timing claim.** Debug builds lie.
- **Every rung is a runnable bin with one honest caveat** about what's faked
  (e.g. the `println` "speaker," the `sleep` that imitates the hardware clock).
- **Reuse the lib.** New nodes and primitives land in `src/lib.rs` so every demo
  draws from one toolbox.

## Immediate next step

Rung 2: `osc → gain` as a new `bin/chain`, introducing the `Node` trait. It's the
smallest possible "two components that talk," and it forces the one abstraction
(the trait) that every later rung depends on. Say the word and I'll scaffold it.
