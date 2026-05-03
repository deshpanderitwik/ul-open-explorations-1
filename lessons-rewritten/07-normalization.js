import {
  getAudioContext,
  createAnalyser,
  readTimeDomain,
  startLoop,
  rms,
  dbToUnit,
} from "../lib/audio.js";
import { createSourceController } from "../lib/sources.js";
import {
  fitCanvas,
  clear,
  drawLine,
  drawBars,
  drawMeter,
  drawText,
} from "../lib/draw.js";

const FFT_SIZE = 2048;
const HISTORY = 360;
const HIST_BUCKETS = 40;

const lesson = {
  id: 7,
  title: "Distributions and adaptive normalization",
  summary: "Mapping a moving target into a stable 0..1 control signal.",
  render(container) {
    container.innerHTML = `
      <p>Visual parameters want inputs in <code>0..1</code>. Audio features show up as dBFS, raw linear magnitudes, hertz, unbounded sums — none of them in <code>0..1</code>. And whatever range you'd hand-tune for a quiet song will be wrong for the loud one ten minutes later.</p>

      <p>Three tools cover almost every case. Convert dB to a unit value with a sensible floor. Track how a feature has been distributed lately and stretch that range to fill <code>0..1</code>. Then apply a soft squash so a stray transient doesn't pin the output at 1.0 and freeze your visual.</p>

      <div class="controls">
        <span>Source</span>
        <button class="button src-btn" data-type="sine">Sine</button>
        <button class="button src-btn" data-type="square">Square</button>
        <button class="button src-btn" data-type="sawtooth">Saw</button>
        <button class="button src-btn" data-type="triangle">Triangle</button>
        <button class="button src-btn" data-type="noise">Noise</button>
        <label>File <input type="file" id="file-input" accept="audio/*"></label>
        <span class="spacer"></span>
        <button class="button" id="reset-btn">Reset learner</button>
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
        <label>dB floor
          <input type="range" id="floor-db" min="-120" max="-40" step="1" value="-80">
          <span class="readout" id="floor-db-readout">−80 dB</span>
        </label>
      </div>

      <div class="controls">
        <span>Auto-norm</span>
        <label>Window
          <select id="win-sec">
            <option value="1">1 s</option>
            <option value="3" selected>3 s</option>
            <option value="10">10 s</option>
            <option value="30">30 s</option>
          </select>
        </label>
        <label>Squash
          <select id="squash">
            <option value="none">none</option>
            <option value="hard">hard clip</option>
            <option value="soft" selected>soft (piecewise)</option>
            <option value="tanh">tanh</option>
          </select>
        </label>
      </div>

      <div class="feature">
        <div class="feature-head">
          <span class="feature-name">Raw RMS  →  normalized 0..1</span>
          <span class="feature-formula">y = squash( (x − p₅) / (p₉₅ − p₅) )</span>
          <span class="feature-value" id="meters-info">—</span>
        </div>
        <canvas id="meters-canvas" style="height: 130px"></canvas>
      </div>

      <div class="feature">
        <div class="feature-head">
          <span class="feature-name">Distribution of recent RMS values</span>
          <span class="feature-formula">histogram over the last N seconds · p₅ / p₉₅ marks</span>
          <span class="feature-value" id="dist-info">—</span>
        </div>
        <canvas id="hist-canvas" style="height: 130px"></canvas>
      </div>

      <div class="feature">
        <div class="feature-head">
          <span class="feature-name">Squash function shapes</span>
          <span class="feature-formula">none · hard · soft · tanh</span>
          <span class="feature-value">f: ℝ → [0, 1]</span>
        </div>
        <canvas id="squash-canvas" style="height: 180px"></canvas>
      </div>

      <h3>What you're seeing</h3>
      <p><em>Top.</em> Two meters. The blue one shows raw RMS clamped to <code>[0, 1]</code> — what you'd get without normalization. The orange one is the same signal after the auto-normalizer: stretched between the 5th and 95th percentiles of the last few seconds, then squashed.</p>
      <p><em>Middle.</em> A histogram of raw RMS values from the last few seconds, with the 5th and 95th percentiles marked. That's the distribution the auto-normalizer uses to set its scale. Watch it shift as you change source or volume.</p>
      <p><em>Bottom.</em> The squash functions side by side. The dashed line is the identity — no squash at all. Hard clip is what you get from a thoughtless <code>min(1, max(0, x))</code>. Soft clip eases the top end so a transient doesn't slam into the ceiling. Tanh is the classic smooth saturator: lovely curve, but it never quite reaches 1.</p>

      <h3>Try this</h3>
      <ol>
        <li>Play a quiet song (volume 0.05). The raw meter sits near zero, but the normalized meter still uses the full range — the auto-normalizer has stretched the song's tiny dynamics to fill 0..1.</li>
        <li>Push volume to 1.0 mid-song. The raw meter pins to 1.0 and goes useless. The normalized meter takes a moment to recalibrate, then settles back into its full range. That's the whole point of adaptive normalization: your visual stays alive on material it wasn't tuned for.</li>
        <li>Set the window to 30 s and play a song with a quiet intro. The histogram stays dominated by the intro for a long time, so when the drop lands, the normalized meter pegs at 1.0 until the long window finally forgets the intro. Switch to 1 s and it recovers in a beat — at the cost of "knowing" less about the material.</li>
        <li>Cycle <strong>Squash</strong> through none → hard → soft → tanh on a kick-heavy file. None lets the meter swing below 0 and above 1 (the 5–95 stretch puts loud kicks <em>past</em> 1). Hard chops them off. Soft eases past 1 with diminishing returns. Tanh is the gentlest of the bunch.</li>
        <li>Drop the <strong>dB floor</strong> from −80 to −40 on a quiet sound. The dB→unit conversion now ignores anything below −40 dB, so silence reads as exactly 0 instead of "0.2 from background hiss." Useful when you want a feature to be honest about silence.</li>
      </ol>

      <h3>What's next</h3>
      <p>Normalization gets a feature into a range a visual can use. Lesson 8 is about the moments <em>between</em> values — when something actually happens. Onset detection picks peaks out of a smoothed flux signal, and a quick autocorrelation on the onset envelope gives you tempo: the two ingredients for any beat-synced visualizer.</p>
    `;

    // ---- DOM refs ----
    const stopBtn = container.querySelector("#stop-btn");
    const resetBtn = container.querySelector("#reset-btn");
    const fileInput = container.querySelector("#file-input");
    const freqInput = container.querySelector("#freq");
    const freqReadout = container.querySelector("#freq-readout");
    const volInput = container.querySelector("#vol");
    const floorDbInput = container.querySelector("#floor-db");
    const floorDbReadout = container.querySelector("#floor-db-readout");
    const winSecSelect = container.querySelector("#win-sec");
    const squashSelect = container.querySelector("#squash");
    const srcButtons = container.querySelectorAll(".src-btn");

    const metersCanvas = container.querySelector("#meters-canvas");
    const histCanvas = container.querySelector("#hist-canvas");
    const squashCanvas = container.querySelector("#squash-canvas");
    const metersInfo = container.querySelector("#meters-info");
    const distInfo = container.querySelector("#dist-info");

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
    let floorDb = parseFloat(floorDbInput.value);
    let winFrames = parseInt(winSecSelect.value) * 60; // assume 60 fps
    let squash = squashSelect.value;

    floorDbInput.addEventListener("input", () => {
      floorDb = parseFloat(floorDbInput.value);
      floorDbReadout.textContent = `${floorDb} dB`;
    });
    winSecSelect.addEventListener("change", () => {
      winFrames = parseInt(winSecSelect.value) * 60;
      // Don't shrink past current ring — let it drain naturally on growth.
      while (recent.length > winFrames) recent.shift();
    });
    squashSelect.addEventListener("change", () => {
      squash = squashSelect.value;
    });

    // Rolling sample window for percentile estimation
    const recent = [];
    resetBtn.addEventListener("click", () => {
      recent.length = 0;
    });

    // ---- Buffers ----
    let timeBuf = new Float32Array(FFT_SIZE);
    const rawHist = new Float32Array(HISTORY);
    const normHist = new Float32Array(HISTORY);
    function pushH(arr, v) {
      arr.copyWithin(0, 1);
      arr[HISTORY - 1] = v;
    }

    function percentile(arr, p) {
      if (arr.length === 0) return 0;
      const sorted = arr.slice().sort((a, b) => a - b);
      const idx = Math.max(
        0,
        Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))
      );
      return sorted[idx];
    }

    function squashFn(x) {
      if (squash === "none") return x;
      if (squash === "hard") return Math.max(0, Math.min(1, x));
      if (squash === "soft") {
        // Linear up to 0.85, then smoothly approach 1.
        if (x <= 0) return 0;
        if (x <= 0.85) return x;
        // For x > 0.85, ease toward 1 with diminishing returns.
        const t = x - 0.85;
        return 0.85 + (1 - 0.85) * (1 - Math.exp(-3 * t));
      }
      if (squash === "tanh") {
        // tanh saturates around ±2; map x s.t. tanh(2x-1) → ~[-1, 1], then to [0, 1].
        return Math.max(0, Math.min(1, (Math.tanh(2 * x - 1) + 1) / 2));
      }
      return x;
    }

    // ---- Drawing ----
    function drawMeters(rawV, normV) {
      const { ctx, w, h } = fitCanvas(metersCanvas);
      clear(ctx, w, h, "#0c0c0c");
      const padX = 12;
      const meterH = 26;
      const gap = 14;
      const rowY1 = 22;
      const rowY2 = rowY1 + meterH + gap + 18;
      drawText(ctx, "raw RMS", padX, rowY1 - 16, { color: "#555555" });
      drawMeter(ctx, Math.max(0, Math.min(1, rawV)), {
        x: padX, y: rowY1, w: w - padX * 2, h: meterH,
        color: "#ededed", label: rawV.toFixed(3),
      });
      drawText(ctx, "normalized + squashed", padX, rowY2 - 16, {
        color: "#555555",
      });
      drawMeter(ctx, normV, {
        x: padX, y: rowY2, w: w - padX * 2, h: meterH,
        color: "#a0a0a0", label: normV.toFixed(3),
      });
    }

    function drawHistogram(p5, p95) {
      const { ctx, w, h } = fitCanvas(histCanvas);
      clear(ctx, w, h, "#0c0c0c");
      const padY = 8;
      const padX = 8;
      const plotW = w - padX * 2;
      const plotH = h - padY * 2;
      const buckets = new Array(HIST_BUCKETS).fill(0);
      let maxBucket = 0;
      for (const v of recent) {
        const b = Math.max(
          0,
          Math.min(HIST_BUCKETS - 1, Math.floor(v * HIST_BUCKETS))
        );
        buckets[b]++;
        if (buckets[b] > maxBucket) maxBucket = buckets[b];
      }
      drawBars(ctx, buckets, {
        x: padX, y: padY, w: plotW, h: plotH,
        min: 0, max: Math.max(1, maxBucket),
        color: "rgba(237, 237, 237, 0.55)", gap: 1,
      });

      // Percentile lines
      ctx.strokeStyle = "#ff5b22";
      ctx.lineWidth = 2;
      for (const [p, label] of [[p5, "p5"], [p95, "p95"]]) {
        const px = padX + Math.max(0, Math.min(1, p)) * plotW;
        ctx.beginPath();
        ctx.moveTo(px, padY);
        ctx.lineTo(px, padY + plotH);
        ctx.stroke();
        drawText(ctx, label, px + 3, padY + 2, { color: "#ff5b22" });
      }
      drawText(ctx, "0", padX, padY + plotH + 2, { color: "#555555" });
      drawText(ctx, "1", padX + plotW, padY + plotH + 2, {
        color: "#555555", align: "right",
      });
    }

    function drawSquash() {
      const { ctx, w, h } = fitCanvas(squashCanvas);
      clear(ctx, w, h, "#0c0c0c");
      const padY = 12;
      const padX = 32;
      const plotW = w - padX * 2;
      const plotH = h - padY * 2;
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      for (const t of [0, 0.5, 1]) {
        const py = padY + (1 - t) * plotH;
        ctx.beginPath();
        ctx.moveTo(padX, py);
        ctx.lineTo(padX + plotW, py);
        ctx.stroke();
        drawText(ctx, t.toFixed(1), padX - 4, py, {
          color: "#555555", align: "right", baseline: "middle",
        });
      }
      // Identity guide
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(padX, padY + plotH);
      ctx.lineTo(padX + plotW, padY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Plot each squash function
      const samples = 200;
      const fns = [
        ["none", "rgba(230,232,236,0.35)"],
        ["hard", "#ededed"],
        ["soft", "#a0a0a0"],
        ["tanh", "#ff5b22"],
      ];
      for (const [name, color] of fns) {
        ctx.strokeStyle = color;
        ctx.lineWidth = name === squash ? 2.25 : 1.25;
        ctx.beginPath();
        for (let i = 0; i <= samples; i++) {
          const x = (i / samples) * 1.4 - 0.2; // sample [-0.2 .. 1.2]
          let y;
          const old = squash;
          squash = name;
          y = squashFn(x);
          squash = old;
          const px = padX + ((x + 0.2) / 1.4) * plotW;
          const py = padY + (1 - Math.max(-0.1, Math.min(1.1, y))) * plotH;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      // Legend
      let lx = padX + 6;
      for (const [name, color] of fns) {
        const isActive = name === squash;
        drawText(ctx, name, lx, padY + 4, {
          color, size: isActive ? 12 : 11,
        });
        lx += 60;
      }
    }

    // ---- Render loop ----
    const cancelLoop = startLoop(() => {
      timeBuf = readTimeDomain(analyser, timeBuf);
      // Convert to dB then back through dbToUnit using the chosen floor —
      // illustrates the floor knob even though we already have linear RMS.
      const r = rms(timeBuf);
      const db = r > 0 ? 20 * Math.log10(r) : floorDb;
      const x = dbToUnit(db, floorDb);

      recent.push(x);
      while (recent.length > winFrames) recent.shift();

      const p5 = percentile(recent, 0.05);
      const p95 = percentile(recent, 0.95);
      const span = Math.max(1e-4, p95 - p5);
      const stretched = (x - p5) / span;
      const norm = squashFn(stretched);

      pushH(rawHist, x);
      pushH(normHist, Math.max(0, Math.min(1, norm)));

      drawMeters(x, Math.max(0, Math.min(1, norm)));
      drawHistogram(p5, p95);
      drawSquash();

      metersInfo.textContent = `raw=${x.toFixed(3)}  norm=${norm.toFixed(3)}`;
      distInfo.textContent = `n=${recent.length} · p5=${p5.toFixed(3)} · p95=${p95.toFixed(3)}`;
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
