#!/usr/bin/env python3
"""Iteratively refine the prose in each lesson via the Claude API.

For each lesson file:
  1. Extract the HTML inside `container.innerHTML = ` ... ` ;`
  2. Send it to Claude with instructions to make the prose more engaging
     and accessible while preserving every HTML element, id, class, and
     formula byte-for-byte.
  3. Replace the original HTML with the refined version.
  4. Feed that into the next round. After N rounds, write the final result
     to a parallel output directory.

Default model: claude-opus-4-7. Default rounds: 6. The system prompt
(large, stable across all calls) is cached via ephemeral prompt caching.

Usage:
    pip install anthropic
    cp .env.example .env  &&  edit .env to add your key
    # ...or:  export ANTHROPIC_API_KEY=...
    python refine_lessons.py                            # all lessons, 6 rounds, opus-4-7
    python refine_lessons.py --lessons 04-spectrum.js   # one lesson
    python refine_lessons.py --rounds 3 --save-intermediate
    python refine_lessons.py --model claude-sonnet-4-6  # cheaper / faster
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

import anthropic


DEFAULT_MODEL = "claude-opus-4-7"
DEFAULT_ROUNDS = 6
DEFAULT_MAX_TOKENS = 32000


def load_env_file(path: Path) -> None:
    """Load KEY=VALUE pairs from a .env file into os.environ.

    Mirrors the loader in scripts/rewrite-lessons.js: shell env wins over
    .env, surrounding quotes are stripped, blank/comment lines are skipped.
    """
    try:
        raw = path.read_text()
    except FileNotFoundError:
        return
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip()
        if not re.fullmatch(r"[A-Z0-9_]+", key):
            continue
        if key in os.environ:
            continue
        if (val.startswith('"') and val.endswith('"')) or (
            val.startswith("'") and val.endswith("'")
        ):
            val = val[1:-1]
        os.environ[key] = val


load_env_file(Path(__file__).resolve().parent / ".env")

# Captures the HTML inside `container.innerHTML = ` ... ` ;`.
# Group 2 is the prose-bearing HTML; groups 1 and 3 are the surrounding
# JS punctuation we splice back in unchanged.
LESSON_PATTERN = re.compile(
    r"(container\.innerHTML\s*=\s*`)([\s\S]*?)(`\s*;)",
)


SYSTEM_PROMPT = """You are an expert editor refining the prose inside an interactive web lesson on audio feature extraction for music visualizers. The lessons run in a static HTML/JS app — the text you edit ships directly to learners.

Your job: rewrite the prose to be MORE ENGAGING and MORE ACCESSIBLE while preserving every structural element exactly.

# What you may change

- The text inside <p>, <li>, <h3>, <ol>, and similar text-bearing tags.
- Wording, examples, analogies, sentence rhythm, paragraph flow.
- The tone — favor curiosity, clarity, and concrete physical imagery over jargon dumps.
- The pedagogical sequencing inside a paragraph, as long as the lesson's claims and the order of experiments stay intact.

# What you MUST NOT change

- Any HTML tag, attribute, id, class, data-* value, or inline style — preserve them byte-identical.
- The structure: the same number and order of <p>, <h3>, <ol>, <li>, <div class="controls">, <div class="feature">, <canvas>, <input>, <select>, <button>, <code>, <em>, <strong> elements as the input.
- Anything inside <code> tags (formulas, identifiers, code) — byte-identical.
- The id="..." and class="..." values, and the order of .controls and .feature blocks.
- The number of items in any "Try this" <ol>, and the core observation each item points at — you may sharpen the wording, but don't drop or merge experiments, and don't change what the learner is meant to notice.
- The lesson's id, title, summary, filenames, and any cross-references to other lessons (e.g., "lesson 6", "lesson 8").
- Technical claims. Don't introduce false statements, change feature definitions, or "improve" a formula by editing it.

# Output format

Return ONLY the refined HTML. No preamble. No closing remarks. No markdown fences (no ```html, no ```). Start with the first character of the HTML and end with the last character. Preserve the leading and trailing whitespace exactly as it appears between the template-literal backticks.

# Quality bar

- Replace passive constructions and abstract noun-stacks with active, concrete sentences.
- Use vivid physical analogies where appropriate. Audio is a physical medium — describe air pressure, vibration, the cone of a speaker, the way an ear or eye perceives change.
- Trim filler: "It is important to note that…", "Essentially…", "Basically…", "In other words…".
- Vary sentence length. Short punchy sentences pair well with longer explanatory ones.
- "Try this" experiments should hint at what the learner will SEE or HEAR, not just enumerate steps.
- Keep technical accuracy intact.

# Iterative refinement

This is one round of a 6-round process. Each round should make the text noticeably better than the previous one, but improvements compound — later rounds polish, earlier rounds restructure. By round 6 the prose should feel hand-crafted: every sentence earns its place.
"""


USER_TEMPLATE = """Lesson file: {filename}
Round: {round_n} of {total_rounds}

Below is the current HTML, between the markers. Refine the prose per your system instructions. Output the refined HTML only — no fences, no preamble.

<<<HTML_START
{html}
HTML_END>>>"""


def extract_html(source: str) -> tuple[str, str, str]:
    """Return (prefix, html, suffix) where prefix + html + suffix == source."""
    m = LESSON_PATTERN.search(source)
    if not m:
        raise ValueError("Could not find container.innerHTML = `...`; block")
    return source[: m.start(2)], m.group(2), source[m.end(2) :]


def strip_fences(text: str) -> str:
    """If Claude wrapped output in markdown fences despite instructions, peel them."""
    s = text.strip()
    if s.startswith("```"):
        nl = s.find("\n")
        if nl != -1:
            s = s[nl + 1 :]
        if s.rstrip().endswith("```"):
            s = s.rstrip()[: -3]
    return s


def refine_once(
    client: anthropic.Anthropic,
    model: str,
    filename: str,
    html: str,
    round_n: int,
    total_rounds: int,
    max_tokens: int,
):
    """Run one refinement round. Returns (refined_html, usage)."""
    user = USER_TEMPLATE.format(
        filename=filename,
        round_n=round_n,
        total_rounds=total_rounds,
        html=html,
    )
    # Stream so large outputs don't hit the SDK's non-streaming timeout guard.
    with client.messages.stream(
        model=model,
        max_tokens=max_tokens,
        thinking={"type": "adaptive"},
        system=[
            {
                "type": "text",
                "text": SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            },
        ],
        messages=[{"role": "user", "content": user}],
    ) as stream:
        msg = stream.get_final_message()

    text_parts = [b.text for b in msg.content if b.type == "text"]
    refined = strip_fences("".join(text_parts))
    return refined, msg.usage


def refine_lesson(
    client: anthropic.Anthropic,
    model: str,
    src_path: Path,
    out_path: Path,
    rounds: int,
    max_tokens: int,
    save_intermediate: bool,
    intermediate_root: Path | None,
) -> None:
    print(f"\n=== {src_path.name} ===")
    source = src_path.read_text()
    prefix, html, suffix = extract_html(source)

    current = html
    for r in range(1, rounds + 1):
        print(f"  round {r}/{rounds} ...", end="", flush=True)
        current, usage = refine_once(
            client, model, src_path.name, current, r, rounds, max_tokens
        )
        cache_read = getattr(usage, "cache_read_input_tokens", 0) or 0
        cache_write = getattr(usage, "cache_creation_input_tokens", 0) or 0
        print(
            f" in={usage.input_tokens} "
            f"cacheR={cache_read} cacheW={cache_write} "
            f"out={usage.output_tokens}"
        )
        if save_intermediate and intermediate_root is not None:
            ip = intermediate_root / f"round-{r}" / src_path.name
            ip.parent.mkdir(parents=True, exist_ok=True)
            ip.write_text(prefix + current + suffix)

    out_path.write_text(prefix + current + suffix)
    print(f"  -> {out_path}")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--lessons-dir", type=Path, default=Path("lessons"))
    p.add_argument("--output-dir", type=Path, default=Path("lessons-refined"))
    p.add_argument(
        "--lessons",
        nargs="*",
        help="Specific lesson filenames to process (default: every NN-*.js)",
    )
    p.add_argument("--rounds", type=int, default=DEFAULT_ROUNDS)
    p.add_argument("--model", default=DEFAULT_MODEL)
    p.add_argument("--max-tokens", type=int, default=DEFAULT_MAX_TOKENS)
    p.add_argument(
        "--save-intermediate",
        action="store_true",
        help="Also write each round's output to <output-dir>/round-N/",
    )
    args = p.parse_args()

    if not os.environ.get("ANTHROPIC_API_KEY"):
        print(
            "error: ANTHROPIC_API_KEY not set.\n"
            "  cp .env.example .env  and add your key,\n"
            "  or export ANTHROPIC_API_KEY=sk-ant-...",
            file=sys.stderr,
        )
        return 1

    if args.lessons:
        files = [args.lessons_dir / name for name in args.lessons]
    else:
        files = sorted(args.lessons_dir.glob("[0-9][0-9]-*.js"))

    files = [f for f in files if f.exists()]
    if not files:
        print(f"error: no lesson files found in {args.lessons_dir}", file=sys.stderr)
        return 1

    args.output_dir.mkdir(parents=True, exist_ok=True)

    client = anthropic.Anthropic()
    print(
        f"model={args.model}  rounds={args.rounds}  "
        f"files={len(files)}  out={args.output_dir}"
    )

    failures = 0
    for src in files:
        out = args.output_dir / src.name
        try:
            refine_lesson(
                client,
                args.model,
                src,
                out,
                args.rounds,
                args.max_tokens,
                args.save_intermediate,
                args.output_dir if args.save_intermediate else None,
            )
        except anthropic.APIError as e:
            print(f"  api error: {e}")
            failures += 1
        except ValueError as e:
            print(f"  skipping ({e})")
            failures += 1

    print(f"\ndone. {len(files) - failures}/{len(files)} lessons refined.")
    return 0 if failures == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
