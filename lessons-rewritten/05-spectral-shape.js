import {
  getAudioContext,
  createAnalyser,
  readFrequency,
  startLoop,
  smooth,
  dbToUnit,
} from "../lib/audio.js";
import { createSourceController } from "../lib/sources.js";
import { fitCanvas, clear, drawLine, drawText } from "../lib/draw.js";

const FFT_SIZE = 4096;
const HISTORY = 300;

const lesson = {
  id: 5,
  title: "Spectral shape — centroid, rolloff, flux, flatness",
  summary: "Single-number summaries of where the energy lives in the spectrum.",
  render(container) {
    container.innerHTML = `
      <p>Bands tell you "how much energy lives in this region." They don't tell you what the spectrum <em>looks</em> like — its shape. Two spectra with identical bass/mid/treble totals can sound nothing alike: one might be a fat sine at 80 Hz, the other a buzzy snarl smeared across 20–500 Hz. To tell those apart with a single number, you need <em>shape</em> features.</p>

      <p>Below are four classic ones. Each squashes 1024 bins down to one scalar that captures something specific: brightness, where the spectrum tails off, how organized vs. chaotic it is, and how much it just changed.</p>

      <div class="controls">
        <span>Source</span>
        <button class="button src-btn" data-type="sine">Sine</button>
        <button class="button src-btn" data-type="square">Square</button>
        <button class="button src-btn" data-type="sawtooth">Saw</button>
        <button class="button src-btn" data-type="triangle">Triangle</button>
        <button class="button src-btn" data-type="noise">Noise</button>
        <label>File <input type="file" id="file-input" accept="audio/*"></label>
        <span class="spacer"></span>
        <button class="button" id="stop-btn">Stop</button>
      </div>

      <div class="controls">
        <label>Frequency
          <input type="range" id="freq" min="40" max="2000" step="1" value="220">
          <span class="readout" id="freq-readout">220 Hz</span>
        </label>
        <label>Volume
          <input type="range" id="vol" min="0" max="1" step="0.01" value="0.2">
        </label>
        <label>Rolloff %
          <input type="range" id="rolloff-pct" min="0.5" max="0.99" step="0.01" value="0.85">
          <span class="readout" id="rolloff-pct-readout">0.85</span>
        </label>
        <label>Smoothing α
          <input type="range" id="alpha" min="0.02" max="1" step="0.01" value="0.3">
          <span class="readout" id="alpha-readout">0.30</span>
        </label>
      </div>

      <div class="feature">
        <div class="feature-head">
          <span class="feature-name">Spectral centroid</span>
          <span class="feature-formula">Σ fₖ · mₖ  /  Σ mₖ   [Hz]</span>
          <span class="feature-value" id="centroid-value">— Hz</span>
        </div>
        <canvas class="feature-chart" id="centroid-chart" style="height: 110px"></canvas>
      </div>

      <div class="feature">
        <div class="feature-head">
          <span class="feature-name">Spectral rolloff</span>
          <span class="feature-formula">f s.t. Σ_{k≤K} mₖ ≥ p · Σ mₖ   [Hz]</span>
          <span class="feature-value" id="rolloff-value">— Hz</span>
        </div>
        <canvas class="feature-chart" id="rolloff-chart" style="height: 110px"></canvas>
      </div>

      <div class="feature">
        <div class="feature-head">
          <span class="feature-name">Spectral flatness</span>
          <span class="feature-formula">geo_mean(m)  /  arith_mean(m)   [0..1]</span>
          <span class="feature-value" id="flatness-value">—</span>
        </div>
        <canvas class="feature-chart" id="flatness-chart" style="height: 110px"></canvas>
      </div>

      <div class="feature">
        <div class="feature-head">
          <span class="feature-name">Spectral flux</span>
          <span class="feature-formula">Σ max(0, mₖ,t − mₖ,t−1)</span>
          <span class="feature-value" id="flux-value">—</span>
        </div>
        <canvas class="feature-chart" id="flux-chart" style="height: 110px"></canvas>
      </div>

      <h3>What each one tells you</h3>
      <p><em>Centroid</em> is the spectrum's "center of mass," measured in Hz. Bright sounds like cymbals and fricatives push it high; bassy sounds like a kick drum or low note pull it down. It lines up almost directly with the perceptual sense of brightness, which is why it turns up everywhere from synth-patch metadata to lightweight alternatives to MFCCs.</p>
      <p><em>Rolloff</em> is the frequency below which some chosen fraction of the total energy lives — usually 85%. It's a coarser read than centroid, but it shrugs off noise floors better. At 0.85 it ignores the long, quiet hiss tail that would otherwise yank the centroid around.</p>
      <p><em>Flatness</em> is the geometric mean of the bin magnitudes divided by the arithmetic mean. A pure tone parks nearly all its energy in one bin and almost nothing in the rest, so geo_mean → 0 and flatness → 0. White noise spreads energy evenly, so geo_mean ≈ arith_mean and flatness → 1. It's the cleanest "tonal vs. noisy" detector you can fit in two lines.</p>
      <p><em>Flux</em> is the half-wave-rectified frame-to-frame difference: only count bins that <em>got louder</em>. A sustained tone gives flux ≈ 0 because nothing's changing. Onsets, transients, and texture changes make it jump. Lesson 8 builds an onset detector around exactly this signal.</p>

      <h3>Try this</h3>
      <ol>
        <li>Sweep a <strong>Sine</strong> from 100 Hz to 1500 Hz. Centroid tracks the fundamental almost exactly, rolloff steps along with it, flatness sits near zero, and flux only spikes while you're moving the slider.</li>
        <li>Switch to <strong>Noise</strong>. Centroid leaps to ~SR/4 (the average of a flat spectrum from 0 to Nyquist), and flatness pegs near 1.0 — nature's "this is unstructured" signal.</li>
        <li>Compare a <strong>Saw</strong> at 220 Hz to a <strong>Sine</strong> at 220 Hz. Same fundamental, but the saw stacks on harmonics, so its centroid sits noticeably higher even though a tuner would call them both 220 Hz.</li>
        <li>Drag the <strong>rolloff %</strong> from 0.85 up to 0.99. The rolloff frequency climbs toward Nyquist as you ask it to capture more of the tail. At 0.5 it sits close to the centroid; at 0.99 it ends up wherever the noise floor is.</li>
        <li>Pause and resume a music file. Flux drops to almost nothing while paused (silence vs. silence ≈ no change) and spikes hard the instant audio resumes — you can already see why peak-picking flux makes a good onset detector.</li>
      </ol>

      <h3>What's next</h3>
      <p>Every feature here is computed once per animation frame, and the raw values jitter from frame to frame — they're only usable as control signals after smoothing. Lesson 6 makes that explicit, comparing one-pole, attack/release, and median smoothers, and works through the latency-vs-stability trade-off properly.</p>
    `;

    // ---- DOM refs ----
    const stopBtn = container.querySelector("#stop-btn");
    const fileInput = container.querySelector("#file-input");
    const freqInput = container.querySelector("#freq");
    const freqReadout = container.querySelector("#freq-readout");
    const volInput = container.querySelector("#vol");
    const rolloffPctInput = container.querySelector("#rolloff-pct");
    const rolloffPctReadout = container.querySelector("#rolloff-pct-readout");
    const alphaInput = container.querySelector("#alpha");
    const alphaReadout = container.querySelector("#alpha-readout");
    const srcButtons = container.querySelectorAll(".src-btn");

    const centroidValue = container.querySelector("#centroid-value");
    const rolloffValue = container.querySelector("#rolloff-value");
    const flatnessValue = container.querySelector("#flatness-value");
    const fluxValue = container.querySelector("#flux-value");
    const centroidCanvas = container.querySelector("#centroid-chart");
    const rolloffCanvas = container.querySelector("#rolloff-chart");
    const flatnessCanvas = container.querySelector("#flatness-chart");
    const fluxCanvas = container.querySelector("#flux-chart");

    // ---- Audio graph ----
    const audioCtx = getAudioContext();
    const masterGain = audioCtx.createGain();
    masterGain.gain.value = parseFloat(volInput.value);
    const analyser = createAnalyser(masterGain, {
      fftSize: FFT_SIZE,
      smoothingTimeConstant: 0.5,
    });
    analyser.connect(audioCtx.destination);

    const sampleRate = audioCtx.sampleRate;
    const nyquist = sampleRate / 2;

    const sources = createSourceController({
      audioCtx,
      destination: masterGain,
      buttons: srcButtons,
      stopButton: stopBtn,
      fileInput,
      freqInput,
      freqReadout,
      volInput,
      volTarget: masterGain.gain,
    });

    // ---- State ----
    let rolloffPct = parseFloat(rolloffPctInput.value);
    let alpha = parseFloat(alphaInput.value);
    rolloffPctInput.addEventListener("input", () => {
      rolloffPct = parseFloat(rolloffPctInput.value);
      rolloffPctReadout.textContent = rolloffPct.toFixed(2);
    });
    alphaInput.addEventListener("input", () => {
      alpha = parseFloat(alphaInput.value);
      alphaReadout.textContent = alpha.toFixed(2);
    });

    // ---- Buffers ----
    const dbBuf = new Float32Array(analyser.frequencyBinCount);
    const linBuf = new Float32Array(analyser.frequencyBinCount);
    const prevLinBuf = new Float32Array(analyser.frequencyBinCount);

    const centroidHistRaw = new Float32Array(HISTORY);
    const centroidHistSm = new Float32Array(HISTORY);
    const rolloffHistRaw = new Float32Array(HISTORY);
    const rolloffHistSm = new Float32Array(HISTORY);
    const flatnessHistRaw = new Float32Array(HISTORY);
    const flatnessHistSm = new Float32Array(HISTORY);
    const fluxHistRaw = new Float32Array(HISTORY);
    const fluxHistSm = new Float32Array(HISTORY);

    let centroidSm = 0;
    let rolloffSm = 0;
    let flatnessSm = 0;
    let fluxSm = 0;

    function pushH(arr, v) {
      arr.copyWithin(0, 1);
      arr[HISTORY - 1] = v;
    }

    function drawFeatureChart(canvas, raw, sm, color, max, unit) {
      const { ctx, w, h } = fitCanvas(canvas);
      clear(ctx, w, h, "#0c0c0c");
      const padY = 6;
      const plotH = h - padY * 2;
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const py = padY + (1 - t) * plotH;
        ctx.beginPath();
        ctx.moveTo(0, py);
        ctx.lineTo(w, py);
        ctx.stroke();
      }
      drawLine(ctx, raw, {
        x: 0, y: padY, w, h: plotH, min: 0, max,
        stroke: "rgba(230, 232, 236, 0.18)", lineWidth: 1,
      });
      drawLine(ctx, sm, {
        x: 0, y: padY, w, h: plotH, min: 0, max,
        stroke: color, lineWidth: 1.75,
      });
      const label = (v) =>
        (max >= 100 ? v.toFixed(0) : v.toFixed(2)) + (unit ? ` ${unit}` : "");
      drawText(ctx, label(max), 4, padY, { color: "#555555" });
      drawText(ctx, label(0), 4, h - padY, {
        color: "#555555", baseline: "bottom",
      });
      drawText(ctx, "5 s ←", w - 6, padY + 2, {
        color: "#555555", align: "right",
      });
    }

    // ---- Render loop ----
    const cancelLoop = startLoop(() => {
      readFrequency(analyser, dbBuf);

      let totalEnergy = 0;
      let geoSum = 0;
      let geoCount = 0;
      const N = dbBuf.length;
      for (let i = 0; i < N; i++) {
        const m = dbToUnit(dbBuf[i]);
        linBuf[i] = m;
        totalEnergy += m;
        if (m > 1e-7) {
          geoSum += Math.log(m);
          geoCount++;
        }
      }

      let weightedSum = 0;
      for (let i = 0; i < N; i++) {
        const f = (i * sampleRate) / (N * 2);
        weightedSum += f * linBuf[i];
      }
      const centroid = totalEnergy > 1e-6 ? weightedSum / totalEnergy : 0;

      const target = rolloffPct * totalEnergy;
      let cum = 0;
      let rolloffBin = N - 1;
      for (let i = 0; i < N; i++) {
        cum += linBuf[i];
        if (cum >= target) {
          rolloffBin = i;
          break;
        }
      }
      const rolloff = (rolloffBin * sampleRate) / (N * 2);

      const arith = totalEnergy / N;
      const geo = geoCount > 0 ? Math.exp(geoSum / geoCount) : 0;
      const flatness = arith > 1e-7 ? Math.min(1, geo / arith) : 0;

      let flux = 0;
      for (let i = 0; i < N; i++) {
        const d = linBuf[i] - prevLinBuf[i];
        if (d > 0) flux += d;
      }
      prevLinBuf.set(linBuf);

      centroidSm = smooth(centroidSm, centroid, alpha);
      rolloffSm = smooth(rolloffSm, rolloff, alpha);
      flatnessSm = smooth(flatnessSm, flatness, alpha);
      fluxSm = smooth(fluxSm, flux, alpha);

      pushH(centroidHistRaw, centroid);
      pushH(centroidHistSm, centroidSm);
      pushH(rolloffHistRaw, rolloff);
      pushH(rolloffHistSm, rolloffSm);
      pushH(flatnessHistRaw, flatness);
      pushH(flatnessHistSm, flatnessSm);
      pushH(fluxHistRaw, flux);
      pushH(fluxHistSm, fluxSm);

      drawFeatureChart(centroidCanvas, centroidHistRaw, centroidHistSm,
        "#ededed", nyquist / 2, "Hz");
      drawFeatureChart(rolloffCanvas, rolloffHistRaw, rolloffHistSm,
        "#a0a0a0", nyquist, "Hz");
      drawFeatureChart(flatnessCanvas, flatnessHistRaw, flatnessHistSm,
        "#ff5b22", 1, "");
      let fluxMax = 4;
      for (let i = 0; i < HISTORY; i++) {
        if (fluxHistRaw[i] > fluxMax) fluxMax = fluxHistRaw[i];
      }
      drawFeatureChart(fluxCanvas, fluxHistRaw, fluxHistSm,
        "#ff5b22", fluxMax, "");

      centroidValue.textContent = `${centroidSm.toFixed(0)} Hz`;
      rolloffValue.textContent = `${rolloffSm.toFixed(0)} Hz`;
      flatnessValue.textContent = flatnessSm.toFixed(3);
      fluxValue.textContent = fluxSm.toFixed(3);
    });

    return () => {
      cancelLoop();
      sources.dispose();
      try { masterGain.disconnect(); } catch {}
      try { analyser.disconnect(); } catch {}
    };
  },
};

export default lesson;
