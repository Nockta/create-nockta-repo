import pc from "picocolors";
import { detectMonorepoRoot } from "../../core/detect-monorepo-root.js";
import { InvalidTargetDirError } from "../../core/validate-target-dir.js";
import { resolveTargetPath } from "../../core/resolve-target-path.js";
import { SKILLS_VERSION_CUSTOM, SKILLS_VERSION_LATEST } from "../core/build-schema.js";
import type { StepModel } from "../core/types.js";
import { paginatedMultiSelect } from "./paginated-multiselect.js";
import type { Presenter, PresenterResult } from "./presenter.js";
import { BACK } from "./presenter.js";

/**
 * The CLI implementation of the `Presenter` seam (decisions.md D28, D29's genesis-only rebuild),
 * ported from `inject-nockta-skills`' own `cli-presenter.ts`. The Controller never imports this
 * directly — it receives it through the abstract `Presenter`, so a scripted fake (tests) drops in
 * with zero Controller changes.
 *
 * - `paginated-multiselect` -> the ported two-pane master–detail prompt (single- or multi-select).
 * - `project-path` -> a validated text-input sub-flow (monorepo detection narration + a bounded
 *   `resolveTargetPath()` retry loop — the SAME validation `commands/create.ts` re-runs, so a
 *   wizard-collected path can never diverge from what the non-interactive path would accept/reject).
 * - `skills-version` -> a single-select (latest/custom); "custom" follows up with a free-text input.
 * - `confirm` -> a themed Yes / No / ‹ Back select, with the genesis-plan preview as its preamble.
 */

const MAX_PATH_ATTEMPTS = 5;

export interface CliPresenterOptions {
  /** The directory the wizard runs in (real CLI: `process.cwd()`). Used for monorepo detection + path validation. */
  cwd: string;
  /** Narration sink (shared with the wizard's log). */
  log?: (message: string) => void;
}

export function createCliPresenter(options: CliPresenterOptions): Presenter {
  const log = options.log ?? (() => {});
  const cwd = options.cwd;

  return {
    clear() {
      // Clean-view (D28): clear the viewport + scrollback so each step is a fresh screen.
      if (process.stdout.isTTY) process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
    },

    async renderStep(step: StepModel, prefill?: unknown): Promise<PresenterResult> {
      switch (step.kind) {
        case "paginated-multiselect": {
          const result = await paginatedMultiSelect({ step });
          if (result.kind === "back") return BACK;
          return { kind: "answer", value: result.selected };
        }
        case "project-path": {
          return renderProjectPathStep(cwd, log, typeof prefill === "string" ? prefill : undefined);
        }
        case "skills-version": {
          return renderSkillsVersionStep(step);
        }
        case "confirm": {
          if (step.preamble) log(step.preamble);
          const { select } = await import("@inquirer/prompts");
          const answer = (await select({
            message: step.title,
            default: step.confirmDefault ? "yes" : "no",
            choices: [
              { value: "yes", name: pc.green("Yes") },
              { value: "no", name: "No" },
              { value: "back", name: pc.dim("‹ Back") },
            ],
          })) as string;
          if (answer === "back") return BACK;
          return { kind: "answer", value: answer === "yes" };
        }
        default:
          return BACK;
      }
    },

    close() {
      /* no persistent resources to release */
    },
  };
}

/**
 * The project name/path sub-flow. Narrates monorepo detection (step 2 is auto-detected, never a real
 * prompt — there is no `--monorepo-target` flag for a user to answer it with; `resolveTargetPath()`
 * re-derives it regardless), then loops (bounded) on a bad path (already exists, absolute, escapes
 * cwd) rather than failing the whole wizard on the first typo. Resolves with the ACCEPTED path string.
 */
async function renderProjectPathStep(
  cwd: string,
  log: (message: string) => void,
  prior: string | undefined,
): Promise<PresenterResult> {
  const monorepoRoot = detectMonorepoRoot(cwd);
  log(
    monorepoRoot.isMonorepoRoot
      ? `Detected a monorepo root at "${cwd}" (signals: ${monorepoRoot.signals.join(", ")}) — ` +
          "whatever path you give next will be created as a monorepo target."
      : `No monorepo root detected at "${cwd}" — this will be a standalone create.`,
  );

  const { input } = await import("@inquirer/prompts");
  for (let attempt = 0; attempt < MAX_PATH_ATTEMPTS; attempt++) {
    const raw = await input({
      message: monorepoRoot.isMonorepoRoot
        ? 'Target path for the new monorepo target (e.g. "apps/web"):'
        : "Project name or path:",
      default: attempt === 0 ? prior : undefined,
    });
    if (!raw || raw.trim().length === 0) {
      log("A project name/path is required.");
      continue;
    }
    try {
      const validated = resolveTargetPath(raw.trim(), { cwd });
      // The Controller only needs the accepted path STRING (commands/create.ts re-resolves everything).
      return { kind: "answer", value: validated.targetPath };
    } catch (error) {
      if (error instanceof InvalidTargetDirError) {
        log(`${error.message} Try a different path.`);
        continue;
      }
      throw error;
    }
  }
  // Bounded-loop exhausted — treat as a cancel (empty answer the Controller reads as "no path").
  return { kind: "answer", value: "" };
}

/**
 * The inject-version sub-flow (D14). A single-select (latest/custom) via the ported two-pane prompt;
 * "custom" follows up with a free-text input. Resolves with `string | undefined` (undefined = latest,
 * matching `--skills-version` omitted).
 */
async function renderSkillsVersionStep(step: StepModel): Promise<PresenterResult> {
  const pick = await paginatedMultiSelect({ step });
  if (pick.kind === "back") return BACK;
  const chosen = pick.selected[0] ?? SKILLS_VERSION_LATEST;
  if (chosen === SKILLS_VERSION_LATEST) return { kind: "answer", value: undefined };
  if (chosen === SKILLS_VERSION_CUSTOM) {
    const { input } = await import("@inquirer/prompts");
    const custom = await input({
      message: "Enter the inject-nockta-skills version or dist-tag (e.g. 2.4.1, or next):",
    });
    return { kind: "answer", value: custom.trim().length > 0 ? custom.trim() : undefined };
  }
  return { kind: "answer", value: undefined };
}
