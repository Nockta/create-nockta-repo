import pc from "picocolors";

/**
 * picocolors theming for the CLI View (decisions.md D28). Centralized so the paginated prompt and
 * the themed simple prompts share ONE palette, and so the pure frame renderer can turn color OFF
 * for deterministic snapshot tests (`colors: false`) while the live prompt turns it on.
 *
 * Palette (D28): selected marker green, cursor row cyan+bold, disabled dim, section headers bold,
 * page indicator + key-hints footer dim.
 */
export interface ThemeFns {
  selected(s: string): string;
  cursor(s: string): string;
  header(s: string): string;
  dim(s: string): string;
  bold(s: string): string;
}

const identity = (s: string): string => s;

export const colorTheme: ThemeFns = {
  selected: (s) => pc.green(s),
  cursor: (s) => pc.cyan(pc.bold(s)),
  header: (s) => pc.bold(s),
  dim: (s) => pc.dim(s),
  bold: (s) => pc.bold(s),
};

export const plainTheme: ThemeFns = {
  selected: identity,
  cursor: identity,
  header: identity,
  dim: identity,
  bold: identity,
};

export function theme(colors: boolean): ThemeFns {
  return colors ? colorTheme : plainTheme;
}

/** Markers (D28): filled = selected, hollow = not; a locked row carries a padlock. */
export const MARK_SELECTED = "◉";
export const MARK_UNSELECTED = "○";
export const CURSOR_POINTER = "❯";
export const LOCK_ICON = "🔒";

/** The one-line key-hints footer shared by the paginated prompt (D28's approved shape). */
export const KEY_HINTS = "space toggle · ←/→ page · ↑/↓ move · b back · ↵ confirm";
