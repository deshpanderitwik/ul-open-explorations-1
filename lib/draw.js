// Shared canvas helpers. The point is to see exactly what's being drawn —
// no charting libraries.

/**
 * Resize a canvas to its CSS box size, accounting for devicePixelRatio so
 * lines stay crisp on retina displays. Returns the logical (CSS) size and
 * a 2D context already scaled, so callers can draw in CSS pixels.
 *
 * Safe to call every frame: width/height are only assigned when the size
 * actually changes (assigning either resets the bitmap).
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {{ ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number }}
 */
export function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  const targetW = Math.round(w * dpr);
  const targetH = Math.round(h * dpr);
  if (canvas.width !== targetW) canvas.width = targetW;
  if (canvas.height !== targetH) canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h, dpr };
}

/**
 * Clear the whole canvas to a solid color (or transparent).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w
 * @param {number} h
 * @param {string} [color]
 */
export function clear(ctx, w, h, color) {
  if (color) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.clearRect(0, 0, w, h);
  }
}

/**
 * Draw a polyline of values across a rect — e.g. a waveform frame, an
 * envelope follower over time, a frequency band history. Values are spread
 * evenly across the rect's width and mapped from [min, max] to the rect's
 * height (top = max, bottom = min).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {ArrayLike<number>} values
 * @param {{
 *   x?: number, y?: number, w?: number, h?: number,
 *   min?: number, max?: number,
 *   stroke?: string, lineWidth?: number,
 *   fill?: string,
 * }} [opts]
 */
export function drawLine(ctx, values, opts = {}) {
  const {
    x = 0,
    y = 0,
    w = ctx.canvas.width,
    h = ctx.canvas.height,
    min = -1,
    max = 1,
    stroke = "#ededed",
    lineWidth = 1,
    fill,
  } = opts;
  const n = values.length;
  if (n < 2) return;
  const range = max - min || 1;

  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const px = x + (i / (n - 1)) * w;
    const py = y + h - ((values[i] - min) / range) * h;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  if (fill) {
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    // Re-stroke the top line, since fill-and-close mangles the path edges.
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const px = x + (i / (n - 1)) * w;
      const py = y + h - ((values[i] - min) / range) * h;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw a vertical bar chart — useful for spectrum visualizations.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {ArrayLike<number>} values
 * @param {{
 *   x?: number, y?: number, w?: number, h?: number,
 *   min?: number, max?: number,
 *   color?: string | ((v: number, i: number) => string),
 *   gap?: number,
 * }} [opts]
 */
export function drawBars(ctx, values, opts = {}) {
  const {
    x = 0,
    y = 0,
    w = ctx.canvas.width,
    h = ctx.canvas.height,
    min = 0,
    max = 1,
    color = "#ededed",
    gap = 1,
  } = opts;
  const n = values.length;
  if (n === 0) return;
  const range = max - min || 1;
  const totalGap = gap * Math.max(0, n - 1);
  const barW = Math.max(1, (w - totalGap) / n);

  ctx.save();
  for (let i = 0; i < n; i++) {
    let v = values[i];
    if (typeof v === "object" && v !== null && "value" in v) v = v.value;
    const t = Math.max(0, Math.min(1, (v - min) / range));
    const bh = t * h;
    const px = x + i * (barW + gap);
    const py = y + h - bh;
    ctx.fillStyle = typeof color === "function" ? color(v, i) : color;
    ctx.fillRect(px, py, barW, bh);
  }
  ctx.restore();
}

/**
 * Draw a horizontal level meter (bar from 0..1 with optional peak hold).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} value      0..1
 * @param {{
 *   x?: number, y?: number, w?: number, h?: number,
 *   peak?: number,
 *   color?: string,
 *   bg?: string,
 *   label?: string,
 * }} [opts]
 */
export function drawMeter(ctx, value, opts = {}) {
  const {
    x = 0,
    y = 0,
    w = ctx.canvas.width,
    h = ctx.canvas.height,
    peak,
    color = "#ededed",
    bg = "rgba(255,255,255,0.04)",
    label,
  } = opts;
  const v = Math.max(0, Math.min(1, value));

  ctx.save();
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, v * w, h);

  if (typeof peak === "number") {
    const px = x + Math.max(0, Math.min(1, peak)) * w;
    ctx.strokeStyle = "#ff5b22";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, y);
    ctx.lineTo(px, y + h);
    ctx.stroke();
  }

  if (label) {
    ctx.fillStyle = "#8a8a8a";
    ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(label, x + 6, y + h / 2);
  }
  ctx.restore();
}

/**
 * Draw labelled axes (linear, log, or dB) inside a rect. Returns the inner
 * plot rectangle so callers can draw data inside it.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{
 *   x: number, y: number, w: number, h: number,
 *   xScale?: "linear" | "log",
 *   yScale?: "linear" | "log" | "db",
 *   xMin?: number, xMax?: number,
 *   yMin?: number, yMax?: number,
 *   xLabel?: string, yLabel?: string,
 *   xTicks?: number[],
 *   yTicks?: number[],
 * }} opts
 * @returns {{ x: number, y: number, w: number, h: number }}
 */
export function drawAxes(ctx, opts) {
  // TODO: implement.
}

/**
 * A perceptual color ramp 0..1 → CSS color. Useful for spectrograms and
 * heat-mapped visualizations. Defaults to a warm magma-ish ramp.
 *
 * @param {number} t   0..1
 * @returns {string}
 */
export function ramp(t) {
  const x = Math.max(0, Math.min(1, t));
  // Monochrome → warm orange tip. Reads well on near-black charts.
  // Stops: charcoal → grey → near-white → ember → orange.
  const stops = [
    [0.0,  18,  18,  18],
    [0.4,  120, 120, 120],
    [0.7,  220, 220, 220],
    [0.9,  255, 140,  80],
    [1.0,  255,  91,  34],
  ];
  let i = 0;
  while (i < stops.length - 2 && x > stops[i + 1][0]) i++;
  const [t0, r0, g0, b0] = stops[i];
  const [t1, r1, g1, b1] = stops[i + 1];
  const f = (x - t0) / (t1 - t0);
  const r = Math.round(r0 + (r1 - r0) * f);
  const g = Math.round(g0 + (g1 - g0) * f);
  const b = Math.round(b0 + (b1 - b0) * f);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Draw text in the canvas's monospace style with sensible defaults.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {{ color?: string, size?: number, align?: CanvasTextAlign, baseline?: CanvasTextBaseline }} [opts]
 */
export function drawText(ctx, text, x, y, opts = {}) {
  const {
    color = "#8a8a8a",
    size = 10,
    align = "left",
    baseline = "top",
  } = opts;
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `${size}px "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(text, x, y);
  ctx.restore();
}
