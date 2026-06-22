# Building a DAW with an agent swarm

An agent swarm that builds a complete DAW by climbing a **capability ladder** one
rung at a time. Each rung is a component with a contract, an objective evaluator,
and golden tests; winners are merged into one growing engine. Mobile groovebox
first, desktop later. The engine is **headless** — every UI is a client of its
JSON control protocol, so you build UI on top of a contract that's already proven
by tests.

## How it works

```
  Architect drafts the next rung ──▶ [you approve contract + tests]
        ▼
  Generators (parallel) implement it ──▶ Evaluator: golden gates + perf + regression
        ▼                                        (rejects anything that fails a gate)
  Select best ──▶ Integrator merges into engine/ ──▶ [you approve the merge]
        ▼
  rung done, next rung opens
```

The keystone: there is **no single fitness for "a DAW."** So we don't evolve a
DAW — we evolve components against contracts and **compound the winners**, with a
regression suite as the ratchet that keeps progress from regressing.

## Layout

```
spec/                 the fixed target (human-owned — agents may not edit)
  objective.md          what we're building and why
  protocol.md           the JSON command/event protocol (the engine/UI boundary)
  profiles.md           mobile vs desktop budgets
  metrics.md            the rung-1 perf fitness formula
  constraints.md        the real-time rules
  ladder/               the capability ladder: one folder per rung
    rung-01-synth-core/    contract.md, budget.md, tests/   ✅ done
    rung-02-transport/     ...                              ✅ done
    rung-03-mixer/         ← next
engine/               THE MAINLINE DAW (compounds; the single source of truth)
  src/lib.rs            the Daw: dispatches protocol commands -> events
  src/synth.rs          rung 1: polyphonic voice engine (gen-1 cubic poly-sine)
  src/transport.rs      rung 2: sample-accurate clock
  src/protocol.rs       command/event wire types
  src/bin/headless.rs   the stdio protocol driver (what UIs/tests talk to)
evaluator/            the ground-truth scorer (human-owned)
  protocol_test.py      golden-test runner (correctness gates, any rung)
  contract/bench.rs     canonical perf harness (alloc tripwire), injected at score time
  score.py              perf benchmark: build -> run -> gate -> fitness
  regression.py         the merge gate: golden + perf across ALL rungs
candidates/           scratch clones of engine/ during evolution (gitignored)
archive/              the program database (runs.jsonl) — the loop's memory
orchestrator/         the loop driver (generate -> evaluate -> select)
mobile/               Expo / React Native app — a CLIENT of the control protocol
  protocol/             transport-agnostic TypeScript protocol client
  tools/smoke.ts        drives the real engine over the protocol (CI gate)
.github/workflows/    CI: protocol smoke test + EAS build -> TestFlight
reference/daw-lab/    the original learning-lab demos this grew out of (read-only)
AGENTS.md / SWARM.md  rules of the game + the swarm's roles and human gates
DEPLOYMENT.md         how the DAW reaches your iPhone as it evolves
CADENCE.md            the rhythm: iterate hourly, integrate per rung, deploy per milestone
dashboard/            static web dashboard (GitHub Pages) — track results between builds
```

## Dashboard

A static dashboard published to **GitHub Pages** lets you watch progress without
reading code: the current champion's numbers, the ladder, fitness over builds,
recent runs, and recent activity. It's regenerated from the repo's own records
(`archive/runs.jsonl`, `spec/ladder/ladder.json`, git log) on every push to main
by `.github/workflows/pages.yml`. One-time setup: repo **Settings → Pages →
Source: GitHub Actions**. Preview locally:

```sh
python dashboard/build.py && (cd dashboard/public && python -m http.server 8765)
# open http://localhost:8765
```

## Getting it on your iPhone

The app is an Expo / React Native client of the engine's protocol. The macOS
build runs on EAS's cloud (no local Mac needed in CI); each merge that touches
the engine builds and ships to TestFlight automatically. The one caveat:
over-the-air updates carry UI changes instantly, but engine (native Rust) rungs
need a new build — automated, a few minutes per rung. Full setup and the
optional instant-engine-OTA path are in [`DEPLOYMENT.md`](./DEPLOYMENT.md).

## Run it

Requires `cargo` and Python 3.10+.

```sh
# Drive the headless engine directly (what a UI does):
printf '%s\n' '{"cmd":"load"}' '{"cmd":"add_voice","freq":440}' \
  '{"cmd":"render","blocks":4}' '{"cmd":"get_state"}' '{"cmd":"quit"}' \
  | ( cd engine && cargo run --release --bin headless )

# Run the regression gate (golden tests across all rungs + perf):
python evaluator/regression.py

# Generate + evaluate candidates against the mainline (LLM generate step):
python orchestrator/loop.py --iters 3 --model sonnet
python orchestrator/loop.py --iters 1 --dry-run     # test plumbing, no LLM
```

## Status

- **Rungs 1–2 integrated and green** in `engine/`: a real-time-safe polyphonic
  synth (~2257 voices/core on the dev box, zero render-path allocations) and a
  sample-accurate transport, both driven over the control protocol.
- The evaluation stack is complete: golden correctness gates, the perf harness
  with its allocation tripwire, and the regression ratchet.
- **Next:** rung 3 (mixer) — multitrack gain/pan/sum, master bus, meters.

## The honest boundary

The swarm can build a complete, correct, real-time-safe, fully-scriptable
**headless DAW engine with a proven API** largely autonomously — all of that has
objective signals. It cannot judge UX taste. So the deliverable is engine + API +
reference UI; you own product and UX decisions on top. That division is exactly
what "build UI on top of it" means.
