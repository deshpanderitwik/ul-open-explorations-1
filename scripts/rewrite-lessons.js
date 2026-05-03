// scripts/rewrite-lessons.js
//
// Reads each lesson under ./lessons, finds the `container.innerHTML = `…``
// template literal, sends the HTML to Claude with instructions to rewrite
// only the prose (text inside <p>, <h3>, <li>) into something more engaging
// and accessible while preserving all other HTML verbatim. Writes the result
// to ./lessons-rewritten/ — diff against ./lessons/ before promoting.
//
// Run:  npm install  &&  npm run rewrite

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC_DIR = join(ROOT, "lessons");
const OUT_DIR = join(ROOT, "lessons-rewritten");

// ---------- env loading (no dotenv dep) ----------

function loadEnvFile(path) {
  let raw;
  try { raw = readFileSync(path, "utf8"); } catch { return; }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const [, key, val] = m;
    if (process.env[key]) continue; // don't override real env
    // Strip surrounding quotes if present.
    const stripped = val.replace(/^["'](.*)["']$/, "$1");
    process.env[key] = stripped;
  }
}
loadEnvFile(join(ROOT, ".env"));

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "Missing ANTHROPIC_API_KEY. Add it to .env and rerun.\n" +
    "  echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env"
  );
  process.exit(1);
}

// ---------- prompt ----------

const SYSTEM_PROMPT = `You are revising explanatory prose inside an interactive web tutorial called "Audio Features for Visualization." It teaches programmers the audio-analysis primitives that drive music visualizers — RMS, FFT, spectral shape, onset detection, and so on. The audience is technically literate but the writing should feel inviting, not academic.

You will be given the full HTML of one lesson's body, taken from a JavaScript template literal. The HTML mixes two things:

  1. PROSE you should rewrite: text inside <p>, <h3>, and <li> tags (and the inline tags inside them: <code>, <em>, <strong>, <br>).
  2. MACHINERY you must NOT touch: <div class="controls">, <canvas>, <button>, <input>, <select>, <span>, <label>, <div class="feature">, <div class="feature-head">, attributes, ids, classes, data-* — everything that isn't user-readable prose. Leave these byte-for-byte identical.

Rewrite goals for the prose:
- More engaging and concrete. Lead with the intuition, then the mechanism.
- More accessible: replace jargon with plainer phrasing where the precise term isn't load-bearing; if the term IS load-bearing, define it briefly the first time.
- Keep the tutorial's voice: direct, second-person ("you"), occasional dry humor is fine, no exclamation points, no marketing-speak.
- Preserve technical accuracy. Don't invent new claims, formulas, numbers, or instructions. If the original says "sine reads ≈ 0.707", keep that fact.
- Preserve all <code> spans, <em>/<strong> emphasis, and inline <br> tags exactly where they semantically belong (you may move them slightly if you restructure a sentence, but don't drop them or add new ones).
- Keep the structure: same number of <p>/<h3>/<li> elements in the same order. Don't merge, split, add, or remove blocks.
- Heading text inside <h3> can be tightened but should still mark the same section.
- List items should stay roughly the same length as the original. Bullet flavor over paragraph flavor.

Output rules:
- Return the COMPLETE rewritten HTML, ready to drop straight back into the template literal.
- Do NOT wrap your response in <html>, <body>, code fences, markdown, or any commentary. Return raw HTML only — your first character should be the first character of the rewritten HTML.
- Do NOT change any non-prose HTML. Whitespace and indentation between block-level elements may be preserved or reflowed slightly, but the non-prose elements themselves must be byte-identical when stripped of surrounding whitespace.`;

// ---------- per-file processing ----------

// Match `container.innerHTML = `…`;` — the template literal body is what we rewrite.
// Lessons may contain backticks inside the literal only as escaped/regex-safe
// content; in this codebase the literal ends with the first ` followed by `;`.
function findInnerHTMLBlock(source) {
  const startMarker = "container.innerHTML = `";
  const startIdx = source.indexOf(startMarker);
  if (startIdx < 0) return null;
  const bodyStart = startIdx + startMarker.length;

  // Walk forward looking for an unescaped closing backtick. The lessons
  // don't use ${} interpolation inside this literal, so this is safe.
  let i = bodyStart;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") { i += 2; continue; }
    if (ch === "`") break;
    i++;
  }
  if (i >= source.length) return null;
  const bodyEnd = i;

  return {
    before: source.slice(0, bodyStart),
    body: source.slice(bodyStart, bodyEnd),
    after: source.slice(bodyEnd), // starts with the closing backtick
  };
}

const client = new Anthropic();

async function rewriteOne(filename) {
  const inputPath = join(SRC_DIR, filename);
  const source = readFileSync(inputPath, "utf8");

  const split = findInnerHTMLBlock(source);
  if (!split) {
    console.warn(`  ${filename}: no container.innerHTML block found, skipping`);
    return { filename, skipped: true };
  }

  process.stdout.write(`  ${filename}: requesting rewrite… `);

  const stream = client.messages.stream({
    model: "claude-opus-4-7",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content:
          "Here is the lesson HTML. Rewrite the prose per the system instructions and return the full HTML.\n\n" +
          "<<<LESSON_HTML>>>\n" +
          split.body +
          "\n<<<END_LESSON_HTML>>>",
      },
    ],
  });

  const message = await stream.finalMessage();
  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock) {
    console.log("no text in response, skipping");
    return { filename, skipped: true };
  }
  let rewritten = textBlock.text;

  // Belt-and-suspenders: strip accidental code fences if the model adds them.
  rewritten = rewritten
    .replace(/^\s*```(?:html)?\s*/i, "")
    .replace(/\s*```\s*$/i, "");

  const out = split.before + rewritten + split.after;
  const outPath = join(OUT_DIR, filename);
  writeFileSync(outPath, out, "utf8");

  const u = message.usage;
  console.log(
    `done (in:${u.input_tokens} out:${u.output_tokens})`
  );
  return { filename, ok: true };
}

// ---------- main ----------

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const files = readdirSync(SRC_DIR)
    .filter((f) => f.endsWith(".js"))
    .sort();

  console.log(`Rewriting ${files.length} lessons → ${OUT_DIR}`);
  console.log("");

  let okCount = 0;
  let failCount = 0;
  for (const f of files) {
    try {
      const r = await rewriteOne(f);
      if (r.ok) okCount++;
    } catch (err) {
      failCount++;
      console.log(`failed: ${err?.message || err}`);
    }
  }

  console.log("");
  console.log(`Done. ${okCount} rewritten, ${failCount} failed.`);
  console.log(`Diff to review:  diff -ru lessons lessons-rewritten`);
  console.log(`Promote when happy:  cp lessons-rewritten/*.js lessons/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
