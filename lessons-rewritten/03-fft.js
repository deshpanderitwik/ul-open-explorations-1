import {
  getAudioContext,
  createAnalyser,
  readTimeDomain,
  readFrequency,
  startLoop,
  applyWindow,
} from "../lib/audio.js";
import { createSourceController } from "../lib/sources.js";
import { fitCanvas, clear, drawLine, drawText } from "../lib/draw.js";

const lesson = {
  id: 3,
  title: "From time to frequency: the FFT",
  summary: "How a window of samples becomes a spectrum.",
  render(container) {
    container.innerHTML = `
      <p>Time-domain features tell you <em>how loud</em> a signal is, but not <em>what's in it</em>. A 440 Hz sine and an 880 Hz sine at the same volume look identical to RMS, yet your ears would never confuse them. The Fast Fourier Transform is the tool every analyzer past the simplest meter reaches for: it answers the question "how much of each frequency lives in this window of samples?"</p>

      <p>The FFT takes <code>N</code> time-domain samples in and gives <code>N/2</code> complex frequency bins back. Each bin's magnitude is the energy near its center frequency. Bin <code>k</code> sits at <code>k · SR / N</code>, so bins are evenly spaced from 0 up to Nyquist (half the sample rate). With <code>fftSize = 2048</code> and <code>SR = 48000</code>, you get 1024 bins covering 0 to 24 kHz, spaced about 23 Hz apart.</p>

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
        <label>fftSize
          <select id="fft-size">
            <option>256</option>
            <option>512</option>
            <option>1024</option>
            <option selected>2048</option>
            <option>4096</option>
            <option>8192</option>
          </select>
        </label>
        <label>Smoothing τ
          <input type="range" id="smoothtc" min="0" max="0.99" step="0.01" value="0.5">
          <span class="readout" id="smoothtc-readout">0.50</span>
        </label>
      </div>

      <div class="feature">
        <div class="feature-head">
          <span class="feature-name">Time domain</span>
          <span class="feature-formula">N most recent samples</span>
          <span class="feature-value" id="time-info">— samples · — ms</span>
        </div>
        <canvas id="time-canvas" style="height: 180px"></canvas>
      </div>

      <div class="feature">
        <div class="feature-head">
          <span class="feature-name">Magnitude spectrum</span>
          <span class="feature-formula">| FFT( windowed ) |  [dBFS]</span>
          <span class="feature-value" id="peak-info">peak: —</span>
        </div>
        <canvas id="spec-canvas" style="height: 260px"></canvas>
      </div>

      <h3>What you're seeing</h3>
      <p><em>Top</em>: the latest <code>N</code> samples. The faint line is the raw waveform; the bright line is the same data multiplied by a <em>Blackman window</em> that tapers smoothly to zero at the edges. The analyser applies this window internally before running the FFT. Without it, the FFT pretends the buffer is one period of a repeating signal, and any jump at the seam leaks energy across many bins.</p>
      <p><em>Bottom</em>: the magnitude of each FFT bin in dBFS. The horizontal axis runs linearly from 0 up to Nyquist. A pure sine puts up a single peak; a square wave puts a peak at the fundamental plus odd harmonics at <code>3f</code>, <code>5f</code>, <code>7f</code>; a sawtooth fills in every integer multiple. The yellow dot marks the loudest bin.</p>

      <h3>Numbers</h3>
      <div class="readouts">
        <div>Sample rate: <code id="sr">—</code></div>
        <div>fftSize (N): <code id="N">—</code></div>
        <div>Bins: <code id="bins">—</code></div>
        <div>Bin width: <code id="bin-hz">—</code></div>
        <div>Window duration: <code id="win-ms">—</code></div>
        <div>Nyquist: <code id="nyq">—</code></div>
      </div>

      <h3>Try this</h3>
      <ol>
        <li>Play a <strong>Sine</strong> at 440 Hz. One peak at 440. Drag the frequency slider and watch the peak slide with it.</li>
        <li>Switch to <strong>Square</strong>. The 440 fundamental picks up odd-harmonic friends at 1320, 2200, 3080 Hz... <strong>Saw</strong>, by contrast, lights up every integer multiple.</li>
        <li>Drop <strong>fftSize</strong> from 2048 to 256. Peaks smear out — bin width jumps from ~23 Hz to ~188 Hz. You lose 8× in frequency resolution, but the FFT now covers ~5 ms instead of ~43 ms, so transients show up sooner. This is the fundamental FFT trade-off.</li>
        <li>Push <strong>Smoothing τ</strong> up to 0.95. The spectrum turns glassy and stable but lags the audio noticeably. At τ=0 you see every frame's noise raw.</li>
        <li>Switch to <strong>Noise</strong>. You get a roughly flat carpet of energy across every bin — that's the defining feature of white noise. Compare it to the clean spikes of a tone.</li>
      </ol>

      <h3>What's next</h3>
      <p>A linear x-axis is handy for understanding how the FFT works — every bin is the same width — but it's a poor match for hearing, which is logarithmic in pitch. Lesson 4 swaps in a log axis, groups bins into bass/mid/treble bands, and turns the spectrum into the kind of control signal a visualizer can actually drive things with.</p>
    `;

    // ---- DOM refs ----
    const stopBtn = container.querySelector("#stop-btn");
    const fileInput = container.querySelector("#file-input");
    const freqInput = container.querySelector("#freq");
    const freqReadout = container.querySelector("#freq-readout");
    const volInput = container.querySelector("#vol");
    const fftSelect = container.querySelector("#fft-size");
    const smoothInput = container.querySelector("#smoothtc");
    const smoothReadout = container.querySelector("#smoothtc-readout");
    const srcButtons = container.querySelectorAll(".src-btn");

    const timeCanvas = container.querySelector("#time-canvas");
    const specCanvas = container.querySelector("#spec-canvas");
    const timeInfo = container.querySelector("#time-info");
    const peakInfo = container.querySelector("#peak-info");

    const srEl = container.querySelector("#sr");
    const nEl = container.querySelector("#N");
    const binsEl = container.querySelector("#bins");
    const binHzEl = container.querySelector("#bin-hz");
    const winMsEl = container.querySelector("#win-ms");
    const nyqEl = container.querySelector("#nyq");

    // ---- Audio graph ----
    const audioCtx = getAudioContext();
    const masterGain = audioCtx.createGain();
    masterGain.gain.value = parseFloat(volInput.value);
    const analyser = createAnalyser(masterGain, {
      fftSize: parseInt(fftSelect.value),
      smoothingTimeConstant: parseFloat(smoothInput.value),
    });
    analyser.connect(audioCtx.destination);

    let timeBuf = new Float32Array(analyser.fftSize);
    let winBuf = new Float32Array(analyser.fftSize);
    let freqBuf = new Float32Array(analyser.frequencyBinCount);

    function reallocBuffers() {
      timeBuf = new Float32Array(analyser.fftSize);
      winBuf = new Float32Array(analyser.fftSize);
      freqBuf = new Float32Array(analyser.frequencyBinCount);
    }

    function refreshReadouts() {
      const N = analyser.fftSize;
      const sr = audioCtx.sampleRate;
      srEl.textContent = `${sr} Hz`;
      nEl.textContent = String(N);
      binsEl.textContent = String(analyser.frequencyBinCount);
      binHzEl.textContent = `${(sr / N).toFixed(2)} Hz`;
      winMsEl.textContent = `${((N / sr) * 1000).toFixed(2)} ms`;
      nyqEl.textContent = `${(sr / 2).toFixed(0)} Hz`;
    }
    refreshReadouts();

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

    fftSelect.addEventListener("change", () => {
      analyser.fftSize = parseInt(fftSelect.value);
      reallocBuffers();
      refreshReadouts();
    });

    smoothInput.addEventListener("input", () => {
      const v = parseFloat(smoothInput.value);
      analyser.smoothingTimeConstant = v;
      smoothReadout.textContent = v.toFixed(2);
    });

    // ---- Drawing ----
    function drawTime() {
      const { ctx, w, h } = fitCanvas(timeCanvas);
      clear(ctx, w, h, "#0c0c0c");

      const padY = 8;
      const plotH = h - padY * 2;
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      for (const yv of [-1, -0.5, 0, 0.5, 1]) {
        const py = padY + (1 - (yv + 1) / 2) * plotH;
        ctx.beginPath();
        ctx.moveTo(0, py);
        ctx.lineTo(w, py);
        ctx.stroke();
      }

      // Raw waveform — faded
      drawLine(ctx, timeBuf, {
        x: 0, y: padY, w, h: plotH,
        min: -1, max: 1,
        stroke: "rgba(230, 232, 236, 0.20)",
        lineWidth: 1,
      });

      // Same data, Blackman-windowed
      winBuf.set(timeBuf);
      applyWindow(winBuf, "blackman");
      drawLine(ctx, winBuf, {
        x: 0, y: padY, w, h: plotH,
        min: -1, max: 1,
        stroke: "#ededed",
        lineWidth: 1.5,
      });

      drawText(ctx, "raw", 8, padY + 2, { color: "#8a8a8a" });
      drawText(ctx, "windowed", 8, padY + 16, { color: "#ededed" });
    }

    function drawSpectrum() {
      const { ctx, w, h } = fitCanvas(specCanvas);
      clear(ctx, w, h, "#0c0c0c");

      const padTop = 10;
      const padBot = 22;
      const padL = 44;
      const padR = 8;
      const plotW = w - padL - padR;
      const plotH = h - padTop - padBot;
      const sr = audioCtx.sampleRate;
      const nyq = sr / 2;
      const N = analyser.fftSize;

      // dB grid + labels
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      for (const db of [0, -25, -50, -75, -100]) {
        const py = padTop + (1 - (db + 100) / 100) * plotH;
        ctx.beginPath();
        ctx.moveTo(padL, py);
        ctx.lineTo(padL + plotW, py);
        ctx.stroke();
        drawText(ctx, `${db} dB`, padL - 6, py, {
          color: "#555555",
          align: "right",
          baseline: "middle",
        });
      }

      // Hz tick lines
      const ticks = [];
      const niceStep = nyq <= 12000 ? 2000 : nyq <= 24000 ? 4000 : 8000;
      for (let f = niceStep; f < nyq; f += niceStep) ticks.push(f);
      for (const f of ticks) {
        const px = padL + (f / nyq) * plotW;
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
      drawText(ctx, "0", padL, padTop + plotH + 4, {
        color: "#555555",
        align: "center",
      });
      drawText(ctx, `${(nyq / 1000).toFixed(0)}k Hz`, padL + plotW, padTop + plotH + 4, {
        color: "#555555",
        align: "right",
      });

      // Read latest spectrum and plot
      readFrequency(analyser, freqBuf);
      drawLine(ctx, freqBuf, {
        x: padL,
        y: padTop,
        w: plotW,
        h: plotH,
        min: -100,
        max: 0,
        stroke: "#ededed",
        lineWidth: 1.5,
        fill: "rgba(237, 237, 237, 0.15)",
      });

      // Find peak bin
      let peakIdx = 0;
      for (let i = 1; i < freqBuf.length; i++) {
        if (freqBuf[i] > freqBuf[peakIdx]) peakIdx = i;
      }
      const peakHz = (peakIdx * sr) / N;
      const peakDb = freqBuf[peakIdx];
      if (peakDb > -90) {
        const px = padL + (peakHz / nyq) * plotW;
        const py = padTop + (1 - (peakDb + 100) / 100) * plotH;
        ctx.fillStyle = "#ff5b22";
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fill();
        peakInfo.textContent = `peak: ${peakHz.toFixed(0)} Hz · ${peakDb.toFixed(1)} dB · bin ${peakIdx}`;
      } else {
        peakInfo.textContent = "peak: (silent)";
      }
    }

    // ---- Main loop ----
    const cancelLoop = startLoop(() => {
      readTimeDomain(analyser, timeBuf);
      drawTime();
      drawSpectrum();

      const ms = ((analyser.fftSize / audioCtx.sampleRate) * 1000).toFixed(1);
      timeInfo.textContent = `${analyser.fftSize} samples · ${ms} ms`;
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
