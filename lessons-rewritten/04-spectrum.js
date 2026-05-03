import {
  getAudioContext,
  createAnalyser,
  readFrequency,
  startLoop,
  bandEnergy,
  logBands,
  dbToUnit,
} from "../lib/audio.js";
import { createSourceController } from "../lib/sources.js";
import {
  fitCanvas,
  clear,
  drawLine,
  drawBars,
  drawText,
} from "../lib/draw.js";

const FFT_SIZE = 4096;

const lesson = {
  id: 4,
  title: "Reading a spectrum — bass, mid, treble",
  summary: "Banding the spectrum into the regions a visualizer cares about.",
  render(container) {
    container.innerHTML = `
      <p>The spectrum from Lesson 3 is technically right but musically clumsy. Its x-axis runs linearly in Hz, so the octave from 100 to 200 Hz gets the same sliver of width as the octave from 10,000 to 20,000 Hz. But pitch is logarithmic — every octave is a doubling — so a linear axis squashes everything interesting into a sliver on the left and leaves a desert on the right.</p>

      <p>This lesson fixes that in three steps. First, switch the x-axis to log spacing so every octave gets equal real estate. Second, sum bins into <em>bands</em> so the jittery 1024-bin curve becomes something stable enough to drive a visual. Third, collapse those bands into the three regions every dance-music visualizer reaches for: bass, mid, and treble.</p>

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
        <label>x-axis
          <select id="axis">
            <option value="linear">linear</option>
            <option value="log" selected>log</option>
          </select>
        </label>
        <label>Bands
          <select id="bands">
            <option>8</option>
            <option selected>16</option>
            <option>32</option>
            <option>64</option>
          </select>
        </label>
      </div>

      <div class="controls">
        <label>Bass / mid crossover
          <input type="range" id="lo-mid" min="60" max="500" step="5" value="250">
          <span class="readout" id="lo-mid-readout">250 Hz</span>
        </label>
        <label>Mid / treble crossover
          <input type="range" id="mid-hi" min="1500" max="8000" step="50" value="4000">
          <span class="readout" id="mid-hi-readout">4000 Hz</span>
        </label>
      </div>

      <div class="feature">
        <div class="feature-head">
          <span class="feature-name">Spectrum bars</span>
          <span class="feature-formula" id="bars-formula">log-spaced bins (linear magnitude)</span>
          <span class="feature-value" id="bars-info">— bands</span>
        </div>
        <canvas id="spec-canvas" style="height: 240px"></canvas>
      </div>

      <div class="feature">
        <div class="feature-head">
          <span class="feature-name">Bass / mid / treble</span>
          <span class="feature-formula">Σ |X(f)| in each band  (linear)</span>
          <span class="feature-value" id="region-info">—</span>
        </div>
        <canvas id="region-canvas" style="height: 130px"></canvas>
      </div>

      <div class="feature">
        <div class="feature-head">
          <span class="feature-name">Linear vs. log banding</span>
          <span class="feature-formula">16 equal-width bins both ways</span>
          <span class="feature-value">comparison</span>
        </div>
        <canvas id="compare-canvas" style="height: 180px"></canvas>
      </div>

      <h3>What you're seeing</h3>
      <p><em>Top</em>: the spectrum as bars, with the x-axis toggleable between linear and log. Flip to log and each octave gets equal width — bass detail stops being a single spike on the left and turns into a region you can actually read.</p>
      <p><em>Middle</em>: three meters fed by <code>bandEnergy()</code>, which sums magnitudes inside bass (0 Hz to the low/mid crossover), mid (low/mid to mid/high), and treble (mid/high to Nyquist). These three numbers are exactly what you'd hand to a visualizer to drive, say, the size, hue, and sparkle of an effect.</p>
      <p><em>Bottom</em>: the same 16 bands done two ways. Faint blue is linear-spaced (each band roughly 1.5 kHz wide at 48 kHz), bright orange is log-spaced. Watch how the linear scheme dumps 14 of its 16 bands above 3 kHz, where music has very little going on.</p>

      <h3>Numbers</h3>
      <div class="readouts">
        <div>fftSize: <code>${FFT_SIZE}</code></div>
        <div>Bins: <code id="num-bins">—</code></div>
        <div>Bin width: <code id="bin-hz">—</code></div>
        <div>Bass energy: <code id="bass-val">—</code></div>
        <div>Mid energy: <code id="mid-val">—</code></div>
        <div>Treble energy: <code id="treble-val">—</code></div>
      </div>

      <h3>Try this</h3>
      <ol>
        <li>Sweep a <strong>Sine</strong> across the spectrum. On log-x the peak glides at a steady pace — each octave is the same pixel width. On linear-x the same sweep crawls through the bass and then sprints through the treble.</li>
        <li>Switch to a <strong>Saw</strong> at 220 Hz. Linear-x: a couple of peaks bunched at the far left, then nothing. Log-x: a tidy comb of harmonics, neatly arrayed (each is still 220 Hz higher than the last, but that's a shrinking fraction of an octave, so they pack tighter as you move right).</li>
        <li>On a kick-drum file, drag the <strong>bass / mid crossover</strong> from 250 down to 80 Hz. The bass meter now reacts only to the kick's body; nudge it back up to 500 Hz and you'll see the meter start picking up the snare's fundamental too.</li>
        <li>Pick <strong>Noise</strong> and look at the comparison strip. The linear bands all read about the same (white noise has flat power per Hz). The log bands climb toward the right, because each higher band covers a wider slice of Hz.</li>
        <li>Drop the band count from 64 to 8 and back. Eight bands is the resolution of a classic graphic EQ — enough to answer "where's the energy?" at a glance, without so much frame-to-frame jitter that your eye gives up.</li>
      </ol>

      <h3>What's next</h3>
      <p>Bands tell you which regions are loud, but not the <em>shape</em> within them. A spectrum with all its energy piled into one bass band looks the same as one spread evenly across the bass band — both come out as a single number. Lesson 5 introduces spectral centroid, rolloff, flatness, and flux: features that capture <em>where</em> the energy sits and <em>how organized</em> it is, each as one scalar.</p>
    `;

    // ---- DOM refs ----
    const stopBtn = container.querySelector("#stop-btn");
    const fileInput = container.querySelector("#file-input");
    const freqInput = container.querySelector("#freq");
    const freqReadout = container.querySelector("#freq-readout");
    const volInput = container.querySelector("#vol");
    const axisSelect = container.querySelector("#axis");
    const bandsSelect = container.querySelector("#bands");
    const loMidInput = container.querySelector("#lo-mid");
    const loMidReadout = container.querySelector("#lo-mid-readout");
    const midHiInput = container.querySelector("#mid-hi");
    const midHiReadout = container.querySelector("#mid-hi-readout");
    const srcButtons = container.querySelectorAll(".src-btn");

    const specCanvas = container.querySelector("#spec-canvas");
    const regionCanvas = container.querySelector("#region-canvas");
    const compareCanvas = container.querySelector("#compare-canvas");

    const barsInfo = container.querySelector("#bars-info");
    const regionInfo = container.querySelector("#region-info");
    const numBinsEl = container.querySelector("#num-bins");
    const binHzEl = container.querySelector("#bin-hz");
    const bassValEl = container.querySelector("#bass-val");
    const midValEl = container.querySelector("#mid-val");
    const trebleValEl = container.querySelector("#treble-val");

    // ---- Audio graph ----
    const audioCtx = getAudioContext();
    const masterGain = audioCtx.createGain();
    masterGain.gain.value = parseFloat(volInput.value);
    const analyser = createAnalyser(masterGain, {
      fftSize: FFT_SIZE,
      smoothingTimeConstant: 0.6,
    });
    analyser.connect(audioCtx.destination);

    const sampleRate = audioCtx.sampleRate;
    const nyquist = sampleRate / 2;
    numBinsEl.textContent = String(analyser.frequencyBinCount);
    binHzEl.textContent = `${(sampleRate / FFT_SIZE).toFixed(2)} Hz`;

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

    // ---- Local state ----
    let axis = axisSelect.value; // "linear" | "log"
    let nBands = parseInt(bandsSelect.value);
    let loMid = parseFloat(loMidInput.value);
    let midHi = parseFloat(midHiInput.value);

    axisSelect.addEventListener("change", () => {
      axis = axisSelect.value;
    });
    bandsSelect.addEventListener("change", () => {
      nBands = parseInt(bandsSelect.value);
    });
    loMidInput.addEventListener("input", () => {
      loMid = parseFloat(loMidInput.value);
      loMidReadout.textContent = `${loMid} Hz`;
    });
    midHiInput.addEventListener("input", () => {
      midHi = parseFloat(midHiInput.value);
      midHiReadout.textContent = `${midHi} Hz`;
    });

    // ---- Buffers ----
    const dbBuf = new Float32Array(analyser.frequencyBinCount);
    const linBuf = new Float32Array(analyser.frequencyBinCount);

    // ---- Drawing ----
    function drawSpec() {
      const { ctx, w, h } = fitCanvas(specCanvas);
      clear(ctx, w, h, "#0c0c0c");

      const padTop = 10;
      const padBot = 22;
      const padL = 36;
      const padR = 8;
      const plotW = w - padL - padR;
      const plotH = h - padTop - padBot;

      // Convert dB → linear unit once.
      readFrequency(analyser, dbBuf);
      for (let i = 0; i < dbBuf.length; i++) linBuf[i] = dbToUnit(dbBuf[i]);

      // Build the bands the user asked for.
      let bands;
      if (axis === "log") {
        bands = logBands(linBuf, sampleRate, {
          bands: nBands,
          loHz: 30,
          hiHz: nyquist,
          mode: "mean",
        });
      } else {
        bands = new Array(nBands);
        for (let i = 0; i < nBands; i++) {
          const a = (i / nBands) * nyquist;
          const b = ((i + 1) / nBands) * nyquist;
          bands[i] = {
            loHz: a,
            hiHz: b,
            value: bandEnergy(linBuf, a, b, sampleRate, { mode: "mean" }),
          };
        }
      }

      // Find a max so the bars use the canvas height.
      let max = 0.001;
      for (const b of bands) if (b.value > max) max = b.value;

      // Grid lines
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const py = padTop + (1 - t) * plotH;
        ctx.beginPath();
        ctx.moveTo(padL, py);
        ctx.lineTo(padL + plotW, py);
        ctx.stroke();
      }

      // Bars colored by region.
      const colorFor = (b) => {
        const center = (b.loHz + b.hiHz) / 2;
        if (center < loMid) return "#ededed";
        if (center < midHi) return "#a0a0a0";
        return "#ff5b22";
      };
      drawBars(ctx, bands, {
        x: padL,
        y: padTop,
        w: plotW,
        h: plotH,
        min: 0,
        max,
        color: (_v, i) => colorFor(bands[i]),
        gap: 2,
      });

      // X axis labels — different ticks for linear vs log
      const ticks =
        axis === "log"
          ? [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].filter(
              (f) => f >= 30 && f <= nyquist
            )
          : (() => {
              const step = nyquist <= 12000 ? 2000 : 4000;
              const out = [];
              for (let f = step; f < nyquist; f += step) out.push(f);
              return out;
            })();

      const xFor = (f) => {
        if (axis === "log") {
          const lo = Math.log(30);
          const hi = Math.log(nyquist);
          return padL + ((Math.log(f) - lo) / (hi - lo)) * plotW;
        }
        return padL + (f / nyquist) * plotW;
      };

      for (const f of ticks) {
        const px = xFor(f);
        ctx.strokeStyle = "rgba(255,255,255,0.04)";
        ctx.beginPath();
        ctx.moveTo(px, padTop);
        ctx.lineTo(px, padTop + plotH);
        ctx.stroke();
        const label = f >= 1000 ? `${f / 1000}k` : `${f}`;
        drawText(ctx, label, px, padTop + plotH + 4, {
          color: "#555555",
          align: "center",
        });
      }

      // Crossover guide lines (only meaningful on the spec, not the bands)
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.setLineDash([3, 4]);
      for (const f of [loMid, midHi]) {
        const px = xFor(f);
        ctx.beginPath();
        ctx.moveTo(px, padTop);
        ctx.lineTo(px, padTop + plotH);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      barsInfo.textContent = `${nBands} bands · ${axis}-x`;
    }

    // History for the bass/mid/treble meters
    const HIST = 240;
    const bassHist = new Float32Array(HIST);
    const midHist = new Float32Array(HIST);
    const trebHist = new Float32Array(HIST);
    function pushH(arr, v) {
      arr.copyWithin(0, 1);
      arr[HIST - 1] = v;
    }

    function drawRegions() {
      const { ctx, w, h } = fitCanvas(regionCanvas);
      clear(ctx, w, h, "#0c0c0c");

      const bass = bandEnergy(linBuf, 20, loMid, sampleRate, { mode: "sum" });
      const mid = bandEnergy(linBuf, loMid, midHi, sampleRate, { mode: "sum" });
      const treble = bandEnergy(linBuf, midHi, nyquist, sampleRate, {
        mode: "sum",
      });

      pushH(bassHist, bass);
      pushH(midHist, mid);
      pushH(trebHist, treble);

      let max = 0.5;
      for (const a of [bassHist, midHist, trebHist]) {
        for (let i = 0; i < a.length; i++) if (a[i] > max) max = a[i];
      }

      const padY = 6;
      const plotH = h - padY * 2;
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      for (const t of [0, 0.5, 1]) {
        const py = padY + (1 - t) * plotH;
        ctx.beginPath();
        ctx.moveTo(0, py);
        ctx.lineTo(w, py);
        ctx.stroke();
      }

      drawLine(ctx, bassHist, {
        x: 0, y: padY, w, h: plotH,
        min: 0, max, stroke: "#ededed", lineWidth: 1.75,
      });
      drawLine(ctx, midHist, {
        x: 0, y: padY, w, h: plotH,
        min: 0, max, stroke: "#a0a0a0", lineWidth: 1.75,
      });
      drawLine(ctx, trebHist, {
        x: 0, y: padY, w, h: plotH,
        min: 0, max, stroke: "#ff5b22", lineWidth: 1.75,
      });

      drawText(ctx, "bass", 6, padY + 2, { color: "#ededed" });
      drawText(ctx, "mid", 42, padY + 2, { color: "#a0a0a0" });
      drawText(ctx, "treble", 70, padY + 2, { color: "#ff5b22" });
      drawText(ctx, "5 s ←", w - 6, padY + 2, {
        color: "#555555", align: "right",
      });

      bassValEl.textContent = bass.toFixed(3);
      midValEl.textContent = mid.toFixed(3);
      trebleValEl.textContent = treble.toFixed(3);
      regionInfo.textContent = `b ${bass.toFixed(2)} · m ${mid.toFixed(2)} · t ${treble.toFixed(2)}`;
    }

    function drawCompare() {
      const { ctx, w, h } = fitCanvas(compareCanvas);
      clear(ctx, w, h, "#0c0c0c");

      const N = 16;
      const lin = new Array(N);
      for (let i = 0; i < N; i++) {
        const a = (i / N) * nyquist;
        const b = ((i + 1) / N) * nyquist;
        lin[i] = {
          loHz: a, hiHz: b,
          value: bandEnergy(linBuf, a, b, sampleRate, { mode: "mean" }),
        };
      }
      const log = logBands(linBuf, sampleRate, {
        bands: N, loHz: 30, hiHz: nyquist, mode: "mean",
      });

      let max = 0.001;
      for (const b of lin) if (b.value > max) max = b.value;
      for (const b of log) if (b.value > max) max = b.value;

      const padY = 8;
      const plotH = (h - padY * 3) / 2;

      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      for (const yOff of [padY, padY * 2 + plotH]) {
        ctx.beginPath();
        ctx.moveTo(0, yOff + plotH);
        ctx.lineTo(w, yOff + plotH);
        ctx.stroke();
      }

      drawBars(ctx, lin, {
        x: 0, y: padY, w, h: plotH,
        min: 0, max,
        color: "rgba(237, 237, 237, 0.55)",
        gap: 2,
      });
      drawText(ctx, "linear bands (16)", 8, padY + 2, { color: "#ededed" });

      drawBars(ctx, log, {
        x: 0, y: padY * 2 + plotH, w, h: plotH,
        min: 0, max,
        color: "#ff5b22",
        gap: 2,
      });
      drawText(ctx, "log bands (16)", 8, padY * 2 + plotH + 2, {
        color: "#ff5b22",
      });
    }

    // ---- Render loop ----
    const cancelLoop = startLoop(() => {
      drawSpec();
      drawRegions();
      drawCompare();
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
