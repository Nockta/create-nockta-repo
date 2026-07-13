import { describe, expect, it } from "vitest";
import {
  buildRows,
  itemRowIndices,
  pageCount,
  renderPaginatedFrame,
} from "../src/wizard/view/paginated-frame.js";
import { stripAnsi, truncateToWidth, visibleWidth, wordWrap } from "../src/wizard/view/width.js";
import { buildRepoTypeStep } from "../src/wizard/core/build-schema.js";
import type { ChoiceModel } from "../src/wizard/core/types.js";

/**
 * The ported VIEW's PURE render layer (decisions.md D28, copied verbatim from inject's own
 * `paginated-frame.ts`/`width.ts`). The live prompt draws every frame through
 * `renderPaginatedFrame()`, so snapshotting the frame string headlessly gives the interactive prompt
 * SOME automated coverage (finite pagination, markers, the two-pane master–detail box, friendly
 * titles + descriptions in the detail pane) despite the real TTY session being un-drivable in CI.
 * Colors OFF for deterministic strings.
 */

function choice(over: Partial<ChoiceModel> & { value: string }): ChoiceModel {
  return { label: over.value, checked: false, disabled: false, ...over };
}

describe("view: ANSI-aware width primitives (ported)", () => {
  it("visibleWidth ignores color escapes and counts wide glyphs as 2", () => {
    expect(visibleWidth("\x1b[32m◉\x1b[39m")).toBe(1);
    expect(visibleWidth("🔒")).toBe(2);
    expect(visibleWidth("◉")).toBe(1);
    expect(visibleWidth("❯")).toBe(1);
  });

  it("stripAnsi removes SGR sequences", () => {
    expect(stripAnsi("\x1b[1m\x1b[36mhi\x1b[39m\x1b[22m")).toBe("hi");
  });

  it("truncateToWidth clamps to cells and appends an ellipsis on overflow", () => {
    expect(truncateToWidth("Next.js", 20)).toBe("Next.js");
    expect(visibleWidth(truncateToWidth("Shopify Headless (Hydrogen)", 10))).toBeLessThanOrEqual(10);
    expect(truncateToWidth("Shopify Headless (Hydrogen)", 10).endsWith("…")).toBe(true);
  });

  it("wordWrap breaks on word boundaries, never past the width", () => {
    const lines = wordWrap("React framework with file-based routing", 12);
    for (const l of lines) expect(visibleWidth(l)).toBeLessThanOrEqual(12);
    expect(lines.join(" ")).toBe("React framework with file-based routing");
  });
});

describe("view: finite pagination + row layout (ported)", () => {
  const choices: ChoiceModel[] = [
    choice({ value: "next", label: "Next.js", title: "Next.js", description: "React framework with file-based routing." }),
    choice({ value: "nest", label: "NestJS", title: "NestJS", description: "NestJS backend framework." }),
    choice({ value: "expo", label: "Expo", title: "Expo", description: "Managed React Native app built with Expo." }),
  ];

  it("buildRows with no sections yields one item row per choice", () => {
    const rows = buildRows(choices, undefined);
    expect(rows.every((r) => r.type === "item")).toBe(true);
    expect(itemRowIndices(rows)).toEqual([0, 1, 2]);
  });

  it("pageCount is finite (ceil), never wraps", () => {
    expect(pageCount(3, 12)).toBe(1);
    expect(pageCount(14, 12)).toBe(2);
    expect(pageCount(0, 12)).toBe(1);
  });
});

describe("view: renderPaginatedFrame two-pane — create repo-type step (friendly titles)", () => {
  // The exact StepModel create's genesis repo-type step renders (single-select).
  const step = buildRepoTypeStep("next");
  const rows = buildRows(step.choices ?? [], step.sections);

  it("shows the friendly TITLE (not the raw enum) in the list, the divider, markers, cursor, and footer", () => {
    const frame = renderPaginatedFrame({
      title: step.title,
      rows,
      pageSize: step.pageSize ?? 12,
      page: 0,
      cursorRowIndex: 0, // "next"
      selected: new Set(["next"]),
      colors: false,
      columns: 100,
    });
    expect(frame).toContain("? Select the project type");
    expect(frame).toContain("Next.js"); // friendly title, not "next"
    expect(frame).toContain("Vite + React + TS");
    expect(frame).toContain("Shopify Headless (Hydrogen)");
    expect(frame).toContain("◉ "); // selected marker (the prior "next")
    expect(frame).toContain("○ "); // an unselected marker
    expect(frame).toContain("❯"); // cursor pointer
    expect(frame).toContain("│"); // two-pane divider
    expect(frame).toContain("space toggle · ←/→ page · ↑/↓ move · b back · ↵ confirm");
    for (const line of frame.split("\n")) expect(visibleWidth(line)).toBeLessThanOrEqual(100);
  });

  it("the right (detail) pane shows the HOVERED type's friendly description", () => {
    const frame = renderPaginatedFrame({
      title: step.title,
      rows,
      pageSize: step.pageSize ?? 12,
      page: 0,
      cursorRowIndex: 0, // next
      selected: new Set(),
      colors: false,
      columns: 100,
    });
    expect(frame).toContain("React framework with file-based routing");
  });

  it("narrow fallback: single column, no divider, still shows names + a detail line, no overflow", () => {
    const frame = renderPaginatedFrame({
      title: step.title,
      rows,
      pageSize: step.pageSize ?? 12,
      page: 0,
      cursorRowIndex: 2, // nest
      selected: new Set(),
      colors: false,
      columns: 60,
    });
    expect(frame).not.toContain("│");
    expect(frame).toContain("NestJS");
    for (const line of frame.split("\n")) expect(visibleWidth(line)).toBeLessThanOrEqual(60);
  });
});
