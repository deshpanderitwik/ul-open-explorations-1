import {
  getAudioContext,
  createAnalyser,
  readTimeDomain,
  readFrequency,
  startLoop,
  rms,
  zeroCrossings,
  smooth,
  bandEnergy,
  dbToUnit,
} from "../lib/audio.js";
import { createSourceController } from "../lib/sources.js";
import { fitCanvas, clear, drawText, ramp } from "../lib/draw.js";

const FFT_SIZE = 2048;
const HISTORY = 240; // 4 s at 60 fps
const FEATURES = ["rms", "peak", "zcr", "bass", "mid", "treble", "centroid", "flux"];
const PARAMS = ["radius", "hue", "speed", "particles"];

const lesson = {
  id: 10,
  title: "Feature correlation and the mapping toolkit",
  summary: "Choosing features that move independently and binding them to visuals.",
  render(container) {
    container.innerHTML = `
      <p>By now you've collected a working vocabulary: RMS, peak, ZCR, bass / mid / treble, centroid, flux — plus everything from the later lessons. The remaining question is engineering, not theory: which feature should drive which visual parameter? And the answer matters more than taste.</p>

      <p>If you wire both particle radius <em>and</em> effect intensity to RMS, they'll move in lockstep, and you've spent twice the screen budget on a single number. The trick is picking features that move <em>independently</em> across the material you care about. That's the gap between a visualizer that feels alive and one that just pulses on a single axis.</p>

      <p>This lesson is the capstone. You get a live dashboard of eight features, a pairwise correlation matrix computed over a rolling window, and a small visualizer where you bind features to four visual parameters — so you can feel each feature's character driving something concrete.</p>

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
      </div>

      <div class="feature">
        <div class="feature-head">
          <span class="feature-name">Live feature dashboard</span>
          <span class="feature-formula">eight normalized 0..1 features</span>
          <span class="feature-value">all together now</span>
        </div>
        <canvas id="dash-canvas" style="height: 240px"></canvas>
      </div>

      <div class="feature">
        <div class="feature-head">
          <span class="feature-name">Mapping</span>
          <span class="feature-formula">choose which feature drives each visual parameter</span>
          <span class="feature-value">8 × 4 = 32 possible bindings</span>
        </div>
        <div class="controls" id="binding-row">
          ${PARAMS.map(
            (p) => `
            <label>${p}
              <select data-param="${p}">
                ${FEATURES.map(
                  (f, i) => `<option value="${f}"${i % 2 === 0 && p === PARAMS[i / 2 | 0] ? " selected" : ""}>${f}</option>`
                ).join("")}
              </select>
            </label>
          `
          ).join("")}
        </div>
        <canvas id="vis-canvas" style="height: 260px"></canvas>
      </div>

      <div class="feature">
        <div class="feature-head">
          <span class="feature-name">Pairwise correlation, last 4 s</span>
          <span class="feature-formula">|ρ| close to 1 → these features carry the same info</span>
          <span class="feature-value" id="corr-info">—</span>
        </div>
        <canvas id="corr-canvas" style="height: 320px"></canvas>
      </div>

      <h3>Reading the correlation matrix</h3>
      <p>Each cell is the absolute Pearson correlation between two features over the last few seconds, mapped through a perceptual color ramp (the same one you'd reach for a spectrogram). The diagonal is always 1. Off-diagonal cells near 1 mean those features are carrying the same information — usually because one is downstream of the other (RMS ≈ bass + mid + treble, for instance).</p>
      <p>The interesting cells are the dark ones. ZCR and bass are almost uncorrelated on most material — bass tracks low energy, ZCR tracks how often the waveform crosses zero, which is dominated by the highest-frequency content. Centroid and ZCR <em>are</em> correlated — they're both measures of brightness from different angles. Flux is mostly orthogonal to RMS — flux fires on changes, RMS reports averages.</p>

      <h3>Try this</h3>
      <ol>
        <li>Bind <strong>radius</strong> = bass, <strong>hue</strong> = centroid, <strong>speed</strong> = flux, <strong>particles</strong> = zcr. Play a kick + hi-hat loop. Each visual parameter responds to a separate aspect of the music — exactly the design we want.</li>
        <li>Bind every parameter to <strong>rms</strong>. The visualizer pulses entirely on one axis. That's the failure mode the correlation matrix exists to prevent.</li>
        <li>Watch the correlation matrix while a song plays. Bass / mid correlation ≈ 0.6 on most material — they share a lot. RMS / bass ≈ 0.8 on bass-heavy material. ZCR / centroid stays near 0.7.</li>
        <li>Switch source to <strong>Noise</strong>. Most correlations rise toward 1 because everything's fluctuating around the same average. With less structure to share, features collapse into one undifferentiated signal — a hint that noise is a poor input for visualizers that want variety.</li>
        <li>Bind <strong>hue</strong> = centroid on a <strong>Sine</strong> sweep. The disc's color slides smoothly across the full ramp as you drag the frequency slider. That's centroid-as-brightness rendered as color.</li>
      </ol>

      <h3>You're done</h3>
      <p>The audio side of a music visualizer is now demystified. From a sequence of samples you have time-domain features, spectral bands, spectral shape, smoothing, normalization, onsets, beats, pitch, chroma, and a way to bind any of them to any visual parameter you can render. Build something.</p>
    `;

    // ---- DOM refs ----
    const stopBtn = container.querySelector("#stop-btn");
    const fileInput = container.querySelector("#file-input");
    const freqInput = container.querySelector("#freq");
    const freqReadout = container.querySelector("#freq-readout");
    const volInput = container.querySelector("#vol");
    const srcButtons = container.querySelectorAll(".src-btn");
    const dashCanvas = container.querySelector("#dash-canvas");
    const visCanvas = container.querySelector("#vis-canvas");
    const corrCanvas = container.querySelector("#corr-canvas");
    const corrInfo = container.querySelector("#corr-info");
    const bindingSelects = container.querySelectorAll(
      '#binding-row select[data-param]'
    );

    // Default bindings: rotate through the feature list so each param starts on
    // a different feature.
    const defaults = { radius: "bass", hue: "centroid", speed: "flux", particles: "zcr" };
    const bindings = { ...defaults };
    bindingSelects.forEach((sel) => {
      const p = sel.dataset.param;
      sel.value = defaults[p];
      sel.addEventListener("change", () => {
        bindings[p] = sel.value;
      });
    });

    // ---- Audio graph ----
    const audioCtx = getAudioContext();
    const masterGain = audioCtx.createGain();
    masterGain.gain.value = parseFloat(volInput.value);
    const analyser = createAnalyser(masterGain, {
      fftSize: FFT_SIZE,
      smoothingTimeConstant: 0.4,
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

    // ---- Buffers / state ----
    let timeBuf = new Float32Array(FFT_SIZE);
    const dbBuf = new Float32Array(analyser.frequencyBinCount);
    const linBuf = new Float32Array(analyser.frequencyBinCount);
    const prevLinBuf = new Float32Array(analyser.frequencyBinCount);

    // Per-feature smoothed value + history
    const sm = Object.fromEntries(FEATURES.map((f) => [f, 0]));
    const hist = Object.fromEntries(
      FEATURES.map((f) => [f, new Float32Array(HISTORY)])
    );
    function pushHist(f, v) {
      const a = hist[f];
      a.copyWithin(0, 1);
      a[HISTORY - 1] = v;
    }

    // Auto-scale tracking so each feature's dashboard plot fills its row.
    const dashMax = Object.fromEntries(FEATURES.map((f) => [f, 0.1]));

    // Particles for the visualizer
    const particles = [];

    // ---- Drawing helpers ----
    function drawDashboard() {
      const { ctx, w, h } = fitCanvas(dashCanvas);
      clear(ctx, w, h, "#0c0c0c");
      const padX = 60;
      const rowH = h / FEATURES.length;
      for (let i = 0; i < FEATURES.length; i++) {
        const f = FEATURES[i];
        const y = i * rowH;
        // Row background
        ctx.fillStyle = i % 2 === 0
          ? "rgba(255,255,255,0.015)"
          : "rgba(255,255,255,0)";
        ctx.fillRect(0, y, w, rowH);

        // Label
        drawText(ctx, f, 8, y + rowH / 2, {
          color: "#8a8a8a", baseline: "middle",
        });

        // Mini sparkline normalized by dashMax[f]
        const a = hist[f];
        const max = Math.max(0.001, dashMax[f]);
        ctx.strokeStyle = "#ededed";
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        for (let k = 0; k < HISTORY; k++) {
          const px = padX + (k / (HISTORY - 1)) * (w - padX - 80);
          const py = y + rowH - 6 - (a[k] / max) * (rowH - 12);
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();

        // Live value
        drawText(ctx, sm[f].toFixed(3), w - 8, y + rowH / 2, {
          color: "#e6e8ec", align: "right", baseline: "middle",
        });
      }
    }

    function drawVisualizer() {
      const { ctx, w, h } = fitCanvas(visCanvas);
      clear(ctx, w, h, "#0c0c0c");

      // Pull each binding through the same per-feature normalization the
      // dashboard uses, so values are comparable across features.
      const norm = (f) => {
        const max = Math.max(0.001, dashMax[f]);
        return Math.max(0, Math.min(1, sm[f] / max));
      };

      const radius = 30 + norm(bindings.radius) * (Math.min(w, h) * 0.38);
      const hueT = norm(bindings.hue);
      const speed = 0.3 + norm(bindings.speed) * 6;
      const want = Math.round(20 + norm(bindings.particles) * 200);

      // Update particle pool to match desired count.
      while (particles.length < want) {
        particles.push({
          a: Math.random() * Math.PI * 2,
          r: 1,
          life: 1,
        });
      }
      while (particles.length > want) particles.pop();

      const cx = w / 2;
      const cy = h / 2;
      // Pulsing disc
      ctx.fillStyle = ramp(hueT);
      ctx.globalAlpha = 0.18;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.strokeStyle = ramp(hueT);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();

      // Particles
      for (const p of particles) {
        p.a += 0.005 * speed;
        const px = cx + Math.cos(p.a) * radius;
        const py = cy + Math.sin(p.a) * radius;
        ctx.fillStyle = ramp((hueT + p.a / (Math.PI * 2)) % 1);
        ctx.fillRect(px - 1, py - 1, 2, 2);
      }

      // HUD
      const lines = PARAMS.map(
        (p) => `${p.padEnd(10)} ← ${bindings[p].padEnd(8)} (${norm(bindings[p]).toFixed(2)})`
      );
      let ly = 12;
      for (const line of lines) {
        drawText(ctx, line, 10, ly, { color: "#8a8a8a", size: 11 });
        ly += 14;
      }
    }

    function pearson(a, b) {
      let mA = 0, mB = 0;
      for (let i = 0; i < a.length; i++) { mA += a[i]; mB += b[i]; }
      mA /= a.length; mB /= a.length;
      let num = 0, dA = 0, dB = 0;
      for (let i = 0; i < a.length; i++) {
        const xa = a[i] - mA;
        const xb = b[i] - mB;
        num += xa * xb;
        dA += xa * xa;
        dB += xb * xb;
      }
      const den = Math.sqrt(dA * dB);
      return den < 1e-9 ? 0 : num / den;
    }

    function drawCorrelation() {
      const { ctx, w, h } = fitCanvas(corrCanvas);
      clear(ctx, w, h, "#0c0c0c");
      const N = FEATURES.length;
      const padL = 70;
      const padT = 18;
      const padR = 8;
      const padB = 18;
      const cellW = (w - padL - padR) / N;
      const cellH = (h - padT - padB) / N;

      let maxOff = 0;
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          const r = i === j ? 1 : Math.abs(pearson(hist[FEATURES[i]], hist[FEATURES[j]]));
          const cx = padL + j * cellW;
          const cy = padT + i * cellH;
          ctx.fillStyle = ramp(r);
          ctx.fillRect(cx + 1, cy + 1, cellW - 1, cellH - 1);
          if (i !== j && r > maxOff) maxOff = r;
        }
      }
      // Row labels (left)
      for (let i = 0; i < N; i++) {
        drawText(ctx, FEATURES[i], padL - 6, padT + i * cellH + cellH / 2, {
          color: "#8a8a8a", align: "right", baseline: "middle",
        });
      }
      // Column labels (top)
      for (let j = 0; j < N; j++) {
        drawText(ctx, FEATURES[j], padL + j * cellW + cellW / 2, padT - 4, {
          color: "#8a8a8a", align: "center", baseline: "bottom",
        });
      }
      corrInfo.textContent = `max off-diagonal |ρ|: ${maxOff.toFixed(2)}`;
    }

    // ---- Render loop ----
    const cancelLoop = startLoop(() => {
      timeBuf = readTimeDomain(analyser, timeBuf);
      readFrequency(analyser, dbBuf);

      // RMS, peak, ZCR
      const rmsV = rms(timeBuf);
      let peakV = 0;
      for (let i = 0; i < timeBuf.length; i++) {
        const a = Math.abs(timeBuf[i]);
        if (a > peakV) peakV = a;
      }
      const zcrV = (zeroCrossings(timeBuf) * sampleRate) / (2 * timeBuf.length);

      // Linear spectrum & flux
      let totalEnergy = 0;
      let flux = 0;
      let weighted = 0;
      const M = dbBuf.length;
      for (let i = 0; i < M; i++) {
        const m = dbToUnit(dbBuf[i]);
        const d = m - prevLinBuf[i];
        if (d > 0) flux += d;
        linBuf[i] = m;
        totalEnergy += m;
        const f = (i * sampleRate) / (M * 2);
        weighted += f * m;
      }
      prevLinBuf.set(linBuf);
      const centroidV = totalEnergy > 1e-6 ? weighted / totalEnergy : 0;

      const bassV = bandEnergy(linBuf, 20, 250, sampleRate, { mode: "sum" });
      const midV = bandEnergy(linBuf, 250, 4000, sampleRate, { mode: "sum" });
      const trebV = bandEnergy(linBuf, 4000, nyquist, sampleRate, { mode: "sum" });

      const raw = {
        rms: rmsV,
        peak: peakV,
        zcr: zcrV,
        bass: bassV,
        mid: midV,
        treble: trebV,
        centroid: centroidV,
        flux,
      };
      for (const f of FEATURES) {
        sm[f] = smooth(sm[f], raw[f], 0.3);
        pushHist(f, sm[f]);
        if (sm[f] > dashMax[f]) dashMax[f] = sm[f];
        else dashMax[f] *= 0.999; // very slow decay so the scale follows down
      }

      drawDashboard();
      drawVisualizer();
      drawCorrelation();
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
