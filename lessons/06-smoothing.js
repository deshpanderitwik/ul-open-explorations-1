import {
  getAudioContext,
  createAnalyser,
  readTimeDomain,
  startLoop,
  rms,
  smooth,
  smoothAR,
} from "../lib/audio.js";
import { createSourceController } from "../lib/sources.js";
import { fitCanvas, clear, drawLine, drawText } from "../lib/draw.js";

const FFT_SIZE = 2048;
const HISTORY = 360;

const lesson = {
  id: 6,
  title: "Time scales and smoothing",
  summary: "Attack/release, EMAs, and how to choose a time constant.",
  render(container) {
    container.innerHTML = `
      <p>Every feature you met in lessons 2–5 jitters from frame to frame. Wire raw RMS or raw centroid straight to a visual parameter and the result twitches — distracting at best, seizure-inducing at worst. Smoothing turns a feature into a control signal you can actually look at, but it always costs you latency: every smoother is some bargain between "responsive" and "stable."</p>

      <p>Three classical smoothers cover almost every case you'll hit. This lesson runs all three on the same input — RMS from an audio source — so you can feel the trade-offs side by side.</p>

      <div class="controls">
        <span>Source</span>
        <button class="button src-btn" data-type="sine">Sine</button>
        <button class="button src-btn" data-type="square">Square</button>
        <button class="button src-btn" data-type="sawtooth">Saw</button>
        <button class="button src-btn" data-type="triangle">Triangle</button>
        <button class="button src-btn" data-type="noise">Noise</button>
        <label>File <input type="file" id="file-input" accept="audio/*"></label>
        <span class="spacer"></span>
        <button class="button" id="impulse-btn">Send impulse</button>
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
      </div>

      <div class="controls">
        <span>Smoothers</span>
        <label>One-pole α
          <input type="range" id="alpha" min="0.02" max="1" step="0.01" value="0.20">
          <span class="readout" id="alpha-readout">0.20</span>
        </label>
        <label>Attack
          <input type="range" id="attack" min="0.05" max="1" step="0.01" value="0.80">
          <span class="readout" id="attack-readout">0.80</span>
        </label>
        <label>Release
          <input type="range" id="release" min="0.01" max="1" step="0.01" value="0.06">
          <span class="readout" id="release-readout">0.06</span>
        </label>
        <label>Median N
          <select id="median-n">
            <option>3</option>
            <option selected>5</option>
            <option>9</option>
            <option>15</option>
          </select>
        </label>
      </div>

      <div class="feature">
        <div class="feature-head">
          <span class="feature-name">RMS, four ways</span>
          <span class="feature-formula">raw · one-pole · attack/release · median</span>
          <span class="feature-value" id="legend">—</span>
        </div>
        <canvas id="compare-canvas" style="height: 260px"></canvas>
      </div>

      <div class="feature">
        <div class="feature-head">
          <span class="feature-name">Impulse response</span>
          <span class="feature-formula">step from 0 → 1 at t=0; recovery to 0 after 1 s</span>
          <span class="feature-value" id="impulse-info">click "Send impulse"</span>
        </div>
        <canvas id="impulse-canvas" style="height: 200px"></canvas>
      </div>

      <h3>Three smoothers, three personalities</h3>
      <p><em>One-pole exponential moving average.</em> <code>y_t = α·x_t + (1−α)·y_{t−1}</code>. One knob, symmetric — it tracks rising and falling input at the same speed. α = 1 is "no smoothing," α near 0 is molasses. It's about as cheap as a smoother gets and the right default when you don't have a specific reason to reach for something else.</p>
      <p><em>Asymmetric attack/release.</em> Same equation, but α flips between an <em>attack</em> value while the input is climbing and a <em>release</em> value while it's falling. Pick a high attack (0.8) and a low release (0.05) and you get the shape every level meter wants: snap up to the peak, decay slowly so your eye can actually read it. Every classic VU/PPM meter is doing exactly this under the hood.</p>
      <p><em>Sliding median.</em> Output the median of the last N samples. This isn't smoothing in the EMA sense — it <em>rejects</em> outliers outright. A single one-frame spike vanishes completely for any N ≥ 3. It reacts more slowly to genuinely sustained changes, but it's immune to the kind of noise an EMA is forced to average through.</p>

      <h3>Try this</h3>
      <ol>
        <li>Hit <strong>Send impulse</strong>. The bottom panel shows a clean 0→1→0 step. Watch each smoother handle the rising edge: median sits still until N/2 frames in, then jumps cleanly; one-pole eases up exponentially; attack/release rises almost instantly (with high attack) but decays slowly.</li>
        <li>Drop <strong>α</strong> to 0.05 and play a kick-heavy file. The one-pole line glides smoothly but lags visibly — by the time it shows the kick, the kick is gone. That's the classic latency tax of heavy EMA smoothing.</li>
        <li>Set <strong>attack</strong> = 0.95, <strong>release</strong> = 0.02. The attack/release line nails every transient peak instantly, and the slow release leaves a readable envelope trail. Compare it to the one-pole at the same effective time constant: same visual stability, but the attack/release version always shows you the real peak.</li>
        <li>Switch to <strong>Noise</strong>. Raw RMS jitters around 0.4. Median-5 sits rock steady; one-pole at α = 0.2 still wobbles visibly. Median is the right tool when the underlying value really is constant and you're just trying to kill measurement noise.</li>
        <li>Crank <strong>Median N</strong> to 15. Now the median trails the impulse by about seven frames (≈ 100 ms at 60 fps). You're spending frames to buy outlier rejection — that's the deal.</li>
      </ol>

      <h3>What's next</h3>
      <p>Smoothing assumes you've already settled the dynamic range — you've decided what "0" and "1" mean for the feature. Real audio refuses to cooperate: a quiet song's RMS lives in 0–0.1, a loud one in 0.5–1.0. Lesson 7 turns to distributions and adaptive normalization — keeping a running estimate of what range a feature is actually using right now, so the control signal stays usable across wildly different material.</p>
    `;

    // ---- DOM refs ----
    const stopBtn = container.querySelector("#stop-btn");
    const impulseBtn = container.querySelector("#impulse-btn");
    const fileInput = container.querySelector("#file-input");
    const freqInput = container.querySelector("#freq");
    const freqReadout = container.querySelector("#freq-readout");
    const volInput = container.querySelector("#vol");
    const alphaInput = container.querySelector("#alpha");
    const alphaReadout = container.querySelector("#alpha-readout");
    const attackInput = container.querySelector("#attack");
    const attackReadout = container.querySelector("#attack-readout");
    const releaseInput = container.querySelector("#release");
    const releaseReadout = container.querySelector("#release-readout");
    const medianNSelect = container.querySelector("#median-n");
    const srcButtons = container.querySelectorAll(".src-btn");
    const compareCanvas = container.querySelector("#compare-canvas");
    const impulseCanvas = container.querySelector("#impulse-canvas");
    const impulseInfo = container.querySelector("#impulse-info");
    const legend = container.querySelector("#legend");

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
    let attack = parseFloat(attackInput.value);
    let release = parseFloat(releaseInput.value);
    let medianN = parseInt(medianNSelect.value);
    alphaInput.addEventListener("input", () => {
      alpha = parseFloat(alphaInput.value);
      alphaReadout.textContent = alpha.toFixed(2);
    });
    attackInput.addEventListener("input", () => {
      attack = parseFloat(attackInput.value);
      attackReadout.textContent = attack.toFixed(2);
    });
    releaseInput.addEventListener("input", () => {
      release = parseFloat(releaseInput.value);
      releaseReadout.textContent = release.toFixed(2);
    });
    medianNSelect.addEventListener("change", () => {
      medianN = parseInt(medianNSelect.value);
    });

    // ---- Buffers / state ----
    let timeBuf = new Float32Array(FFT_SIZE);
    const rawHist = new Float32Array(HISTORY);
    const onepoleHist = new Float32Array(HISTORY);
    const arHist = new Float32Array(HISTORY);
    const medianHist = new Float32Array(HISTORY);
    let onepoleSm = 0;
    let arSm = 0;
    const recentRaw = []; // for median
    function pushH(arr, v) {
      arr.copyWithin(0, 1);
      arr[HISTORY - 1] = v;
    }
    function median(arr) {
      const a = arr.slice().sort((x, y) => x - y);
      return a[(a.length - 1) >> 1];
    }

    // ---- Impulse capture ----
    // Inject a synthetic step on top of the live RMS so the impulse panel can
    // freeze the four smoothers' response to a known input.
    let impulseActive = false;
    let impulseStart = 0;
    const IMP_FRAMES = 240;
    const impRaw = new Float32Array(IMP_FRAMES);
    const impOnepole = new Float32Array(IMP_FRAMES);
    const impAR = new Float32Array(IMP_FRAMES);
    const impMedian = new Float32Array(IMP_FRAMES);
    let impIdx = 0;
    let impOnepoleSm = 0;
    let impARSm = 0;
    const impRecent = [];

    impulseBtn.addEventListener("click", () => {
      impulseActive = true;
      impulseStart = performance.now();
      impIdx = 0;
      impOnepoleSm = 0;
      impARSm = 0;
      impRecent.length = 0;
      impRaw.fill(0);
      impOnepole.fill(0);
      impAR.fill(0);
      impMedian.fill(0);
      impulseInfo.textContent = "capturing…";
    });

    function impulseValue(idx) {
      // 60 frames up (≈ 1 s), 60 frames down, then trailing zeros.
      if (idx < 60) return 1;
      if (idx < 120) return 0;
      return 0;
    }

    // ---- Drawing ----
    function drawCompare() {
      const { ctx, w, h } = fitCanvas(compareCanvas);
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
      drawLine(ctx, rawHist, {
        x: 0, y: padY, w, h: plotH, min: 0, max: 1,
        stroke: "rgba(230, 232, 236, 0.18)", lineWidth: 1,
      });
      drawLine(ctx, onepoleHist, {
        x: 0, y: padY, w, h: plotH, min: 0, max: 1,
        stroke: "#ededed", lineWidth: 1.75,
      });
      drawLine(ctx, arHist, {
        x: 0, y: padY, w, h: plotH, min: 0, max: 1,
        stroke: "#a0a0a0", lineWidth: 1.75,
      });
      drawLine(ctx, medianHist, {
        x: 0, y: padY, w, h: plotH, min: 0, max: 1,
        stroke: "#ff5b22", lineWidth: 1.75,
      });
      drawText(ctx, "raw", 8, padY + 2, { color: "#8a8a8a" });
      drawText(ctx, "one-pole", 40, padY + 2, { color: "#ededed" });
      drawText(ctx, "attack/release", 100, padY + 2, { color: "#a0a0a0" });
      drawText(ctx, `median(${medianN})`, 200, padY + 2, { color: "#ff5b22" });
      drawText(ctx, "6 s ←", w - 6, padY + 2, {
        color: "#555555", align: "right",
      });
    }

    function drawImpulse() {
      const { ctx, w, h } = fitCanvas(impulseCanvas);
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
      // Vertical guide at the step transitions
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.setLineDash([3, 4]);
      for (const f of [60, 120]) {
        const px = (f / IMP_FRAMES) * w;
        ctx.beginPath();
        ctx.moveTo(px, padY);
        ctx.lineTo(px, padY + plotH);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      drawLine(ctx, impRaw, {
        x: 0, y: padY, w, h: plotH, min: 0, max: 1,
        stroke: "rgba(230, 232, 236, 0.30)", lineWidth: 1,
      });
      drawLine(ctx, impOnepole, {
        x: 0, y: padY, w, h: plotH, min: 0, max: 1,
        stroke: "#ededed", lineWidth: 1.75,
      });
      drawLine(ctx, impAR, {
        x: 0, y: padY, w, h: plotH, min: 0, max: 1,
        stroke: "#a0a0a0", lineWidth: 1.75,
      });
      drawLine(ctx, impMedian, {
        x: 0, y: padY, w, h: plotH, min: 0, max: 1,
        stroke: "#ff5b22", lineWidth: 1.75,
      });

      drawText(ctx, "step↑", 8, padY + 2, { color: "#555555" });
      drawText(ctx, "step↓", (60 / IMP_FRAMES) * w + 6, padY + 2, {
        color: "#555555",
      });
    }

    // ---- Render loop ----
    const cancelLoop = startLoop(() => {
      timeBuf = readTimeDomain(analyser, timeBuf);
      const r = rms(timeBuf);

      // Clamp to a 0..1ish range; RMS rarely exceeds 0.7 for natural audio,
      // but we map to display [0..1] linearly.
      const x = Math.min(1, r * 1.5);

      onepoleSm = smooth(onepoleSm, x, alpha);
      arSm = smoothAR(arSm, x, attack, release);
      recentRaw.push(x);
      while (recentRaw.length > medianN) recentRaw.shift();
      const med = median(recentRaw);

      pushH(rawHist, x);
      pushH(onepoleHist, onepoleSm);
      pushH(arHist, arSm);
      pushH(medianHist, med);

      // Impulse capture (synthetic step on a separate state machine)
      if (impulseActive) {
        const inp = impulseValue(impIdx);
        impOnepoleSm = smooth(impOnepoleSm, inp, alpha);
        impARSm = smoothAR(impARSm, inp, attack, release);
        impRecent.push(inp);
        while (impRecent.length > medianN) impRecent.shift();
        const m = median(impRecent);
        impRaw[impIdx] = inp;
        impOnepole[impIdx] = impOnepoleSm;
        impAR[impIdx] = impARSm;
        impMedian[impIdx] = m;
        impIdx++;
        if (impIdx >= IMP_FRAMES) {
          impulseActive = false;
          // Compute time-to-90% and time-to-10% for one-pole.
          let t90 = -1;
          for (let i = 0; i < 60; i++) {
            if (impOnepole[i] >= 0.9) { t90 = i; break; }
          }
          impulseInfo.textContent = `one-pole 90% at frame ${t90 < 0 ? "—" : t90}`;
        }
      }

      drawCompare();
      drawImpulse();

      legend.textContent = `raw=${x.toFixed(3)} · 1p=${onepoleSm.toFixed(3)} · ar=${arSm.toFixed(3)} · med=${med.toFixed(3)}`;
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
