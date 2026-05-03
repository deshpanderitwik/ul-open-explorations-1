import {
  getAudioContext,
  createAnalyser,
  readTimeDomain,
  readFrequency,
  startLoop,
  smooth,
  dbToUnit,
} from "../lib/audio.js";
import { createSourceController } from "../lib/sources.js";
import { fitCanvas, clear, drawLine, drawBars, drawText } from "../lib/draw.js";

const FFT_SIZE = 4096;

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const lesson = {
  id: 9,
  title: "Musical features — chroma, pitch, structure",
  summary: "Features that know about notes and sections, not just energy.",
  render(container) {
    container.innerHTML = `
      <p>Every feature so far has been pitch-blind. RMS, centroid, flux — none of them know whether you're playing a C# or a D. But if your visualizer wants to color by key, hold a hue through a chord change, or pulse on the root note, it needs features that <em>know about notes</em>.</p>

      <p>Two classic features handle most of that. <em>Pitch</em> via autocorrelation finds the dominant period in the time-domain waveform. <em>Chroma</em> folds the spectrum down into 12 pitch-class bins, giving you a "which notes are present" vector that ignores octave.</p>

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
        <label>Pitch min Hz
          <input type="range" id="pmin" min="40" max="200" step="2" value="60">
          <span class="readout" id="pmin-readout">60 Hz</span>
        </label>
        <label>Pitch max Hz
          <input type="range" id="pmax" min="500" max="3000" step="10" value="1500">
          <span class="readout" id="pmax-readout">1500 Hz</span>
        </label>
        <label>Reference A
          <input type="range" id="refa" min="415" max="466" step="1" value="440">
          <span class="readout" id="refa-readout">440 Hz</span>
        </label>
      </div>

      <div class="feature">
        <div class="feature-head">
          <span class="feature-name">Time-domain autocorrelation</span>
          <span class="feature-formula">peak in [pitch-min, pitch-max] → fundamental</span>
          <span class="feature-value" id="pitch-info">— Hz</span>
        </div>
        <canvas id="acf-canvas" style="height: 180px"></canvas>
      </div>

      <div class="feature">
        <div class="feature-head">
          <span class="feature-name">Chroma — 12 pitch classes</span>
          <span class="feature-formula">Σ |X(f)| folded into the nearest of {C, C#, …, B}</span>
          <span class="feature-value" id="chroma-info">—</span>
        </div>
        <canvas id="chroma-canvas" style="height: 160px"></canvas>
      </div>

      <div class="feature">
        <div class="feature-head">
          <span class="feature-name">Chromagram — last 6 s</span>
          <span class="feature-formula">12 × time. Brighter = stronger.</span>
          <span class="feature-value">structure across time</span>
        </div>
        <canvas id="chromagram-canvas" style="height: 180px"></canvas>
      </div>

      <h3>How each one works</h3>
      <p><em>Pitch via autocorrelation.</em> A periodic signal at frequency <code>f</code> looks identical to itself when you shift it by one period — that's <code>1/f</code> seconds. Compare the signal to delayed copies of itself and you'll see a peak at the lag matching one period. Convert lag back to frequency with <code>f = SR / lag</code>. Restrict the search to a sensible band (say 60–1500 Hz) to avoid DC and octave mistakes. This is the simplest pitch tracker that actually works; fancier ones like YIN and CREPE refine the same core idea.</p>
      <p><em>Chroma.</em> Take every FFT magnitude bin and assign it to one of 12 pitch classes via <code>round(12·log₂(f/A) + 9) mod 12</code> (the <code>+9</code> lines A up with index 9). Sum across octaves. You end up with a length-12 vector where a C in any octave lands in the same bin — that octave invariance is what makes chroma the go-to representation for chord and key recognition.</p>
      <p><em>Chromagram.</em> Stack chroma vectors over time as columns in a heatmap. Held notes draw horizontal stripes. Chord changes show up as discontinuities. Section boundaries — verse into chorus — often appear as a whole column of stripes shifting at once.</p>

      <h3>Try this</h3>
      <ol>
        <li><strong>Sine</strong> at 440 Hz. The autocorrelation peak lands at lag = SR/440 ≈ 109 samples (at 48 kHz). Chroma lights up only the A bar. Drag the frequency slider — chroma snaps to the nearest pitch class.</li>
        <li>Pull <strong>Reference A</strong> from 440 down to 432 Hz. The same 440 Hz sine now reads as a slightly-sharp A. If you want a visualizer that stays in tune with non-440 material, this knob matters.</li>
        <li>Switch to <strong>Saw</strong> at 220 Hz. The pitch tracker still locks to 220 (autocorrelation peaks at lag = SR/220, even though the spectrum has energy at 220, 440, 660, 880 …). Chroma lights up A, since 220, 440, and 880 all share a pitch class — that's the octave summing at work.</li>
        <li>Load a chord-progression file. The chromagram grows vertical bands — usually 3–4 rows lit at a time for a chord. Watch chord changes appear as bright bars hopping between rows.</li>
        <li><strong>Noise</strong> defeats both. Autocorrelation shows no clear peak (nothing correlates with anything), and chroma flattens out across all 12 bins. The honest answer for noise is "no pitch," and that's exactly what the displays should look like.</li>
      </ol>

      <h3>What's next</h3>
      <p>You now have the full vocabulary: RMS, peak, ZCR, bands, centroid, rolloff, flatness, flux, onsets, BPM, pitch, chroma. Lesson 10 ties it together: a feature dashboard, a small visualizer, and a routing matrix that lets you wire features to visual parameters. The new question is "which of these features are actually <em>independent</em>?" — driving two visuals from tightly correlated features just wastes information.</p>
    `;

    // ---- DOM refs ----
    const stopBtn = container.querySelector("#stop-btn");
    const fileInput = container.querySelector("#file-input");
    const freqInput = container.querySelector("#freq");
    const freqReadout = container.querySelector("#freq-readout");
    const volInput = container.querySelector("#vol");
    const pminInput = container.querySelector("#pmin");
    const pminReadout = container.querySelector("#pmin-readout");
    const pmaxInput = container.querySelector("#pmax");
    const pmaxReadout = container.querySelector("#pmax-readout");
    const refaInput = container.querySelector("#refa");
    const refaReadout = container.querySelector("#refa-readout");
    const srcButtons = container.querySelectorAll(".src-btn");

    const acfCanvas = container.querySelector("#acf-canvas");
    const chromaCanvas = container.querySelector("#chroma-canvas");
    const chromagramCanvas = container.querySelector("#chromagram-canvas");
    const pitchInfo = container.querySelector("#pitch-info");
    const chromaInfo = container.querySelector("#chroma-info");

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
    let pmin = parseFloat(pminInput.value);
    let pmax = parseFloat(pmaxInput.value);
    let refA = parseFloat(refaInput.value);
    pminInput.addEventListener("input", () => {
      pmin = parseFloat(pminInput.value);
      pminReadout.textContent = `${pmin} Hz`;
    });
    pmaxInput.addEventListener("input", () => {
      pmax = parseFloat(pmaxInput.value);
      pmaxReadout.textContent = `${pmax} Hz`;
    });
    refaInput.addEventListener("input", () => {
      refA = parseFloat(refaInput.value);
      refaReadout.textContent = `${refA} Hz`;
    });

    // ---- Buffers ----
    const timeBuf = new Float32Array(FFT_SIZE);
    const dbBuf = new Float32Array(analyser.frequencyBinCount);

    // ACF: search-window sized to maxLag = SR / pmin.
    let acfBuf = new Float32Array(2);
    function ensureAcfBuf(maxLag) {
      if (acfBuf.length !== maxLag + 1) acfBuf = new Float32Array(maxLag + 1);
    }

    const chromaSm = new Float32Array(12);
    const CHROMAGRAM_FRAMES = 240;
    // Column-major: 12 rows × N cols
    const chromagram = new Float32Array(12 * CHROMAGRAM_FRAMES);

    function shiftChromagramLeft() {
      // Move every column one to the left.
      for (let f = 0; f < CHROMAGRAM_FRAMES - 1; f++) {
        for (let p = 0; p < 12; p++) {
          chromagram[p * CHROMAGRAM_FRAMES + f] =
            chromagram[p * CHROMAGRAM_FRAMES + f + 1];
        }
      }
    }
    function setChromagramLast(col) {
      const f = CHROMAGRAM_FRAMES - 1;
      for (let p = 0; p < 12; p++) {
        chromagram[p * CHROMAGRAM_FRAMES + f] = col[p];
      }
    }

    // ---- Drawing ----
    function drawACF(acf, peakLag, peakHz, maxLag) {
      const { ctx, w, h } = fitCanvas(acfCanvas);
      clear(ctx, w, h, "#0c0c0c");
      const padY = 10;
      const padL = 36;
      const padR = 8;
      const plotW = w - padL - padR;
      const plotH = h - padY * 2;
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      for (const t of [0, 0.5, 1]) {
        const py = padY + (1 - t) * plotH;
        ctx.beginPath();
        ctx.moveTo(padL, py);
        ctx.lineTo(padL + plotW, py);
        ctx.stroke();
      }
      drawLine(ctx, acf, {
        x: padL, y: padY, w: plotW, h: plotH,
        min: -0.5, max: 1,
        stroke: "#ededed", lineWidth: 1.5,
        fill: "rgba(237, 237, 237, 0.10)",
      });
      // Peak marker
      if (peakLag > 0 && peakLag < maxLag) {
        const px = padL + (peakLag / maxLag) * plotW;
        ctx.strokeStyle = "#ff5b22";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, padY);
        ctx.lineTo(px, padY + plotH);
        ctx.stroke();
      }
      // Hz tick marks at common pitches
      for (const f of [110, 220, 440, 880]) {
        const lag = sampleRate / f;
        if (lag <= 0 || lag >= maxLag) continue;
        const px = padL + (lag / maxLag) * plotW;
        ctx.strokeStyle = "rgba(255,255,255,0.05)";
        ctx.beginPath();
        ctx.moveTo(px, padY);
        ctx.lineTo(px, padY + plotH);
        ctx.stroke();
        drawText(ctx, `${f}`, px, padY + plotH + 2, {
          color: "#555555", align: "center",
        });
      }
      drawText(ctx, "Hz →", padL, padY + 2, { color: "#555555" });
      drawText(
        ctx,
        peakLag > 0 ? `${peakHz.toFixed(1)} Hz` : "—",
        w - 6, padY + 2,
        { color: "#ff5b22", align: "right" }
      );
    }

    function drawChroma(values, dominantIdx) {
      const { ctx, w, h } = fitCanvas(chromaCanvas);
      clear(ctx, w, h, "#0c0c0c");
      const padY = 8;
      const padX = 8;
      const plotH = h - padY * 2 - 16;
      let max = 1e-3;
      for (let i = 0; i < 12; i++) if (values[i] > max) max = values[i];
      drawBars(ctx, values, {
        x: padX, y: padY, w: w - padX * 2, h: plotH,
        min: 0, max,
        color: (_v, i) => (i === dominantIdx ? "#ff5b22" : "#ededed"),
        gap: 4,
      });
      // Note labels
      const barW = (w - padX * 2) / 12;
      for (let i = 0; i < 12; i++) {
        const cx = padX + i * barW + barW / 2;
        drawText(ctx, NOTE_NAMES[i], cx, padY + plotH + 4, {
          color: i === dominantIdx ? "#ff5b22" : "#555555",
          align: "center",
          size: i === dominantIdx ? 12 : 11,
        });
      }
    }

    function drawChromagram() {
      const { ctx, w, h } = fitCanvas(chromagramCanvas);
      clear(ctx, w, h, "#0c0c0c");
      const padY = 6;
      const padL = 26;
      const padR = 8;
      const plotW = w - padL - padR;
      const plotH = h - padY * 2;
      const cellW = plotW / CHROMAGRAM_FRAMES;
      const cellH = plotH / 12;

      // Find a per-frame max so the heatmap stays bright across volume.
      let max = 1e-3;
      for (let i = 0; i < chromagram.length; i++) {
        if (chromagram[i] > max) max = chromagram[i];
      }

      for (let p = 0; p < 12; p++) {
        for (let f = 0; f < CHROMAGRAM_FRAMES; f++) {
          const v = chromagram[p * CHROMAGRAM_FRAMES + f] / max;
          if (v < 0.02) continue;
          const t = Math.min(1, v);
          // Simple two-stop ramp: dark blue → warm yellow.
          const r = Math.round(40 + (240 - 40) * t);
          const g = Math.round(60 + (200 - 60) * t);
          const b = Math.round(120 + (110 - 120) * t);
          ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
          // Draw row top-down so high pitches sit at top.
          const py = padY + (11 - p) * cellH;
          ctx.fillRect(padL + f * cellW, py, cellW + 1, cellH + 1);
        }
      }
      // Note labels on the left
      for (let p = 0; p < 12; p++) {
        const py = padY + (11 - p) * cellH + cellH / 2;
        drawText(ctx, NOTE_NAMES[p], padL - 4, py, {
          color: "#555555", align: "right", baseline: "middle",
        });
      }
      drawText(ctx, "6 s ←", w - 6, padY + 2, {
        color: "#555555", align: "right",
      });
    }

    // ---- Render loop ----
    const cancelLoop = startLoop(() => {
      readTimeDomain(analyser, timeBuf);
      readFrequency(analyser, dbBuf);

      // ---- Pitch via autocorrelation ----
      const minLag = Math.max(2, Math.floor(sampleRate / pmax));
      const maxLag = Math.min(timeBuf.length - 1, Math.ceil(sampleRate / pmin));
      ensureAcfBuf(maxLag);
      // Compute mean-removed ACF up to maxLag. r0 normalizes.
      let mean = 0;
      for (let i = 0; i < timeBuf.length; i++) mean += timeBuf[i];
      mean /= timeBuf.length;
      let r0 = 0;
      for (let i = 0; i < timeBuf.length; i++) {
        const d = timeBuf[i] - mean;
        r0 += d * d;
      }
      acfBuf.fill(0);
      if (r0 > 1e-9) {
        for (let lag = 0; lag <= maxLag; lag++) {
          let sum = 0;
          for (let i = 0; i + lag < timeBuf.length; i++) {
            sum += (timeBuf[i] - mean) * (timeBuf[i + lag] - mean);
          }
          acfBuf[lag] = sum / r0;
        }
      }

      let peakLag = -1;
      let peakVal = 0.15; // confidence floor
      for (let lag = minLag; lag <= maxLag; lag++) {
        if (acfBuf[lag] > peakVal) {
          peakVal = acfBuf[lag];
          peakLag = lag;
        }
      }
      const pitchHz = peakLag > 0 ? sampleRate / peakLag : 0;

      // ---- Chroma ----
      const chromaFrame = new Float32Array(12);
      const N = dbBuf.length;
      for (let i = 1; i < N; i++) {
        const f = (i * sampleRate) / (N * 2);
        if (f < 80 || f > 5000) continue; // useful musical range
        const m = dbToUnit(dbBuf[i]);
        if (m < 1e-4) continue;
        // 12·log2(f/A) gives semitones from A. A is index 9 (NOTE_NAMES).
        const semis = 12 * Math.log2(f / refA);
        const idx = ((Math.round(semis) + 9) % 12 + 12) % 12;
        chromaFrame[idx] += m;
      }
      // Normalize so the bar chart is comparable across volumes.
      let chromaSum = 0;
      for (let i = 0; i < 12; i++) chromaSum += chromaFrame[i];
      if (chromaSum > 1e-7) {
        for (let i = 0; i < 12; i++) chromaFrame[i] /= chromaSum;
      }
      // Smooth and pick dominant
      for (let i = 0; i < 12; i++) {
        chromaSm[i] = smooth(chromaSm[i], chromaFrame[i], 0.25);
      }
      let dominant = 0;
      for (let i = 1; i < 12; i++) {
        if (chromaSm[i] > chromaSm[dominant]) dominant = i;
      }

      shiftChromagramLeft();
      setChromagramLast(chromaSm);

      drawACF(acfBuf, peakLag, pitchHz, maxLag);
      drawChroma(chromaSm, dominant);
      drawChromagram();

      pitchInfo.textContent =
        peakLag > 0
          ? `${pitchHz.toFixed(1)} Hz · acf=${peakVal.toFixed(2)}`
          : "no pitch";
      chromaInfo.textContent = `dominant: ${NOTE_NAMES[dominant]}`;
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
