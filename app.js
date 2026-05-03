// Router, lesson registry, and shared shell behavior.
// No build step: this file is loaded as an ES module from index.html.

import lesson01 from "./lessons/01-raw-signal.js";
import lesson02 from "./lessons/02-time-domain.js";
import lesson03 from "./lessons/03-fft.js";
import lesson04 from "./lessons/04-spectrum.js";
import lesson05 from "./lessons/05-spectral-shape.js";
import lesson06 from "./lessons/06-smoothing.js";
import lesson07 from "./lessons/07-normalization.js";
import lesson08 from "./lessons/08-onsets-beats.js";
import lesson09 from "./lessons/09-musical-features.js";
import lesson10 from "./lessons/10-correlation-mapping.js";

const LESSONS = [
  lesson01,
  lesson02,
  lesson03,
  lesson04,
  lesson05,
  lesson06,
  lesson07,
  lesson08,
  lesson09,
  lesson10,
];

const STORAGE_KEY = "audio-features:completed";

// ---------- Progress persistence ----------

function loadCompleted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveCompleted(set) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
}

let completed = loadCompleted();

// ---------- Sidebar rendering ----------

const navEl = document.getElementById("lesson-nav");
const rootEl = document.getElementById("lesson-root");
const resetBtn = document.getElementById("reset-progress");

function renderNav(activeId) {
  navEl.innerHTML = "";
  for (const lesson of LESSONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "nav-item";
    if (lesson.id === activeId) btn.classList.add("is-active");
    if (completed.has(lesson.id)) btn.classList.add("is-complete");

    const num = document.createElement("span");
    num.className = "nav-num";
    num.textContent = String(lesson.id).padStart(2, "0");

    const title = document.createElement("span");
    title.className = "nav-title";
    title.textContent = lesson.title;

    const check = document.createElement("span");
    check.className = "nav-check";
    check.textContent = "✓";

    btn.append(num, title, check);
    btn.addEventListener("click", () => {
      location.hash = `#/lesson/${lesson.id}`;
    });
    navEl.appendChild(btn);
  }
}

resetBtn.addEventListener("click", () => {
  if (!confirm("Clear all lesson progress?")) return;
  completed = new Set();
  saveCompleted(completed);
  renderNav(currentLessonId);
});

// ---------- Router ----------

let currentCleanup = null;
let currentLessonId = null;

function parseHash() {
  const m = location.hash.match(/^#\/lesson\/(\d+)$/);
  if (m) return { kind: "lesson", id: Number(m[1]) };
  return { kind: "welcome" };
}

function navigate() {
  // Tear down previous lesson, if any.
  if (typeof currentCleanup === "function") {
    try {
      currentCleanup();
    } catch (err) {
      console.error("Lesson cleanup failed:", err);
    }
  }
  currentCleanup = null;

  const route = parseHash();

  if (route.kind === "lesson") {
    const lesson = LESSONS.find((l) => l.id === route.id);
    if (!lesson) {
      location.hash = "#/";
      return;
    }
    currentLessonId = lesson.id;
    renderLesson(lesson);
  } else {
    currentLessonId = null;
    renderWelcome();
  }

  renderNav(currentLessonId);
  window.scrollTo({ top: 0 });
}

function renderLesson(lesson) {
  rootEl.innerHTML = "";

  // Header
  const header = document.createElement("header");
  header.className = "lesson-header";

  const eyebrow = document.createElement("p");
  eyebrow.className = "lesson-eyebrow";
  eyebrow.textContent = `Lesson ${String(lesson.id).padStart(2, "0")}`;

  const title = document.createElement("h1");
  title.className = "lesson-title";
  title.textContent = lesson.title;

  const summary = document.createElement("p");
  summary.className = "lesson-summary";
  summary.textContent = lesson.summary;

  header.append(eyebrow, title, summary);
  rootEl.appendChild(header);

  // Body — lesson populates this.
  const body = document.createElement("section");
  body.className = "lesson-body";
  rootEl.appendChild(body);

  try {
    const cleanup = lesson.render(body);
    if (typeof cleanup === "function") currentCleanup = cleanup;
  } catch (err) {
    console.error(`Lesson ${lesson.id} render failed:`, err);
    body.innerHTML = `<div class="placeholder">Lesson failed to render. See console.</div>`;
  }

  // Footer
  const footer = document.createElement("footer");
  footer.className = "lesson-footer";

  const prev = document.createElement("button");
  prev.type = "button";
  prev.className = "button";
  prev.textContent = "← Previous";
  const prevLesson = LESSONS.find((l) => l.id === lesson.id - 1);
  prev.disabled = !prevLesson;
  prev.addEventListener("click", () => {
    if (prevLesson) location.hash = `#/lesson/${prevLesson.id}`;
  });

  const completeBtn = document.createElement("button");
  completeBtn.type = "button";
  const isDone = completed.has(lesson.id);
  completeBtn.className = isDone ? "button is-complete" : "button is-primary";
  completeBtn.textContent = isDone ? "✓ Completed" : "Mark complete";
  completeBtn.addEventListener("click", () => {
    if (completed.has(lesson.id)) {
      completed.delete(lesson.id);
    } else {
      completed.add(lesson.id);
    }
    saveCompleted(completed);
    const nowDone = completed.has(lesson.id);
    completeBtn.className = nowDone ? "button is-complete" : "button is-primary";
    completeBtn.textContent = nowDone ? "✓ Completed" : "Mark complete";
    renderNav(currentLessonId);
  });

  const spacer = document.createElement("span");
  spacer.className = "spacer";

  const next = document.createElement("button");
  next.type = "button";
  next.className = "button";
  next.textContent = "Next →";
  const nextLesson = LESSONS.find((l) => l.id === lesson.id + 1);
  next.disabled = !nextLesson;
  next.addEventListener("click", () => {
    if (nextLesson) location.hash = `#/lesson/${nextLesson.id}`;
  });

  footer.append(prev, completeBtn, spacer, next);
  rootEl.appendChild(footer);
}

function renderWelcome() {
  rootEl.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "welcome";

  const eyebrow = document.createElement("p");
  eyebrow.className = "lesson-eyebrow";
  eyebrow.textContent = "Curriculum";

  const title = document.createElement("h1");
  title.className = "lesson-title";
  title.textContent = "Audio features for music visualization";

  const summary = document.createElement("p");
  summary.className = "lesson-summary";
  summary.textContent =
    "An interactive walk through the audio analysis primitives that drive a visualizer — from the raw waveform up through onset detection and the mapping toolkit. Each lesson is hands-on: load a sound, play with parameters, watch the numbers move.";

  wrap.append(eyebrow, title, summary);

  const h2 = document.createElement("h2");
  h2.textContent = "How to use this";
  wrap.appendChild(h2);

  const ul = document.createElement("ul");
  for (const text of [
    "Pick a lesson from the sidebar. Lessons are designed to be read in order, but each one stands on its own.",
    "Lessons share a small audio + drawing toolkit. The point is to see the primitives — no charting libraries, no audio frameworks.",
    "Click \"Mark complete\" at the bottom of a lesson to track progress in localStorage.",
  ]) {
    const li = document.createElement("li");
    li.textContent = text;
    ul.appendChild(li);
  }
  wrap.appendChild(ul);

  const h2b = document.createElement("h2");
  h2b.textContent = "Start here";
  wrap.appendChild(h2b);

  const startBtn = document.createElement("button");
  startBtn.type = "button";
  startBtn.className = "button is-primary";
  startBtn.textContent = "Begin lesson 1 →";
  startBtn.addEventListener("click", () => {
    location.hash = "#/lesson/1";
  });
  wrap.appendChild(startBtn);

  rootEl.appendChild(wrap);
}

// ---------- Boot ----------

window.addEventListener("hashchange", navigate);
navigate();
