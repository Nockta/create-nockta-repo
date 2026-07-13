import pc from "picocolors";
import { EXIT_CODE, emitError, resolveCreatePlan, runCreateCommand } from "../commands/create.js";
import type { CreateCommandCliOptions, CreatePlan } from "../commands/create.js";
import { isRepoType, type RepoType } from "../types/repo-type.js";
import { runCreateController } from "./controller.js";
import type { CreateControllerContext } from "./controller.js";
import type { CreateWizardAnswers, StepId } from "./core/types.js";
import { createCliPresenter } from "./view/cli-presenter.js";
import type { Presenter } from "./view/presenter.js";

/**
 * The interactive create wizard — REBUILT to `inject-nockta-skills`' Model–View–Controller shape
 * (decisions.md D28) and made GENESIS-ONLY (D29). It no longer prompts for adapters or skills:
 * inject owns those now, chosen in inject's OWN wizard after the create->inject handoff.
 *
 * Architecture (mirrors inject's `src/wizard/*`, copied not imported — D7 duplicate-the-contract):
 *  - Model:      `core/build-schema.ts` — pure `StepModel` builders (friendly repo-type titles);
 *                `core/types.ts` — the serializable step/answer vocabulary.
 *  - Controller: `controller.ts` — the back-aware indexed step loop (clean-view between steps,
 *                back-nav preserving state).
 *  - View:       `view/*` — the ported two-pane paginated master–detail prompt + width/theme +
 *                `Presenter` seam + CLI presenter.
 *
 * Genesis steps (D29): project name/path -> primary repo type -> secondary (also) types ->
 * package manager (record-only, only for types that ask) -> architecture -> inject version ->
 * confirm (genesis plan preview). Step 11 (actually creating) is still the SAME
 * `commands/create.ts::runCreateCommand()` the non-interactive path uses — and, because the wizard
 * calls it WITHOUT `--yes`, that command takes D29's INTERACTIVE handoff branch (inject's wizard,
 * inherited stdio, type pre-filled). There is no second write path.
 */
export interface CreateWizardOptions {
  /** Presets from CLI flags given alongside an insufficient invocation — each pre-answers + skips its step. */
  presetProjectPath?: string;
  presetType?: string;
  presetAlso?: string;
  presetArch?: string | false;
  /** Retained for CLI-surface symmetry; create's wizard is genesis-only, so adapters are NOT a wizard step (inject asks). Unused here. */
  presetAdapters?: string;
  presetSkillsVersion?: string;
  presetPassthroughArgs?: string[];
  json?: boolean;
  /** Test-injection only — replaces the CLI presenter (the View) with a scripted fake. */
  presenter?: Presenter;
  /** Test-injection only — narration sink; defaults to `console.log` (human mode) / no-op (`--json`). */
  log?: (message: string) => void;
  /** Test-injection only — defaults to `process.cwd()`. */
  cwd?: string;
}

export type WizardFlowResult =
  | { kind: "would-create"; projectNameOrPath: string; cliOptions: CreateCommandCliOptions }
  | { kind: "cancelled"; reason: string }
  | { kind: "invalid-plan"; error: { code: string; message: string; details: Record<string, unknown> }; exitCode: number };

/** Parse a preset `--also` value into valid, non-primary, deduped types (silent — commands/create.ts re-validates + warns). */
function parsePresetAlso(raw: string | undefined, primary: RepoType | undefined): RepoType[] | undefined {
  if (raw === undefined) return undefined;
  const list = raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (!list.every((t) => isRepoType(t))) return undefined; // invalid -> fall through to prompting
  return [...new Set(list as RepoType[])].filter((t) => t !== primary);
}

/** Assemble the `CreateCommandCliOptions` from the completed genesis answers. NO adapters/yes (D29 interactive handoff). */
function toCliOptions(answers: CreateWizardAnswers, options: CreateWizardOptions, cwd: string): CreateCommandCliOptions {
  return {
    type: answers.repoType,
    also: answers.alsoTypes && answers.alsoTypes.length > 0 ? answers.alsoTypes.join(",") : undefined,
    arch: answers.architecture,
    skillsVersion: answers.skillsVersion,
    passthroughArgs: options.presetPassthroughArgs ?? [],
    json: options.json,
    cwd,
  };
}

/** Genesis-plan preview shown above the confirm step (D29): scaffolder + architecture + the "skills chosen next in inject" note. */
function formatGenesisPreview(plan: CreatePlan): string {
  const lines: string[] = [];
  lines.push(pc.bold("Genesis plan:"));
  lines.push(`  Upstream:      ${plan.officialScaffolder.command} ${plan.officialScaffolder.args.join(" ")}`);
  lines.push(`  Target:        ${plan.targetPath} (${plan.monorepo.isMonorepoTarget ? "monorepo target" : "standalone"})`);
  if (plan.alsoTypes.length > 0) lines.push(`  Skill domains: ${[plan.repoType, ...plan.alsoTypes].join(", ")}`);
  lines.push(
    plan.architecturePlan.enabled
      ? `  Architecture:  preset "${plan.architecturePlan.preset}" ` +
          `(${plan.architecturePlan.manifest.directories.length} dir(s), ` +
          `${plan.architecturePlan.manifest.files.length} file(s), ${plan.architecturePlan.manifest.moves.length} move(s))`
      : "  Architecture:  none (--no-arch)",
  );
  lines.push("");
  lines.push(
    pc.dim(
      "Adapters, skills, and Razor doctrine are chosen next, in inject-nockta-skills' own wizard " +
        "(it opens right after this project is scaffolded, with the project type already filled in).",
    ),
  );
  return lines.join("\n");
}

/**
 * Pure-ish orchestrator — drives the Controller with a Presenter, returns a decision. Never touches
 * `process.exit`/`process.exitCode`. Tests drive it directly with a scripted `presenter` against a
 * real `mkdtemp` `cwd`.
 */
export async function runWizardFlow(options: CreateWizardOptions = {}): Promise<WizardFlowResult> {
  const cwd = options.cwd ?? process.cwd();
  const log = options.log ?? (options.json ? () => {} : (message: string) => console.log(message));

  // Seed answers + preset-skip set from any flags already given.
  const seed: CreateWizardAnswers = {};
  const presetSteps = new Set<StepId>();
  if (options.presetProjectPath) {
    seed.projectPath = options.presetProjectPath;
    presetSteps.add("project-path");
  }
  if (options.presetType && isRepoType(options.presetType)) {
    seed.repoType = options.presetType;
    presetSteps.add("repo-type");
  }
  const presetAlso = parsePresetAlso(options.presetAlso, seed.repoType);
  if (presetAlso !== undefined) {
    seed.alsoTypes = presetAlso;
    presetSteps.add("also-types");
  }
  if (options.presetArch !== undefined) {
    seed.architecture = options.presetArch;
    presetSteps.add("architecture");
  }
  if (options.presetSkillsVersion) {
    seed.skillsVersion = options.presetSkillsVersion;
    presetSteps.add("skills-version");
  }

  // Confirm-step preview: resolve create's own plan (dry-run, side-effect free) and format the
  // GENESIS half only (D29 — the final skill list is NOT previewed; the user picks it in inject).
  const previewText = (answers: CreateWizardAnswers): string => {
    if (!answers.projectPath || !answers.repoType) return "";
    const resolved = resolveCreatePlan(answers.projectPath, {
      type: answers.repoType,
      also: answers.alsoTypes && answers.alsoTypes.length > 0 ? answers.alsoTypes.join(",") : undefined,
      arch: answers.architecture,
      skillsVersion: answers.skillsVersion,
      dryRun: true,
      cwd,
    });
    return resolved.ok ? formatGenesisPreview(resolved.plan) : "";
  };

  const ctx: CreateControllerContext = { cwd, previewText };
  const presenter = options.presenter ?? createCliPresenter({ cwd, log });

  let controllerResult;
  try {
    controllerResult = await runCreateController({ presenter, ctx, answers: seed, presetSteps });
  } finally {
    presenter.close();
  }

  if (controllerResult.kind === "cancelled") {
    return { kind: "cancelled", reason: controllerResult.reason };
  }
  const answers = controllerResult.answers;
  if (!answers.confirmed) {
    return { kind: "cancelled", reason: "user declined the confirmation prompt — nothing was created" };
  }
  if (!answers.projectPath || !answers.repoType) {
    return { kind: "cancelled", reason: "incomplete answers — no project path or type" };
  }

  const cliOptions = toCliOptions(answers, options, cwd);
  // Validate the plan the same way the non-interactive path does (side-effect free). An invalid plan
  // (e.g. an --also / --arch problem) surfaces as invalid-plan rather than reaching runCreateCommand.
  const resolved = resolveCreatePlan(answers.projectPath, { ...cliOptions, dryRun: true });
  if (!resolved.ok) {
    return { kind: "invalid-plan", error: resolved.error, exitCode: resolved.exitCode };
  }

  return { kind: "would-create", projectNameOrPath: answers.projectPath, cliOptions };
}

/**
 * Impure wrapper — runs `runWizardFlow()`, then either hands off to
 * `commands/create.ts::runCreateCommand()` for step 11 (REUSED — and, called WITHOUT `--yes`, it
 * takes D29's interactive inject handoff), or prints/emits the cancellation/plan-error and sets
 * `process.exitCode`.
 */
export async function runCreateWizard(options: CreateWizardOptions = {}): Promise<void> {
  const result = await runWizardFlow(options);

  if (result.kind === "would-create") {
    await runCreateCommand(result.projectNameOrPath, result.cliOptions);
    return;
  }

  if (result.kind === "cancelled") {
    if (options.json) {
      console.log(JSON.stringify({ ok: false, status: "cancelled", reason: result.reason }));
    } else {
      console.log(pc.dim(result.reason));
    }
    process.exitCode = EXIT_CODE.INVALID_TARGET;
    return;
  }

  emitError({ json: options.json }, result.error);
  process.exitCode = result.exitCode;
}
