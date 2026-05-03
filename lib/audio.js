// Shared audio utilities. Lessons import what they need from here.
// Everything is built on the Web Audio API primitives — no external libs.

let _ctx = null;

/**
 * Lazily create and return a shared AudioContext. Browsers require a user
 * gesture before audio can start; callers should call resume() (or play
 * something) inside a user-gesture handler.
 *
 * @returns {AudioContext}
 */
export function getAudioContext() {
  if (!_ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    _ctx = new Ctor();
  }
  return _ctx;
}

/**
 * Decode an audio file (URL or File/Blob) into an AudioBuffer.
 *
 * @param {string | File | Blob} source
 * @param {AudioContext} [ctx]
 * @returns {Promise<AudioBuffer>}
 */
export async function loadAudioBuffer(source, ctx = getAudioContext()) {
  let arrayBuf;
  if (typeof source === "string") {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Failed to fetch ${source}: ${res.status}`);
    arrayBuf = await res.arrayBuffer();
  } else {
    arrayBuf = await source.arrayBuffer();
  }
  return await ctx.decodeAudioData(arrayBuf);
}

/**
 * Build an AnalyserNode and connect it after the given source. The analyser
 * passes audio through unchanged, so callers can chain analyser.connect(
 * destination) to keep audio audible.
 *
 * @param {AudioNode} source
 * @param {{ fftSize?: number, smoothingTimeConstant?: number }} [opts]
 * @returns {AnalyserNode}
 */
export function createAnalyser(source, opts = {}) {
  const { fftSize = 2048, smoothingTimeConstant = 0.8 } = opts;
  const analyser = source.context.createAnalyser();
  analyser.fftSize = fftSize;
  analyser.smoothingTimeConstant = smoothingTimeConstant;
  source.connect(analyser);
  return analyser;
}

/**
 * Read the latest time-domain samples (Float32, range roughly [-1, 1]) from
 * an analyser into a reusable array.
 *
 * @param {AnalyserNode} analyser
 * @param {Float32Array} [out]
 * @returns {Float32Array}
 */
export function readTimeDomain(analyser, out) {
  if (!out || out.length !== analyser.fftSize) {
    out = new Float32Array(analyser.fftSize);
  }
  analyser.getFloatTimeDomainData(out);
  return out;
}

/**
 * Read the latest frequency magnitudes (Float32, dBFS) from an analyser
 * into a reusable array. The analyser internally applies a Blackman window
 * before the FFT and exponentially smooths bin-by-bin via its
 * smoothingTimeConstant property.
 *
 * @param {AnalyserNode} analyser
 * @param {Float32Array} [out]
 * @returns {Float32Array}
 */
export function readFrequency(analyser, out) {
  if (!out || out.length !== analyser.frequencyBinCount) {
    out = new Float32Array(analyser.frequencyBinCount);
  }
  analyser.getFloatFrequencyData(out);
  return out;
}

/**
 * Compute the RMS (root mean square) energy of a time-domain frame.
 *
 * @param {Float32Array} frame
 * @returns {number}
 */
export function rms(frame) {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

/**
 * Count zero crossings within a time-domain frame. Useful as a crude
 * brightness / noisiness indicator for time-domain lessons.
 *
 * @param {Float32Array} frame
 * @returns {number}
 */
export function zeroCrossings(frame) {
  let count = 0;
  let prevPos = frame[0] >= 0;
  for (let i = 1; i < frame.length; i++) {
    const pos = frame[i] >= 0;
    if (pos !== prevPos) count++;
    prevPos = pos;
  }
  return count;
}

/**
 * Apply a window function in place (Hann by default). Windows taper the
 * frame to zero at the edges, which suppresses the spectral leakage caused
 * by the FFT's implicit assumption that the buffer is one period of a
 * periodic signal.
 *
 * @param {Float32Array} frame
 * @param {"hann" | "hamming" | "blackman"} [type]
 * @returns {Float32Array}
 */
export function applyWindow(frame, type = "hann") {
  const N = frame.length;
  const k = (2 * Math.PI) / (N - 1);
  for (let i = 0; i < N; i++) {
    let w;
    if (type === "hamming") {
      w = 0.54 - 0.46 * Math.cos(k * i);
    } else if (type === "blackman") {
      w = 0.42 - 0.5 * Math.cos(k * i) + 0.08 * Math.cos(2 * k * i);
    } else {
      w = 0.5 * (1 - Math.cos(k * i));
    }
    frame[i] *= w;
  }
  return frame;
}

/**
 * One-pole exponential smoother. Returns the smoothed value:
 *   y_t = alpha * x_t + (1 - alpha) * y_{t-1}
 *
 * @param {number} prev
 * @param {number} next
 * @param {number} alpha   0..1, larger = more responsive
 * @returns {number}
 */
export function smooth(prev, next, alpha) {
  return alpha * next + (1 - alpha) * prev;
}

/**
 * Asymmetric (attack/release) smoother — fast on the way up, slow on the
 * way down (or vice versa). The shape every meter wants.
 *
 * @param {number} prev
 * @param {number} next
 * @param {number} attack    0..1
 * @param {number} release   0..1
 * @returns {number}
 */
export function smoothAR(prev, next, attack, release) {
  const alpha = next > prev ? attack : release;
  return alpha * next + (1 - alpha) * prev;
}

/**
 * Convert a frequency in Hz to its (fractional) FFT bin index given an
 * FFT size and sample rate. Bin k corresponds to k * sampleRate / fftSize.
 *
 * @param {number} hz
 * @param {number} fftSize
 * @param {number} sampleRate
 * @returns {number}
 */
export function hzToBin(hz, fftSize, sampleRate) {
  return (hz * fftSize) / sampleRate;
}

/**
 * Sum (or average) magnitudes across a frequency band [loHz, hiHz].
 *
 * @param {Float32Array} magnitudes  linear or dB; caller's choice
 * @param {number} loHz
 * @param {number} hiHz
 * @param {number} sampleRate
 * @param {{ mode?: "sum" | "mean" }} [opts]
 * @returns {number}
 */
export function bandEnergy(magnitudes, loHz, hiHz, sampleRate, opts = {}) {
  const { mode = "sum" } = opts;
  const N = magnitudes.length;
  const fftSize = N * 2;
  const lo = Math.max(0, Math.floor((loHz * fftSize) / sampleRate));
  const hi = Math.min(N - 1, Math.ceil((hiHz * fftSize) / sampleRate));
  if (hi < lo) return 0;
  let sum = 0;
  for (let k = lo; k <= hi; k++) sum += magnitudes[k];
  if (mode === "mean") return sum / (hi - lo + 1);
  return sum;
}

/**
 * Convenience: split the spectrum into N log-spaced bands between loHz and
 * hiHz. Returns an array of {loHz, hiHz, value}.
 *
 * @param {Float32Array} magnitudes
 * @param {number} sampleRate
 * @param {{ bands?: number, loHz?: number, hiHz?: number }} [opts]
 */
export function logBands(magnitudes, sampleRate, opts = {}) {
  const {
    bands = 16,
    loHz = 30,
    hiHz = sampleRate / 2,
    mode = "mean",
  } = opts;
  const out = new Array(bands);
  const logLo = Math.log(loHz);
  const logHi = Math.log(hiHz);
  for (let i = 0; i < bands; i++) {
    const a = Math.exp(logLo + ((logHi - logLo) * i) / bands);
    const b = Math.exp(logLo + ((logHi - logLo) * (i + 1)) / bands);
    out[i] = {
      loHz: a,
      hiHz: b,
      value: bandEnergy(magnitudes, a, b, sampleRate, { mode }),
    };
  }
  return out;
}

/**
 * Run a callback on each animation frame. Returns a function that cancels
 * the loop — lessons should return this from their cleanup function.
 *
 * @param {(t: number, dt: number) => void} fn
 * @returns {() => void}  cancel
 */
export function startLoop(fn) {
  let raf = 0;
  let last = performance.now();
  const tick = (now) => {
    const dt = (now - last) / 1000;
    last = now;
    fn(now, dt);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

/**
 * Convert dBFS to a linear 0..1 scale, clamped to a floor.
 *
 * @param {number} db
 * @param {number} [floorDb]   default -100
 * @returns {number}
 */
export function dbToUnit(db, floorDb = -100) {
  if (!isFinite(db) || db <= floorDb) return 0;
  if (db >= 0) return 1;
  return (db - floorDb) / -floorDb;
}
