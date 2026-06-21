# archive/ — the program database

The loop's memory. Every evaluation appends one immutable JSON line to
`runs.jsonl` (created on first run). This is what lets the swarm learn instead of
re-trying dead ends, and what you read to see the lineage of how an architecture
won.

## Record shape

```jsonc
{
  "id": "gen-20260621-204500",   // candidate dir name under candidates/
  "parent": "seed",              // what it was mutated from (lineage)
  "ts": "2026-06-21T20:45:00+00:00",
  "fitness": 1024.0,             // spec/metrics.md; 0 means a gate failed
  "reason": "ok",                // "ok" or e.g. "gate_failed:realtime.no_render_alloc"
  "build_ok": true,
  "metrics": { ... }             // the full raw harness output (omitted on build/run failure)
}
```

## Handy queries (jq)

```sh
# leaderboard
jq -s 'sort_by(-.fitness) | .[] | {id, fitness, reason}' archive/runs.jsonl

# best so far
jq -s 'max_by(.fitness) | {id, fitness}' archive/runs.jsonl

# what's failing, and why
jq 'select(.fitness == 0) | {id, reason}' archive/runs.jsonl
```

Records are append-only — don't rewrite history; it's the experiment log.
