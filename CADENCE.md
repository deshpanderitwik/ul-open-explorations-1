# Cadence — from planning to deploying

The smoothest rhythm comes from running three loops at three speeds and letting
each trigger the next only when it crosses a quality bar — never on a timer, and
never forcing the fast loops to wait on the slow ones.

## The three clocks

| Loop | What happens | Speed | Who |
|---|---|---|---|
| **Iterate** | swarm builds a candidate; evaluator judges it | minutes | automatic |
| **Integrate** | a passing rung auto-merges into `engine/` on green CI | per rung | automatic |
| **Deploy** | a milestone build ships to TestFlight | per milestone | **you** (a tag) |

## The rhythm we chose

- **Iterate — continuously, off-device.** Candidates are generated and gated by
  `evaluator/regression.py`. Nothing reaches your phone. Runs as hot as you like.
- **Integrate — auto-merge on green.** When a rung passes the CI gate (golden
  correctness + perf/regression across all rungs + the mobile protocol smoke
  test), it merges to `main` automatically. No per-rung approval.
- **Deploy — milestone-gated.** You ship to TestFlight only when a *cluster* of
  rungs adds up to something you can feel, by pushing a `milestone-*` tag.

## Your two gates (everything else is automatic)

1. **Plan:** approve the next rung's contract + tests (steer what gets built).
2. **Deploy:** review at a milestone and push the tag (decide what's worth
   feeling on the phone).

## What's worth a milestone (deploy moments)

Ship when the engine crosses into a *new testable experience*, not per rung:

| Milestone tag | After rungs | What you can do on the phone |
|---|---|---|
| `milestone-groovebox-playback` | transport + mixer + sampler | load a sound, hear it on a track |
| `milestone-groovebox-beat` | + step sequencer | program a beat |
| `milestone-groovebox-instrument` | + effects + record | it feels like an instrument |
| `milestone-groovebox-live` | + real audio I/O | it plays through the phone's speakers |

## Why this is the smooth one

- **You test meaningful things** — a milestone build you can *play with*, not a
  half-finished rung that only matters to the next rung.
- **The fast loop stays fast** — engine evolution never waits on a 10-minute iOS
  build.
- **The native-vs-OTA caveat stops mattering** — engine rungs need a real build
  (not OTA), but batching to milestones means you pay that cost a handful of
  times, not dozens.
- **OTA covers the gaps** — while you live with a milestone build, any *UI* tweak
  ships over the air in seconds (`eas update`), so the phone feels fresh between
  milestones.

## A typical week

```
Mon      plan: approve rung 3 (mixer) contract + tests          ← your gate 1
Mon–Wed  iterate: swarm climbs rungs 3, 4 (sampler)             [auto-merge on green]
Wed      UI polish for the new tracks → eas update              [OTA, seconds]
Thu      rung 5 (sequencer) auto-merges
Fri      MILESTONE: git push origin milestone-groovebox-beat    ← your gate 2
weekend  play with the beat-maker on your iPhone (TestFlight)
```

**Iterate hourly · integrate per rung · deploy per milestone.**

## How to fire a deploy

```sh
git tag milestone-groovebox-beat -m "program a beat"
git push origin milestone-groovebox-beat
# -> release-ios.yml builds on EAS (macOS cloud) and submits to TestFlight
```

(Or trigger `release-ios` manually from the GitHub Actions tab.) Setup and the
native-vs-OTA details live in `DEPLOYMENT.md`.
