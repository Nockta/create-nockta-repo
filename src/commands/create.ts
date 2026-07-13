import { existsSync } from "node:fs";
import path from "node:path";
import pc from "picocolors";
import {
  ArchitectureApplyError,
  applyArchitectureManifest,
  type ArchitectureChanges,
} from "../architecture/apply-architecture-manifest.js";
import {
  ArchitectureManifestError,
  readArchitectureManifestForPreset,
  readArchitectureManifestFromDir,
  type ReadArchitectureManifestForPresetResult,
} from "../architecture/read-architecture-manifest.js";
import { InvalidTargetDirError } from "../core/validate-target-dir.js";
import { resolveTargetPath } from "../core/resolve-target-path.js";
import { UpstreamFailure, runUpstream, type UpstreamResult } from "../core/run-upstream.js";
import {
  InjectSkillsFailure,
  buildInjectSkillsCommand,
  readInjectedSkillsVersion,
  runInjectSkills,
  runInjectSkillsInteractive,
  type InjectSkillsMode,
  type InjectSkippedPack,
} from "../core/run-inject-skills.js";
import { readRunningPackageVersion } from "../core/read-package-version.js";
import { WriteRepoProfileError, writeRepoProfile } from "../core/write-repo-profile.js";
import { UnknownRepoTypeError, resolveScaffolder } from "../scaffolders/registry.js";
import { upstreamOptionDefaults } from "../scaffolders/upstream-options.js";
import type { StdioOptions } from "node:child_process";
import { ADAPTER_TYPES, type AdapterType } from "../types/adapter.js";
import type { ArchitectureManifest } from "../types/architecture.js";
import type { CreateNocktaRepoResult } from "../types/create-result.js";
import type { NocktaRepoProfile } from "../types/profile.js";
import { REPO_TYPES, isRepoType, type RepoType } from "../types/repo-type.js";
import type { ScaffolderCommand } from "../types/scaffold.js";
import { runCreateWizard } from "../wizard/run-create-wizard.js";

/** CLI-facing flags for the `create` path before they're normalized. */
export type CreateCommandCliOptions = {
  type?: string;
  /**
   * Raw `--also <type>[,<type>...]` flag value (decisions.md D22, spec §5.2)
   * — secondary skill-domain repo types forwarded, as a union with `type`
   * (the primary), to `inject-nockta-skills`'s multi-type install. Never a
   * second scaffolder or a second architecture overlay (D22: primary-type
   * only). Parsed/validated by `parseAlsoTypes()` below.
   */
  also?: string;
  /** `string` (explicit preset), `false` (--no-arch), or `undefined` (default preset). */
  arch?: string | false;
  adapters?: string;
  skillsVersion?: string;
  /**
   * D30 web-flow only: skill DELTAS collected in the browser page, forwarded to inject's
   * `--include-skills`/`--exclude-skills` on the headless install (decisions.md D19). Never set by
   * the CLI flag paths (there inject applies its own tier defaults, or the D29 interactive handoff
   * collects skills in inject's own wizard). Consumed ONLY in the headless (`--yes`) inject branch.
   */
  includeSkills?: readonly string[];
  excludeSkills?: readonly string[];
  /**
   * D36 web-flow (and `--yes` parity): the surfaced upstream-scaffolder option
   * answers (keyed by each `UpstreamOption.key`), forwarded to the type's
   * `buildCommand`. The web submit passes the page's full answers; a plain CLI
   * `--yes` run with none set falls back to the schema defaults (single source,
   * so CLI and web can't drift). The wizard/interactive path leaves this
   * undefined — upstream stays interactive there by design.
   */
  upstreamOptions?: Record<string, unknown>;
  /**
   * D36 / PART A: set only by the web submit path — spawn the upstream
   * scaffolder with stdin detached (`["ignore", "inherit", "inherit"]`) so a
   * browser-driven run never depends on the launching terminal. See
   * `upstreamStdio()`.
   */
  nonInteractiveUpstream?: boolean;
  /** `false` when `--no-skills` was passed (spec §5.6); `undefined`/`true` otherwise. */
  skills?: boolean;
  passthroughArgs?: string[];
  dryRun?: boolean;
  yes?: boolean;
  force?: boolean;
  json?: boolean;
  /**
   * Test-injection only (Milestone 7) — defaults to `process.cwd()`. Every
   * real CLI invocation (non-interactive or wizard-driven) always uses the
   * real `process.cwd()`; this exists so `wizard/run-create-wizard.ts`'s own
   * in-process, scripted-`WizardPrompts` tests (`test/wizard-flow.test.ts`,
   * mirroring `inject-nockta-skills`' identical `targetDir` test-injection
   * convention on its `WizardOptions`) can resolve against a real `mkdtemp`
   * directory without a global `process.chdir()`. Threaded through both
   * `resolveCreatePlan()`'s target-path/monorepo-root resolution and
   * `runCreateCommand()`'s real upstream-scaffolder spawn, so a wizard's
   * PREVIEW step (dry run against this `cwd`) and its final real execution
   * (also against this `cwd`) always agree.
   */
  cwd?: string;
};

/**
 * Documented exit codes (spec §5.9). Milestone 6 added `SKILLS_FAILURE` (4).
 * Milestone 7 adds `PROFILE_FAILURE` (5) — spec §5.9's table stops at 4; this
 * package is not the first time that's happened (`SKILLS_FAILURE` itself was
 * a Milestone 6 addition, not present in the spec text either at the time
 * §5.9 was written). Same reasoning applied again here: a created project
 * without its `.nockta/repo-profile.json` is incomplete (this milestone's own
 * brief), and every other step that can fail after upstream succeeds already
 * gets its own dedicated code (3 for the overlay, 4 for skills) rather than
 * being folded into a generic catch-all — a profile-write failure earns the
 * same treatment for consistency, and so callers can distinguish it from
 * every other failure mode. Flagged explicitly as an extension beyond the
 * spec's literal table, not a spec-stated mapping.
 *
 * Spec §5.9's table has no dedicated code for "unknown --type" — it isn't a
 * scaffolder failure (nothing ran) and isn't literally a target-directory
 * problem, but exit code 2 ("invalid target") is the closest fit in the
 * documented table ("nothing ran, your input was invalid") and is what this
 * module uses for it, and — by the same reasoning — for an unknown `--arch`
 * preset, an invalid `--adapters` value, and (Milestone 7) insufficient flags
 * on a non-TTY wizard-eligible invocation (`commands/create-entry.ts`) too
 * (all are bad/missing input, not a broken overlay or a failed injection).
 * Flagged as an assumption, not a spec-stated mapping.
 */
export const EXIT_CODE = {
  SUCCESS: 0,
  UPSTREAM_FAILURE: 1,
  INVALID_TARGET: 2,
  ARCHITECTURE_FAILURE: 3,
  SKILLS_FAILURE: 4,
  PROFILE_FAILURE: 5,
} as const;

/**
 * Milestone-3-only escape hatch for integration tests. When set, the create
 * flow spawns `node <this file> <targetPath> [...passthroughArgs]` instead
 * of the real registry-resolved upstream command, for whichever `--type`
 * was requested. This is how `test/create-command.integration.test.ts`
 * exercises the *real* built CLI end to end — argv parsing, resolveArgv,
 * registry resolution, target validation, the runner, exit codes — against
 * the fixture scaffolders (spec §16.2) without ever touching the network or
 * a real framework CLI (a hard constraint on this milestone's build). Not
 * part of the public CLI surface; not documented in README/help text; not
 * read anywhere else in this package.
 */
const FIXTURE_OVERRIDE_ENV_VAR = "CREATE_NOCKTA_REPO_TEST_FIXTURE_BIN";

/**
 * Milestone-4-only escape hatch, same idea as {@link FIXTURE_OVERRIDE_ENV_VAR}
 * above: when set, the architecture step reads its manifest directly from
 * this directory instead of resolving `packs/<repoType>/architecture/<preset>/`.
 * This is how integration tests exercise apply-time overlay failure (a
 * non-optional `moves[]` entry whose source a fixture scaffolder never
 * creates) without adding a test-only preset to the real, published `packs/`
 * content. Not part of the public CLI surface.
 */
const ARCH_FIXTURE_OVERRIDE_ENV_VAR = "CREATE_NOCKTA_REPO_TEST_ARCH_DIR";

function resolveOfficialScaffolderCommand(
  repoType: string,
  targetPath: string,
  passthroughArgs: string[],
  upstreamAnswers?: Record<string, unknown>,
): ScaffolderCommand {
  const fixtureOverride = process.env[FIXTURE_OVERRIDE_ENV_VAR];
  if (fixtureOverride) {
    // The fixture override is a bare argv-recording stand-in — it doesn't
    // understand real upstream flags, so surfaced option args (D36) are NOT
    // injected here (they'd be meaningless to the fixture). Real option-args
    // composition is proved directly against each type's buildCommand and via
    // a real-registry dry run.
    return {
      name: `${repoType} (test fixture override)`,
      command: process.execPath,
      args: [fixtureOverride, targetPath, ...passthroughArgs],
    };
  }
  return resolveScaffolder(repoType).buildCommand(targetPath, passthroughArgs, upstreamAnswers);
}

/**
 * PART A (D36): the stdio the upstream scaffolder is spawned with. The web
 * submit path (`nonInteractiveUpstream`) detaches stdin
 * (`["ignore", "inherit", "inherit"]`) so a browser-driven run can never
 * depend on — or hang on — the launching terminal's stdin, while normal
 * output still relays to the terminal as the run log. Every other path keeps
 * the uniform `"inherit"` (spec §18.5) — the CLI `--yes` path's
 * non-interactivity is already handled by `runUpstream`'s `forceCI`, and the
 * wizard path is genuinely interactive. Pure/observable so the decision is
 * unit-tested rather than the spawn intercepted.
 */
export function upstreamStdio(cliOptions: Pick<CreateCommandCliOptions, "nonInteractiveUpstream">): StdioOptions {
  return cliOptions.nonInteractiveUpstream === true ? ["ignore", "inherit", "inherit"] : "inherit";
}

function readArchitecturePreset(repoType: string, preset: string): ReadArchitectureManifestForPresetResult {
  const override = process.env[ARCH_FIXTURE_OVERRIDE_ENV_VAR];
  if (override) {
    return { manifest: readArchitectureManifestFromDir(override), manifestDir: override };
  }
  return readArchitectureManifestForPreset(repoType, preset);
}

/**
 * Monorepo-target classification carried on the plan (spec §6, §19
 * Milestone 5) — `commands/create.ts`'s own presentation shape over
 * `resolveTargetPath()`'s result, not a re-export of it, so the plan stays a
 * plain JSON-serializable object independent of `core/resolve-target-path.ts`'s
 * own type surface.
 */
type MonorepoPlanInfo = {
  isMonorepoTarget: boolean;
  isMonorepoRoot: boolean;
  signals: string[];
  isNestedPath: boolean;
  infoLine: string | null;
};

/**
 * `metadata` step — REAL as of Milestone 7 (spec §9, §12.1 step 11/§12.2 step
 * 6). What used to be an honest "skipped (milestone 7)" stub is now the
 * actual repo-profile plan: the resolved write path plus a preview of every
 * field knowable before the create flow actually runs (spec §5.7's own "print
 * the plan" requirement extended to cover the profile, per this milestone's
 * brief item 2). `preview.skillsInjected`/`preview.adapters` reflect the PLAN
 * (whether skills injection is enabled at all), not a real outcome — the real
 * outcome is only known after the skills step actually runs; see
 * `buildRepoProfile()` below for how the real, written profile can differ
 * (e.g. `skillsInjected: false` if the real skills step ends up failing —
 * though that outcome never reaches profile-writing at all, spec §13's
 * "no post-processing continues past a failed step").
 */
type ProfilePreview = Omit<NocktaRepoProfile, "version" | "createdAt" | "skillsVersion">;

type ProfilePlan = {
  /** Absolute path this run WOULD write to (dry run) or DID write to (real run) — spec §9.1, decisions.md D5: `<target>/.nockta/repo-profile.json`, the target's own root, never a monorepo root. */
  path: string;
  preview: ProfilePreview;
};

function buildProfilePlan(params: {
  resolvedTargetPath: string;
  repoType: string;
  /** D22 union (primary first) — see `CreatePlan.repoTypes`'s own header comment. */
  repoTypes: string[];
  targetPath: string;
  officialScaffolder: ScaffolderCommand;
  architecturePlan: ArchitecturePlan;
  monorepo: MonorepoPlanInfo;
  skills: SkillsPlan;
}): ProfilePlan {
  return {
    path: path.join(params.resolvedTargetPath, ".nockta", "repo-profile.json"),
    preview: {
      tool: "create-nockta-repo",
      repoTypes: params.repoTypes as RepoType[],
      architecture: params.architecturePlan.enabled ? params.architecturePlan.preset : null,
      projectPath: params.targetPath,
      isMonorepoTarget: params.monorepo.isMonorepoTarget,
      officialScaffolder: params.officialScaffolder,
      skillsInjected: params.skills.enabled,
      adapters: params.skills.enabled ? params.skills.adapters : undefined,
    },
  };
}

/** What actually happened when the profile-write step ran for real (spec §12.1 step 11/§12.2 step 6). */
type ProfileOutcome = { path: string; profile: NocktaRepoProfile };

/** Thrown-but-caught detail carried on a `"profile-failed"` outcome (spec §5.9, new `PROFILE_FAILURE` code). */
type ProfileFailureDetail = { path: string; message: string };

/**
 * Assembles the real `NocktaRepoProfile` to write (spec §9.2) once the
 * skills step has resolved (injected, skipped via `--no-skills`, or —
 * unreachable here, since a real failure already returned earlier —
 * failed). `skillsVersion`/`adapters` are populated only when skills
 * actually ran (`kind: "injected"`) — an `undefined` `adapters` when skills
 * were never invoked is more honest than echoing back a `--adapters` value
 * that was never actually used for anything (a deliberate reading of the
 * spec §9.2 type's `adapters?` optionality, flagged as a judgment call, not
 * a spec-stated rule).
 */
function buildRepoProfile(params: {
  plan: CreatePlan;
  officialScaffolder: ScaffolderCommand;
  architecturePlan: ArchitecturePlan;
  skillsOutcome: SkillsOutcome;
  packageVersion: string;
}): NocktaRepoProfile {
  const injected = params.skillsOutcome.kind === "injected" ? params.skillsOutcome : null;
  return {
    tool: "create-nockta-repo",
    version: params.packageVersion,
    // D22: primary type first, then any --also secondary types (CreatePlan.repoTypes's own header comment).
    repoTypes: params.plan.repoTypes as RepoType[],
    architecture: params.architecturePlan.enabled ? params.architecturePlan.preset : null,
    projectPath: params.plan.targetPath,
    isMonorepoTarget: params.plan.monorepo.isMonorepoTarget,
    officialScaffolder: params.officialScaffolder,
    skillsInjected: injected !== null,
    skillsVersion: injected?.skillsVersion ?? undefined,
    adapters: injected?.adapters,
    createdAt: new Date().toISOString(),
  };
}

/**
 * What the skills step *would* do, resolved up front (spec §12.1 step 10 /
 * §12.2 step 4, §19 Milestone 6) — same "resolve first, run later" split
 * `architecturePlan`/`ArchitecturePlan` already use. `enabled: false` covers
 * `--no-skills` (spec §5.6). The enabled case carries the exact, already-built
 * `inject-nockta-skills` command (`core/run-inject-skills.ts`'s pure
 * `buildInjectSkillsCommand()`) so dry-run can print precisely what would
 * spawn (this milestone's brief item 3) without ever spawning it.
 */
type SkillsPlan =
  | { enabled: false; reason: string }
  | {
      enabled: true;
      mode: InjectSkillsMode;
      /** D22 union forwarded to inject (primary first, then any --also types) — what `commandLine`'s `--type`/`--target ...:` actually encodes. */
      repoTypes: string[];
      adapters: AdapterType[];
      skillsVersion?: string;
      command: string;
      args: string[];
      cwd: string;
      commandLine: string;
    };

function buildSkillsPlan(params: {
  enabled: boolean;
  repoType: string;
  /** D22 union (primary first) — see `CreatePlan.repoTypes`'s own header comment. Falls back to `[repoType]` when empty/omitted. */
  repoTypes?: string[];
  adapters: AdapterType[];
  skillsVersion?: string;
  mode: InjectSkillsMode;
  cwd: string;
  targetPath?: string;
}): SkillsPlan {
  if (!params.enabled) {
    return { enabled: false, reason: "--no-skills flag: inject-nockta-skills invocation skipped." };
  }
  const repoTypes = params.repoTypes && params.repoTypes.length > 0 ? params.repoTypes : [params.repoType];
  const built = buildInjectSkillsCommand({
    mode: params.mode,
    repoType: params.repoType,
    repoTypes,
    adapters: params.adapters,
    skillsVersion: params.skillsVersion,
    cwd: params.cwd,
    targetPath: params.targetPath,
  });
  return {
    enabled: true,
    mode: params.mode,
    repoTypes,
    adapters: params.adapters,
    skillsVersion: params.skillsVersion,
    command: built.command,
    args: built.args,
    cwd: built.cwd,
    commandLine: built.commandLine,
  };
}

/** What actually happened when the skills step ran for real (spec §12.1 step 10). */
type SkillsOutcome =
  | { kind: "skipped"; reason: string }
  | {
      kind: "injected";
      mode: InjectSkillsMode;
      adapters: AdapterType[];
      skillsVersion: string | null;
      isMonorepo: boolean;
      installedPacks: string[];
      skippedPacks: InjectSkippedPack[];
      renderedFileCount: number;
      profilePath: string | null;
      manifestPath: string | null;
      targetsPath: string | null;
      warnings: string[];
      summary: string;
      exitCode: number;
      durationMs: number;
    }
  | {
      kind: "failed";
      mode: InjectSkillsMode;
      adapters: AdapterType[];
      exitCode: number | null;
      reason: string;
      message: string;
      stderrTail: string;
    };

/**
 * What the architecture step *would* do, resolved up front (spec §12.1 step
 * 3 "Resolve architecture preset" — well before step 9 "Apply architecture
 * overlay"). Reading happens here; applying does not. `enabled: false`
 * covers `--no-arch` (spec §5.5).
 */
type ArchitecturePlan =
  | { enabled: false; reason: string }
  | { enabled: true; preset: string; manifestDir: string; manifest: ArchitectureManifest };

/** What actually happened when the overlay was applied for real (spec §12.1 step 9). */
type ArchitectureResult =
  | { status: "applied"; preset: string; changes: ArchitectureChanges }
  | { status: "failed"; preset: string; code: string; message: string; changes: ArchitectureChanges };

const EMPTY_ARCHITECTURE_CHANGES: ArchitectureChanges = { created: [], updated: [], moved: [], skipped: [] };

/**
 * Milestone 7 create-plan/result shape — spec §11.4 `CreateNocktaRepoResult`
 * is now fully assemblable from a completed run (see
 * `buildCreateNocktaRepoResult()` below); this internal `CreatePlan` stays a
 * richer, outcome-agnostic planning shape (dry-run vs. real, per-status
 * detail) rather than becoming that literal type itself. `metadata` now
 * carries the REAL repo-profile plan (path + field preview), not a
 * Milestone-7-not-implemented stub.
 */
export type CreatePlan = {
  dryRun: boolean;
  projectNameOrPath: string;
  /** The PRIMARY repo type (from `--type`) — the sole genesis-scaffolder/architecture-overlay owner (decisions.md D22). */
  repoType: string;
  /** `--also <type>[,<type>...]` secondary skill-domain types, validated and deduped against the primary (decisions.md D22) — never includes `repoType` itself. */
  alsoTypes: string[];
  /** The full union forwarded to inject-nockta-skills: `[repoType, ...alsoTypes]`, primary first (decisions.md D22). A `--also`-free create is still a one-element array. */
  repoTypes: string[];
  /** Non-fatal notices from resolving this plan's inputs (currently: `--also` dedup-with-primary/dedup-within-itself — decisions.md D22, "warn, don't error"). Surfaced in both human dry-run/create output and the `--json` envelope's `warnings`, independent of the skills step's own warnings. */
  inputWarnings: string[];
  targetPath: string;
  resolvedTargetPath: string;
  passthroughArgs: string[];
  officialScaffolder: ScaffolderCommand;
  architecturePlan: ArchitecturePlan;
  monorepo: MonorepoPlanInfo;
  skills: SkillsPlan;
  metadata: ProfilePlan;
};

type CreateOutcome =
  | { kind: "dry-run"; plan: CreatePlan }
  | {
      kind: "created";
      plan: CreatePlan;
      upstream: UpstreamResult;
      architecture: ArchitectureResult | null;
      skills: SkillsOutcome;
      profile: ProfileOutcome;
    }
  | { kind: "upstream-failed"; plan: CreatePlan; upstream: UpstreamResult; error: UpstreamFailure }
  | {
      kind: "overlay-failed";
      plan: CreatePlan;
      upstream: UpstreamResult;
      architecture: Extract<ArchitectureResult, { status: "failed" }>;
    }
  | {
      kind: "skills-failed";
      plan: CreatePlan;
      upstream: UpstreamResult;
      architecture: ArchitectureResult | null;
      skills: Extract<SkillsOutcome, { kind: "failed" }>;
    }
  | {
      kind: "profile-failed";
      plan: CreatePlan;
      upstream: UpstreamResult;
      architecture: ArchitectureResult | null;
      skills: SkillsOutcome;
      profileError: ProfileFailureDetail;
    };

function buildPlan(params: {
  dryRun: boolean;
  projectNameOrPath: string;
  repoType: string;
  /** D22: validated/deduped `--also` types (never includes `repoType`). Defaults to `[]`. */
  alsoTypes?: string[];
  /** D22: non-fatal notices from resolving `--also` (dedup-with-primary/dedup-within-itself). Defaults to `[]`. */
  inputWarnings?: string[];
  targetPath: string;
  resolvedTargetPath: string;
  passthroughArgs: string[];
  officialScaffolder: ScaffolderCommand;
  architecturePlan: ArchitecturePlan;
  monorepo: MonorepoPlanInfo;
  skills: Parameters<typeof buildSkillsPlan>[0];
}): CreatePlan {
  const alsoTypes = params.alsoTypes ?? [];
  const repoTypes = [params.repoType, ...alsoTypes];
  const skillsPlan = buildSkillsPlan({ ...params.skills, repoTypes });
  return {
    dryRun: params.dryRun,
    projectNameOrPath: params.projectNameOrPath,
    repoType: params.repoType,
    alsoTypes,
    repoTypes,
    inputWarnings: params.inputWarnings ?? [],
    targetPath: params.targetPath,
    resolvedTargetPath: params.resolvedTargetPath,
    passthroughArgs: params.passthroughArgs,
    officialScaffolder: params.officialScaffolder,
    architecturePlan: params.architecturePlan,
    monorepo: params.monorepo,
    skills: skillsPlan,
    metadata: buildProfilePlan({
      resolvedTargetPath: params.resolvedTargetPath,
      repoType: params.repoType,
      repoTypes,
      targetPath: params.targetPath,
      officialScaffolder: params.officialScaffolder,
      architecturePlan: params.architecturePlan,
      monorepo: params.monorepo,
      skills: skillsPlan,
    }),
  };
}

function printChangesList(label: string, items: string[]): void {
  if (items.length === 0) return;
  console.log(`    ${label} (${items.length}):`);
  for (const item of items) console.log(`      - ${item}`);
}

function printArchitecturePlanHuman(archPlan: ArchitecturePlan, dryRun: boolean): void {
  if (!archPlan.enabled) {
    console.log(`Architecture overlay:  ${pc.dim(archPlan.reason)}`);
    return;
  }
  const { preset, manifest } = archPlan;
  console.log(
    `Architecture overlay:  preset "${preset}" (${manifest.directories.length} dir(s), ` +
      `${manifest.files.length} file(s), ${manifest.moves.length} move(s))${dryRun ? " — would apply:" : ""}`,
  );
  if (dryRun) {
    for (const dir of manifest.directories) console.log(`    dir    ${dir}`);
    for (const file of manifest.files) console.log(`    file   ${file.from} -> ${file.to}`);
    for (const move of manifest.moves) {
      console.log(`    move   ${move.from} -> ${move.to}${move.optional ? " (optional)" : ""}`);
    }
  }
}

/** Prints what actually happened when the overlay ran for real (spec §12.1 step 9). Skipped/`--no-arch` case is already covered by the plan section above, so this only prints for a real attempt. */
function printArchitectureResultHuman(architecture: ArchitectureResult | null): void {
  if (architecture === null) return;
  if (architecture.status === "applied") {
    console.log(pc.bold(`Architecture overlay applied (preset "${architecture.preset}"):`));
  } else {
    console.log(
      pc.bold(pc.red(`Architecture overlay failed (preset "${architecture.preset}"): ${architecture.message}`)),
    );
    console.log(pc.dim("No rollback in MVP — this is everything that was already created before the failure:"));
  }
  printChangesList("created", architecture.changes.created);
  printChangesList("updated", architecture.changes.updated);
  printChangesList("moved", architecture.changes.moved);
  printChangesList("skipped", architecture.changes.skipped);
}

/** Prints the skills plan line inside `printPlanHuman()` — mirrors `printArchitecturePlanHuman()`'s "only list detail under dry-run" convention exactly. */
function printSkillsPlanHuman(skillsPlan: SkillsPlan, dryRun: boolean): void {
  if (!skillsPlan.enabled) {
    console.log(`AI skill injection:    ${pc.dim(skillsPlan.reason)}`);
    return;
  }
  const modeLabel = skillsPlan.mode === "monorepo-target" ? "monorepo-target install" : "standalone install";
  console.log(`AI skill injection:    ${modeLabel} via inject-nockta-skills${dryRun ? " — would run:" : ""}`);
  if (dryRun) {
    console.log(`    ${pc.cyan(skillsPlan.commandLine)}`);
    console.log(`    cwd: ${skillsPlan.cwd}`);
  }
}

/** Prints what actually happened when the skills step ran for real (spec §12.1 step 10). Skipped/`--no-skills` case is already covered by the plan section above, so this only prints for a real attempt. */
function printSkillsOutcomeHuman(skills: SkillsOutcome): void {
  if (skills.kind === "skipped") return;
  if (skills.kind === "injected") {
    console.log(pc.bold(`AI skill injection succeeded (${skills.mode}):`));
    console.log(`  ${skills.summary}`);
    if (skills.skillsVersion) console.log(`  inject-nockta-skills version: ${skills.skillsVersion}`);
    if (skills.profilePath) console.log(`  Profile: ${skills.profilePath}`);
    if (skills.targetsPath) console.log(`  Targets: ${skills.targetsPath}`);
    if (skills.manifestPath) console.log(`  Manifest: ${skills.manifestPath}`);
    if (skills.mode === "monorepo-target" && skills.isMonorepo) {
      console.log(
        pc.dim(
          "  Root .nockta/targets.json + skills-profile.json above were written by inject-nockta-skills " +
            "— a SEPARATE file from create-nockta-repo's own " +
            "<target>/.nockta/repo-profile.json, printed below.",
        ),
      );
    }
    if (skills.warnings.length > 0) {
      console.log(pc.yellow("  Warnings:"));
      for (const w of skills.warnings) console.log(pc.yellow(`    ${w}`));
    }
    return;
  }
  // failed
  console.log(pc.bold(pc.red(`AI skill injection failed (exit ${skills.exitCode ?? "unknown"}): ${skills.message}`)));
  if (skills.stderrTail) {
    console.log(pc.dim("  inject-nockta-skills stderr (tail):"));
    for (const line of skills.stderrTail.split("\n").filter((l) => l.length > 0)) console.log(pc.dim(`    ${line}`));
  }
}

function printPlanHuman(plan: CreatePlan): void {
  console.log(pc.bold(plan.dryRun ? "create-nockta-repo — dry run" : "create-nockta-repo — create"));
  if (plan.dryRun) {
    console.log(pc.dim("No files will be created. No upstream scaffolder will run."));
  }
  console.log("");
  console.log("Target:");
  console.log(`  path             ${plan.targetPath}`);
  console.log(`  resolved         ${plan.resolvedTargetPath}`);
  console.log(`  repo type        ${plan.repoType}`);
  if (plan.alsoTypes.length > 0) {
    // D22: --also secondary skill-domain types — NOT a second scaffolder,
    // just what gets unioned into the forwarded inject-nockta-skills command
    // below (spec §5.2's own --also documentation).
    console.log(`  also types       ${plan.alsoTypes.join(", ")} (skill domains only, forwarded to inject-nockta-skills)`);
  }
  console.log(`  monorepo target  ${plan.monorepo.isMonorepoTarget ? "yes" : "no"}`);
  if (plan.monorepo.infoLine) {
    console.log(pc.dim(`  ${plan.monorepo.infoLine}`));
  }
  if (plan.inputWarnings.length > 0) {
    console.log("");
    console.log(pc.yellow("Warnings:"));
    for (const w of plan.inputWarnings) console.log(pc.yellow(`  ${w}`));
  }
  console.log("");
  console.log(plan.dryRun ? "Upstream scaffolder (would run):" : "Upstream scaffolder:");
  console.log(`  ${pc.cyan(plan.officialScaffolder.command)} ${plan.officialScaffolder.args.join(" ")}`);
  console.log("");
  printArchitecturePlanHuman(plan.architecturePlan, plan.dryRun);
  printSkillsPlanHuman(plan.skills, plan.dryRun);
  printProfilePlanHuman(plan.metadata, plan.dryRun);
}

/** Prints the repo-profile plan line inside `printPlanHuman()` — real as of Milestone 7 (spec §9, §5.7). */
function printProfilePlanHuman(profilePlan: ProfilePlan, dryRun: boolean): void {
  console.log(`Repo profile metadata:${dryRun ? " would write:" : ""}`);
  console.log(`  path             ${profilePlan.path}`);
  if (dryRun) {
    console.log(`  tool             ${profilePlan.preview.tool}`);
    // D22: repoTypes[] (primary first) — was singular repoType.
    console.log(`  repoTypes        ${profilePlan.preview.repoTypes.join(", ")}`);
    console.log(`  architecture     ${profilePlan.preview.architecture ?? "null"}`);
    console.log(`  isMonorepoTarget ${profilePlan.preview.isMonorepoTarget ? "true" : "false"}`);
    console.log(`  skillsInjected   ${profilePlan.preview.skillsInjected ? "true" : "false"} (planned)`);
    if (profilePlan.preview.adapters) console.log(`  adapters         ${profilePlan.preview.adapters.join(", ")}`);
  }
}

/** Prints what actually happened when the profile-write step ran for real (spec §12.1 step 11/§12.2 step 6). */
function printProfileOutcomeHuman(profile: ProfileOutcome): void {
  console.log(pc.bold("Repo profile written:"));
  console.log(`  ${profile.path}`);
  console.log(`  skillsInjected: ${profile.profile.skillsInjected}`);
  if (profile.profile.skillsVersion) console.log(`  skillsVersion: ${profile.profile.skillsVersion}`);
}

/**
 * Non-interactive create flow (spec §12.1/§12.2, §19 Milestones 4-6). One
 * code path serves both the standalone flow (§12.1) and the monorepo-target
 * flow (§12.2) — they differ only in what `resolveTargetPath()` classifies
 * step 1-2 as, not in a separate branch. Follows the spec's own step order:
 *
 * 1-2. resolve project path + repo type;
 * 3. resolve the architecture preset — *read and validate* the manifest,
 *    never apply it here (unknown preset -> exit 2; a broken manifest for a
 *    preset that does exist -> exit 3, spec §5.9, even though it's caught
 *    before upstream ever runs — it's the overlay pack's own content that's
 *    broken, not the user's input);
 * 3b. resolve `--adapters` (default `["claude"]`, exit 2 on an unknown
 *    adapter — same bucket as an unknown `--type`/`--arch`, spec §16.1);
 * 4. detect the monorepo root and validate the (possibly nested) target
 *    path against it (spec §12.2 steps 1-2, §13) — `resolveTargetPath()`
 *    (Milestone 5) composes `validateTargetDir()`'s existing safety checks
 *    (already-exists, absolute path, `..` escape) unchanged, and adds
 *    `isMonorepoTarget` classification on top;
 * 5. resolve the official scaffolder command;
 * 6-8. dry run: print the plan (now including the real architecture plan,
 *    spec §5.7, *and* the monorepo-target classification, spec §12.2, *and*
 *    the exact `inject-nockta-skills` command that would run, Milestone 6)
 *    and stop — or run the upstream scaffolder for real, into the resolved
 *    target path (nested or not — the same path either way), and stop
 *    immediately with no post-processing on failure (spec §13);
 * 9. apply the architecture overlay now that upstream has actually
 *    succeeded, inside the target directory (nested or not) — `--no-arch`
 *    skips this; a `move` whose non-optional source is missing stops the
 *    apply and fails with exit 3, reporting exactly what was already created
 *    (no rollback in MVP, spec §7.3/§13);
 * 10. invoke `inject-nockta-skills` for real (Milestone 6, spec §8) — unless
 *    `--no-skills` (spec §5.6) — by spawning its CLI (`core/run-inject-skills.ts`,
 *    decisions.md D4): standalone runs inside the created project dir with
 *    `install --type <repoType> ...`; a monorepo target runs at the
 *    monorepo root with `install --target <path>:<type> ...` (spec §6.4/§6.5,
 *    decisions.md D5 — root adapters + `.nockta/targets.json` land there, not
 *    inside the target; `create-nockta-repo` itself still writes nothing to
 *    root `.nockta`). A skill-injection failure is exit code 4 (spec §5.9)
 *    and reports the honest partial state — project and overlay already
 *    exist, only skills failed, no rollback.
 *
 * Repo-profile writing (spec §12.1 step 11, §12.2 step 6) is now REAL
 * (Milestone 7, spec §9) — the true final step, run only once skills has
 * resolved (injected or legitimately skipped via `--no-skills`; never
 * reached after an upstream/overlay/skills failure, all of which already
 * returned above, spec §13). A profile-write failure gets its own outcome
 * kind and exit code (`PROFILE_FAILURE`, 5) — see this file's `EXIT_CODE`
 * comment for why. `isMonorepoTarget` flows through the plan/`--json` output
 * regardless (spec §11.4) — see `MonorepoPlanInfo` above.
 */

export type ResolvedCreatePlan = {
  ok: true;
  plan: CreatePlan;
  validated: ReturnType<typeof resolveTargetPath>;
  adapters: AdapterType[];
  repoType: string;
};

export type UnresolvedCreatePlan = {
  ok: false;
  exitCode: number;
  error: { code: string; message: string; details: Record<string, unknown> };
};

/**
 * Extracted (Milestone 7, this milestone's brief item 4/§18.2 "reuse
 * commands/create.ts internals; do not reimplement") from what used to be
 * the first half of `runCreateCommand()` itself — spec §12.1 steps 2-5 /
 * §12.2 steps 1-2: resolve the repo type, the architecture preset (read +
 * validate only, never apply), `--adapters`, the (possibly nested,
 * possibly-monorepo-target) target path, and the official scaffolder
 * command, then assemble the full {@link CreatePlan}. Entirely side-effect
 * free — every step here only reads (registry lookups, manifest reads,
 * `existsSync` checks) — which is exactly why it's safe for
 * `wizard/steps/preview-plan.ts`'s PREVIEW step (spec §5.1 step 9,
 * decisions.md D18) to call this directly to build the "create's own plan"
 * half of the wizard's preview, before anything has been confirmed or run.
 * `runCreateCommand()` below is the only other caller — same function, same
 * validation, same error shapes either way; there is no second resolution
 * path to keep in sync.
 */
export function resolveCreatePlan(
  projectNameOrPath: string,
  cliOptions: CreateCommandCliOptions,
): ResolvedCreatePlan | UnresolvedCreatePlan {
  const passthroughArgs = cliOptions.passthroughArgs ?? [];
  const dryRun = cliOptions.dryRun ?? false;
  const repoType = cliOptions.type as string;

  try {
    resolveScaffolder(repoType);
  } catch (error) {
    if (error instanceof UnknownRepoTypeError) {
      return {
        ok: false,
        exitCode: EXIT_CODE.INVALID_TARGET,
        error: {
          code: "unknown-repo-type",
          message: error.message,
          details: { repoType: error.repoType, knownRepoTypes: error.knownRepoTypes },
        },
      };
    }
    throw error;
  }

  let architecturePlan: ArchitecturePlan;
  if (cliOptions.arch === false) {
    architecturePlan = { enabled: false, reason: "--no-arch flag: architecture overlay skipped." };
  } else {
    const preset = cliOptions.arch ?? "standard";
    try {
      const { manifest, manifestDir } = readArchitecturePreset(repoType, preset);
      architecturePlan = { enabled: true, preset, manifestDir, manifest };
    } catch (error) {
      if (error instanceof ArchitectureManifestError) {
        const exitCode = error.code === "preset-not-found" ? EXIT_CODE.INVALID_TARGET : EXIT_CODE.ARCHITECTURE_FAILURE;
        return {
          ok: false,
          exitCode,
          error: { code: `architecture-${error.code}`, message: error.message, details: error.details },
        };
      }
      throw error;
    }
  }

  // --adapters (spec §12.1 "resolve adapters", §16.1) — validated early,
  // before the target path or the upstream scaffolder ever run, same bucket
  // as an unknown --type/--arch (exit 2, bad flag value, nothing ran).
  // Defaults to ["claude"] when --adapters is omitted (Milestone 6's brief
  // item 3).
  const parsedAdapters = parseAdapters(cliOptions.adapters);
  if (!parsedAdapters.ok) {
    return {
      ok: false,
      exitCode: EXIT_CODE.INVALID_TARGET,
      error: {
        code: "invalid-adapters",
        message: parsedAdapters.message,
        details: { adapters: cliOptions.adapters ?? null, knownAdapters: ADAPTER_TYPES },
      },
    };
  }
  const adapters = parsedAdapters.adapters;

  // --also <type>[,<type>...] (decisions.md D22, spec §5.2) — validated in
  // the same early "bad flag value, nothing ran" bucket as --type/--arch/
  // --adapters (exit 2). An unknown --also value is a hard error; a --also
  // type equal to the primary --type (or repeated within --also itself) is
  // silently deduped with a warning instead (this milestone's brief: "warn,
  // don't error") — see parseAlsoTypes()'s own header comment. `--also`
  // given without a resolvable primary --type never reaches here at all: an
  // unknown --type already returned above, and a wholly missing --type never
  // reaches resolveCreatePlan() in the first place (commands/create-entry.ts's
  // routing treats "no --type" as insufficient flags — wizard on a real TTY,
  // else a structured invalid-input error, exit 2 either way).
  const parsedAlso = parseAlsoTypes(cliOptions.also, repoType);
  if (!parsedAlso.ok) {
    return {
      ok: false,
      exitCode: EXIT_CODE.INVALID_TARGET,
      error: {
        code: "invalid-also",
        message: parsedAlso.message,
        details: { also: cliOptions.also ?? null, primary: repoType, invalid: parsedAlso.invalid, knownRepoTypes: REPO_TYPES },
      },
    };
  }
  const alsoTypes = parsedAlso.types;
  const inputWarnings = parsedAlso.warnings;

  const skillsEnabled = cliOptions.skills !== false;
  // Captured once, up front — the same cwd resolveTargetPath()/detectMonorepoRoot()
  // use by default (spec §6.3: a monorepo root is detected at cwd itself, no
  // upward walk), and the same directory the skills step spawns
  // inject-nockta-skills in for a monorepo target (spec §6.4/§6.5, D5).
  // `cliOptions.cwd` is test-injection only (Milestone 7, see this type's own
  // header comment) — every real invocation leaves it undefined and gets the
  // real `process.cwd()`.
  const invocationCwd = cliOptions.cwd ?? process.cwd();

  // spec §12.2 steps 1-2: detect monorepo root at cwd, then validate the
  // (possibly nested) target path against it. Both happen inside
  // resolveTargetPath() — see core/resolve-target-path.ts for the three
  // cases it distinguishes (monorepo target / nested-but-standalone / plain
  // standalone). Safety checks (already-exists, absolute path, `..` escape)
  // are unchanged from Milestone 3 — resolveTargetPath composes
  // validateTargetDir rather than re-implementing them.
  let validated: ReturnType<typeof resolveTargetPath>;
  try {
    validated = resolveTargetPath(projectNameOrPath, { cwd: invocationCwd });
  } catch (error) {
    if (error instanceof InvalidTargetDirError) {
      return {
        ok: false,
        exitCode: EXIT_CODE.INVALID_TARGET,
        error: {
          code: error.code,
          message: error.message,
          details: { targetPath: error.targetPath, resolvedPath: error.resolvedPath },
        },
      };
    }
    throw error;
  }

  // D36: resolve the surfaced upstream-option answers. The web submit passes a
  // full answers object; a plain CLI `--yes` run with none set falls back to
  // the schema's own defaults (single source — CLI and web can't drift). The
  // wizard/interactive path (no `--yes`, no answers) leaves this undefined, so
  // buildCommand stays bare and upstream prompts stay interactive by design.
  const upstreamAnswers: Record<string, unknown> | undefined =
    cliOptions.upstreamOptions ??
    (cliOptions.yes === true ? upstreamOptionDefaults(resolveScaffolder(repoType).upstreamOptions) : undefined);
  const officialScaffolder = resolveOfficialScaffolderCommand(
    repoType,
    validated.targetPath,
    passthroughArgs,
    upstreamAnswers,
  );

  const plan = buildPlan({
    dryRun,
    projectNameOrPath,
    repoType,
    alsoTypes,
    inputWarnings,
    targetPath: validated.targetPath,
    resolvedTargetPath: validated.resolvedPath,
    passthroughArgs,
    officialScaffolder,
    architecturePlan,
    monorepo: {
      isMonorepoTarget: validated.isMonorepoTarget,
      isMonorepoRoot: validated.monorepoRoot.isMonorepoRoot,
      signals: validated.monorepoRoot.isMonorepoRoot ? validated.monorepoRoot.signals : [],
      isNestedPath: validated.isNestedPath,
      infoLine: validated.infoLine,
    },
    skills: {
      enabled: skillsEnabled,
      repoType,
      adapters,
      skillsVersion: cliOptions.skillsVersion,
      // standalone: spawn inside the created project dir; monorepo target:
      // spawn at the monorepo root (spec §6.4/§6.5, decisions.md D5 — root
      // adapters + targets.json land there, not inside the target).
      mode: validated.isMonorepoTarget ? "monorepo-target" : "standalone",
      cwd: validated.isMonorepoTarget ? invocationCwd : validated.resolvedPath,
      targetPath: validated.isMonorepoTarget ? validated.targetPath : undefined,
    },
  });

  return { ok: true, plan, validated, adapters, repoType };
}

export async function runCreateCommand(
  projectNameOrPath: string | undefined,
  cliOptions: CreateCommandCliOptions,
): Promise<void> {
  if (!projectNameOrPath || !cliOptions.type) {
    await runCreateWizard();
    return;
  }

  const resolved = resolveCreatePlan(projectNameOrPath, cliOptions);
  if (!resolved.ok) {
    emitError(cliOptions, resolved.error);
    process.exitCode = resolved.exitCode;
    return;
  }
  const { plan, validated, adapters, repoType } = resolved;
  const dryRun = plan.dryRun;

  if (dryRun) {
    // Dry run (spec §5.7): print the plan — including the real architecture
    // plan resolved above — and call nothing else. Neither runUpstream() nor
    // applyArchitectureManifest() is ever invoked in this branch — the
    // strongest available proof that dry run writes nothing is that the code
    // paths that could write anything are simply never reached.
    const outcome: CreateOutcome = { kind: "dry-run", plan };
    emitOutcome(cliOptions, outcome);
    return;
  }

  let upstream: UpstreamResult;
  try {
    upstream = await runUpstream({
      command: plan.officialScaffolder.command,
      args: plan.officialScaffolder.args,
      cwd: cliOptions.cwd ?? process.cwd(),
      // PART A (D36): the web submit path detaches stdin so a browser-driven
      // run never depends on the launching terminal; every other path keeps
      // "inherit". See upstreamStdio().
      stdio: upstreamStdio(cliOptions),
      // Headless run (CLI `--yes` or the `--web` submit path, which always
      // sets `yes: true` — web/run-create-web.ts::answersToCliOptions()):
      // no human is watching the inherited stdio, so force CI=true so the
      // upstream scaffolder takes its non-interactive default-answers path
      // instead of printing a prompt and silently exiting 0 with nothing
      // written (verified bug, run-upstream.ts::RunUpstreamOptions.forceCI
      // doc comment). The wizard path (no --yes) is exempt — it only ever
      // runs with a real TTY (create-entry.ts's own isTTY gate), so it's
      // genuinely interactive and must keep its real prompt behavior.
      forceCI: cliOptions.yes === true,
    });
  } catch (error) {
    if (error instanceof UpstreamFailure) {
      // Spec §13: stop immediately, no post-processing runs after an
      // upstream failure — the architecture overlay is never attempted.
      const outcome: CreateOutcome = { kind: "upstream-failed", plan, upstream: error.result, error };
      emitOutcome(cliOptions, outcome);
      process.exitCode = EXIT_CODE.UPSTREAM_FAILURE;
      return;
    }
    throw error;
  }

  let architectureResult: ArchitectureResult | null = null;
  if (plan.architecturePlan.enabled) {
    try {
      const changes = applyArchitectureManifest({
        manifest: plan.architecturePlan.manifest,
        manifestDir: plan.architecturePlan.manifestDir,
        targetDir: validated.resolvedPath,
      });
      architectureResult = { status: "applied", preset: plan.architecturePlan.preset, changes };
    } catch (error) {
      if (error instanceof ArchitectureApplyError) {
        const outcome: CreateOutcome = {
          kind: "overlay-failed",
          plan,
          upstream,
          architecture: {
            status: "failed",
            preset: plan.architecturePlan.preset,
            code: error.code,
            message: error.message,
            changes: error.changes,
          },
        };
        emitOutcome(cliOptions, outcome);
        process.exitCode = EXIT_CODE.ARCHITECTURE_FAILURE;
        return;
      }
      throw error;
    }
  }

  // Milestone 6, spec §12.1 step 10 / §12.2 step 4-5: skill injection runs
  // only once the architecture step has actually succeeded (or was
  // legitimately skipped via --no-arch) — never reached after an upstream
  // failure or an overlay failure, both of which already returned above
  // (spec §13: no post-processing continues past a failed step).
  // decisions.md D29 — the create->inject handoff branches on interactivity:
  //  - INTERACTIVE (no --yes; every wizard-driven run, since D20 makes --yes
  //    the marker of a truly non-interactive invocation): spawn inject's OWN
  //    wizard with the repo-type(s) pre-filled and INHERITED stdio, so the
  //    user reaches inject's adapter/skill/razor prompts. No --yes/--json;
  //    nothing is captured (inject printed straight to the terminal).
  //  - HEADLESS (--yes): spawn inject headless (--yes --json, captured)
  //    exactly as before.
  // --dry-run already returned above; --no-skills is handled first below.
  const interactiveHandoff = cliOptions.yes !== true;
  let skillsOutcome: SkillsOutcome;
  if (!plan.skills.enabled) {
    skillsOutcome = { kind: "skipped", reason: plan.skills.reason };
  } else if (interactiveHandoff) {
    try {
      const interactive = await runInjectSkillsInteractive({
        mode: plan.skills.mode,
        repoType,
        repoTypes: plan.skills.repoTypes,
        skillsVersion: cliOptions.skillsVersion,
        cwd: plan.skills.cwd,
        targetPath: plan.skills.mode === "monorepo-target" ? validated.targetPath : undefined,
      });
      // inject writes its own .nockta/skills-profile.json in its target/root cwd; read the resolved
      // version back best-effort (there is no captured --json in the interactive handoff — D29).
      const injectProfilePath = path.join(plan.skills.cwd, ".nockta", "skills-profile.json");
      if (interactive.exitCode === 0) {
        skillsOutcome = {
          kind: "injected",
          mode: plan.skills.mode,
          // Adapters were chosen inside inject's own wizard now (D29) — create no longer forwards or
          // knows them. Recorded as empty here; the authoritative record is inject's own profile.
          adapters: [],
          skillsVersion: readInjectedSkillsVersion(injectProfilePath),
          isMonorepo: plan.skills.mode === "monorepo-target",
          installedPacks: [],
          skippedPacks: [],
          renderedFileCount: 0,
          profilePath: existsSync(injectProfilePath) ? injectProfilePath : null,
          manifestPath: null,
          targetsPath: null,
          warnings: [],
          summary:
            "inject-nockta-skills interactive wizard completed — adapters/skills/razor were chosen there (see its output above).",
          exitCode: 0,
          durationMs: interactive.durationMs,
        };
      } else {
        // inject ran but the user declined/cancelled its wizard (a non-zero exit). That is the user's
        // choice, NOT a create failure: the project + overlay already exist; record that skills were
        // not injected and finish successfully (exit 0), never exit 4.
        skillsOutcome = {
          kind: "skipped",
          reason: `inject-nockta-skills interactive wizard did not complete (exit ${interactive.exitCode ?? "unknown"}) — no skills recorded for this project.`,
        };
      }
    } catch (error) {
      if (error instanceof InjectSkillsFailure) {
        // Only a genuine spawn failure (inject could not launch at all) is exit 4 here — same honest
        // partial-state posture as the headless path below.
        const failedSkills: Extract<SkillsOutcome, { kind: "failed" }> = {
          kind: "failed",
          mode: plan.skills.mode,
          adapters,
          exitCode: error.details.exitCode,
          reason: error.details.reason,
          message: error.message,
          stderrTail: error.details.stderrTail,
        };
        emitOutcome(cliOptions, {
          kind: "skills-failed",
          plan,
          upstream,
          architecture: architectureResult,
          skills: failedSkills,
        });
        process.exitCode = EXIT_CODE.SKILLS_FAILURE;
        return;
      }
      throw error;
    }
  } else {
    try {
      const injected = await runInjectSkills({
        mode: plan.skills.mode,
        repoType,
        // D22: the union (primary + validated/deduped --also types) already
        // resolved onto the plan (plan.skills.repoTypes, mirrored on
        // plan.repoTypes) — the SAME array printed/planned under dry-run, so
        // the real run and the dry-run preview can never diverge.
        repoTypes: plan.skills.repoTypes,
        adapters,
        skillsVersion: cliOptions.skillsVersion,
        // D30 web flow forwards the page-collected skill deltas; every other path leaves these
        // undefined (no flag emitted — see run-inject-skills.ts::skillDeltaFlags).
        includeSkills: cliOptions.includeSkills,
        excludeSkills: cliOptions.excludeSkills,
        cwd: plan.skills.cwd,
        targetPath: plan.skills.mode === "monorepo-target" ? validated.targetPath : undefined,
      });
      skillsOutcome = {
        kind: "injected",
        mode: plan.skills.mode,
        adapters,
        skillsVersion: injected.skillsVersion,
        isMonorepo: injected.result.data.isMonorepo,
        installedPacks: injected.result.data.installedPacks,
        skippedPacks: injected.result.data.skippedPacks,
        renderedFileCount: injected.result.data.renderedFileCount,
        profilePath: injected.result.data.profilePath,
        manifestPath: injected.result.data.manifestPath,
        targetsPath: injected.result.data.targetsPath,
        warnings: injected.result.data.warnings,
        summary: injected.result.summary,
        exitCode: injected.exitCode,
        durationMs: injected.durationMs,
      };
    } catch (error) {
      if (error instanceof InjectSkillsFailure) {
        // Spec §5.9 exit code 4: honest partial-state reporting — the
        // project directory and the architecture overlay already exist
        // (architectureResult above proves it), only the skills step failed.
        // No rollback (same MVP posture as the overlay-failure path, spec
        // §13).
        const failedSkills: Extract<SkillsOutcome, { kind: "failed" }> = {
          kind: "failed",
          mode: plan.skills.mode,
          adapters,
          exitCode: error.details.exitCode,
          reason: error.details.reason,
          message: error.message,
          stderrTail: error.details.stderrTail,
        };
        const outcome: CreateOutcome = {
          kind: "skills-failed",
          plan,
          upstream,
          architecture: architectureResult,
          skills: failedSkills,
        };
        emitOutcome(cliOptions, outcome);
        process.exitCode = EXIT_CODE.SKILLS_FAILURE;
        return;
      }
      throw error;
    }
  }

  // Milestone 7, spec §12.1 step 11/§12.2 step 6 — the TRUE final step, run
  // only after skills has resolved (injected or legitimately skipped via
  // --no-skills; never reached after an upstream/overlay/skills failure, all
  // three of which already returned above, spec §13). `validated.resolvedPath`
  // is the target's OWN root either way (standalone or a monorepo target,
  // spec §9.1, decisions.md D5) — never the monorepo root.
  const profile = buildRepoProfile({
    plan,
    officialScaffolder: plan.officialScaffolder,
    architecturePlan: plan.architecturePlan,
    skillsOutcome,
    packageVersion: readRunningPackageVersion(),
  });

  let profileOutcome: ProfileOutcome;
  try {
    const written = writeRepoProfile({ projectDir: validated.resolvedPath, profile });
    profileOutcome = { path: written.path, profile: written.profile };
  } catch (error) {
    if (error instanceof WriteRepoProfileError) {
      // Fails loudly (spec §5.9 new PROFILE_FAILURE code, this milestone's
      // own brief: "a created project without its profile is incomplete") —
      // project, overlay, and skills already succeeded; only the profile
      // write itself failed. No rollback (same MVP posture as every other
      // post-upstream failure path in this file).
      const outcome: CreateOutcome = {
        kind: "profile-failed",
        plan,
        upstream,
        architecture: architectureResult,
        skills: skillsOutcome,
        profileError: { path: error.path, message: error.message },
      };
      emitOutcome(cliOptions, outcome);
      process.exitCode = EXIT_CODE.PROFILE_FAILURE;
      return;
    }
    throw error;
  }

  const outcome: CreateOutcome = {
    kind: "created",
    plan,
    upstream,
    architecture: architectureResult,
    skills: skillsOutcome,
    profile: profileOutcome,
  };
  emitOutcome(cliOptions, outcome);
}

function parseAdapters(
  raw: string | undefined,
): { ok: true; adapters: AdapterType[] } | { ok: false; message: string } {
  const requested = (raw ?? "claude")
    .split(",")
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
  if (requested.length === 0) {
    return { ok: false, message: `--adapters requires at least one adapter. Valid adapters: ${ADAPTER_TYPES.join(", ")}` };
  }
  const invalid = requested.filter((a) => !(ADAPTER_TYPES as readonly string[]).includes(a));
  if (invalid.length > 0) {
    return {
      ok: false,
      message: `invalid --adapters value(s): ${invalid.join(", ")}. Valid adapters: ${ADAPTER_TYPES.join(", ")}`,
    };
  }
  return { ok: true, adapters: requested as AdapterType[] };
}

/**
 * Parses/validates `--also <type>[,<type>...]` (decisions.md D22, spec §5.2)
 * — comma-separated secondary skill-domain repo types, same split/trim/filter
 * convention as {@link parseAdapters}. Two distinct failure/notice modes,
 * deliberately NOT the same bucket:
 * - an UNKNOWN type (not in `REPO_TYPES`) is a hard error (`ok: false`) — same
 *   exit-code-2 bucket as an unknown `--type`/`--arch`/`--adapters` value
 *   (invalid input, nothing ran);
 * - a type equal to the PRIMARY `--type`, or repeated within `--also` itself,
 *   is silently DEDUPED with a warning, never an error (this milestone's
 *   brief: "dedup a --also type equal to primary (warn, don't error)") — the
 *   user asked for a set that happens to have a redundant member, not for
 *   something invalid.
 *
 * `--also` entirely omitted, or present-but-empty (e.g. `--also ""`), is a
 * clean no-op: `{ok: true, types: [], warnings: []}`. Order preserved,
 * primary never appears in the returned `types` (that's `resolveCreatePlan`'s
 * own job to prepend when building the union — see its own `repoTypes`
 * construction below).
 */
function parseAlsoTypes(
  raw: string | undefined,
  primary: string,
):
  | { ok: true; types: RepoType[]; warnings: string[] }
  | { ok: false; message: string; invalid: string[] } {
  const requested = (raw ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (requested.length === 0) {
    return { ok: true, types: [], warnings: [] };
  }
  const invalid = requested.filter((t) => !isRepoType(t));
  if (invalid.length > 0) {
    return {
      ok: false,
      message: `invalid --also value(s): ${invalid.join(", ")}. Valid repo types: ${REPO_TYPES.join(", ")}`,
      invalid,
    };
  }

  const warnings: string[] = [];
  const seen = new Set<string>();
  const types: RepoType[] = [];
  for (const t of requested as RepoType[]) {
    if (t === primary) {
      warnings.push(
        `--also type "${t}" is the same as the primary --type "${primary}" — ignoring the duplicate ` +
          "(the primary type is already included).",
      );
      continue;
    }
    if (seen.has(t)) {
      warnings.push(`--also type "${t}" was given more than once — ignoring the duplicate.`);
      continue;
    }
    seen.add(t);
    types.push(t);
  }
  return { ok: true, types, warnings };
}

/** Exported so `commands/create-entry.ts` can reuse the exact same "one JSON line / human error" shaping for its own insufficient-flags, non-TTY structured error (spec §6, this milestone's brief item 6) — no second error-formatting path to keep in sync. */
export function emitError(
  cliOptions: CreateCommandCliOptions,
  error: { code: string; message: string; details: Record<string, unknown> },
): void {
  if (cliOptions.json) {
    // D13: one compact JSON line, no pretty-printing.
    console.log(JSON.stringify({ ok: false, error }));
    return;
  }
  console.error(pc.bold(pc.red("create-nockta-repo — invalid input")));
  console.error(error.message);
}

function emitOutcome(cliOptions: CreateCommandCliOptions, outcome: CreateOutcome): void {
  if (cliOptions.json) {
    console.log(JSON.stringify(toJsonResult(outcome)));
    return;
  }

  if (outcome.kind === "dry-run") {
    printPlanHuman(outcome.plan);
    console.log("");
    console.log(pc.dim("Nothing was written."));
    return;
  }

  if (outcome.kind === "created") {
    printPlanHuman(outcome.plan);
    console.log("");
    console.log(
      pc.green(
        `Upstream scaffolder finished (exit ${outcome.upstream.exitCode}, ${outcome.upstream.durationMs}ms).`,
      ),
    );
    console.log("");
    printArchitectureResultHuman(outcome.architecture);
    console.log("");
    printSkillsOutcomeHuman(outcome.skills);
    console.log("");
    printProfileOutcomeHuman(outcome.profile);
    return;
  }

  if (outcome.kind === "profile-failed") {
    printPlanHuman(outcome.plan);
    console.log("");
    console.log(
      pc.green(
        `Upstream scaffolder finished (exit ${outcome.upstream.exitCode}, ${outcome.upstream.durationMs}ms).`,
      ),
    );
    console.log("");
    printArchitectureResultHuman(outcome.architecture);
    console.log("");
    printSkillsOutcomeHuman(outcome.skills);
    console.error("");
    console.error(pc.bold(pc.red("create-nockta-repo — repo profile write failed")));
    console.error(pc.dim(`  ${outcome.profileError.path}: ${outcome.profileError.message}`));
    console.error(
      pc.dim(
        "Project, architecture overlay, and skill injection already succeeded; only the profile write failed; " +
          "no rollback (exit code 5 — a created project without its profile is incomplete).",
      ),
    );
    return;
  }

  if (outcome.kind === "overlay-failed") {
    printPlanHuman(outcome.plan);
    console.log("");
    console.log(
      pc.green(
        `Upstream scaffolder finished (exit ${outcome.upstream.exitCode}, ${outcome.upstream.durationMs}ms).`,
      ),
    );
    console.log("");
    printArchitectureResultHuman(outcome.architecture);
    console.error("");
    console.error(pc.bold(pc.red("create-nockta-repo — architecture overlay failed")));
    console.error(
      pc.dim("Upstream scaffolder had already succeeded; stopping after the overlay step (exit code 3)."),
    );
    return;
  }

  if (outcome.kind === "skills-failed") {
    printPlanHuman(outcome.plan);
    console.log("");
    console.log(
      pc.green(
        `Upstream scaffolder finished (exit ${outcome.upstream.exitCode}, ${outcome.upstream.durationMs}ms).`,
      ),
    );
    console.log("");
    printArchitectureResultHuman(outcome.architecture);
    console.log("");
    printSkillsOutcomeHuman(outcome.skills);
    console.error("");
    console.error(pc.bold(pc.red("create-nockta-repo — skill injection failed")));
    console.error(
      pc.dim(
        "Project and architecture overlay already exist; skill injection failed; no rollback (exit code 4).",
      ),
    );
    return;
  }

  // upstream-failed
  console.error(pc.bold(pc.red("create-nockta-repo — create failed")));
  console.error(
    `Upstream scaffolder failed: ${outcome.plan.officialScaffolder.command} ` +
      `${outcome.plan.officialScaffolder.args.join(" ")} ` +
      `(exit ${outcome.upstream.exitCode ?? "null"}${
        outcome.upstream.signal ? `, signal ${outcome.upstream.signal}` : ""
      })`,
  );
  console.error(pc.dim("Stopping — no post-processing runs after an upstream failure."));
}

function architectureChangesJson(architecture: ArchitectureResult | null | undefined): ArchitectureChanges {
  return architecture ? architecture.changes : EMPTY_ARCHITECTURE_CHANGES;
}

function architectureStatusJson(
  plan: CreatePlan,
  architecture: ArchitectureResult | null | undefined,
): Record<string, unknown> {
  if (!plan.architecturePlan.enabled) {
    return { status: "skipped", preset: null, reason: plan.architecturePlan.reason };
  }
  if (plan.dryRun) {
    return {
      status: "planned",
      preset: plan.architecturePlan.preset,
      plan: {
        directories: plan.architecturePlan.manifest.directories,
        files: plan.architecturePlan.manifest.files,
        moves: plan.architecturePlan.manifest.moves,
      },
    };
  }
  if (!architecture) {
    // Enabled but never attempted — only reachable when upstream failed
    // before the overlay step ran (spec §13).
    return { status: "not-attempted", preset: plan.architecturePlan.preset };
  }
  if (architecture.status === "applied") {
    return { status: "applied", preset: architecture.preset };
  }
  return { status: "failed", preset: architecture.preset, code: architecture.code, message: architecture.message };
}

/** Mirrors `architectureStatusJson()`'s "plan vs. attempted vs. real outcome" branching, for the skills step (Milestone 6). */
function skillsStatusJson(plan: CreatePlan, skillsOutcome: SkillsOutcome | null | undefined): Record<string, unknown> {
  if (!plan.skills.enabled) {
    return { status: "skipped", reason: plan.skills.reason };
  }
  if (plan.dryRun) {
    // This milestone's brief item 3: dry run prints the exact command that
    // would run (npx-shaped or version-pinned) without ever spawning it.
    return {
      status: "planned",
      mode: plan.skills.mode,
      // D22: the union forwarded to inject (primary + validated --also
      // types) — the SAME array that produced commandLine's `--type`/
      // `--target ...:` below, exposed structurally so a --json consumer
      // doesn't have to re-parse the command line to see it.
      repoTypes: plan.skills.repoTypes,
      adapters: plan.skills.adapters,
      skillsVersion: plan.skills.skillsVersion ?? null,
      command: plan.skills.command,
      args: plan.skills.args,
      cwd: plan.skills.cwd,
      commandLine: plan.skills.commandLine,
    };
  }
  if (!skillsOutcome) {
    // Enabled but never attempted — only reachable when upstream or the
    // overlay failed before the skills step ran (spec §13).
    return { status: "not-attempted", mode: plan.skills.mode };
  }
  if (skillsOutcome.kind === "skipped") {
    return { status: "skipped", reason: skillsOutcome.reason };
  }
  if (skillsOutcome.kind === "injected") {
    return {
      status: "injected",
      mode: skillsOutcome.mode,
      adapters: skillsOutcome.adapters,
      skillsVersion: skillsOutcome.skillsVersion,
      isMonorepo: skillsOutcome.isMonorepo,
      installedPacks: skillsOutcome.installedPacks,
      skippedPacks: skillsOutcome.skippedPacks,
      renderedFileCount: skillsOutcome.renderedFileCount,
      profilePath: skillsOutcome.profilePath,
      manifestPath: skillsOutcome.manifestPath,
      targetsPath: skillsOutcome.targetsPath,
      warnings: skillsOutcome.warnings,
      summary: skillsOutcome.summary,
    };
  }
  // failed
  return {
    status: "failed",
    mode: skillsOutcome.mode,
    exitCode: skillsOutcome.exitCode,
    reason: skillsOutcome.reason,
    message: skillsOutcome.message,
    stderrTail: skillsOutcome.stderrTail,
  };
}

/** Mirrors `architectureStatusJson()`/`skillsStatusJson()`'s "plan vs. attempted vs. real outcome" branching, for the repo-profile step (Milestone 7). */
function profileStatusJson(
  plan: CreatePlan,
  profileOutcome: ProfileOutcome | null | undefined,
  profileError: ProfileFailureDetail | null | undefined,
): Record<string, unknown> {
  if (plan.dryRun) {
    return { status: "planned", path: plan.metadata.path, preview: plan.metadata.preview };
  }
  if (profileError) {
    return { status: "failed", path: profileError.path, message: profileError.message };
  }
  if (!profileOutcome) {
    // Never reached the profile-write step — only reachable when upstream,
    // the overlay, or skills failed earlier (spec §13).
    return { status: "not-attempted", path: plan.metadata.path };
  }
  return { status: "written", path: profileOutcome.path, profile: profileOutcome.profile };
}

/**
 * Collects non-blocking notices for spec §11.4's `CreateNocktaRepoResult.warnings`
 * — best-effort, defaults to `[]`. D22 addition: always leads with the plan's
 * own `inputWarnings` (currently only `--also` dedup-with-primary/dedup-
 * within-itself notices) — present regardless of dry-run vs. real, unlike the
 * skills-injection warnings below which only exist once skills has actually
 * run/planned.
 */
function collectWarnings(plan: CreatePlan, skillsOutcome: SkillsOutcome | null | undefined): string[] {
  const warnings = [...plan.inputWarnings];
  if (skillsOutcome && skillsOutcome.kind === "injected") {
    warnings.push(...skillsOutcome.warnings);
    if (!skillsOutcome.skillsVersion) {
      warnings.push(
        "inject-nockta-skills did not report a resolved version (neither its --json data.version field nor its " +
          "written .nockta/skills-profile.json could be read) — repo-profile.json's skillsVersion is omitted.",
      );
    }
  }
  return warnings;
}

/**
 * The formal spec §11.4 `CreateNocktaRepoResult` assembler — deferred by
 * Milestone 6 (`projectDir`/`warnings` awaited real skills + profile data),
 * real as of Milestone 7 (this milestone's brief item 3). Pure — reads only
 * from already-computed plan/outcome data, no I/O of its own. Exposed inside
 * `toJsonResult()`'s envelope as the `result` key: the exact spec §11.4 shape,
 * nothing more, nothing less, so a programmatic/`--json` consumer that wants
 * ONLY the spec-documented fields has a single object to read instead of
 * having to reassemble them from this CLI's richer per-status detail fields.
 */
function buildCreateNocktaRepoResult(params: {
  plan: CreatePlan;
  architecture: ArchitectureResult | null | undefined;
  skills: SkillsOutcome | null | undefined;
}): CreateNocktaRepoResult {
  return {
    projectNameOrPath: params.plan.projectNameOrPath,
    projectDir: params.plan.resolvedTargetPath,
    repoType: params.plan.repoType as RepoType,
    architecture: params.plan.architecturePlan.enabled ? params.plan.architecturePlan.preset : null,
    isMonorepoTarget: params.plan.monorepo.isMonorepoTarget,
    officialScaffolder: params.plan.officialScaffolder,
    architectureChanges: architectureChangesJson(params.architecture),
    skillsInjected: params.skills?.kind === "injected",
    warnings: collectWarnings(params.plan, params.skills),
  };
}

function toJsonResult(outcome: CreateOutcome): Record<string, unknown> {
  const architectureResult: ArchitectureResult | null | undefined =
    outcome.kind === "created" ||
    outcome.kind === "overlay-failed" ||
    outcome.kind === "skills-failed" ||
    outcome.kind === "profile-failed"
      ? outcome.architecture
      : undefined;
  const skillsOutcome: SkillsOutcome | undefined =
    outcome.kind === "created" || outcome.kind === "skills-failed" || outcome.kind === "profile-failed"
      ? outcome.skills
      : undefined;
  const profileOutcome: ProfileOutcome | undefined = outcome.kind === "created" ? outcome.profile : undefined;
  const profileError: ProfileFailureDetail | undefined =
    outcome.kind === "profile-failed" ? outcome.profileError : undefined;

  const base = {
    ok: outcome.kind === "dry-run" || outcome.kind === "created",
    status: outcome.kind,
    projectNameOrPath: outcome.plan.projectNameOrPath,
    repoType: outcome.plan.repoType,
    // D22 (worker pass adding --also): the validated/deduped --also types
    // and the full union forwarded to inject-nockta-skills — top-level,
    // alongside the pre-existing singular `repoType` (the primary, unchanged).
    alsoTypes: outcome.plan.alsoTypes,
    repoTypes: outcome.plan.repoTypes,
    targetPath: outcome.plan.targetPath,
    resolvedTargetPath: outcome.plan.resolvedTargetPath,
    // Spec §11.4 CreateNocktaRepoResult.projectDir — same value as
    // resolvedTargetPath above (that field predates this milestone and is
    // kept for backward compatibility); added under its spec-documented name
    // too so a consumer reading strictly against spec §11.4 finds it.
    projectDir: outcome.plan.resolvedTargetPath,
    passthroughArgs: outcome.plan.passthroughArgs,
    officialScaffolder: outcome.plan.officialScaffolder,
    // Spec §11.4 CreateNocktaRepoResult.isMonorepoTarget (§19 Milestone 5) —
    // top-level, matching the spec field name exactly, alongside the fuller
    // `monorepo` detail object (signals/infoLine) this CLI's own --json
    // envelope adds on top of the spec-minimal shape.
    isMonorepoTarget: outcome.plan.monorepo.isMonorepoTarget,
    monorepo: {
      isMonorepoRoot: outcome.plan.monorepo.isMonorepoRoot,
      signals: outcome.plan.monorepo.signals,
      isNestedPath: outcome.plan.monorepo.isNestedPath,
      infoLine: outcome.plan.monorepo.infoLine,
    },
    architecture: architectureStatusJson(outcome.plan, architectureResult),
    // Spec §11.4 CreateNocktaRepoResult.architectureChanges — always present,
    // always the {created, updated, moved, skipped} shape, empty when
    // nothing was actually applied (dry run, --no-arch, upstream failure).
    architectureChanges: architectureChangesJson(architectureResult),
    // Spec §11.4 CreateNocktaRepoResult.skillsInjected (§19 Milestone 6) —
    // top-level boolean, matching the spec field name exactly, alongside the
    // fuller `skills` detail object this CLI's own --json envelope adds.
    skillsInjected: outcome.kind === "created" && outcome.skills.kind === "injected",
    skills: skillsStatusJson(outcome.plan, skillsOutcome),
    // Real as of Milestone 7 (spec §9): the repo-profile plan/outcome —
    // "planned" (dry run, path + field preview), "written" (real path +
    // object), "failed" (profile-write itself failed), or "not-attempted"
    // (never reached — an earlier step already failed, spec §13).
    metadata: profileStatusJson(outcome.plan, profileOutcome, profileError),
    // Spec §11.4 CreateNocktaRepoResult.warnings — real as of Milestone 7
    // (this milestone's brief item 3; Milestone 6 deferred it). D22: now
    // always leads with the plan's own --also dedup notices (see
    // collectWarnings()'s own header comment), present even under dry run.
    warnings: collectWarnings(outcome.plan, skillsOutcome),
    // The formal, spec §11.4-shaped assembly — see buildCreateNocktaRepoResult()'s
    // own header comment for why this exists ALONGSIDE the richer per-status
    // fields above rather than replacing them.
    result: buildCreateNocktaRepoResult({ plan: outcome.plan, architecture: architectureResult, skills: skillsOutcome }),
  };

  if (outcome.kind === "dry-run") {
    return base;
  }

  return {
    ...base,
    upstream: {
      ok: outcome.upstream.ok,
      exitCode: outcome.upstream.exitCode,
      signal: outcome.upstream.signal,
      durationMs: outcome.upstream.durationMs,
    },
  };
}
