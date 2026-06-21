# The objective

We are using an autonomous agent loop to **discover better audio-engine
architectures** for a next-generation DAW. Agents propose engine
implementations; an objective benchmark scores them; the best survive and get
mutated again. This file is the fixed target every agent optimizes toward. It
changes only by deliberate human decision — never by an agent.

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
