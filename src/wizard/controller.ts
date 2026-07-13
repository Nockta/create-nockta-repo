import type { RepoType } from "../types/repo-type.js";
import {
  NO_ARCHITECTURE_VALUE,
  buildAlsoTypesStep,
  buildArchitectureStep,
  buildConfirmStep,
  buildPackageManagerStep,
  buildProjectPathStep,
  buildRepoTypeStep,
  buildSkillsVersionStep,
  shouldAskPackageManager,
  type PackageManagerChoice,
} from "./core/build-schema.js";
import type { CreateWizardAnswers, StepId } from "./core/types.js";
import type { Presenter } from "./view/presenter.js";

/**
 * The back-aware create Controller (decisions.md D28, D29 genesis-only), ported in spirit from
 * `inject-nockta-skills`' own `controller.ts`. Owns the step index + back-navigation; drives
 * Model <-> View. Depends ONLY on the abstract `Presenter` — never on `@inquirer/*` — so the CLI and
 * a scripted fake (tests) are interchangeable. It never writes files: it produces a plain
 * `CreateWizardAnswers` object the wizard turns into `CreateCommandCliOptions`.
 *
 * Flow (indexed step-loop): the ordered genesis spine lives in an array; the loop holds
 * `{ index, answers }`. Each step renders via the View with current answers as presets; a step
 * returns EITHER an answer (advance to the next non-skipped step) OR a BACK signal (retreat to the
 * previous non-skipped step, PRESERVING already-entered answers so re-entering a prior step shows the
 * prior choice). The package-manager step is skipped when the chosen primary type doesn't ask for one.
 */

export interface CreateControllerContext {
  cwd: string;
  /** Optional genesis-plan preview text for the confirm step's preamble (pure narration; no writes). */
  previewText?: (answers: CreateWizardAnswers) => string;
}

export type CreateControllerResult =
  | { kind: "completed"; answers: CreateWizardAnswers }
  | { kind: "cancelled"; reason: string };

type StepOutcome = { kind: "next" } | { kind: "back" } | { kind: "cancel"; reason: string };

/** The ordered genesis spine (D29). No adapters/skills/razor — inject owns those after the handoff. */
const STEP_IDS: StepId[] = [
  "project-path",
  "repo-type",
  "also-types",
  "package-manager",
  "architecture",
  "skills-version",
  "confirm",
];

export interface RunCreateControllerOptions {
  presenter: Presenter;
  ctx: CreateControllerContext;
  /** Pre-seeded answers from CLI flags (presets) — a preset step is still visited unless empty; presets seed its default. */
  answers: CreateWizardAnswers;
  /** Step ids fully pre-answered by flags and therefore skipped entirely (never prompted, never visited by back). */
  presetSteps: Set<StepId>;
}

export async function runCreateController(options: RunCreateControllerOptions): Promise<CreateControllerResult> {
  const { presenter, ctx } = options;
  const answers: CreateWizardAnswers = { ...options.answers };

  const isSkipped = (id: StepId): boolean => {
    if (options.presetSteps.has(id)) return true;
    if (id === "package-manager") {
      // Only offered for types whose scaffolder conventionally asks (record-only). Unknown primary -> not skipped.
      return answers.repoType ? !shouldAskPackageManager(answers.repoType) : false;
    }
    return false;
  };

  const nextIndex = (from: number): number => {
    for (let i = from; i < STEP_IDS.length; i++) if (!isSkipped(STEP_IDS[i]!)) return i;
    return STEP_IDS.length;
  };
  const prevIndex = (from: number): number => {
    for (let i = from; i >= 0; i--) if (!isSkipped(STEP_IDS[i]!)) return i;
    return -1;
  };

  let index = nextIndex(0);
  while (index < STEP_IDS.length) {
    const id = STEP_IDS[index]!;
    const outcome = await runStep(id, presenter, ctx, answers);
    if (outcome.kind === "cancel") return { kind: "cancelled", reason: outcome.reason };
    if (outcome.kind === "back") {
      const prev = prevIndex(index - 1);
      index = prev < 0 ? index : prev; // at the first step, back is a no-op (re-render).
    } else {
      index = nextIndex(index + 1);
    }
  }

  return { kind: "completed", answers };
}

async function runStep(
  id: StepId,
  presenter: Presenter,
  ctx: CreateControllerContext,
  answers: CreateWizardAnswers,
): Promise<StepOutcome> {
  switch (id) {
    case "project-path": {
      const step = buildProjectPathStep();
      presenter.clear();
      const res = await presenter.renderStep(step, answers.projectPath);
      if (res.kind === "back") return { kind: "back" };
      const pathValue = (res.value as string) ?? "";
      if (pathValue.trim().length === 0) return { kind: "cancel", reason: "no project name/path was given" };
      answers.projectPath = pathValue;
      return { kind: "next" };
    }
    case "repo-type": {
      const step = buildRepoTypeStep(answers.repoType);
      presenter.clear();
      const res = await presenter.renderStep(step);
      if (res.kind === "back") return { kind: "back" };
      const chosen = res.value as string[];
      if (chosen.length === 0) return { kind: "cancel", reason: "no project type was selected" };
      const nextPrimary = chosen[0] as RepoType;
      // Changing the primary invalidates any prior also-types selection that now equals it.
      if (answers.repoType !== nextPrimary && answers.alsoTypes) {
        answers.alsoTypes = answers.alsoTypes.filter((t) => t !== nextPrimary);
      }
      answers.repoType = nextPrimary;
      return { kind: "next" };
    }
    case "also-types": {
      const primary = answers.repoType!;
      const step = buildAlsoTypesStep(primary, answers.alsoTypes);
      presenter.clear();
      const res = await presenter.renderStep(step);
      if (res.kind === "back") return { kind: "back" };
      // Multi-select over non-primary types; keep them in canonical REPO_TYPES order via the step's own ordering.
      answers.alsoTypes = (res.value as string[]).filter((t) => t !== primary) as RepoType[];
      return { kind: "next" };
    }
    case "package-manager": {
      const step = buildPackageManagerStep(answers.packageManager ?? undefined);
      presenter.clear();
      const res = await presenter.renderStep(step);
      if (res.kind === "back") return { kind: "back" };
      const chosen = res.value as string[];
      answers.packageManager = (chosen[0] as PackageManagerChoice) ?? "npm";
      return { kind: "next" };
    }
    case "architecture": {
      const primary = answers.repoType!;
      const step = buildArchitectureStep(primary, answers.architecture);
      presenter.clear();
      const res = await presenter.renderStep(step);
      if (res.kind === "back") return { kind: "back" };
      const chosen = res.value as string[];
      const value = chosen[0];
      answers.architecture = value === undefined || value === NO_ARCHITECTURE_VALUE ? false : value;
      return { kind: "next" };
    }
    case "skills-version": {
      const step = buildSkillsVersionStep(answers.skillsVersion);
      presenter.clear();
      const res = await presenter.renderStep(step);
      if (res.kind === "back") return { kind: "back" };
      answers.skillsVersion = res.value as string | undefined;
      return { kind: "next" };
    }
    case "confirm": {
      const step = buildConfirmStep(ctx.previewText?.(answers));
      if (answers.confirmed !== undefined) step.confirmDefault = answers.confirmed;
      presenter.clear();
      const res = await presenter.renderStep(step);
      if (res.kind === "back") return { kind: "back" };
      answers.confirmed = res.value as boolean;
      return { kind: "next" };
    }
    default:
      return { kind: "next" };
  }
}
