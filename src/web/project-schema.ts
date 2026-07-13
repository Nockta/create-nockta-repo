import {
  buildRepoTypeStep,
  buildAlsoTypesStep,
  buildPackageManagerStep,
  buildArchitectureStep,
  buildSkillsVersionStep,
  buildProjectPathStep,
  NO_ARCHITECTURE_VALUE,
} from "../wizard/core/build-schema.js";
import { listArchitecturePresets } from "../architecture/get-architecture-path.js";
import { REPO_TYPES } from "../types/repo-type.js";
import type { RepoType } from "../types/repo-type.js";
import type { StepModel } from "../wizard/core/types.js";

/**
 * The "Project" section's schema for create's `--web` page (decisions.md D30). This is create's OWN
 * genesis Model — the SAME serializable `StepModel` objects the ported CLI presenter renders (D28/D29
 * genesis-only): project name/path, primary repo type, secondary `--also` types, package manager,
 * architecture preset, and the inject VERSION to spawn. Rendered as the TOP section; inject's fetched
 * schema is the BOTTOM "Skills" section (owner's resolved D30 layout: two sections, Project first).
 *
 * Architecture presets are per-repo-type (`packs/<type>/architecture/`), so a single static list
 * can't cover a page where the primary type is chosen live. `archPresetsByType` embeds every type's
 * real preset list up front; the page rebuilds the architecture choices client-side when the primary
 * type changes — no server round-trip, and it can never offer a preset a type doesn't actually have.
 */
export interface WebProjectSchema {
  /** create's genesis steps (project-path, repo-type, also-types, package-manager, architecture, skills-version). */
  steps: StepModel[];
  /** repoType -> its real bundled architecture preset names (never a hand-written list). */
  archPresetsByType: Record<string, string[]>;
  /** Sentinel for the "none / --no-arch" architecture choice (mirrors build-schema's `NO_ARCHITECTURE_VALUE`). */
  noArchitectureValue: string;
}

export interface BuildWebProjectSchemaOptions {
  /** Pre-seed the primary repo type (from `--type`, `--web` + flags combo). */
  presetType?: RepoType;
  /** Pre-seed the secondary `--also` types. */
  presetAlso?: RepoType[];
  /** Pre-seed the package manager (record-only). */
  presetPackageManager?: "npm" | "pnpm" | "yarn" | "bun";
  /** Pre-seed the architecture preset (a name, or `false` for --no-arch). */
  presetArch?: string | false;
  /** Pre-seed the inject skills-version (a version string; undefined = latest). */
  presetSkillsVersion?: string;
}

export function buildWebProjectSchema(options: BuildWebProjectSchemaOptions = {}): WebProjectSchema {
  const primary = options.presetType;

  // Architecture choices are built for the currently-selected (or first) type; the page swaps them
  // client-side on a type change using `archPresetsByType` below.
  const archAnchorType: RepoType = primary ?? REPO_TYPES[0];

  const steps: StepModel[] = [
    buildProjectPathStep(),
    buildRepoTypeStep(primary),
    buildAlsoTypesStep(primary ?? REPO_TYPES[0], options.presetAlso),
    buildPackageManagerStep(options.presetPackageManager),
    buildArchitectureStep(archAnchorType, options.presetArch),
    buildSkillsVersionStep(options.presetSkillsVersion),
  ];

  const archPresetsByType: Record<string, string[]> = {};
  for (const type of REPO_TYPES) {
    archPresetsByType[type] = listArchitecturePresets(type);
  }

  return { steps, archPresetsByType, noArchitectureValue: NO_ARCHITECTURE_VALUE };
}
