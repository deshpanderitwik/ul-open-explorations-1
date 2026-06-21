# The swarm — roles, cycle, and human gates

How the agent swarm climbs the ladder (`spec/ladder/`) to build the DAW. The unit
of progress is **one rung**. Within a rung the swarm runs a `generate → evaluate
→ select → integrate` cycle; between rungs, you (the human) approve.

## Roles

| role | what it does | implemented by |
|---|---|---|
| **Architect** | reads the ladder + mainline, picks the next rung, writes its `contract.md`, `budget.md`, and golden `tests/`. Proposes the API/protocol additions. | a planning agent + **your approval** |
| **Generators** | a population of N parallel agents, each cloning the mainline into a candidate and implementing the rung. Run in isolated dirs (later: git worktrees). Diversity via different strategy briefs ("islands"). | `orchestrator/loop.py` + subagents / headless `claude -p` |
| **Evaluator** | scores each candidate: golden gates + perf fitness + regression. Unfakeable (harness is evaluator-owned). | `evaluator/regression.py` (wraps `protocol_test.py` + `score.py`) |
| **Integrator** | takes the winning candidate, runs the **full regression**, and merges it into `engine/`. Promotes only if everything stays green. | a merge step + **your approval** |
| **Reviewer** (optional) | reads the winning diff for what benchmarks miss: API quality, real-time safety, readability. | a review agent |
| **Orchestrator** | drives the cycle, enforces budgets (tokens/iters/wall-clock), writes the archive. | `orchestrator/loop.py` |

## The cycle (one rung)

```
  Architect drafts rung N  ──▶  [YOU APPROVE the contract + tests]
        │
        ▼
  Generators: N candidates (parallel, isolated)  ──┐
        │                                          │ islands / diversity
        ▼                                          │
  Evaluator: golden gates + perf + regression  ◀──┘
        │   (rejects anything that fails a gate — correctness, zero
        │    render-path allocations, or a regression)
        ▼
  Select best passing candidate
        │
        ▼
  Integrator merges into engine/  ──▶  [YOU APPROVE the merge]
        │
        ▼
  Rung N done; archive updated; rung N+1 opens
```

## Human gates (the two you own)

1. **Contract approval** — before generation, you sign off on what the rung adds
   (the API/protocol surface and its tests). This is where you steer the DAW.
2. **Merge approval** — before a winner lands in `engine/`, you approve the diff.

Everything between those gates is automatic and objective.

## Guardrails (always on)

- **Real-time safety** — the allocation tripwire fails any candidate that
  allocates on the render path. Non-negotiable, both profiles.
- **Regression** — a candidate must pass every earlier rung's golden + perf, so
  progress can't silently regress.
- **Budgets** — per-round caps on tokens / iterations / wall-clock (`--iters`,
  model choice; `--max-turns`/budget on the headless CLI).
- **Archive** — every evaluation is logged to `archive/runs.jsonl` with lineage.

## Where this is today

- Rungs 1–2 (synth core + transport) are integrated in `engine/` and green.
- The cycle has been exercised by hand (the gen-1 perf round); `loop.py`
  automates the generate/evaluate/select primitive. Scaling to a true parallel
  population with git worktrees is the next infra step (Phase 2).
