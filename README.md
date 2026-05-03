# Audio Features for Visualization

> **Work in progress.** The interactive widgets in each lesson have not yet
> been audited for accuracy — treat the numbers, formulas, and visualizations
> as illustrative until that pass is done. Issues and corrections welcome.

An interactive web tutorial that teaches the audio-analysis primitives behind
music visualizers — RMS, FFT, spectral shape, onset detection, and more.
Ten lessons, all running live in the browser with the Web Audio API.

The site is plain HTML / CSS / vanilla JS. No build step, no framework, no
backend. Open `index.html` and it works.

## Run the site locally

Because the lessons load as ES modules, you need to serve the directory over
HTTP — opening `index.html` via `file://` will fail with a CORS error.

```sh
# any static server works; pick one
python3 -m http.server 8000
# or
npx serve .
```

Then open http://localhost:8000.

## Lessons

1. Raw signal
2. Time domain
3. FFT
4. Spectrum
5. Spectral shape
6. Smoothing
7. Normalization
8. Onsets & beats
9. Musical features
10. Correlation & mapping

Each lesson lives in `lessons/NN-name.js` as a self-contained module that
renders into `#lesson-root`.

## Dev tools (optional — for editing lesson prose)

The repo ships two scripts that use the Anthropic API to refine the
explanatory prose inside each lesson while preserving every interactive
element byte-for-byte. **You don't need an API key to run the site** —
only to regenerate lesson text.

### Setup

1. Get an API key at https://console.anthropic.com/settings/keys
2. Copy the env template and paste your key in:
   ```sh
   cp .env.example .env
   # then edit .env so ANTHROPIC_API_KEY=sk-ant-...
   ```
   `.env` is gitignored — it will not be committed.

### `npm run rewrite` — single-pass rewrite (Node)

```sh
npm install
npm run rewrite
```

Reads each `lessons/*.js`, rewrites the prose with Claude, writes the result
to `lessons-rewritten/`. Diff before promoting:

```sh
diff -ru lessons lessons-rewritten
cp lessons-rewritten/*.js lessons/   # when happy
```

### `refine_lessons.py` — multi-round refinement (Python)

```sh
pip install anthropic
python refine_lessons.py                            # all lessons, 6 rounds
python refine_lessons.py --lessons 04-spectrum.js   # one lesson
python refine_lessons.py --rounds 3 --save-intermediate
```

Iteratively refines each lesson over multiple rounds, feeding round N's
output into round N+1. Uses prompt caching for the (large, stable) system
prompt. Defaults to `claude-opus-4-7`; pass `--model claude-sonnet-4-6` for
something cheaper and faster.

## Project layout

```
index.html            entry point
app.js                lesson router + nav
styles.css
lessons/              the live lessons (ship to learners)
lessons-rewritten/    output of dev tools — diff before promoting
lib/                  shared audio helpers
assets/
scripts/rewrite-lessons.js
refine_lessons.py
```
