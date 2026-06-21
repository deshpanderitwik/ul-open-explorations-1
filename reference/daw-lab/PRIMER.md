# PRIMER — read this first

A plain-English on-ramp to the engine. No code, no prerequisites. Once this
clicks, [`NOTION.md`](./NOTION.md) (the technical roadmap) reads like ordinary
English. One running metaphor — a hungry speaker and the cook who feeds it —
carries the whole thing, with the real terms riding along inside it.

## Feeding the hungry speaker

Sound, to a computer, is just a long list of numbers. A speaker cone pushes air
back and forth; each number is one position of that cone at one instant. Play
them fast enough — about **48,000 numbers every second** ("48 kHz", the *sample
rate*) — and your ear hears a tone. Each number is a *sample*: the atom of
digital audio.

The twist that shapes everything: the speaker is **hungry and never stops being
hungry.** It eats numbers at a perfectly steady rate, forever, the instant you
hit play. Fail to have the next mouthful ready *on time* and it doesn't wait —
it runs dry, and you hear a click or pop. That failure is a **dropout** (or
"xrun"), and it's the cardinal sin. A DAW that clicks is broken no matter how
good it sounds.

So we feed the speaker in **spoonfuls** — batches of a few hundred numbers at
once. One spoonful is a *block* or *buffer*. At 48,000/sec, a spoonful of 256
numbers buys about **5.3 milliseconds** before the next is due. That 5.3 ms is
your whole world: the **deadline**, the "real-time budget." Everything the
engine does to produce a spoonful must finish inside it, every time, no
exceptions.

## Two workers who must never get in each other's way

Inside the program are independent workers (*threads*). Two matter, with
opposite rules:

- The **Cook** (the "audio thread"): plate a spoonful every 5.3 ms, on the dot,
  forever. Ruthless about the clock.
- The **Waiter** (the "UI thread"): handles your mouse, the knobs, the screen.
  No deadline. If it's briefly slow, nobody dies.

The problem: while you drag a volume slider, the Waiter wants to tell the Cook
"louder" — but the Cook can't stop mid-spoonful to chat, and they must never
grab the same plate at once. The fix is a tiny **mailbox slot**: the Waiter
drops a sticky note ("volume = 80"); the Cook glances at it at the *start* of
each spoonful and keeps cooking. No waiting, no collision. In the repo this is
the **membrane** — the most important trick in the engine, and what the
`membrane` demo already builds. It's the "vertical talk": info flowing *down*
from the relaxed world into the deadline-bound one.

## The assembly line

A real instrument is many steps: raw tone → shaped (a filter) → volume set (a
gain) → echo, etc. So the Cook is really an **assembly line** of stations, each
doing one thing and handing its work down the line. Each station is a **node**;
the wired-up line is the **graph**; sound flows along it within the same 5.3 ms.
That's the "horizontal talk" — audio flowing node to node — and it's the next
thing we build.

## Why "fast" is really "never late"

Counterintuitive but central: a great DAW isn't the one that does math
*quickly* on average — it's the one that's **never late, not even once, over
hours.** A cook who's lightning-fast but freezes for a second once an hour is
useless; that freeze is a click in your recording. So the obsession is the
**worst case**, not the average.

That's why the Cook obeys absolute prohibitions on the line — normal for the
Waiter, forbidden for the Cook, because they take *unpredictable* time:

- **Never wait on anyone** (no "locks").
- **Never go shopping** (no asking the system for new memory mid-spoonful —
  everything is laid out *before* service).
- **Never run to the basement** (no files, no logging, no disk).

Any one could take 10 ms when you can afford 5.3. Discipline, not horsepower,
buys reliability.

## Where macOS comes in

Apple provides the kitchen infrastructure — the gas lines, the ticket rail, the
wire to the actual speaker. That plumbing is **CoreAudio**; it hands the Cook
the metronome and collects each spoonful. A few macOS realities become levers:

- **Star stations vs. chore stations.** Apple Silicon has a few very fast cores
  ("performance cores") and slower power-sippers ("efficiency cores") for
  background chores. Left alone, the OS might shove your audio Cook onto a slow
  chore station to save battery — disastrous. So macOS lets you pin an
  **"urgent — dinner rush" badge** on every sound worker: the **audio
  workgroup**. It tells the scheduler "these share a hard deadline; keep them on
  the star stations, together." Biggest macOS-specific win; getting it wrong
  makes a 12-core machine cook like a 2-core one.
- **Chopping eight carrots in one stroke.** Much of audio is the same simple
  math over thousands of numbers; modern chips do eight-plus at once
  (**SIMD**), and Apple ships a pre-tuned team for the heavy stuff like reverb
  and frequency analysis (**Accelerate / vDSP**).
- **Sweeping phantom crumbs.** The math sometimes makes absurdly tiny near-zero
  numbers (**denormals**) that make the chip grind slowly; one setting says
  "treat anything that tiny as zero."
- **Guest chefs.** Third-party effects/instruments are **plugins**; Apple's
  native way to host them safely, each in its own sealed room, is **AUv3**.
- **More cooks.** When one can't finish in time, split the line into independent
  branches across **multiple cores** (parallelism) — every cook wearing the
  badge.

## The destination, in plain words

The "fastest, most reliable DAW the world has seen" means: the **smallest
spoonful** (so it responds the instant you touch it — *low latency*), running a
**huge number of stations and guest chefs at once** (*high throughput*), with
the speaker **never once going hungry** even after hours (*reliability*). The
secret to all three isn't brute speed — it's relentless discipline about *never
being late*, plus using the Mac's hardware exactly as Apple intends.

## The decoder ring (back to the technical roadmap)

| Story | Technical term |
|---|---|
| spoonful | block / buffer |
| the 5.3 ms feeding deadline | the real-time budget |
| the speaker screaming | dropout / xrun |
| the mailbox slot | the membrane (an atomic) |
| the assembly line | the node graph |
| the Cook's prohibitions | the render-thread rules (no locks/allocation/IO) |
| the urgent-rush badge | audio workgroup |
| chopping eight at once | SIMD / Accelerate / vDSP |
| never late, not just fast | worst-case determinism |
| guest chefs in sealed rooms | AUv3 plugin hosting |
