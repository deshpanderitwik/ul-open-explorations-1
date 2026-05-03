import {
  getAudioContext,
  createAnalyser,
  readTimeDomain,
  startLoop,
  rms,
} from "../lib/audio.js";
import { createSourceController } from "../lib/sources.js";
import { fitCanvas, clear, drawLine, drawText } from "../lib/draw.js";

const FFT_SIZE = 2048;

const lesson = {
  id: 1,
  title: "The raw signal",
  summary: "Audio as samples over time.",
  render(container) {
    container.innerHTML = `
      <p>At its lowest level, an audio signal is just a stream of numbers. Each one records the air pressure at a single instant — or equivalently, where a speaker cone sits at that moment. Play those numbers back fast enough (typically 44,100 or 48,000 per second) and your ear hears continuous sound.</p>

      <p>Pick a source below and watch the waveform draw itself. Then drag the <em>zoom</em> slider all the way in: eventually you can count the individual samples as dots. Those dots are <em>all there is</em>. Every feature we extract in later lessons — RMS, FFT, onset detection, the lot — is just arithmetic performed on sequences like this one.</p>

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
          <input type="range" id="freq" min="40" max="2000" step="1" value="440">
          <span class="readout" id="freq-readout">440 Hz</span>
        </label>
        <label>Volume
          <input type="range" id="vol" min="0" max="1" step="0.01" value="0.2">
        </label>
      </div>

      <canvas id="wave" style="height: 280px"></canvas>

      <div class="controls">
        <label>Zoom
          <input type="range" id="zoom" min="0" max="1" step="0.001" value="1">
          <span class="readout" id="zoom-readout">—</span>
        </label>
      </div>

      <h3>The numbers behind the picture</h3>
      <div class="readouts">
        <div>Sample rate: <code id="sr">—</code></div>
        <div>Buffer (fftSize): <code>${FFT_SIZE}</code></div>
        <div>Per-sample interval: <code id="dt-sample">—</code></div>
        <div>RMS: <code id="rms">0.0000</code></div>
        <div>Peak: <code id="peak">0.0000</code></div>
      </div>

      <p style="margin-top: 16px;">A few of the actual sample values from the window above:</p>
      <pre id="samples"><code>—</code></pre>

      <h3>Why this matters</h3>
      <p>The sample rate is your time grid. At 48 kHz, samples sit about 20.8 µs apart. The Nyquist theorem tells you that a grid this fine can faithfully represent any frequency up to <em>half</em> the sample rate — so 48 kHz covers everything below 24 kHz, comfortably past the top of human hearing.</p>
      <p>One thing worth noticing as you switch sources: noise and a sine wave look nothing alike, even at the same loudness. Their <em>shape</em> over time tells you whether the signal has any obvious periodicity. The next two lessons turn that visual intuition into numbers — first with simple time-domain features, then with the FFT.</p>
    `;

    // ---- DOM refs ----
    const canvas = container.querySelector("#wave");
    const stopBtn = container.querySelector("#stop-btn");
    const fileInput = container.querySelector("#file-input");
    const freqInput = container.querySelector("#freq");
    const freqReadout = container.querySelector("#freq-readout");
    const volInput = container.querySelector("#vol");
    const zoomInput = container.querySelector("#zoom");
    const zoomReadout = container.querySelector("#zoom-readout");
    const srEl = container.querySelector("#sr");
    const dtEl = container.querySelector("#dt-sample");
    const rmsEl = container.querySelector("#rms");
    const peakEl = container.querySelector("#peak");
    const samplesEl = container.querySelector("#samples").querySelector("code");
    const srcButtons = container.querySelectorAll(".src-btn");

    // ---- Audio graph: source → masterGain → analyser → destination ----
    const audioCtx = getAudioContext();
    const masterGain = audioCtx.createGain();
    masterGain.gain.value = parseFloat(volInput.value);
    const analyser = createAnalyser(masterGain, {
      fftSize: FFT_SIZE,
      smoothingTimeConstant: 0, // raw waveform — no smoothing
    });
    analyser.connect(audioCtx.destination);

    srEl.textContent = `${audioCtx.sampleRate} Hz`;
    dtEl.textContent = `${(1e6 / audioCtx.sampleRate).toFixed(2)} µs`;

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

    // ---- Render loop ----
    let timeBuf = new Float32Array(FFT_SIZE);

    const cancelLoop = startLoop(() => {
      const { ctx, w, h } = fitCanvas(canvas);
      timeBuf = readTimeDomain(analyser, timeBuf);

      // Map zoom slider [0..1] → number of visible samples [8..FFT_SIZE]
      // exponentially, so the slider feels balanced at every scale.
      const zoomT = parseFloat(zoomInput.value);
      const sampleCount = Math.max(
        2,
        Math.round(8 * Math.pow(FFT_SIZE / 8, zoomT))
      );
      const start = Math.floor((FFT_SIZE - sampleCount) / 2);
      const slice = timeBuf.subarray(start, start + sampleCount);

      // ---- Background + grid ----
      clear(ctx, w, h, "#0c0c0c");
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      const padY = h * 0.06;
      const plotH = h - 2 * padY;
      const yFor = (v) => padY + (1 - (v + 1) / 2) * plotH;
      for (const v of [-1, -0.5, 0, 0.5, 1]) {
        const py = yFor(v);
        ctx.beginPath();
        ctx.moveTo(0, py);
        ctx.lineTo(w, py);
        ctx.stroke();
      }

      // ---- Waveform line ----
      drawLine(ctx, slice, {
        x: 0,
        y: padY,
        w,
        h: plotH,
        min: -1,
        max: 1,
        stroke: "#ededed",
        lineWidth: 1.5,
      });

      // ---- Sample dots when zoomed in enough to see them ----
      if (sampleCount <= 96) {
        ctx.fillStyle = "#ededed";
        const r = sampleCount <= 32 ? 4 : sampleCount <= 64 ? 3 : 2;
        for (let i = 0; i < slice.length; i++) {
          const px = (i / Math.max(1, slice.length - 1)) * w;
          const py = yFor(slice[i]);
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ---- Axis labels ----
      drawText(ctx, "+1.0", 6, padY, { color: "#555555" });
      drawText(ctx, " 0.0", 6, h / 2, { color: "#555555", baseline: "middle" });
      drawText(ctx, "-1.0", 6, h - padY, { color: "#555555", baseline: "bottom" });

      const ms = (sampleCount * 1000) / audioCtx.sampleRate;
      drawText(
        ctx,
        `${sampleCount} samples · ${ms < 10 ? ms.toFixed(2) : ms.toFixed(1)} ms`,
        w - 8,
        h - 6,
        { color: "#555555", align: "right", baseline: "bottom" }
      );

      // ---- Stats / readouts ----
      const r = rms(timeBuf);
      let peak = 0;
      for (let i = 0; i < timeBuf.length; i++) {
        const a = Math.abs(timeBuf[i]);
        if (a > peak) peak = a;
      }
      rmsEl.textContent = r.toFixed(4);
      peakEl.textContent = peak.toFixed(4);
      zoomReadout.textContent =
        sampleCount === FFT_SIZE
          ? `full window (${FFT_SIZE} samples)`
          : `showing ${sampleCount} of ${FFT_SIZE}`;

      // ---- A handful of sample values from the visible slice ----
      const N = Math.min(8, slice.length);
      const stride = Math.max(1, Math.floor(slice.length / N));
      const out = [];
      for (let i = 0; i < slice.length && out.length < N; i += stride) {
        const v = slice[i];
        const sign = v < 0 ? "-" : " ";
        out.push(sign + Math.abs(v).toFixed(4));
      }
      samplesEl.textContent = out.join("   ");
    });

    // ---- Cleanup on navigation away ----
    return () => {
      cancelLoop();
      sources.dispose();
      try { masterGain.disconnect(); } catch {}
      try { analyser.disconnect(); } catch {}
    };
  },
};

export default lesson;
