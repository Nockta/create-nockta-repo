import { listArchitecturePresets } from "../../architecture/get-architecture-path.js";
import { listScaffolders } from "../../scaffolders/registry.js";
import type { RepoType } from "../../types/repo-type.js";
import { REPO_TYPES, REPO_TYPE_TITLES, REPO_TYPE_DESCRIPTIONS } from "../../types/repo-type.js";
import type { ChoiceModel, StepModel } from "./types.js";

/**
 * The create-wizard-core Model builder (decisions.md D28's MVC boundary; D29 genesis-only). Produces
 * the SAME serializable `StepModel` objects the ported CLI presenter renders. Nothing here prompts or
 * touches a terminal — every function is pure. Selection/enablement logic (what create has of it:
 * "primary is single", "also-types excludes the primary", "package-manager only for some types")
 * lives HERE in the core, never inside the prompt code (D28's headline requirement).
 *
 * Create is genesis-only (D29): NO adapters/skills/razor steps — inject owns those, chosen after the
 * handoff. Repo-type rows carry FRIENDLY titles + descriptions (`REPO_TYPE_TITLES`/
 * `REPO_TYPE_DESCRIPTIONS`, mirrored from inject) for the two-pane detail pane; the raw `RepoType`
 * enum stays in `value` (routing/scaffolder-resolve/the handoff all key off that, unchanged).
 */

/** Mirrors `inject-nockta-skills`' `NocktaSkillsProfile.packageManager` union for vocabulary consistency (record-only in create — spec §5.1 step 4). */
export type PackageManagerChoice = "npm" | "pnpm" | "yarn" | "bun";

const PACKAGE_MANAGER_CHOICES: readonly PackageManagerChoice[] = ["npm", "pnpm", "yarn", "bun"];

/**
 * Repo types whose official scaffolder conventionally asks "which package manager?" during its own
 * run (create-next-app, create-vite, `@nestjs/cli new`) — the Shopify/RN/Expo types use their own
 * tooling where this question doesn't apply. A heuristic (spec §5.1 step 4 says only "if needed"),
 * unchanged from the pre-rebuild wizard.
 */
const REPO_TYPES_ASKING_PACKAGE_MANAGER: readonly RepoType[] = ["next", "vite-react-ts", "nest"];

export function shouldAskPackageManager(repoType: RepoType): boolean {
  return REPO_TYPES_ASKING_PACKAGE_MANAGER.includes(repoType);
}

/** Items per page (finite, no wrap). Every create genesis list fits on one page, so this is generous. */
export const CREATE_PAGE_SIZE = 12;

/** Sentinel value for the "none / --no-arch" architecture choice (maps to `architecture: false`). */
export const NO_ARCHITECTURE_VALUE = "__none__";
/** Sentinel values for the skills-version select step. */
export const SKILLS_VERSION_LATEST = "__latest__";
export const SKILLS_VERSION_CUSTOM = "__custom__";

/** A repo-type choice row (friendly title + description). `checked` reflects a prior/preset selection for back re-entry. */
function repoTypeChoice(type: RepoType, checked: boolean): ChoiceModel {
  const title = REPO_TYPE_TITLES[type];
  return {
    value: type,
    label: title,
    title,
    description: REPO_TYPE_DESCRIPTIONS[type],
    checked,
    disabled: false,
  };
}

/**
 * The PRIMARY repo-type step (D29) — single-select two-pane. Lists every `RepoType` (from the
 * scaffolder registry, so it can never drift from what's really installable) with FRIENDLY titles +
 * descriptions. `selected` reflects a prior answer on back re-entry.
 */
export function buildRepoTypeStep(selected?: RepoType): StepModel {
  // Registry order === REPO_TYPES declaration order; use the registry so a missing scaffolder can't be offered.
  const choices = listScaffolders().map((def) => repoTypeChoice(def.repoType, def.repoType === selected));
  return {
    id: "repo-type",
    kind: "paginated-multiselect",
    single: true,
    title: "Select the project type",
    choices,
    pageSize: CREATE_PAGE_SIZE,
  };
}

/**
 * The SECONDARY skill-domains step (`--also`, D22) — multi-select two-pane over every OTHER
 * `RepoType` besides the chosen primary. Selecting none is a full no-op. `selected` reflects prior
 * answers on back re-entry.
 */
export function buildAlsoTypesStep(primary: RepoType, selected?: readonly RepoType[]): StepModel {
  const chosen = new Set(selected ?? []);
  const choices = REPO_TYPES.filter((t) => t !== primary).map((t) => repoTypeChoice(t, chosen.has(t)));
  return {
    id: "also-types",
    kind: "paginated-multiselect",
    title: "Add any SECONDARY skill domains (optional — the primary scaffolder above is unaffected)",
    choices,
    pageSize: CREATE_PAGE_SIZE,
  };
}

/**
 * The package-manager step (record-only, spec §5.1 step 4) — single-select. Only built when
 * `shouldAskPackageManager()` is true (the Controller skips it otherwise). `selected` reflects a
 * prior answer on back re-entry; defaults to npm.
 */
export function buildPackageManagerStep(selected?: PackageManagerChoice): StepModel {
  const effective = selected ?? "npm";
  const choices: ChoiceModel[] = PACKAGE_MANAGER_CHOICES.map((pm) => ({
    value: pm,
    label: pm,
    checked: pm === effective,
    disabled: false,
  }));
  return {
    id: "package-manager",
    kind: "paginated-multiselect",
    single: true,
    title: "Select a package manager (recorded only — not wired into the scaffolder invocation)",
    choices,
    pageSize: CREATE_PAGE_SIZE,
  };
}

/**
 * The architecture-preset step (spec §5.1 step 5) — single-select. Enumerates the presets really
 * bundled under `packs/<type>/architecture/` (never a hand-written list), always offering a
 * "none / --no-arch" choice. `selected` reflects a prior answer (a preset name, or `false` for
 * --no-arch); defaults to "standard" when present.
 */
export function buildArchitectureStep(repoType: RepoType, selected?: string | false): StepModel {
  const presets = listArchitecturePresets(repoType);
  const defaultPreset = presets.includes("standard") ? "standard" : (presets[0] ?? NO_ARCHITECTURE_VALUE);
  const selectedValue = selected === false ? NO_ARCHITECTURE_VALUE : (selected ?? defaultPreset);
  const choices: ChoiceModel[] = [
    ...presets.map((preset) => ({ value: preset, label: preset, checked: preset === selectedValue, disabled: false })),
    {
      value: NO_ARCHITECTURE_VALUE,
      label: "none — skip the architecture overlay entirely",
      checked: selectedValue === NO_ARCHITECTURE_VALUE,
      disabled: false,
    },
  ];
  return {
    id: "architecture",
    kind: "paginated-multiselect",
    single: true,
    title: "Select an architecture preset",
    choices,
    pageSize: CREATE_PAGE_SIZE,
  };
}

/**
 * The inject-nockta-skills VERSION step (D14, D29) — which inject version create spawns for the
 * handoff. A create concern (kept — brief item B), NOT a skill-selection step. Single-select: latest
 * (default) or custom (follows up with a text input in the presenter). `selected` reflects a prior
 * answer (a version string, or undefined for latest).
 */
export function buildSkillsVersionStep(selected?: string): StepModel {
  const isCustom = selected !== undefined;
  const choices: ChoiceModel[] = [
    {
      value: SKILLS_VERSION_LATEST,
      label: "latest (default) — always the newest published inject-nockta-skills",
      checked: !isCustom,
      disabled: false,
    },
    {
      value: SKILLS_VERSION_CUSTOM,
      label: isCustom ? `custom — currently "${selected}"` : "custom — type a specific version or dist-tag",
      checked: isCustom,
      disabled: false,
    },
  ];
  return {
    id: "skills-version",
    kind: "skills-version",
    single: true,
    title: "Which inject-nockta-skills version should run next?",
    choices,
    pageSize: CREATE_PAGE_SIZE,
  };
}

/** The final confirm step. `preamble` carries the GENESIS plan preview (scaffolder + architecture) + the "skills chosen next in inject" note. */
export function buildConfirmStep(preamble?: string): StepModel {
  const step: StepModel = { id: "confirm", kind: "confirm", title: "Create this project now?", confirmDefault: true };
  if (preamble) step.preamble = preamble;
  return step;
}

/** The project name/path step (validated text-input sub-flow, owned by the presenter). */
export function buildProjectPathStep(): StepModel {
  return { id: "project-path", kind: "project-path", title: "Project name or path" };
}
