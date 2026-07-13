import { spawn } from "node:child_process";
import { INJECT_BIN_OVERRIDE_ENV_VAR } from "../core/run-inject-skills.js";

/**
 * The create-side host for `inject-nockta-skills`' wizard schema (decisions.md D30). create's `--web`
 * page renders TWO sections — "Project" (create's own genesis steps) then "Skills". The Skills
 * section is NOT reimplemented here: create HOSTS inject's schema, fetched via the D30 composition
 * contract `inject wizard --emit-schema --type <types> [--adapters <csv>]` — still a pure CLI spawn
 * (D4 intact, no npm dependency, no programmatic import), exactly the same integration seam
 * `core/run-inject-skills.ts` already uses for the real install. The single source of truth stays
 * inject: it emits its skill/adapter/razor offering, create draws it.
 *
 * The types below are a STRUCTURAL MIRROR of inject's own `wizard/core/types.ts` `WizardSchema`
 * (copied, not imported — the two packages are independent, D7's "duplicate the contract" posture,
 * same as the `RepoType`/`InjectInstallData` mirrors already in this package). Only the fields the
 * page reads are declared; the payload is plain JSON end to end.
 */
export interface InjectChoice {
  value: string;
  label: string;
  title?: string;
  description?: string;
  tier?: "required" | "default" | "optional";
  pack?: string;
  section?: string;
  checked: boolean;
  disabled: boolean;
  disabledReason?: string;
  clashesWith?: string[];
}

export interface InjectSection {
  pack: string;
  key?: string;
  label: string;
}

export interface InjectStep {
  id: string;
  kind: string;
  title: string;
  choices?: InjectChoice[];
  sections?: InjectSection[];
  pageSize?: number;
  preamble?: string;
}

export interface InjectWizardSchema {
  monorepo: boolean;
  repoTypes: string[];
  adapters: string[];
  steps: InjectStep[];
}

/**
 * The empty-skills marker (decisions.md D30, documented decision): when the page has NO primary
 * repo-type chosen yet, the reactive `/inject-schema` endpoint returns THIS instead of spawning
 * inject — a spawn with no `--type` would make inject DETECT the server's own cwd project (create's
 * own repo), which is not what "no type chosen" means. The page renders its "pick a project type to
 * see skills" placeholder off an empty `steps` array. `adapters: []` so no adapter card shows either.
 */
export function emptyInjectSchema(): InjectWizardSchema {
  return { monorepo: false, repoTypes: [], adapters: [], steps: [] };
}

export interface FetchInjectSchemaOptions {
  /** Comma-separated repo types (primary + `--also`) — the Skills offering is derived from these. */
  types: string;
  /** Comma-separated adapters — echoed back into the returned schema's adapter `checked` state (pre-seed preservation). */
  adapters?: string;
  /** Pins `inject-nockta-skills@<version|dist-tag>` for the spawn; omitted → `@latest`. Same as the install spawn (decisions.md D14). */
  skillsVersion?: string;
  /** Cap on inject's stdout, mirroring the server's own body cap — a hostile/broken child can't exhaust memory. */
  maxBytes?: number;
}

/** Human-readable argv rendering (dry-run/error/proof reporting), plus the split pieces the spawn uses. */
export interface BuiltEmitSchemaCommand {
  command: string;
  args: string[];
  commandLine: string;
  usesTestOverride: boolean;
}

/**
 * Pure argv construction for the emit-schema spawn — no spawning. Honors {@link INJECT_BIN_OVERRIDE_ENV_VAR}
 * (the SAME `CREATE_NOCKTA_REPO_TEST_INJECT_BIN` override the real install spawn uses — brief item E,
 * both spawns) and the SAME `@latest`/`@<skills-version>` pkgSpec logic as `buildInjectSkillsCommand`.
 * `wizard --emit-schema` is inject's create-hosting contract entrypoint (decisions.md D30).
 */
export function buildEmitSchemaCommand(options: FetchInjectSchemaOptions): BuiltEmitSchemaCommand {
  const emitArgs = ["wizard", "--emit-schema", "--type", options.types];
  if (options.adapters && options.adapters.length > 0) {
    emitArgs.push("--adapters", options.adapters);
  }

  const override = process.env[INJECT_BIN_OVERRIDE_ENV_VAR];
  if (override) {
    const args = [override, ...emitArgs];
    return {
      command: process.execPath,
      args,
      commandLine: [process.execPath, ...args].join(" "),
      usesTestOverride: true,
    };
  }
  const pkgSpec = options.skillsVersion ? `inject-nockta-skills@${options.skillsVersion}` : "inject-nockta-skills@latest";
  const args = [pkgSpec, ...emitArgs];
  return { command: "npx", args, commandLine: ["npx", ...args].join(" "), usesTestOverride: false };
}

const DEFAULT_MAX_BYTES = 4_000_000;

/**
 * Spawns `inject wizard --emit-schema --type <types> [--adapters <csv>]`, parses its single stdout
 * JSON line, and returns it (decisions.md D30). Empty `types` short-circuits to the empty-skills
 * marker WITHOUT spawning (see {@link emptyInjectSchema}). Rejects on spawn failure, nonzero exit, or
 * unparseable stdout — the caller (the `/inject-schema` endpoint) maps that to a 500.
 */
export function fetchInjectSchema(options: FetchInjectSchemaOptions): Promise<InjectWizardSchema> {
  const types = options.types.trim();
  if (types.length === 0) {
    return Promise.resolve(emptyInjectSchema());
  }

  const built = buildEmitSchemaCommand({ ...options, types });
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  return new Promise<InjectWizardSchema>((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let overflow = false;

    const child = spawn(built.command, built.args, { stdio: ["ignore", "pipe", "pipe"], shell: false });

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > maxBytes) {
        overflow = true;
        child.kill();
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(new Error(`emit-schema spawn failed (${built.commandLine}): ${error.message}`));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (overflow) {
        reject(new Error(`emit-schema output exceeded ${maxBytes} bytes (${built.commandLine})`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`emit-schema exited ${code ?? "unknown"} (${built.commandLine}): ${stderr.slice(-2000)}`));
        return;
      }
      const line = stdout.split("\n").find((l) => l.trim().length > 0);
      if (!line) {
        reject(new Error(`emit-schema printed no JSON (${built.commandLine})`));
        return;
      }
      try {
        resolve(JSON.parse(line) as InjectWizardSchema);
      } catch (err) {
        reject(new Error(`emit-schema printed unparseable JSON (${built.commandLine}): ${(err as Error).message}`));
      }
    });
  });
}
