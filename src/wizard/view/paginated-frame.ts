import type { ChoiceModel, SectionModel } from "../core/types.js";
import {
  CURSOR_POINTER,
  KEY_HINTS,
  LOCK_ICON,
  MARK_SELECTED,
  MARK_UNSELECTED,
  theme as themeFor,
  type ThemeFns,
} from "./theme.js";
import { padEndVisible, truncateToWidth, visibleWidth, wordWrap } from "./width.js";

/**
 * The PURE render layer of the custom paginated multi-select (decisions.md D28). It owns the
 * finite pagination math and the frame string — no hooks, no terminal, no keypress handling — so
 * it is snapshot-testable headlessly (render one page to a string and assert its layout), which is
 * how the interactive View gets SOME automated coverage despite the real TTY session being
 * un-drivable in CI. The live prompt (`paginated-multiselect.ts`) computes state via hooks and
 * calls straight into here to draw each frame.
 *
 * ## Two-pane master–detail layout (2026-07-11 redesign)
 *
 * The frame is a STABLE box: `title` → two-pane body → full-width footer. The LEFT pane is the
 * paginated list (section headers, selection markers, lock icon, cursor pointer, skill NAME ONLY —
 * NO inline description). The RIGHT pane is the detail for the currently-hovered item (its name, its
 * word-wrapped description, and — when present — a clash line + a lock reason). This is the shared
 * component for EVERY list step (repo-type, adapters, skills, razor) — not skill-specific; a list
 * whose choices carry no `description` simply shows the hovered NAME in the detail pane and degrades
 * cleanly (no empty/broken pane, no crash). The body height is FIXED per render at the page window
 * (`min(pageSize, rows.length)` — so a short one-page list is a tight box, a multi-page list keeps
 * the full `pageSize` window and pads the last page), so the box never reflows when the cursor moves
 * or when descriptions differ in length; over-long detail truncates with "…". A dim `│` divides the
 * panes. Below a width threshold (two panes can't fit) it falls back to a single-column list with a
 * fixed, TRUNCATED detail block stacked beneath — which still avoids the old per-keystroke reflow
 * because the detail area is a fixed height, not an inline-under-the-cursor line that reflowed the list.
 */

/** A rendered row: a non-selectable section header, or a selectable item. */
export type FrameRow =
  | { type: "header"; label: string }
  | { type: "item"; choice: ChoiceModel };

/**
 * Interleave sections + their choices into the ordered row list (header, then that section's
 * items). Matches on the GENERIC grouping key (`ChoiceModel.section` / `SectionModel.key`), each
 * falling back to `pack` when absent — so the general skills step (pack-grouped, never sets
 * `section`/`key`) renders exactly as before, while the razor step (grouped by category — see
 * `wizard/core/build-schema.ts`'s `buildRazorStep`) groups correctly even though every razor
 * choice shares one `pack`. NOT a "one section = one pack" assumption.
 */
export function buildRows(choices: ChoiceModel[], sections: SectionModel[] | undefined): FrameRow[] {
  if (!sections || sections.length === 0) {
    return choices.map((choice) => ({ type: "item", choice }));
  }
  const rows: FrameRow[] = [];
  for (const section of sections) {
    const sectionKey = section.key ?? section.pack;
    rows.push({ type: "header", label: section.label });
    for (const choice of choices) {
      if ((choice.section ?? choice.pack) === sectionKey) rows.push({ type: "item", choice });
    }
  }
  return rows;
}

/** Indices (into `rows`) of the selectable item rows, in order — the cursor only ever lands on these. */
export function itemRowIndices(rows: FrameRow[]): number[] {
  const out: number[] = [];
  rows.forEach((row, i) => {
    if (row.type === "item") out.push(i);
  });
  return out;
}

export function pageCount(rowCount: number, pageSize: number): number {
  return Math.max(1, Math.ceil(rowCount / pageSize));
}

export interface FrameInput {
  title: string;
  rows: FrameRow[];
  pageSize: number;
  /** 0-based page currently shown. */
  page: number;
  /** Absolute index into `rows` of the row under the cursor (must be an item row). */
  cursorRowIndex: number;
  /** Currently-selected values (persists across pages). */
  selected: ReadonlySet<string> | readonly string[];
  /** Turn picocolors on (live prompt) or off (deterministic snapshots). */
  colors: boolean;
  /** Terminal columns (live prompt passes `process.stdout.columns`); defaults to 80 when absent. */
  columns?: number;
}

// Layout constants (see the module doc's two-pane note).
const NARROW_THRESHOLD = 80; // below this, fall back to a single column
const MIN_LEFT = 32;
const MAX_LEFT = 60;
const GUTTER = 3; // " │ " between the panes (space + divider + space)
const MIN_RIGHT = 20;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Build ONE left-pane cell for a row, padded to `width` visible cells (name only, no description). */
function leftCell(row: FrameRow, isCursor: boolean, isSelected: boolean, width: number, t: ThemeFns): string {
  if (row.type === "header") {
    const header = truncateToWidth(`── ${row.label} ──`, width);
    return padEndVisible(t.header(header), width);
  }
  const choice = row.choice;
  const pointerGlyph = isCursor ? CURSOR_POINTER : " ";
  const markerGlyph = isSelected ? MARK_SELECTED : MARK_UNSELECTED;
  // Prefix is "<pointer> <marker> " → 4 cells (all width-1 glyphs).
  const prefixWidth = 4;
  const lockWidth = choice.disabled ? visibleWidth(`${LOCK_ICON} `) : 0;
  const labelBudget = Math.max(0, width - prefixWidth - lockWidth);
  const labelShown = truncateToWidth(choice.label, labelBudget);

  const pointerCol = isCursor ? t.cursor(pointerGlyph) : pointerGlyph;
  const markerCol = isSelected ? t.selected(markerGlyph) : markerGlyph;
  let namePart: string;
  if (choice.disabled) namePart = t.dim(`${LOCK_ICON} ${labelShown}`);
  else if (isCursor) namePart = t.cursor(labelShown);
  else namePart = labelShown;

  return padEndVisible(`${pointerCol} ${markerCol} ${namePart}`, width);
}

/** Build the right-pane detail lines for the hovered choice, clipped+padded to exactly `height` rows. */
function detailCells(hovered: ChoiceModel | undefined, width: number, height: number, t: ThemeFns): string[] {
  const lines: string[] = [];
  if (hovered) {
    for (const l of wordWrap(hovered.label, width)) lines.push(t.bold(l));
    if (hovered.description) {
      lines.push("");
      for (const l of wordWrap(hovered.description, width)) lines.push(l);
    }
    if (hovered.clashesWith && hovered.clashesWith.length > 0) {
      lines.push("");
      const clash = `overlaps with ${hovered.clashesWith.join(", ")} — enable at your discretion`;
      for (const l of wordWrap(clash, width)) lines.push(t.dim(l));
    }
    if (hovered.disabled && hovered.disabledReason) {
      lines.push("");
      for (const l of wordWrap(`${LOCK_ICON} ${hovered.disabledReason}`, width)) lines.push(t.dim(l));
    }
  }
  if (lines.length > height) {
    lines.length = height;
    lines[height - 1] = t.dim("…"); // truncation marker — prefer a stable box over showing everything
  }
  while (lines.length < height) lines.push("");
  return lines;
}

/** Find the hovered item's choice (the cursor only lands on item rows). */
function hoveredChoice(rows: FrameRow[], cursorRowIndex: number): ChoiceModel | undefined {
  const row = rows[cursorRowIndex];
  return row && row.type === "item" ? row.choice : undefined;
}

/**
 * Render ONE page of the paginated multi-select to a string. Finite: only the current page's rows
 * are drawn, with a `Page X/Y` indicator — no wrap-around scroll (D28). Two-pane master–detail
 * layout (see the module doc): the left pane is the list, the right pane the hovered item's detail,
 * with a fixed body height so the box never jumps. Falls back to a single column on narrow terminals.
 */
export function renderPaginatedFrame(input: FrameInput): string {
  const t = themeFor(input.colors);
  const selectedSet = input.selected instanceof Set ? input.selected : new Set(input.selected);
  const total = pageCount(input.rows.length, input.pageSize);
  const page = Math.min(Math.max(0, input.page), total - 1);
  const start = page * input.pageSize;
  const pageRows = input.rows.slice(start, start + input.pageSize);
  const cols = Math.max(1, Math.floor(input.columns ?? 80));
  // Fixed body height = the page window. For a list that fits on ONE page (repo-type/adapters, and
  // skills whose rows ≤ pageSize) it collapses to the actual row count so a short list isn't a tall
  // box of blanks; a multi-page list keeps the full pageSize window and pads the last page. Either
  // way the height never changes as the cursor moves — the box does not jump.
  const bodyHeight = Math.max(1, Math.min(input.pageSize, input.rows.length));

  const footer = truncateToWidth(`Page ${page + 1}/${total} · ${KEY_HINTS}`, cols);
  const titleLine = truncateToWidth(`? ${input.title}`, cols);

  // Precompute the per-row selection/cursor state as padded LEFT cells at a given width.
  const buildLeftCells = (width: number): string[] => {
    const cells: string[] = [];
    for (let offset = 0; offset < bodyHeight; offset++) {
      if (offset >= pageRows.length) {
        cells.push(" ".repeat(width));
        continue;
      }
      const row = pageRows[offset]!;
      const absoluteIndex = start + offset;
      const isCursor = row.type === "item" && absoluteIndex === input.cursorRowIndex;
      const isSelected = row.type === "item" && selectedSet.has(row.choice.value);
      cells.push(leftCell(row, isCursor, isSelected, width, t));
    }
    return cells;
  };

  const hovered = hoveredChoice(input.rows, input.cursorRowIndex);

  // --- Narrow fallback: single column list + a FIXED, truncated detail block (no reflow). ---
  if (cols < NARROW_THRESHOLD) {
    const lines: string[] = [t.bold(titleLine)];
    for (const cell of buildLeftCells(cols)) lines.push(cell.replace(/\s+$/, ""));
    lines.push("");
    // Fixed 3-line detail area so height never changes as the cursor moves.
    const nameLine = hovered ? t.bold(truncateToWidth(hovered.label, cols)) : "";
    const descLine = hovered && hovered.description ? truncateToWidth(hovered.description, cols) : "";
    let metaLine = "";
    if (hovered && hovered.clashesWith && hovered.clashesWith.length > 0) {
      metaLine = t.dim(
        truncateToWidth(`overlaps with ${hovered.clashesWith.join(", ")} — enable at your discretion`, cols),
      );
    } else if (hovered && hovered.disabled && hovered.disabledReason) {
      metaLine = t.dim(truncateToWidth(`${LOCK_ICON} ${hovered.disabledReason}`, cols));
    }
    lines.push(nameLine, descLine, metaLine);
    lines.push("");
    lines.push(t.dim(footer));
    return lines.join("\n");
  }

  // --- Two-pane master–detail. ---
  let leftWidth = clamp(Math.floor(cols * 0.4), MIN_LEFT, MAX_LEFT);
  if (cols - leftWidth - GUTTER < MIN_RIGHT) leftWidth = cols - GUTTER - MIN_RIGHT;
  const rightWidth = cols - leftWidth - GUTTER;

  const leftCells = buildLeftCells(leftWidth);
  const rightCells = detailCells(hovered, rightWidth, bodyHeight, t);
  const divider = t.dim("│");

  const lines: string[] = [t.bold(titleLine)];
  for (let i = 0; i < bodyHeight; i++) {
    const right = rightCells[i] ?? "";
    const rowText = right ? `${leftCells[i]} ${divider} ${right}` : `${leftCells[i]} ${divider}`;
    lines.push(rowText);
  }
  lines.push("");
  lines.push(t.dim(footer));
  return lines.join("\n");
}
