/**
 * Pure precedence resolver for `--web` / `--cli` / `--yes` / TTY / display conflicts (decisions.md
 * D30). No I/O, no process state — every input is passed in, so this is unit-tested directly across
 * all branches (`test/web-precedence.test.ts`).
 *
 * D30's ordering, verbatim: `--web` (if a display is available) > interactive CLI (if a TTY) >
 * `--yes` headless > clean error.
 *
 * The resolver's job is ONLY to choose the top-level route; it deliberately does NOT re-decide
 * wizard-vs-non-interactive within the CLI route — that stays the single existing decision in
 * `commands/install-entry.ts` (`hasSufficientInstallFlags` + TTY). So the three outcomes are:
 *   - `web`   — serve the local page (`runWebInstall`).
 *   - `cli`   — defer to the existing CLI entry, which itself picks the wizard or the
 *               non-interactive/`--yes` path (and emits its own clean flag-validation errors).
 *   - `error` — no display, no TTY, no `--yes`: nothing to do. A clean exit-1, never a hang.
 */
export interface PrecedenceInput {
  /** `--web` given (already AND-ed with `!--cli` by the caller — `--cli` forces this false). */
  web: boolean;
  /** `--yes` given. */
  yes: boolean;
  /** A display is available (real display heuristic OR the manual `--no-open` override). */
  hasDisplay: boolean;
  /** A real interactive terminal is attached. */
  isTTY: boolean;
}

export type PrecedenceMode = "web" | "cli" | "error";

export interface PrecedenceDecision {
  mode: PrecedenceMode;
  /** Plain-language reason, surfaced in narration/errors so the choice is never mysterious. */
  reason: string;
}

export function resolveWebPrecedence(input: PrecedenceInput): PrecedenceDecision {
  const { web, yes, hasDisplay, isTTY } = input;

  if (web) {
    if (hasDisplay) {
      // --web is authoritative even alongside --yes (D30): --yes only pre-seeds the page's
      // defaults in that combo, it does not steal the route.
      return {
        mode: "web",
        reason: yes
          ? "web mode requested and a display is available — serving the page (--yes values pre-seed the form)"
          : "web mode requested and a display is available",
      };
    }
    // --web but no display: degrade, never hang.
    if (yes) {
      return { mode: "cli", reason: "web mode requested but no display is available — falling back to the non-interactive --yes install" };
    }
    if (isTTY) {
      return { mode: "cli", reason: "web mode requested but no display is available — falling back to the interactive terminal wizard" };
    }
    return {
      mode: "error",
      reason:
        "web mode requested but no display is available, and there is no interactive terminal and no --yes to fall back to — nothing to do (pass --no-open to serve and open the URL yourself, or drop --web)",
    };
  }

  // Default / --cli: always the CLI route. The existing entry decides wizard vs non-interactive and
  // emits its own clean errors for the no-TTY/no-flags case, so we never need an `error` here.
  return { mode: "cli", reason: "using the terminal (default; or --cli given)" };
}
