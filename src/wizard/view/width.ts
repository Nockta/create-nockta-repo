/**
 * ANSI-aware terminal-width primitives for the two-pane paginated multi-select (D28 View).
 *
 * Column alignment in a boxed, two-pane layout is only correct if padding is computed from the
 * VISIBLE width of a string — the number of terminal cells it occupies — NOT its `.length`. Two
 * things break `.length`:
 *   1. picocolors wraps text in `\x1b[..m` SGR escape sequences that occupy ZERO cells;
 *   2. some glyphs occupy TWO cells (emoji like 🔒, CJK), and some occupy ZERO (combining marks,
 *      variation selectors).
 * These helpers strip ANSI and sum per-code-point cell widths so the divider column stays straight.
 * The wide/zero-width tables are the classic `wcwidth` set: the geometric-shape markers this View
 * uses (◉ ○ ❯ ⚠) are width 1, while 🔒 (U+1F512) is width 2 — matching how a modern xterm renders them.
 */

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** Strip SGR color escape sequences, leaving only the visible characters. */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

/** Inclusive code-point ranges rendered as two terminal cells (wcwidth "wide"/"fullwidth"). */
const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2329, 0x232a],
  [0x2e80, 0x303e], // CJK radicals … Kangxi
  [0x3041, 0x33ff], // Hiragana … CJK compat
  [0x3400, 0x4dbf], // CJK ext A
  [0x4e00, 0x9fff], // CJK unified
  [0xa000, 0xa4cf], // Yi
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compat ideographs
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f], // CJK compat forms
  [0xff00, 0xff60], // fullwidth forms
  [0xffe0, 0xffe6],
  [0x1f000, 0x1faff], // emoji, pictographs, symbols (incl. 🔒 U+1F512)
  [0x20000, 0x3fffd], // CJK ext B+
];

/** Inclusive code-point ranges rendered as ZERO cells (combining marks, joiners, variation selectors). */
const ZERO_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0300, 0x036f], // combining diacritics
  [0x200b, 0x200f], // zero-width space … marks
  [0x2028, 0x202e], // line/paragraph seps + bidi
  [0x2060, 0x206f],
  [0xfe00, 0xfe0f], // variation selectors (incl. VS16 emoji-presentation)
  [0xfeff, 0xfeff], // BOM
];

function inRanges(cp: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  for (const [lo, hi] of ranges) if (cp >= lo && cp <= hi) return true;
  return false;
}

/** Cells occupied by a single code point: 0 (combining/control), 2 (wide), or 1. */
function charWidth(cp: number): number {
  if (cp === 0) return 0;
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0; // C0/C1 controls
  if (inRanges(cp, ZERO_RANGES)) return 0;
  if (inRanges(cp, WIDE_RANGES)) return 2;
  return 1;
}

/** Visible terminal width of a (possibly colored) string, in cells. */
export function visibleWidth(s: string): number {
  const plain = stripAnsi(s);
  let w = 0;
  for (const ch of plain) w += charWidth(ch.codePointAt(0)!);
  return w;
}

/**
 * Truncate a PLAIN (uncolored) string to at most `maxWidth` cells, appending "…" when it overflows.
 * Cell-aware: never splits a wide glyph across the boundary, never exceeds `maxWidth`.
 */
export function truncateToWidth(s: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (visibleWidth(s) <= maxWidth) return s;
  // Reserve one cell for the ellipsis.
  const budget = maxWidth - 1;
  let out = "";
  let w = 0;
  for (const ch of s) {
    const cw = charWidth(ch.codePointAt(0)!);
    if (w + cw > budget) break;
    out += ch;
    w += cw;
  }
  return `${out}…`;
}

/** Append spaces so `colored` reaches exactly `width` visible cells (no-op if already ≥ width). */
export function padEndVisible(colored: string, width: number): string {
  const pad = width - visibleWidth(colored);
  return pad > 0 ? colored + " ".repeat(pad) : colored;
}

/**
 * Word-wrap PLAIN text to `width` cells per line, breaking on whitespace. A single word longer than
 * `width` is hard-split at the cell boundary (so it can never overflow the pane). Returns [] for
 * empty/blank input.
 */
export function wordWrap(text: string, width: number): string[] {
  if (width <= 0) return [];
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let cur = "";
  const flush = () => {
    if (cur) lines.push(cur);
    cur = "";
  };
  for (let word of words) {
    // Hard-split an over-long word into width-sized chunks.
    while (visibleWidth(word) > width) {
      flush();
      let chunk = "";
      let w = 0;
      let rest = "";
      let broke = false;
      for (const ch of word) {
        const cw = charWidth(ch.codePointAt(0)!);
        if (!broke && w + cw <= width) {
          chunk += ch;
          w += cw;
        } else {
          broke = true;
          rest += ch;
        }
      }
      lines.push(chunk);
      word = rest;
    }
    if (!cur) {
      cur = word;
    } else if (visibleWidth(cur) + 1 + visibleWidth(word) <= width) {
      cur += ` ${word}`;
    } else {
      flush();
      cur = word;
    }
  }
  flush();
  return lines;
}
