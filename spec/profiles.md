# Platform profiles

One engine core, two budget profiles. Mobile is the forcing function — tight
constraints make for a disciplined architecture (the daw-lab ethos: design for
the worst block, not the average). Desktop scales the same code up.

Each rung's `budget.md` states its bar **per profile**; the regression suite runs
the active profile's thresholds.

| dimension | `mobile` | `desktop` |
|---|---|---|
| target | iOS / Android (ARM, battery, thermal) | macOS / Windows / Linux (x86-64 / ARM) |
| sample rate | 48 kHz | 48 kHz (up to 96 k later) |
| block size | 256 (≈5.33 ms) | 128–256 |
| voice budget (synth, ½-budget) | ≥ 256 voices/core | ≥ 2000 voices/core |
| track budget (groovebox) | ≥ 8 tracks | ≥ 64 tracks |
| insert effects / track | ≤ 4 | ≤ 32 |
| render-path allocations | 0 (hard gate, both profiles) | 0 (hard gate) |
| dropouts at budget | 0 (hard gate) | 0 (hard gate) |

Notes:
- The voice/track budgets are deliberately modest on mobile — a groovebox needs a
  handful of solid tracks, not thousands of voices. Headroom goes to UI
  responsiveness and battery, not raw polyphony.
- Real-time safety (zero render-path allocations, zero dropouts) is a **hard
  gate on both profiles** — it is never traded for features.
- Feature flags (`profile.mobile` / `profile.desktop`) gate heavy desktop-only
  rungs (plugin hosting, multicore scheduling) out of mobile builds.
