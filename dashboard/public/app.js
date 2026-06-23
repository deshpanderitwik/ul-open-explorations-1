"use strict";

/* ============================================================
   DAW Swarm dashboard — vanilla JS, no deps.
   Fetches sibling data.json (cache-busted), renders, auto-refreshes.
   ============================================================ */

const REFRESH_MS = 30000;

/* ---------------- helpers ---------------- */

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
      else if (k === "text") node.textContent = v;
      else node.setAttribute(k, v);
    }
  }
  if (children != null) {
    const list = Array.isArray(children) ? children : [children];
    for (const c of list) {
      if (c == null) continue;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
  }
  return node;
}

function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

// Friendly number formatting.
function fmt(n, digits) {
  if (n == null || Number.isNaN(n)) return "—";
  const d = digits == null ? 0 : digits;
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

function safeDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function absTime(s) {
  const d = safeDate(s);
  return d ? d.toLocaleString() : (s || "");
}

function relTime(s) {
  const d = safeDate(s);
  if (!d) return "unknown";
  let sec = Math.round((Date.now() - d.getTime()) / 1000);
  const future = sec < 0;
  sec = Math.abs(sec);
  const units = [
    ["y", 31536000], ["mo", 2592000], ["d", 86400],
    ["h", 3600], ["m", 60], ["s", 1],
  ];
  for (const [label, span] of units) {
    if (sec >= span || label === "s") {
      const val = Math.floor(sec / span);
      const txt = val + label + " ago";
      return future ? "in " + val + label : (sec < 5 ? "just now" : txt);
    }
  }
  return "just now";
}

function isPass(run) { return run && run.reason === "ok"; }

/* ---------------- renderers ---------------- */

function renderHeader(data) {
  const summit = document.getElementById("summit");
  summit.textContent = data.summit || "—";

  const updated = document.getElementById("updated");
  clear(updated);
  updated.appendChild(el("span", { class: "dot" }));
  updated.appendChild(document.createTextNode("updated " + relTime(data.generatedAt)));
  updated.title = absTime(data.generatedAt);
}

function statCard(label, value, opts) {
  opts = opts || {};
  const valueNode = el("div", { class: "value" + (opts.tone ? " " + opts.tone : "") });
  valueNode.appendChild(document.createTextNode(value));
  if (opts.unit) valueNode.appendChild(el("span", { class: "unit", text: opts.unit }));
  if (opts.suffix) valueNode.appendChild(document.createTextNode(opts.suffix));
  return el("div", { class: "stat" + (opts.headline ? " headline" : "") }, [
    el("div", { class: "label", text: label }),
    valueNode,
  ]);
}

// "0 ✓" green / nonzero red
function countCard(label, n) {
  if (n == null) return statCard(label, "—", { tone: "" });
  const ok = Number(n) === 0;
  return statCard(label, fmt(n), {
    tone: ok ? "good" : "bad",
    suffix: ok ? " ✓" : " ✗",
  });
}

function renderChampion(data) {
  const c = data.champion;
  const head = el("div", { class: "champion-head" }, [
    el("h2", { text: "Champion" }),
  ]);
  if (c && c.id) head.appendChild(el("span", { class: "champ-id", text: c.id }));

  const section = el("section");
  section.appendChild(head);

  if (!c || c.voices_50pct == null) {
    section.appendChild(el("div", { class: "empty inset",
      text: "No passing run yet — the swarm hasn't cleared a rung." }));
    return section;
  }

  const grid = el("div", { class: "stat-grid" }, [
    statCard("Voices / core", fmt(c.voices_50pct), { headline: true }),
    statCard("Fitness", fmt(c.fitness, 1)),
    statCard("p99.9 latency", fmt(c.p99_9_us, 1), { unit: "µs" }),
    countCard("Render allocations", c.alloc),
    countCard("Dropouts", c.dropouts),
  ]);
  section.appendChild(grid);
  return section;
}

function renderLadder(data) {
  const ladder = data.ladder || {};
  const rungs = Array.isArray(ladder.rungs) ? ladder.rungs : [];
  const milestones = Array.isArray(ladder.milestones) ? ladder.milestones : [];
  const stats = data.stats || {};

  const section = el("section");
  section.appendChild(el("div", { class: "section-head" }, [
    el("h2", { text: "Ladder to the summit" }),
    el("span", { class: "sub", text: ladder.summit || data.summit || "" }),
  ]));

  const grid = el("div", { class: "ladder-grid" });

  /* left: progress + rungs */
  const left = el("div", { class: "card", style: "padding:18px" });

  const done = stats.rungs_done != null ? stats.rungs_done
    : rungs.filter((r) => r.status === "done").length;
  const total = stats.rungs_total != null ? stats.rungs_total : rungs.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  left.appendChild(el("div", { class: "progress-wrap" }, [
    el("div", { class: "progress-meta" }, [
      el("span", { html: "<strong>" + done + "</strong> of " + total + " rungs complete" }),
      el("span", { text: pct + "%" }),
    ]),
    el("div", { class: "progress-track" }, [
      el("div", { class: "progress-fill", style: "width:" + pct + "%" }),
    ]),
  ]));

  if (rungs.length === 0) {
    left.appendChild(el("div", { class: "empty", text: "No rungs defined." }));
  } else {
    const list = el("ul", { class: "rungs" });
    for (const r of rungs) {
      const status = r.status || "todo";
      const node = el("div", { class: "rung-node" },
        status === "done" ? "✓" : String(r.n != null ? r.n : ""));
      const title = el("div", { class: "rung-title" }, [r.title || "Untitled"]);
      if (status === "next") {
        title.appendChild(el("span", { class: "rung-badge", text: "in progress" }));
      }
      list.appendChild(el("li", { class: "rung " + status }, [
        el("div", { class: "rung-rail" }, [node, el("div", { class: "rung-line" })]),
        el("div", { class: "rung-body" }, [
          title,
          r.summary ? el("div", { class: "rung-summary", text: r.summary }) : null,
        ]),
      ]));
    }
    left.appendChild(list);
  }
  grid.appendChild(left);

  /* right: milestones (deploy targets), in rung order */
  const right = el("div", { class: "card milestones" });
  right.appendChild(el("h3", { text: "Deploy milestones" }));
  if (milestones.length === 0) {
    right.appendChild(el("div", { class: "empty", text: "No milestones." }));
  } else {
    const ordered = milestones.slice().sort((a, b) => {
      const am = Math.max.apply(null, (a.after && a.after.length ? a.after : [0]));
      const bm = Math.max.apply(null, (b.after && b.after.length ? b.after : [0]));
      return am - bm;
    });
    for (const m of ordered) {
      const after = Array.isArray(m.after) && m.after.length
        ? "after rung " + m.after.join(", ") : null;
      right.appendChild(el("div", { class: "milestone" }, [
        el("div", { class: "exp", text: m.experience || m.tag || "Milestone" }),
        m.tag ? el("div", { class: "tag", text: m.tag }) : null,
        after ? el("div", { class: "after", text: after }) : null,
      ]));
    }
  }
  grid.appendChild(right);

  section.appendChild(grid);
  return section;
}

/* ---- hand-rolled SVG fitness chart ---- */
function renderChart(data) {
  const runs = Array.isArray(data.runs) ? data.runs : [];

  const section = el("section");
  section.appendChild(el("div", { class: "section-head" }, [
    el("h2", { text: "Fitness over builds" }),
    el("span", { class: "sub", text: runs.length + (runs.length === 1 ? " build" : " builds") }),
  ]));

  const card = el("div", { class: "card chart-card" });

  if (runs.length === 0) {
    card.appendChild(el("div", { class: "empty", text: "No builds recorded yet." }));
    section.appendChild(card);
    return section;
  }

  const W = 720, H = 240;
  const padL = 52, padR = 16, padT = 16, padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const passing = runs.filter(isPass);
  const maxFit = Math.max.apply(null, passing.map((r) => r.fitness || 0).concat([1]));
  const yMax = maxFit * 1.1 || 1;

  // x position by array index (build order)
  const n = runs.length;
  const xAt = (i) => n === 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW;
  const yAt = (f) => padT + plotH - (Math.max(0, f) / yMax) * plotH;

  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 " + W + " " + H);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Fitness across builds");

  function mk(name, attrs, title) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (title) {
      const t = document.createElementNS(NS, "title");
      t.textContent = title;
      e.appendChild(t);
    }
    return e;
  }

  // gridlines + y labels (0, mid, max)
  const ticks = [0, yMax / 2, yMax];
  for (const tv of ticks) {
    const y = yAt(tv);
    svg.appendChild(mk("line", {
      x1: padL, y1: y, x2: W - padR, y2: y,
      stroke: "#262e3b", "stroke-width": 1,
    }));
    svg.appendChild(mk("text", {
      x: padL - 8, y: y + 4, "text-anchor": "end",
      fill: "#5e6a7a", "font-size": 11,
    })).textContent = fmt(tv, tv >= 100 ? 0 : 1);
  }
  // baseline axis
  svg.appendChild(mk("line", {
    x1: padL, y1: padT + plotH, x2: W - padR, y2: padT + plotH,
    stroke: "#3a4453", "stroke-width": 1,
  }));

  // passing line + area
  const passPts = [];
  runs.forEach((r, i) => { if (isPass(r)) passPts.push([xAt(i), yAt(r.fitness || 0), r, i]); });

  if (passPts.length >= 2) {
    const line = passPts.map((p) => p[0] + "," + p[1]).join(" ");
    const area = "M" + passPts[0][0] + "," + (padT + plotH) +
      " L" + passPts.map((p) => p[0] + "," + p[1]).join(" L") +
      " L" + passPts[passPts.length - 1][0] + "," + (padT + plotH) + " Z";
    svg.appendChild(mk("path", { d: area, fill: "rgba(45,212,167,0.12)" }));
    svg.appendChild(mk("polyline", {
      points: line, fill: "none", stroke: "#2dd4a7",
      "stroke-width": 2.5, "stroke-linejoin": "round", "stroke-linecap": "round",
    }));
  }

  // passing points
  for (const [x, y, r] of passPts) {
    svg.appendChild(mk("circle", {
      cx: x, cy: y, r: 4.5, fill: "#2dd4a7",
      stroke: "#0c0f14", "stroke-width": 2,
    }, (r.id || "?") + " · fitness " + fmt(r.fitness, 1) + " · " + (r.reason || "ok")));
  }

  // rejected runs as red x's near the baseline
  const rejY = padT + plotH - 6;
  runs.forEach((r, i) => {
    if (isPass(r)) return;
    const x = xAt(i);
    const g = mk("g", {}, (r.id || "?") + " · rejected · " + (r.reason || "fail"));
    const s = 4;
    g.appendChild(mk("line", { x1: x - s, y1: rejY - s, x2: x + s, y2: rejY + s, stroke: "#ff5c7a", "stroke-width": 2 }));
    g.appendChild(mk("line", { x1: x - s, y1: rejY + s, x2: x + s, y2: rejY - s, stroke: "#ff5c7a", "stroke-width": 2 }));
    svg.appendChild(g);
  });

  card.appendChild(svg);
  card.appendChild(el("div", { class: "chart-legend" }, [
    el("span", {}, [el("span", { class: "swatch line" }), document.createTextNode("passing fitness")]),
    el("span", {}, [el("span", { class: "swatch rej" }), document.createTextNode("rejected build")]),
  ]));
  section.appendChild(card);
  return section;
}

function renderTable(data) {
  const runs = Array.isArray(data.runs) ? data.runs.slice() : [];
  // most recent first (by ts when available, else reverse array order)
  runs.sort((a, b) => {
    const da = safeDate(a.ts), db = safeDate(b.ts);
    if (da && db) return db - da;
    return 0;
  });

  const section = el("section");
  section.appendChild(el("div", { class: "section-head" }, [
    el("h2", { text: "Recent runs" }),
  ]));

  if (runs.length === 0) {
    section.appendChild(el("div", { class: "empty inset", text: "No runs yet." }));
    return section;
  }

  const cols = ["ID", "Parent", "Fitness", "Reason", "Voices/core", "Mean µs", "p99.9 µs", "Alloc", "Drops"];
  const thead = el("thead", {}, el("tr", {}, cols.map((c) => el("th", { text: c }))));

  const tbody = el("tbody");
  for (const r of runs) {
    const pass = isPass(r);
    const badge = el("span", {
      class: "badge " + (pass ? "ok" : "rej"),
      text: pass ? "ok" : (r.reason || "rejected"),
      title: r.reason || "",
    });

    function num(v, digits) {
      if (v == null) return el("td", { class: "cell-null", text: "—" });
      return el("td", { text: fmt(v, digits) });
    }
    function count(v) {
      if (v == null) return el("td", { class: "cell-null", text: "—" });
      const ok = Number(v) === 0;
      return el("td", { class: ok ? "cell-good" : "cell-bad", text: fmt(v) });
    }

    tbody.appendChild(el("tr", {}, [
      el("td", { class: "mono", text: r.id || "—", title: absTime(r.ts) }),
      el("td", { class: "parent mono", text: r.parent || "—" }),
      num(r.fitness, 1),
      el("td", {}, badge),
      num(r.voices_50pct),
      num(r.mean_us, 1),
      num(r.p99_9_us, 1),
      count(r.alloc),
      count(r.dropouts),
    ]));
  }

  section.appendChild(el("div", { class: "table-wrap" }, el("table", {}, [thead, tbody])));
  return section;
}

/* ---------------- codebase tab ---------------- */

// Static framing copy (the methodology is stable); the facts below it are live.
const CODEBASE_INTRO = [
  "This isn't one big program a model wrote in a sitting. It's a small engine that <strong>grows one rung at a time</strong>, and most of the repo exists to make that growth safe and legible.",
  "Each rung is a contract with golden tests. A <strong>swarm</strong> of agents each writes a candidate implementation in isolation; an <strong>evaluator</strong> the agents can't touch scores them on correctness and real-time performance; the winner is merged into <code>engine/</code> and the next rung opens. The full regression suite is the ratchet — progress accumulates, it never silently breaks.",
  "Everything below is read straight from the source on each build, so it stays honest as the engine climbs.",
];

function pill(text, kind) {
  return el("span", { class: "pill" + (kind ? " " + kind : ""), text: text });
}

function renderCodebase(data) {
  const cb = data.codebase || {};
  const frag = document.createDocumentFragment();

  /* intro / methodology */
  const intro = el("section");
  intro.appendChild(el("div", { class: "section-head" }, [
    el("h2", { text: "How this codebase works" }),
  ]));
  const introCard = el("div", { class: "card prose" });
  for (const para of CODEBASE_INTRO) introCard.appendChild(el("p", { html: para }));
  intro.appendChild(introCard);
  frag.appendChild(intro);

  /* repository map */
  const map = Array.isArray(cb.repo_map) ? cb.repo_map : [];
  if (map.length) {
    const s = el("section");
    s.appendChild(el("div", { class: "section-head" }, [
      el("h2", { text: "Repository map" }),
    ]));
    const list = el("ul", { class: "repo-map card" });
    for (const e of map) {
      list.appendChild(el("li", { class: "repo-row" }, [
        el("code", { class: "repo-path", text: e.path }),
        el("span", { class: "repo-desc", text: e.desc || "" }),
      ]));
    }
    s.appendChild(list);
    frag.appendChild(s);
  }

  /* engine modules (live: file + LOC + one-liner) */
  const mods = Array.isArray(cb.modules) ? cb.modules : [];
  if (mods.length) {
    const s = el("section");
    s.appendChild(el("div", { class: "section-head" }, [
      el("h2", { text: "Engine modules" }),
      el("span", { class: "sub", text: fmt(cb.engine_loc) + " lines of Rust · " + mods.length + " files" }),
    ]));
    const list = el("ul", { class: "modules card" });
    for (const m of mods) {
      list.appendChild(el("li", { class: "module-row" }, [
        el("code", { class: "mod-file", text: m.file }),
        el("span", { class: "mod-desc", text: m.desc || "—" }),
        el("span", { class: "mod-loc", text: fmt(m.loc) + " loc" }),
      ]));
    }
    s.appendChild(list);
    frag.appendChild(s);
  }

  /* control protocol surface (live from protocol.rs) */
  const proto = cb.protocol || {};
  const cmds = Array.isArray(proto.commands) ? proto.commands : [];
  const evts = Array.isArray(proto.events) ? proto.events : [];
  if (cmds.length || evts.length) {
    const s = el("section");
    s.appendChild(el("div", { class: "section-head" }, [
      el("h2", { text: "Control protocol" }),
      el("span", { class: "sub", text: "the engine speaks one JSON object per line" }),
    ]));
    const card = el("div", { class: "card proto" });
    card.appendChild(el("div", { class: "proto-group" }, [
      el("div", { class: "proto-label" }, [
        document.createTextNode("Commands in"),
        el("span", { class: "proto-count", text: String(cmds.length) }),
      ]),
      el("div", { class: "pills" }, cmds.map((c) => pill(c, "cmd"))),
    ]));
    card.appendChild(el("div", { class: "proto-group" }, [
      el("div", { class: "proto-label" }, [
        document.createTextNode("Events out"),
        el("span", { class: "proto-count", text: String(evts.length) }),
      ]),
      el("div", { class: "pills" }, evts.map((e) => pill(e, "evt"))),
    ]));
    s.appendChild(card);
    frag.appendChild(s);
  }

  return frag;
}

function renderCommits(data) {
  const commits = Array.isArray(data.commits) ? data.commits : [];
  const section = el("section");
  section.appendChild(el("div", { class: "section-head" }, [
    el("h2", { text: "Recent activity" }),
  ]));

  if (commits.length === 0) {
    section.appendChild(el("div", { class: "empty inset", text: "No commits to show." }));
    return section;
  }

  const list = el("ul", { class: "commits card" });
  for (const c of commits) {
    list.appendChild(el("li", { class: "commit" }, [
      el("span", { class: "hash", text: (c.hash || "").slice(0, 7) }),
      el("span", { class: "subject", text: c.subject || "(no message)" }),
      el("span", { class: "when", text: relTime(c.date), title: absTime(c.date) }),
    ]));
  }
  section.appendChild(list);
  return section;
}

/* ---------------- orchestration ---------------- */

let lastData = null;       // keep the latest payload so tab switches don't refetch
let currentView = "overview";

function renderView(view, data) {
  const content = document.getElementById("content");
  clear(content);
  if (view === "codebase") {
    content.appendChild(renderCodebase(data));
    return;
  }
  content.appendChild(renderChampion(data));
  content.appendChild(renderLadder(data));
  content.appendChild(renderChart(data));
  content.appendChild(renderTable(data));
  content.appendChild(renderCommits(data));
}

function render(data) {
  lastData = data;
  renderHeader(data);
  renderView(currentView, data);
}

function initTabs() {
  const tabs = document.getElementById("tabs");
  if (!tabs) return;
  tabs.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".tab");
    if (!btn) return;
    const view = btn.getAttribute("data-view");
    if (!view || view === currentView) return;
    currentView = view;
    for (const t of tabs.querySelectorAll(".tab")) {
      const active = t === btn;
      t.classList.toggle("is-active", active);
      t.setAttribute("aria-selected", active ? "true" : "false");
    }
    if (lastData) renderView(currentView, lastData);
  });
}

function renderError(err) {
  const content = document.getElementById("content");
  clear(content);
  content.appendChild(el("div", { class: "error" }, [
    el("strong", { text: "Could not load data.json. " }),
    document.createTextNode(String(err && err.message ? err.message : err)),
  ]));
}

async function load() {
  try {
    const res = await fetch("data.json?_=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    render(data);
  } catch (err) {
    // Keep prior render on a transient refresh failure; only show error if nothing rendered.
    const content = document.getElementById("content");
    if (content.querySelector(".loading") || content.children.length === 0) {
      renderError(err);
    } else {
      console.warn("Refresh failed, keeping last good render:", err);
    }
  }
}

initTabs();
load();
setInterval(load, REFRESH_MS);
