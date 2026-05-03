// Shared source controller. Every lesson lets the user audition the same
// six sources — sine / square / saw / triangle / noise / file — plus a
// frequency knob, a volume knob, and a Stop button. The lesson templates
// the HTML; this module wires it up and returns { stop, dispose }.

import { loadAudioBuffer } from "./audio.js";

/**
 * @param {{
 *   audioCtx: AudioContext,
 *   destination: AudioNode,
 *   buttons: NodeListOf<HTMLButtonElement> | HTMLButtonElement[],
 *   stopButton?: HTMLButtonElement,
 *   fileInput?: HTMLInputElement,
 *   freqInput?: HTMLInputElement,
 *   freqReadout?: HTMLElement,
 *   volInput?: HTMLInputElement,
 *   volTarget?: AudioParam,
 * }} opts
 */
export function createSourceController(opts) {
  const {
    audioCtx,
    destination,
    buttons,
    stopButton,
    fileInput,
    freqInput,
    freqReadout,
    volInput,
    volTarget,
  } = opts;

  let activeSource = null;
  let activeType = null;
  let loadedBuffer = null;

  function updateActiveButtons() {
    buttons.forEach((b) => {
      const isActive = activeSource && b.dataset.type === activeType;
      b.classList.toggle("is-primary", !!isActive);
    });
  }

  function stop() {
    if (activeSource) {
      try { activeSource.stop(); } catch {}
      try { activeSource.disconnect(); } catch {}
      activeSource = null;
      activeType = null;
      updateActiveButtons();
    }
  }

  function start(type) {
    stop();
    if (audioCtx.state === "suspended") audioCtx.resume();
    let src;
    if (type === "noise") {
      const buf = audioCtx.createBuffer(
        1,
        audioCtx.sampleRate * 2,
        audioCtx.sampleRate
      );
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      src = audioCtx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
    } else if (type === "file") {
      if (!loadedBuffer) return;
      src = audioCtx.createBufferSource();
      src.buffer = loadedBuffer;
      src.loop = true;
    } else {
      src = audioCtx.createOscillator();
      src.type = type;
      if (freqInput) src.frequency.value = parseFloat(freqInput.value);
    }
    src.connect(destination);
    src.start();
    activeSource = src;
    activeType = type;
    updateActiveButtons();
  }

  // Wire up listeners and remember them so dispose() can clean up.
  const btnHandlers = [];
  buttons.forEach((b) => {
    const handler = () => start(b.dataset.type);
    b.addEventListener("click", handler);
    btnHandlers.push([b, handler]);
  });

  const onStop = () => stop();
  if (stopButton) stopButton.addEventListener("click", onStop);

  const onFreq = freqInput
    ? () => {
        const v = parseFloat(freqInput.value);
        if (freqReadout) freqReadout.textContent = `${v} Hz`;
        if (activeSource && "frequency" in activeSource) {
          activeSource.frequency.setValueAtTime(v, audioCtx.currentTime);
        }
      }
    : null;
  if (onFreq) freqInput.addEventListener("input", onFreq);

  const onVol =
    volInput && volTarget
      ? () => {
          volTarget.value = parseFloat(volInput.value);
        }
      : null;
  if (onVol) volInput.addEventListener("input", onVol);

  const onFile = fileInput
    ? async (e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        try {
          loadedBuffer = await loadAudioBuffer(f, audioCtx);
          start("file");
        } catch (err) {
          console.error("File decode failed:", err);
          alert("Could not decode that audio file.");
        }
      }
    : null;
  if (onFile) fileInput.addEventListener("change", onFile);

  return {
    start,
    stop,
    get activeType() {
      return activeType;
    },
    dispose() {
      stop();
      btnHandlers.forEach(([b, h]) => b.removeEventListener("click", h));
      if (stopButton) stopButton.removeEventListener("click", onStop);
      if (onFreq) freqInput.removeEventListener("input", onFreq);
      if (onVol) volInput.removeEventListener("input", onVol);
      if (onFile) fileInput.removeEventListener("change", onFile);
    },
  };
}
