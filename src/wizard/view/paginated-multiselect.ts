import {
  createPrompt,
  isDownKey,
  isEnterKey,
  isSpaceKey,
  isUpKey,
  useKeypress,
  useMemo,
  useState,
  type KeypressEvent,
} from "@inquirer/core";
import type { StepModel } from "../core/types.js";
import { buildRows, itemRowIndices, pageCount, renderPaginatedFrame } from "./paginated-frame.js";

/**
 * The custom finite, paginated two-pane master–detail prompt — PORTED verbatim from
 * `inject-nockta-skills`' own `src/wizard/view/paginated-multiselect.ts` (decisions.md D28's
 * component, copied not imported — packages are independent, D7's duplicate-the-contract posture).
 * Built on `@inquirer/core` primitives (`createPrompt` + `useState`/`useKeypress`/`useMemo`), NOT the
 * stock `checkbox()`. Reused for EVERY create genesis list step (repo-type, also-types,
 * package-manager, architecture) — they differ only by `StepModel`.
 *
 * Keys (D28, identical footer to inject): ←/→ = discrete PAGE turns (no scroll/wrap); ↑/↓ = move the
 * cursor within the current page (finite — clamps at page ends); space = toggle the item under the
 * cursor; ↵ = confirm; b = go back a step (resolves with the BACK sentinel the Controller
 * understands). Selection is held in a Set ABOVE the page view, so turning pages NEVER loses prior
 * toggles.
 *
 * ## D29 addition — single-select mode (`step.single`)
 *
 * Create's PRIMARY repo-type step, and the package-manager/architecture steps, are single-choice
 * (unlike inject, where every list step is a true multi-select). `step.single === true` makes the
 * prompt a radio: space on a row selects THAT row and deselects every other; ↵ confirms with exactly
 * the one selected (or, if the user never pressed space, the currently-hovered row). This keeps the
 * two-pane master–detail rendering (and the shared footer) identical while enforcing "pick one".
 * Locked rows (required/dependency-locked) render disabled and cannot be toggled. All drawing is
 * delegated to the pure `renderPaginatedFrame()` (snapshot-tested headlessly).
 */

export type PaginatedResult = { kind: "answer"; selected: string[] } | { kind: "back" };

export interface PaginatedConfig {
  step: StepModel;
}

/** Explicit annotation so the exported prompt's type is nameable without a transitive `@inquirer/type` reference (TS2742). */
type PromptFn<Value, Config> = (config: Config, context?: unknown) => Promise<Value> & { cancel: () => void };

function isLeftKey(key: KeypressEvent): boolean {
  return key.name === "left";
}
function isRightKey(key: KeypressEvent): boolean {
  return key.name === "right";
}
function isBackKey(key: KeypressEvent): boolean {
  return key.name === "b";
}

const paginatedMultiSelectImpl = createPrompt<PaginatedResult, PaginatedConfig>((config, done) => {
  const step = config.step;
  const pageSize = step.pageSize ?? 10;
  const single = step.single === true;

  const rows = useMemo(() => buildRows(step.choices ?? [], step.sections), [step]);
  const itemRows = useMemo(() => itemRowIndices(rows), [rows]);
  const total = pageCount(rows.length, pageSize);

  const [selected, setSelected] = useState<ReadonlySet<string>>(() => {
    const set = new Set<string>();
    for (const choice of step.choices ?? []) if (choice.checked) set.add(choice.value);
    return set;
  });
  const [page, setPage] = useState(0);
  const [cursorRowIndex, setCursorRowIndex] = useState(() => itemRows[0] ?? -1);

  const itemsOnPage = (p: number): number[] => {
    const start = p * pageSize;
    const end = start + pageSize;
    return itemRows.filter((i) => i >= start && i < end);
  };

  useKeypress((key) => {
    if (isEnterKey(key)) {
      // Single-select: if the user never toggled, confirm with the hovered row.
      if (single && selected.size === 0) {
        const row = rows[cursorRowIndex];
        if (row && row.type === "item" && !row.choice.disabled) {
          done({ kind: "answer", selected: [row.choice.value] });
          return;
        }
      }
      done({ kind: "answer", selected: [...selected] });
      return;
    }
    if (isBackKey(key)) {
      done({ kind: "back" });
      return;
    }
    if (isUpKey(key)) {
      const onPage = itemsOnPage(page);
      const pos = onPage.indexOf(cursorRowIndex);
      if (pos > 0) setCursorRowIndex(onPage[pos - 1]!);
      return;
    }
    if (isDownKey(key)) {
      const onPage = itemsOnPage(page);
      const pos = onPage.indexOf(cursorRowIndex);
      if (pos >= 0 && pos < onPage.length - 1) setCursorRowIndex(onPage[pos + 1]!);
      return;
    }
    if (isLeftKey(key)) {
      if (page > 0) {
        const np = page - 1;
        setPage(np);
        setCursorRowIndex(itemsOnPage(np)[0] ?? -1);
      }
      return;
    }
    if (isRightKey(key)) {
      if (page < total - 1) {
        const np = page + 1;
        setPage(np);
        setCursorRowIndex(itemsOnPage(np)[0] ?? -1);
      }
      return;
    }
    if (isSpaceKey(key)) {
      const row = rows[cursorRowIndex];
      if (row && row.type === "item" && !row.choice.disabled) {
        if (single) {
          // Radio: this row becomes the sole selection (toggling it off if it was already the pick).
          const next = new Set<string>();
          if (!selected.has(row.choice.value)) next.add(row.choice.value);
          setSelected(next);
        } else {
          const next = new Set(selected);
          if (next.has(row.choice.value)) next.delete(row.choice.value);
          else next.add(row.choice.value);
          setSelected(next);
        }
      }
      return;
    }
  });

  return renderPaginatedFrame({
    title: step.title,
    rows,
    pageSize,
    page,
    cursorRowIndex,
    selected,
    colors: true,
    // Live terminal width for the two-pane layout; falls back to 80 inside the renderer when absent.
    columns: process.stdout.columns,
  });
});

export const paginatedMultiSelect = paginatedMultiSelectImpl as unknown as PromptFn<PaginatedResult, PaginatedConfig>;
