// Re-applies the original leading/trailing whitespace of the
// `container.innerHTML = `…`` template-literal body to the rewritten
// files, so the diff against ./lessons shows only prose changes.
//
// Run:  node scripts/restore-whitespace.js

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC_DIR = join(ROOT, "lessons");
const OUT_DIR = join(ROOT, "lessons-rewritten");

function findInnerHTMLBlock(source) {
  const startMarker = "container.innerHTML = `";
  const startIdx = source.indexOf(startMarker);
  if (startIdx < 0) return null;
  const bodyStart = startIdx + startMarker.length;
  let i = bodyStart;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") { i += 2; continue; }
    if (ch === "`") break;
    i++;
  }
  if (i >= source.length) return null;
  return {
    before: source.slice(0, bodyStart),
    body: source.slice(bodyStart, i),
    after: source.slice(i),
  };
}

const leadingWS = (s) => s.match(/^\s*/)[0];
const trailingWS = (s) => s.match(/\s*$/)[0];

const files = readdirSync(OUT_DIR).filter((f) => f.endsWith(".js")).sort();
let fixed = 0;
for (const f of files) {
  const orig = readFileSync(join(SRC_DIR, f), "utf8");
  const out = readFileSync(join(OUT_DIR, f), "utf8");
  const o = findInnerHTMLBlock(orig);
  const n = findInnerHTMLBlock(out);
  if (!o || !n) continue;

  const lead = leadingWS(o.body);
  const trail = trailingWS(o.body);
  const trimmed = n.body.replace(/^\s*/, "").replace(/\s*$/, "");
  const newBody = lead + trimmed + trail;
  if (newBody === n.body) continue;

  writeFileSync(join(OUT_DIR, f), n.before + newBody + n.after, "utf8");
  fixed++;
  console.log(`  fixed ${f}`);
}
console.log(`Restored whitespace in ${fixed} file(s).`);
