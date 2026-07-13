/**
 * Display-availability heuristic for `--web` mode (decisions.md D30).
 *
 * "Is a browser/display available?" is not answerable with certainty from a CLI, so this is a
 * deliberately pragmatic heuristic, documented in `src/web/CONTEXT.md`:
 *   - macOS (`darwin`) and Windows (`win32`): a windowing system is effectively always present, so
 *     we optimistically assume a display and let the browser-open attempt itself be the real test
 *     (a failed open still prints the URL — see `open-browser.ts`).
 *   - Linux / other (unix-y): require an X11 (`DISPLAY`) or Wayland (`WAYLAND_DISPLAY`) session —
 *     the standard signal that a graphical session exists at all. A headless server/CI box has
 *     neither, so `--web` there degrades to CLI/`--yes` instead of opening nothing.
 *
 * The manual `--no-open` path (caller's concern, not this function's) overrides this entirely: it
 * means "serve and print the URL, I'll open it myself", so it is treated as display-available even
 * on a headless box.
 */
export function detectDisplay(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform === "darwin" || platform === "win32") return true;
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
}
