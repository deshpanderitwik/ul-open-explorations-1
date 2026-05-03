import {
  getAudioContext,
  createAnalyser,
  readTimeDomain,
  startLoop,
  rms,
  zeroCrossings,
  smooth,
} from "../lib/audio.js";
import { createSourceController } from "../lib/sources.js";
import { fitCanvas, clear, drawLine, drawText } from "../lib/draw.js";

const FFT_SIZE = 2048;
const HISTORY = 300; // ~5 seconds of frames at 60fps

const lesson = {
  id: 2,
  title: "Time-domain features",
  summary: "RMS, zero crossings, peaks.",
  render(container) {
    container.innerHTML = `
      <p>Before we reach for any fancy transforms, three dead-simple features carry us a surprising distance: how loud the signal is, how peaky it is, and how often it crosses zero. Each one is a single number summarising a window of samples — no FFT, no filters, just arithmetic on the raw waveform.</p>

      <p>On every animation frame below, we grab <code>${FFT_SIZE}</code> fresh samples from the analyser and reduce them to three numbers. The faded line in each chart is the raw value frame-to-frame; the bright line is the same value smoothed with a one-pole filter. Drag the smoothing slider to feel the trade between snappy and steady — lesson 6 picks this up properly.</p>

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
        <label>Smoothing α
          <input type="range" id="alpha" min="0.02" max="1" step="0.01" value="0.2">
          <span class="readout" id="alpha-readout">0.20</span>
        </label>
        <span class="spacer"></span>
        <button class="button" id="reset-btn">Reset history</button>
      </div>

      <div class="feature">
        <div class="feature-head">
          <span class="feature-name">RMS</span>
          <span class="feature-formula">√( mean( xᵢ² ) )</span>
          <span class="feature-value" id="rms-value">0.0000</span>
        </div>
        <canvas class="feature-chart" id="rms-chart" style="height: 110px"></canvas>
      </div>

      <div class="feature">
        <div class="feature-head">
          <span class="feature-name">Peak</span>
          <span class="feature-formula">max | xᵢ |</span>
          <span class="feature-value" id="peak-value">0.0000</span>
        </div>
        <canvas class="feature-chart" id="peak-chart" style="height: 110px"></canvas>
      </div>

      <div class="feature">
        <div class="feature-head">
          <span class="feature-name">Zero-crossing rate</span>
          <span class="feature-formula">crossings · SR / (2 · N)  [Hz]</span>
          <span class="feature-value" id="zcr-value">0 crossings</span>
        </div>
        <canvas class="feature-chart" id="zcr-chart" style="height: 110px"></canvas>
      </div>

      <h3>What each one tells you</h3>
      <p><em>RMS</em> (root-mean-square) is the workhorse measure of energy: square every sample, average them, take the square root. A unity-amplitude sine reads ≈ 0.707; a unity-amplitude square wave reads exactly 1.0, because it sits at full amplitude the whole time. Your ears track something close to RMS, which is why level meters are built on it.</p>
      <p><em>Peak</em> is simply the largest absolute sample in the window. It's twitchy — a single stray transient can pin it — but that twitchiness is precisely what you want for clip detection or impact triggers. Notice how Peak and RMS pull apart on noise yet agree on steady tones.</p>
      <p><em>Zero-crossing rate</em> counts how often the signal flips sign between neighbouring samples. For a clean periodic tone at <code>f</code> Hz you get exactly <code>2f</code> crossings per second, so ZCR moonlights as a crude pitch tracker. White noise, on the other hand, has each sample roughly independent of its neighbour, so ZCR climbs toward its theoretical ceiling (around half the sample rate). Click between Sine and Noise to see ZCR earn its keep.</p>

      <h3>Try this</h3>
      <ol>
        <li>Play <strong>Sine</strong> at 440 Hz. RMS ≈ 0.707, Peak = 1.0, ZCR ≈ 880 / sec ≈ 440 Hz.</li>
        <li>Switch to <strong>Noise</strong>. ZCR shoots up to several kHz, RMS barely budges, Peak goes jittery.</li>
        <li>Sweep the frequency slider on a <strong>Sine</strong>. ZCR follows the fundamental — but it <em>won't</em> on noisy or harmonically-rich signals, which is exactly why we'll need the FFT.</li>
        <li>Push smoothing <strong>α to 1.0</strong> (no smoothing) and back down. At α=1 the raw and smoothed lines sit on top of each other; at α=0.05 the smoothed line lags visibly but is far calmer — a clean control signal in exchange for some latency.</li>
      </ol>

      <h3>What's next</h3>
      <p>These three features are cheap and genuinely useful, but they can't tell you <em>where</em> in the spectrum the energy is sitting. A kick drum and a hi-hat at the same loudness give you the same RMS. The next lesson brings in the FFT, which finally splits bass from treble.</p>
    `;

    // ---- DOM refs ----
    const stopBtn = container.querySelector("#stop-btn");
    const fileInput = container.querySelector("#file-input");
    const freqInput = container.querySelector("#freq");
    const freqReadout = container.querySelector("#freq-readout");
    const volInput = container.querySelector("#vol");
    const alphaInput = container.querySelector("#alpha");
    const alphaReadout = container.querySelector("#alpha-readout");
    const resetBtn = container.querySelector("#reset-btn");
    const srcButtons = container.querySelectorAll(".src-btn");

    const rmsCanvas = container.querySelector("#rms-chart");
    const peakCanvas = container.querySelector("#peak-chart");
    const zcrCanvas = container.querySelector("#zcr-chart");
    const rmsValue = container.querySelector("#rms-value");
    const peakValue = container.querySelector("#peak-value");
    const zcrValue = container.querySelector("#zcr-value");

    // ---- Audio graph: source → masterGain → analyser → destination ----
    const audioCtx = getAudioContext();
    const masterGain = audioCtx.createGain();
    masterGain.gain.value = parseFloat(volInput.value);
    const analyser = createAnalyser(masterGain, {
      fftSize: FFT_SIZE,
      smoothingTimeConstant: 0,
    });
    analyser.connect(audioCtx.destination);

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

    let alpha = parseFloat(alphaInput.value);
    alphaInput.addEventListener("input", () => {
      alpha = parseFloat(alphaInput.value);
      alphaReadout.textContent = alpha.toFixed(2);
    });

    // ---- History ring buffers (shifted left each frame, newest at right) ----
    const rmsHistRaw = new Float32Array(HISTORY);
    const rmsHistSm = new Float32Array(HISTORY);
    const peakHistRaw = new Float32Array(HISTORY);
    const peakHistSm = new Float32Array(HISTORY);
    const zcrHistRaw = new Float32Array(HISTORY);
    const zcrHistSm = new Float32Array(HISTORY);

    let rmsSm = 0;
    let peakSm = 0;
    let zcrSm = 0;
    let timeBuf = new Float32Array(FFT_SIZE);

    function pushHistory(arr, v) {
      arr.copyWithin(0, 1);
      arr[HISTORY - 1] = v;
    }

    resetBtn.addEventListener("click", () => {
      rmsHistRaw.fill(0); rmsHistSm.fill(0);
      peakHistRaw.fill(0); peakHistSm.fill(0);
      zcrHistRaw.fill(0); zcrHistSm.fill(0);
      rmsSm = peakSm = zcrSm = 0;
    });

    // ---- Chart drawing ----
    function fmtAxis(v, unit) {
      const s = v >= 100 ? v.toFixed(0) : v.toFixed(2);
      return unit ? `${s} ${unit}` : s;
    }

    function drawChart(canvas, raw, smoothed, color, label, max = 1, unit = "") {
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
        x: 0, y: padY, w, h: plotH,
        min: 0, max,
        stroke: "rgba(230, 232, 236, 0.18)",
        lineWidth: 1,
      });

      drawLine(ctx, smoothed, {
        x: 0, y: padY, w, h: plotH,
        min: 0, max,
        stroke: color,
        lineWidth: 1.75,
      });

      drawText(ctx, fmtAxis(max, unit), 4, padY, { color: "#555555" });
      drawText(ctx, fmtAxis(0, unit), 4, h - padY, {
        color: "#555555", baseline: "bottom",
      });
      drawText(ctx, label, w - 6, padY + 2, {
        color: "#555555", align: "right",
      });
    }

    // ---- Render loop ----
    const cancelLoop = startLoop(() => {
      timeBuf = readTimeDomain(analyser, timeBuf);

      // Compute features
      const r = rms(timeBuf);
      let p = 0;
      for (let i = 0; i < timeBuf.length; i++) {
        const a = Math.abs(timeBuf[i]);
        if (a > p) p = a;
      }
      const xc = zeroCrossings(timeBuf);
      const xcHz = (xc * audioCtx.sampleRate) / (2 * timeBuf.length);

      // One-pole smoothing
      rmsSm = smooth(rmsSm, r, alpha);
      peakSm = smooth(peakSm, p, alpha);
      zcrSm = smooth(zcrSm, xcHz, alpha);

      // Push to history
      pushHistory(rmsHistRaw, r);
      pushHistory(rmsHistSm, rmsSm);
      pushHistory(peakHistRaw, p);
      pushHistory(peakHistSm, peakSm);
      pushHistory(zcrHistRaw, xcHz);
      pushHistory(zcrHistSm, zcrSm);

      // Draw
      drawChart(rmsCanvas, rmsHistRaw, rmsHistSm, "#ededed", "5 s ←");
      drawChart(peakCanvas, peakHistRaw, peakHistSm, "#ff5b22", "5 s ←");
      drawChart(zcrCanvas, zcrHistRaw, zcrHistSm, "#a0a0a0", "5 s ←", 14000, "Hz");

      rmsValue.textContent = rmsSm.toFixed(4);
      peakValue.textContent = peakSm.toFixed(4);
      zcrValue.textContent = `${xc} crossings · ~${xcHz.toFixed(0)} Hz`;
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
