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

const FFT_SIZE = 2048;
const HISTORY = 360; // ~6 s at 60 fps
const ACF_WINDOW = 240; // 4 s of onset envelope used for tempo

const lesson = {
  id: 8,
  title: "Onset and beat detection",
  summary: "From spectral flux to a usable beat trigger.",
  render(container) {
    container.innerHTML = `
      <p>Lesson 5 introduced spectral flux: the half-wave-rectified, frame-to-frame change in the magnitude spectrum. Held tones make it sit near zero; new events spike it. Run that signal through a smoother and a peak-picker and you have a complete onset detector.</p>

      <p>Once onsets are in hand, the next question is whether they're <em>regular</em>. Autocorrelating the onset envelope (the smoothed flux) reveals the dominant period — the lag at which the signal most resembles a shifted copy of itself. That's the beat. Converting that lag to BPM and taking an <code>argmax</code> gives you tempo.</p>

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
        <label>Smoothing α
          <input type="range" id="alpha" min="0.05" max="1" step="0.01" value="0.45">
          <span class="readout" id="alpha-readout">0.45</span>
        </label>
        <label>Threshold k
          <input type="range" id="kthr" min="0.5" max="3" step="0.05" value="1.4">
          <span class="readout" id="kthr-readout">1.40</span>
        </label>
        <label>Min IOI ms
          <input type="range" id="ioi" min="40" max="400" step="10" value="100">
          <span class="readout" id="ioi-readout">100 ms</span>
        </label>
        <label>Volume
          <input type="range" id="vol" min="0" max="1" step="0.01" value="0.2">
        </label>
        <label>Frequency
          <input type="range" id="freq" min="40" max="2000" step="1" value="220">
          <span class="readout" id="freq-readout">220 Hz</span>
        </label>
      </div>

      <div class="feature">
        <div class="feature-head">
          <span class="feature-name">Onset detection function</span>
          <span class="feature-formula">smoothed flux · dynamic threshold · onsets ↑</span>
          <span class="feature-value" id="odf-info">—</span>
        </div>
        <canvas id="odf-canvas" style="height: 180px"></canvas>
      </div>

      <div class="feature">
        <div class="feature-head">
          <span class="feature-name">Tempogram</span>
          <span class="feature-formula">autocorrelation of the last 4 s of onset envelope</span>
          <span class="feature-value" id="tempo-info">— BPM</span>
        </div>
        <canvas id="tempo-canvas" style="height: 160px"></canvas>
      </div>

      <div class="feature">
        <div class="feature-head">
          <span class="feature-name">Beat phase</span>
          <span class="feature-formula">position within the inferred beat period</span>
          <span class="feature-value" id="phase-info">—</span>
        </div>
        <canvas id="phase-canvas" style="height: 70px"></canvas>
      </div>

      <h3>How the pipeline fits together</h3>
      <p><em>Spectral flux</em> per frame, smoothed with a one-pole α. The smoothed value is the <em>onset detection function</em> (ODF) — the bright line in the top panel.</p>
      <p><em>Dynamic threshold.</em> A fixed threshold falls apart the moment the level changes: noise in a quiet section will trip the same line that snares in a loud section barely clear. Instead, track the rolling mean and standard deviation of the ODF over the last second or so, and threshold at <code>mean + k · std</code>. The dashed line in the top panel does exactly that — it follows the floor and ignores the spikes.</p>
      <p><em>Peak-pick.</em> Whenever the ODF crosses the threshold and forms a local maximum, log an onset — but reject it if the previous onset fired less than <code>min IOI</code> ms ago. Real drum hits sit at least ~80 ms apart, so a sensible floor here suppresses the double-triggers caused by snare reverb.</p>
      <p><em>Tempogram.</em> Autocorrelate the last 4 seconds of the ODF. A peak at lag <code>L</code> means the signal resembles itself when shifted by L frames — there's a recurring pattern at that period. Peaks in the 300 ms – 1.5 s range cover roughly 40–200 BPM.</p>

      <h3>Try this</h3>
      <ol>
        <li>Load a drum loop. Onset ticks land on every kick and snare. The tempogram shows one strong peak (the beat) plus smaller peaks at integer multiples (the bar). The reported BPM should match what you'd tap.</li>
        <li>Pull <strong>Threshold k</strong> from 1.4 down to 0.7. Onsets multiply, including false positives between hits where the ODF just wobbles. Push k up to 2.5 and you start missing real onsets, especially soft ghost notes.</li>
        <li>Drop <strong>Min IOI</strong> to 40 ms on a snare-heavy file. Reverb tails will start spawning extra onsets. Raise it to 200 ms and a fast hi-hat pattern starts losing every other hit.</li>
        <li>Switch from a drum loop to a sustained pad. Onset ticks vanish (good); the tempogram flattens into a carpet with no clear peak (good). The reported BPM becomes meaningless — which is the right behavior, you just want a confidence reading alongside it in real apps.</li>
        <li>Smoothing α at 1.0 (no smoothing) leaves the ODF identical to raw flux — jagged, noisy, hard to threshold. Around α ≈ 0.4 you get clean impulses on real hits with a low floor between them. That's the sweet spot for most material.</li>
      </ol>

      <h3>What's next</h3>
      <p>Onsets answer "did something happen?"; tempo answers "is it regular?". Lesson 9 takes on "what note is it?". Pitch tracking via time-domain autocorrelation, together with chroma — folding the spectrum into 12 pitch classes — rounds out the toolkit for key-aware visuals.</p>
    `;

    // ---- DOM refs ----
    const stopBtn = container.querySelector("#stop-btn");
    const fileInput = container.querySelector("#file-input");
    const freqInput = container.querySelector("#freq");
    const freqReadout = container.querySelector("#freq-readout");
    const volInput = container.querySelector("#vol");
    const alphaInput = container.querySelector("#alpha");
    const alphaReadout = container.querySelector("#alpha-readout");
    const kthrInput = container.querySelector("#kthr");
    const kthrReadout = container.querySelector("#kthr-readout");
    const ioiInput = container.querySelector("#ioi");
    const ioiReadout = container.querySelector("#ioi-readout");
    const srcButtons = container.querySelectorAll(".src-btn");
    const odfCanvas = container.querySelector("#odf-canvas");
    const tempoCanvas = container.querySelector("#tempo-canvas");
    const phaseCanvas = container.querySelector("#phase-canvas");
    const odfInfo = container.querySelector("#odf-info");
    const tempoInfo = container.querySelector("#tempo-info");
    const phaseInfo = container.querySelector("#phase-info");

    // ---- Audio graph ----
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

    // ---- State ----
    let alpha = parseFloat(alphaInput.value);
    let kthr = parseFloat(kthrInput.value);
    let minIoi = parseFloat(ioiInput.value);
    alphaInput.addEventListener("input", () => {
      alpha = parseFloat(alphaInput.value);
      alphaReadout.textContent = alpha.toFixed(2);
    });
    kthrInput.addEventListener("input", () => {
      kthr = parseFloat(kthrInput.value);
      kthrReadout.textContent = kthr.toFixed(2);
    });
    ioiInput.addEventListener("input", () => {
      minIoi = parseFloat(ioiInput.value);
      ioiReadout.textContent = `${minIoi} ms`;
    });

    // ---- Buffers ----
    const dbBuf = new Float32Array(analyser.frequencyBinCount);
    const linBuf = new Float32Array(analyser.frequencyBinCount);
    const prevLinBuf = new Float32Array(analyser.frequencyBinCount);

    const odfHist = new Float32Array(HISTORY);
    const thrHist = new Float32Array(HISTORY);
    const onsetHist = new Uint8Array(HISTORY);
    let odfSm = 0;
    let lastOnsetMs = -Infinity;
    const recentOdf = []; // for dynamic threshold over last ~1 s

    function pushH(arr, v) {
      arr.copyWithin(0, 1);
      arr[HISTORY - 1] = v;
    }

    // ---- Drawing ----
    function drawODF(odfMax) {
      const { ctx, w, h } = fitCanvas(odfCanvas);
      clear(ctx, w, h, "#0c0c0c");
      const padY = 10;
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
      // ODF
      drawLine(ctx, odfHist, {
        x: 0, y: padY, w, h: plotH, min: 0, max: odfMax,
        stroke: "#ededed", lineWidth: 1.75,
        fill: "rgba(237, 237, 237, 0.12)",
      });
      // Threshold
      ctx.save();
      ctx.strokeStyle = "rgba(160, 160, 160, 0.5)";
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      for (let i = 0; i < HISTORY; i++) {
        const px = (i / (HISTORY - 1)) * w;
        const py = padY + (1 - thrHist[i] / odfMax) * plotH;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();
      // Onsets — vertical ticks at the bottom
      ctx.fillStyle = "#ff5b22";
      for (let i = 0; i < HISTORY; i++) {
        if (onsetHist[i]) {
          const px = (i / (HISTORY - 1)) * w;
          ctx.fillRect(px - 1, padY + plotH - 18, 2, 18);
        }
      }
      drawText(ctx, "ODF", 8, padY + 2, { color: "#ededed" });
      drawText(ctx, "threshold", 40, padY + 2, { color: "#a0a0a0" });
      drawText(ctx, "onsets", 110, padY + 2, { color: "#ff5b22" });
      drawText(ctx, "6 s ←", w - 6, padY + 2, {
        color: "#555555", align: "right",
      });
    }

    function autocorrelate(arr, maxLag) {
      // Mean-removed autocorrelation, normalized so acf[0] = 1.
      const N = arr.length;
      let mean = 0;
      for (let i = 0; i < N; i++) mean += arr[i];
      mean /= N;
      const out = new Float32Array(maxLag);
      let r0 = 0;
      for (let i = 0; i < N; i++) {
        const d = arr[i] - mean;
        r0 += d * d;
      }
      if (r0 < 1e-9) return out;
      for (let lag = 0; lag < maxLag; lag++) {
        let sum = 0;
        for (let i = 0; i + lag < N; i++) {
          sum += (arr[i] - mean) * (arr[i + lag] - mean);
        }
        out[lag] = sum / r0;
      }
      return out;
    }

    function drawTempo(bpm, peakLag, acf) {
      const { ctx, w, h } = fitCanvas(tempoCanvas);
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
      // BPM tick lines
      const fps = 60;
      for (const b of [60, 90, 120, 150, 180]) {
        const lag = (60 / b) * fps;
        if (lag <= 0 || lag >= acf.length) continue;
        const px = padL + (lag / acf.length) * plotW;
        ctx.strokeStyle = "rgba(255,255,255,0.05)";
        ctx.beginPath();
        ctx.moveTo(px, padY);
        ctx.lineTo(px, padY + plotH);
        ctx.stroke();
        drawText(ctx, `${b}`, px, padY + plotH + 2, {
          color: "#555555", align: "center",
        });
      }

      drawLine(ctx, acf, {
        x: padL, y: padY, w: plotW, h: plotH,
        min: -0.3, max: 1,
        stroke: "#a0a0a0", lineWidth: 1.5,
        fill: "rgba(160, 160, 160, 0.12)",
      });

      if (peakLag > 0) {
        const px = padL + (peakLag / acf.length) * plotW;
        ctx.strokeStyle = "#ff5b22";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, padY);
        ctx.lineTo(px, padY + plotH);
        ctx.stroke();
      }
      drawText(ctx, "BPM →", padL + 4, padY + 2, { color: "#555555" });
      drawText(ctx, `${bpm > 0 ? bpm.toFixed(1) : "—"} BPM`, w - 6, padY + 2, {
        color: "#ff5b22", align: "right",
      });
    }

    function drawPhase(period, framesSinceOnset) {
      const { ctx, w, h } = fitCanvas(phaseCanvas);
      clear(ctx, w, h, "#0c0c0c");
      const padX = 12;
      const meterY = 18;
      const meterH = 18;
      const phase = period > 0 ? (framesSinceOnset % period) / period : 0;
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(padX, meterY, w - padX * 2, meterH);
      // Tick marks at quarter beats
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      for (let q = 1; q < 4; q++) {
        const tx = padX + (q / 4) * (w - padX * 2);
        ctx.fillRect(tx, meterY, 1, meterH);
      }
      // Phase indicator
      const px = padX + phase * (w - padX * 2);
      ctx.fillStyle = "#ededed";
      ctx.fillRect(px - 2, meterY - 3, 4, meterH + 6);
      drawText(ctx, `phase ${(phase * 100).toFixed(0)}%`, padX, meterY + meterH + 4, {
        color: "#555555",
      });
    }

    // ---- Render loop ----
    const cancelLoop = startLoop((tNow) => {
      readFrequency(analyser, dbBuf);

      // Convert to linear and compute flux.
      let flux = 0;
      const N = dbBuf.length;
      for (let i = 0; i < N; i++) {
        const m = dbToUnit(dbBuf[i]);
        const d = m - prevLinBuf[i];
        if (d > 0) flux += d;
        linBuf[i] = m;
      }
      prevLinBuf.set(linBuf);

      odfSm = smooth(odfSm, flux, alpha);

      // Dynamic threshold over the last ~1 s.
      recentOdf.push(odfSm);
      while (recentOdf.length > 60) recentOdf.shift();
      let mean = 0;
      for (let i = 0; i < recentOdf.length; i++) mean += recentOdf[i];
      mean /= Math.max(1, recentOdf.length);
      let varSum = 0;
      for (let i = 0; i < recentOdf.length; i++) {
        const d = recentOdf[i] - mean;
        varSum += d * d;
      }
      const std = Math.sqrt(varSum / Math.max(1, recentOdf.length));
      const thr = mean + kthr * std;

      // Peak-pick: above threshold and a local max vs. the previous frame.
      const prevOdf = odfHist[HISTORY - 1];
      const isPeak =
        odfSm > thr &&
        odfSm > prevOdf &&
        tNow - lastOnsetMs >= minIoi;
      if (isPeak) lastOnsetMs = tNow;

      pushH(odfHist, odfSm);
      pushH(thrHist, thr);
      onsetHist.copyWithin(0, 1);
      onsetHist[HISTORY - 1] = isPeak ? 1 : 0;

      // Auto-scale ODF y-axis (sticky max, slow decay).
      let odfMax = 0.5;
      for (let i = 0; i < HISTORY; i++) {
        if (odfHist[i] > odfMax) odfMax = odfHist[i];
      }

      // Tempogram on the last ACF_WINDOW frames.
      const start = HISTORY - ACF_WINDOW;
      const slice = odfHist.subarray(start);
      const fps = 60;
      const minLag = Math.round((60 / 200) * fps); // 200 BPM
      const maxLag = Math.round((60 / 40) * fps); // 40 BPM
      const acf = autocorrelate(slice, Math.min(slice.length - 1, maxLag));
      let peakLag = -1;
      let peakVal = 0.05; // confidence floor
      for (let lag = minLag; lag < acf.length; lag++) {
        if (acf[lag] > peakVal) {
          peakVal = acf[lag];
          peakLag = lag;
        }
      }
      const bpm = peakLag > 0 ? (60 * fps) / peakLag : 0;

      // Phase: frames since last onset, modulo the inferred period.
      const period = peakLag > 0 ? peakLag : 0;
      const framesSinceOnset = (tNow - lastOnsetMs) / 1000 * fps;

      drawODF(odfMax);
      drawTempo(bpm, peakLag, acf);
      drawPhase(period, framesSinceOnset);

      odfInfo.textContent = `flux=${flux.toFixed(2)} · thr=${thr.toFixed(2)}`;
      tempoInfo.textContent =
        bpm > 0 ? `${bpm.toFixed(1)} BPM · acf=${peakVal.toFixed(2)}` : "— BPM";
      phaseInfo.textContent =
        period > 0
          ? `period ${(period / fps).toFixed(2)} s`
          : "no beat lock";
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
