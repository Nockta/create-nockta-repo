import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * Skills-injector integration (spec §8, §19 Milestone 6). Builds and spawns
 * `inject-nockta-skills`'s own CLI as a child process — never an npm
 * dependency, never a programmatic import (decisions.md D4, spec §8.1/§18.4).
 *
 * Two invocation shapes (spec §8.2, §6.4/§6.5, decisions.md D5, D9):
 * - **standalone** — run *inside the created project dir*:
 *   `install --type <repoType> --adapters <list> --yes --json`.
 * - **monorepo-target** — run *at the monorepo root* (this is how root
 *   adapters + `.nockta/targets.json` happen, per D5 — `create-nockta-repo`
 *   itself writes nothing to root `.nockta`):
 *   `install --target <path>:<type> --adapters <list> --yes --json`.
 *
 * Default binary resolution: `npx inject-nockta-skills@latest`.
 * `skillsVersion` switches this to `npx inject-nockta-skills@<version|dist-tag>`
 * (spec §5.2, §8.1, decisions.md D14).
 *
 * Test/dev override (mirrors `commands/create.ts`'s
 * `CREATE_NOCKTA_REPO_TEST_FIXTURE_BIN`/`CREATE_NOCKTA_REPO_TEST_ARCH_DIR`):
 * when {@link INJECT_BIN_OVERRIDE_ENV_VAR} is set, spawns
 * `node <that path> install ...` instead of `npx ...`. This is also the
 * *only* way to test this module against a real, running `install` command
 * until `inject-nockta-skills` is published — the real `npx` path only gets
 * a code-path test (command construction, see `buildInjectSkillsCommand`
 * below and `test/run-inject-skills.test.ts`), never a live-network test.
 * `test/create-skills.integration.test.ts` points this at the sibling
 * package's own real built `dist/cli.js` for the full-chain proof; a fixture
 * script that exits non-zero exercises the failure path.
 */
export const INJECT_BIN_OVERRIDE_ENV_VAR = "CREATE_NOCKTA_REPO_TEST_INJECT_BIN";

export type InjectSkillsMode = "standalone" | "monorepo-target";

/** Mirrors inject-nockta-skills' `InstallData["skippedPacks"][number]` shape (its spec §7.9 `--json` contract) — duplicated, not imported (same posture as decisions.md D7's RepoType/AdapterType mirroring). */
export type InjectSkippedPack = { name: string; missingSkills: string[] };

/** Mirrors inject-nockta-skills' `InstallData["skippedSkills"][number]` shape. */
export type InjectSkippedSkill = { pack: string; skill: string; reason: string };

/**
 * Mirrors inject-nockta-skills' `InstallData["targets"][number]` shape
 * (monorepo install only). D22 update (worker pass adding `--also`): inject's
 * real shape carries `repoTypes: string[]` per target (was singular
 * `repoType`) — verified against its actual built `dist/cli.js` output
 * (`src/core/inject-skills-monorepo.ts`'s `target.repoTypes`). This field is
 * declared for shape fidelity but not currently read by this package's own
 * code (create only ever installs ONE target per invocation and reads its
 * own separately-resolved `plan.repoTypes` for that).
 */
export type InjectTargetSummary = { name: string; path: string; repoTypes: string[]; installedPacks: string[] };

/**
 * Mirrors inject-nockta-skills' `install` command's `InstallData` shape
 * (`src/commands/install.ts` as of its own Milestone 5) — verified directly
 * against its real built `dist/cli.js` output, not guessed from the spec
 * prose alone. Notably: there is **no `version` field anywhere in this
 * shape** — see {@link readInjectedSkillsVersion} for where the resolved
 * version actually comes from.
 */
export type InjectInstallData = {
  /**
   * D22 update (worker pass adding `--also`): inject's real `install` command
   * shape carries `repoTypes: RepoType[] | null` (was singular `repoType`) —
   * verified against its actual built `dist/cli.js` output
   * (`src/commands/install.ts`'s `emptyData()`/`InstallData`). One or more
   * types for a single-project install; `null` before/without a resolvable
   * type, or for a monorepo install (per-target types live in
   * `targets[].repoTypes` instead — see {@link InjectTargetSummary}).
   */
  repoTypes: string[] | null;
  adapters: string[];
  targetDir: string;
  installedPacks: string[];
  skippedPacks: InjectSkippedPack[];
  skippedSkills: InjectSkippedSkill[];
  renderedFileCount: number;
  renderedFiles: string[];
  profilePath: string | null;
  manifestPath: string | null;
  isMonorepo: boolean;
  targets: InjectTargetSummary[];
  targetsPath: string | null;
  warnings: string[];
  /**
   * Milestone 7 addition (spec §9.2, decisions.md D14): the actual resolved
   * `inject-nockta-skills` version this run used. Landing in the SAME batch
   * as this package's own Milestone 7, in a sibling worker's pass over
   * `inject-nockta-skills` — not yet verified against a real built
   * `dist/cli.js` the way every other field on this type was (see this
   * module's own header comment for that verification precedent). Declared
   * `string | undefined` (optional, not required) and consumed defensively —
   * see {@link readInjectedSkillsVersion}'s caller in {@link runInjectSkills}:
   * this field wins when present, but an older/still-building inject build
   * that doesn't carry it yet falls back to the pre-existing
   * `.nockta/skills-profile.json`-read workaround unchanged. Flagged
   * explicitly as an assumption about field location (`data.version`, not a
   * top-level `InjectJsonResult.version`) — the sibling worker's actual
   * choice was not available to coordinate with directly.
   */
  version?: string;
};

/** Mirrors inject-nockta-skills' shared `JsonResult` envelope (its spec §7.9), narrowed to `command: "install"`. */
export type InjectJsonResult = {
  ok: boolean;
  command: string;
  exitCode: number;
  summary: string;
  data: InjectInstallData;
  errors?: string[];
};

export type BuildInjectSkillsCommandOptions = {
  mode: InjectSkillsMode;
  /**
   * Repo type string as understood by both packages' `RepoType` unions
   * (decisions.md D7). Legacy single-type field, kept for back-compat with
   * every pre-`--also` caller/test in this package — still required, still
   * works standalone. Superseded by {@link repoTypes} when that's also given
   * (D22, worker pass adding `--also`): pass the PRIMARY type here either way
   * (it's also the safe single-element fallback when `repoTypes` is omitted).
   */
  repoType: string;
  /**
   * D22 union of repo types to forward to inject — the PRIMARY type
   * (`repoType` above) first, then any `--also <type>[,<type>...]` secondary
   * skill-domain types. Wins over the legacy singular {@link repoType} when
   * non-empty (falls back to `[repoType]` otherwise) — see
   * `resolveTypesArg()` below. Joined with `,` for `--type` (standalone) or
   * `+` inside the colon `--target <path>:<type>[+<type>...]` form
   * (monorepo-target) — inject's own two documented multi-type separators
   * (decisions.md D22; `+` verified against inject's real
   * `core/parse-targets.ts::parseTargetArgs()`), never the same separator for
   * both modes.
   */
  repoTypes?: readonly string[];
  adapters: readonly string[];
  /** Pins `inject-nockta-skills@<version|dist-tag>`; omitted means `@latest` (spec §5.2, §8.1). */
  skillsVersion?: string;
  /**
   * D30 web-flow addition: the web-collected skill DELTAS forwarded to inject's own
   * `--include-skills`/`--exclude-skills` (inject supports both, decisions.md D19). Only the `--web`
   * submit path sets these — the interactive D29 handoff never does (inject's own wizard collects
   * skills there), and the flag-driven CLI path leaves them undefined (inject applies its tier
   * defaults). Empty/undefined arrays emit NO flag, so every pre-web caller/test is unaffected.
   */
  includeSkills?: readonly string[];
  excludeSkills?: readonly string[];
  /** Required in `"monorepo-target"` mode — the path AS PASSED to `create` (e.g. `"apps/web"`), relative to `cwd` below (spec §8.2, decisions.md D9's canonical `--target <path>:<type>` form). */
  targetPath?: string;
  /**
   * Working directory to spawn inject in. Standalone: the created project
   * directory. Monorepo target: the monorepo root — this is how root
   * adapters + `.nockta/targets.json` land there instead of inside the
   * target (spec §6.4/§6.5, decisions.md D5).
   */
  cwd: string;
  /**
   * Milestone 7 addition (decisions.md D18, this package's wizard preview
   * step) — appends `--dry-run` to the built `install` args, requesting
   * inject's plan-only output instead of a real write. Landing on inject's
   * `install` command in the SAME batch, in a sibling worker's pass — not
   * yet verified against a real built `dist/cli.js` the way the rest of this
   * module's command construction was. `wizard/steps/preview-plan.ts` is the
   * only caller that sets this; `commands/create.ts`'s own real (write) skill
   * injection never does. Never combined with the
   * {@link INJECT_BIN_OVERRIDE_ENV_VAR} test double unless that double itself
   * understands `--dry-run` — see `test/create-wizard-preview.test.ts` for
   * the graceful-degradation coverage when it doesn't (the documented
   * production behavior for an inject build that predates this flag, or any
   * other spawn/parse failure — see `runFetchSkillsPreview()` in
   * `wizard/steps/preview-plan.ts`).
   */
  dryRun?: boolean;
};

export type BuiltInjectSkillsCommand = {
  command: string;
  args: string[];
  cwd: string;
  /** Human-readable rendering of `command` + `args`, for dry-run printing (spec §5.7, this milestone's brief item 3) and error messages. */
  commandLine: string;
  /** True when {@link INJECT_BIN_OVERRIDE_ENV_VAR} was honored instead of the real `npx` path. */
  usesTestOverride: boolean;
};

/**
 * Resolves the union of repo types to forward (D22, worker pass adding
 * `--also`) — {@link BuildInjectSkillsCommandOptions.repoTypes} when
 * non-empty, else a one-element fallback from the legacy singular
 * {@link BuildInjectSkillsCommandOptions.repoType} (every pre-`--also`
 * caller/test in this package).
 */
function resolveTypesArg(options: BuildInjectSkillsCommandOptions): string[] {
  if (options.repoTypes && options.repoTypes.length > 0) return [...options.repoTypes];
  return [options.repoType];
}

/** D30: web-collected skill deltas → inject's `--include-skills`/`--exclude-skills` (D19). Empty/absent → no flag. */
function skillDeltaFlags(options: BuildInjectSkillsCommandOptions): string[] {
  const out: string[] = [];
  if (options.includeSkills && options.includeSkills.length > 0) out.push("--include-skills", options.includeSkills.join(","));
  if (options.excludeSkills && options.excludeSkills.length > 0) out.push("--exclude-skills", options.excludeSkills.join(","));
  return out;
}

function buildInstallArgs(options: BuildInjectSkillsCommandOptions): string[] {
  const types = resolveTypesArg(options);
  const adaptersArg = options.adapters.join(",");
  const dryRunFlag = options.dryRun ? ["--dry-run"] : [];
  const skillFlags = skillDeltaFlags(options);
  if (options.mode === "monorepo-target") {
    if (!options.targetPath) {
      // Programmer error, not a user-input error — commands/create.ts always
      // supplies targetPath when mode is "monorepo-target"; there is no CLI
      // flag path that reaches this without one.
      throw new Error("run-inject-skills: monorepo-target mode requires targetPath");
    }
    // D22: multiple types inside the colon `--target <path>:<type>[+<type>...]`
    // form are `+`-joined, NOT comma-joined — inject's own
    // `core/parse-targets.ts::parseTargetArgs()` parses the colon form's
    // right-hand side with `parseRepoTypesList(rawType, "+")` specifically
    // (comma is reserved for the standalone `--type` flag below and the
    // colon form's split-form convenience `--type`). A single type still
    // "joins" to just itself either way.
    return [
      "install",
      "--target",
      `${options.targetPath}:${types.join("+")}`,
      "--adapters",
      adaptersArg,
      ...skillFlags,
      ...dryRunFlag,
      "--yes",
      "--json",
    ];
  }
  return ["install", "--type", types.join(","), "--adapters", adaptersArg, ...skillFlags, ...dryRunFlag, "--yes", "--json"];
}

/**
 * Pure command construction — no spawning. Used both by {@link runInjectSkills}
 * itself and directly by `commands/create.ts`'s dry-run plan (spec §5.7),
 * which must print the exact command that *would* run (npx-shaped or
 * `CREATE_NOCKTA_REPO_TEST_INJECT_BIN`-overridden) without ever spawning it —
 * the same "resolve first, spawn separately" split `commands/create.ts`
 * already uses for the upstream scaffolder command.
 */
export function buildInjectSkillsCommand(options: BuildInjectSkillsCommandOptions): BuiltInjectSkillsCommand {
  const installArgs = buildInstallArgs(options);
  const override = process.env[INJECT_BIN_OVERRIDE_ENV_VAR];

  if (override) {
    const args = [override, ...installArgs];
    return {
      command: process.execPath,
      args,
      cwd: options.cwd,
      commandLine: [process.execPath, ...args].join(" "),
      usesTestOverride: true,
    };
  }

  const pkgSpec = options.skillsVersion ? `inject-nockta-skills@${options.skillsVersion}` : "inject-nockta-skills@latest";
  const args = [pkgSpec, ...installArgs];
  return {
    command: "npx",
    args,
    cwd: options.cwd,
    commandLine: ["npx", ...args].join(" "),
    usesTestOverride: false,
  };
}

/**
 * Options for the INTERACTIVE create->inject handoff (decisions.md D29). A strict subset of
 * {@link BuildInjectSkillsCommandOptions}: the repo type(s) to PRE-FILL and where to run — but
 * deliberately NO `adapters`/`dryRun`/`yes`/`json`, because the whole point of D29's interactive
 * handoff is to hand the user to inject's OWN wizard (which then asks for adapters + skills + razor)
 * with only the type step already answered. `--skills-version` still pins the npx `@<version>` spec
 * (unchanged) and the {@link INJECT_BIN_OVERRIDE_ENV_VAR} test double is still honored (brief item E).
 */
export type BuildInjectSkillsInteractiveOptions = {
  mode: InjectSkillsMode;
  repoType: string;
  repoTypes?: readonly string[];
  skillsVersion?: string;
  targetPath?: string;
  cwd: string;
};

/**
 * Builds the INTERACTIVE handoff argv (decisions.md D29) — inject's own wizard with the repo-type(s)
 * pre-filled and NOTHING else forced: `install --type <types>` (standalone) or
 * `install --target <path>:<type>[+<type>...]` (monorepo-target). No `--adapters`, no `--yes`, no
 * `--json` — inject's wizard runs in the same terminal with inherited stdio and prompts the user for
 * adapters/skills/razor. Honors the {@link INJECT_BIN_OVERRIDE_ENV_VAR} test double exactly like the
 * headless {@link buildInjectSkillsCommand} does, so the handoff is locally testable/runnable.
 */
export function buildInjectSkillsInteractiveCommand(
  options: BuildInjectSkillsInteractiveOptions,
): BuiltInjectSkillsCommand {
  const types = options.repoTypes && options.repoTypes.length > 0 ? [...options.repoTypes] : [options.repoType];
  const installArgs =
    options.mode === "monorepo-target"
      ? (() => {
          if (!options.targetPath) throw new Error("run-inject-skills: monorepo-target mode requires targetPath");
          return ["install", "--target", `${options.targetPath}:${types.join("+")}`];
        })()
      : ["install", "--type", types.join(",")];

  const override = process.env[INJECT_BIN_OVERRIDE_ENV_VAR];
  if (override) {
    const args = [override, ...installArgs];
    return {
      command: process.execPath,
      args,
      cwd: options.cwd,
      commandLine: [process.execPath, ...args].join(" "),
      usesTestOverride: true,
    };
  }
  const pkgSpec = options.skillsVersion ? `inject-nockta-skills@${options.skillsVersion}` : "inject-nockta-skills@latest";
  const args = [pkgSpec, ...installArgs];
  return {
    command: "npx",
    args,
    cwd: options.cwd,
    commandLine: ["npx", ...args].join(" "),
    usesTestOverride: false,
  };
}

/** Outcome of the interactive handoff spawn (decisions.md D29). Never carries parsed `--json` — inject's wizard printed to the inherited terminal, not to a captured pipe. */
export type InjectSkillsInteractiveResult = {
  command: string;
  args: string[];
  cwd: string;
  /** inject's own exit code: 0 = the user completed its wizard; non-zero = cancelled/declined (NOT a create failure). `null` if killed by a signal. */
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  usesTestOverride: boolean;
};

/**
 * Spawns inject's INTERACTIVE wizard with INHERITED stdio (decisions.md D29) — inject's own prompts
 * render in the SAME terminal, type step pre-filled, user picks adapters/skills/razor there. Resolves
 * with inject's exit code on close (even a NON-ZERO one — a user declining inject's confirm is their
 * choice, not a create failure; the caller decides what a non-zero exit means). Rejects with a typed
 * {@link InjectSkillsFailure} (`spawn-error`) ONLY when the process fails to even launch. Honors
 * {@link INJECT_BIN_OVERRIDE_ENV_VAR}.
 */
export async function runInjectSkillsInteractive(
  options: BuildInjectSkillsInteractiveOptions,
): Promise<InjectSkillsInteractiveResult> {
  const built = buildInjectSkillsInteractiveCommand(options);
  const start = Date.now();

  return new Promise<InjectSkillsInteractiveResult>((resolve, reject) => {
    let settled = false;
    const child = spawn(built.command, built.args, {
      cwd: built.cwd,
      // Inherited stdio (D29): inject's wizard talks to the real terminal directly. Nothing to capture.
      stdio: "inherit",
      shell: false,
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(
        new InjectSkillsFailure(
          {
            reason: "spawn-error",
            command: built.command,
            args: built.args,
            cwd: built.cwd,
            exitCode: null,
            signal: null,
            stdout: "",
            stderrTail: "",
          },
          error,
        ),
      );
    });

    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      resolve({
        command: built.command,
        args: built.args,
        cwd: built.cwd,
        exitCode,
        signal,
        durationMs: Date.now() - start,
        usesTestOverride: built.usesTestOverride,
      });
    });
  });
}

export type RunInjectSkillsOptions = BuildInjectSkillsCommandOptions;

export type InjectSkillsSuccess = {
  ok: true;
  command: string;
  args: string[];
  cwd: string;
  exitCode: number;
  durationMs: number;
  result: InjectJsonResult;
  /**
   * Resolved `inject-nockta-skills` version actually used (spec §9.2's
   * `skillsVersion` — "not the `--skills-version` flag echoed back", the
   * actual resolved version). **Not** read from `result.data` — verified
   * directly against inject's real built output that `InstallData` carries
   * no version field of any kind. Instead read from the `.nockta/skills-profile.json`
   * file inject itself just wrote (path taken from `result.data.profilePath`,
   * which is present for both the standalone and monorepo shapes — see
   * {@link readInjectedSkillsVersion}). `null` if that file couldn't be read
   * — best-effort only, never fails the run for this alone.
   */
  skillsVersion: string | null;
};

export type InjectSkillsFailureReason = "spawn-error" | "nonzero-exit" | "unparseable-output";

export type InjectSkillsFailureDetails = {
  reason: InjectSkillsFailureReason;
  command: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  /** Last {@link STDERR_TAIL_MAX_CHARS} characters of stderr — enough to diagnose without unbounded buffering into `--json` output. */
  stderrTail: string;
};

/**
 * Thrown by {@link runInjectSkills} on any non-success outcome: nonzero exit
 * (or killed by signal), unparseable `--json` output on stdout (this
 * milestone's brief item 1: "on nonzero exit or unparseable output → typed
 * failure carrying inject's exit code and stderr tail"), or the command
 * failing to even launch. Mirrors `run-upstream.ts`'s `UpstreamFailure`
 * shape/spirit — a typed class with structured `.details`, not a bare
 * string throw.
 */
export class InjectSkillsFailure extends Error {
  readonly details: InjectSkillsFailureDetails;

  constructor(details: InjectSkillsFailureDetails, cause?: unknown) {
    const commandLine = [details.command, ...details.args].join(" ");
    const outcome =
      details.reason === "spawn-error"
        ? "failed to launch"
        : details.reason === "unparseable-output"
          ? `exited ${details.exitCode ?? "unknown"} but did not print parseable single-line --json output`
          : `exited with code ${details.exitCode ?? "unknown"}`;
    super(`inject-nockta-skills failed: ${commandLine} (${outcome})`, cause !== undefined ? { cause } : undefined);
    this.name = "InjectSkillsFailure";
    this.details = details;
  }
}

const STDERR_TAIL_MAX_CHARS = 4000;

function stderrTail(text: string, maxChars = STDERR_TAIL_MAX_CHARS): string {
  return text.length <= maxChars ? text : text.slice(text.length - maxChars);
}

/** Spec §7.9: "`--json` prints exactly one structured result object to stdout at the end of the run." Anything else — zero lines, multiple lines, invalid JSON — is treated as unparseable, never guessed at. */
function parseSingleJsonLine(stdout: string): { ok: true; value: InjectJsonResult } | { ok: false } {
  const lines = stdout.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length !== 1) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(lines[0]) as InjectJsonResult };
  } catch {
    return { ok: false };
  }
}

/**
 * Reads the resolved `inject-nockta-skills` version actually used, from the
 * `.nockta/skills-profile.json` file it just wrote (see
 * {@link InjectSkillsSuccess.skillsVersion} for why this file, not the
 * `--json` result, is the source). Works for both the single-project and
 * monorepo profile shapes — both carry a top-level `version` field (verified
 * against inject's real `src/types/profile.ts` and its actual written
 * output). Never throws — a missing/unreadable/malformed profile just means
 * "unknown" (`null`), not a run failure; the install itself already
 * succeeded by the time this is called.
 */
export function readInjectedSkillsVersion(profilePath: string | null): string | null {
  if (!profilePath) return null;
  try {
    const raw = readFileSync(profilePath, "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

/**
 * Spawns `inject-nockta-skills install ...` for real (spec §8.1/§8.2, §19
 * Milestone 6) and resolves with a structured {@link InjectSkillsSuccess}, or
 * rejects with a typed {@link InjectSkillsFailure} carrying inject's exit
 * code and a stderr tail. `stdio` is always `["ignore", "pipe", "pipe"]` —
 * unlike `run-upstream.ts`'s upstream scaffolders (which are interactive and
 * need a real TTY passthrough), inject's non-interactive `--json` install is
 * always driven with `--yes` and produces a single machine-readable line;
 * piping stdout/stderr is what lets this module actually parse and report
 * on it, per spec §7.9's own machine-interface contract.
 */
export async function runInjectSkills(options: RunInjectSkillsOptions): Promise<InjectSkillsSuccess> {
  const built = buildInjectSkillsCommand(options);
  const start = Date.now();

  return new Promise<InjectSkillsSuccess>((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";

    const child = spawn(built.command, built.args, {
      cwd: built.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(
        new InjectSkillsFailure(
          {
            reason: "spawn-error",
            command: built.command,
            args: built.args,
            cwd: built.cwd,
            exitCode: null,
            signal: null,
            stdout,
            stderrTail: stderrTail(stderr),
          },
          error,
        ),
      );
    });

    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      const durationMs = Date.now() - start;

      if (exitCode !== 0 || signal !== null) {
        reject(
          new InjectSkillsFailure({
            reason: "nonzero-exit",
            command: built.command,
            args: built.args,
            cwd: built.cwd,
            exitCode,
            signal,
            stdout,
            stderrTail: stderrTail(stderr),
          }),
        );
        return;
      }

      const parsed = parseSingleJsonLine(stdout);
      if (!parsed.ok) {
        reject(
          new InjectSkillsFailure({
            reason: "unparseable-output",
            command: built.command,
            args: built.args,
            cwd: built.cwd,
            exitCode,
            signal,
            stdout,
            stderrTail: stderrTail(stderr),
          }),
        );
        return;
      }

      const result = parsed.value;
      if (!result.ok) {
        // Belt-and-suspenders: inject's own contract (spec §7.9) never pairs
        // exit 0 with ok:false, but this module doesn't trust that pairing
        // blindly either — same defensive posture as the rest of this
        // package (e.g. run-upstream.ts never assumes exitCode and ok agree
        // either).
        reject(
          new InjectSkillsFailure({
            reason: "nonzero-exit",
            command: built.command,
            args: built.args,
            cwd: built.cwd,
            exitCode: result.exitCode ?? exitCode,
            signal: null,
            stdout,
            stderrTail: stderrTail(stderr),
          }),
        );
        return;
      }

      resolve({
        ok: true,
        command: built.command,
        args: built.args,
        cwd: built.cwd,
        exitCode,
        durationMs,
        result,
        // Milestone 7 (spec §9.2, decisions.md D14): prefer inject's own
        // --json `data.version` field now that it may be present (see
        // InjectInstallData.version's own header comment for the "landing in
        // the same batch, verified defensively, not yet against a real
        // build" caveat) — fall back to the pre-existing
        // .nockta/skills-profile.json-read workaround unchanged when it
        // isn't (an inject build from before this field existed, or any
        // other reason it's absent/blank).
        skillsVersion:
          typeof result.data.version === "string" && result.data.version.length > 0
            ? result.data.version
            : readInjectedSkillsVersion(result.data.profilePath),
      });
    });
  });
}
