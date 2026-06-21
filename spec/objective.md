# The objective

We are using an agent swarm to **build a complete DAW**, one component at a time,
by climbing the capability ladder in [`ladder/`](./ladder/README.md). The swarm
implements each rung against a contract, an objective evaluator scores it, and
the winner is merged into the mainline `engine/`. The target is a headless,
real-time-safe, fully-scriptable DAW engine driven entirely through the control
protocol ([`protocol.md`](./protocol.md)) — mobile groovebox first, desktop next
— that any UI can be built on top of.

This file and everything under `spec/` and `evaluator/` are the fixed target and
measuring stick. They change only by deliberate human decision — never by an
agent. The single-number throughput goal below is **rung 1** of the ladder; later
rungs add correctness-gated features (transport, mixer, sampler, sequencer, …).

## What "better" means, in one sentence

> Render the most simultaneous voices per CPU core while never missing the
> real-time deadline and never breaking the real-time rules.

A DAW is judged by its **worst** block, not its average. An engine that is fast
on average but stalls once a second puts an audible click in the recording, and
is worthless. So the bar is: correct, real-time-safe, dropout-free — *and then*
as much throughput (voices/core) as possible.

## The fitness signal (summary)

Defined precisely in [`metrics.md`](./metrics.md) and computed only by
`evaluator/score.py`:

1. **Gates** (any failure → fitness 0): the engine compiles, produces correct
   audio, performs **zero heap allocations on the render path**, and drops zero
   blocks at the comfortable budget.
2. **Fitness** (when gates pass): the maximum number of voices that still render
   under **half** the per-block budget — throughput with headroom for the tail.

The numbers are produced by an evaluator-owned harness, not by the candidate, so
they cannot be faked. See [`constraints.md`](./constraints.md) for the rules and
the exact API a candidate must expose.

## Scope for now

- Single-core throughput of a polyphonic sine synth + master gain is the v0
  workload. It is a stand-in: it exercises the hot path (per-sample math over a
  block) the way a real engine does, and it has obvious, legitimate optimization
  headroom (SIMD, blocked math, wavetables, smarter memory layout).
- Later milestones widen the workload (effects chains, multi-core graphs, real
  I/O). The contract is designed so those can be added without a rewrite.

## What is explicitly out of bounds for agents

- Editing anything under `spec/` or `evaluator/` (the goal and the measuring
  stick are human-owned).
- "Winning" by weakening the benchmark, special-casing its exact inputs, or
  producing silence/garbage that happens to be fast. These fail the gates by
  design; doing them is the failure mode we are guarding against, not a strategy.
