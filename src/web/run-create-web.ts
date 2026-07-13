import { runCreateCommand } from "../commands/create.js";
import type { CreateCommandCliOptions } from "../commands/create.js";
import { resolveScaffolder, UnknownRepoTypeError } from "../scaffolders/registry.js";
import type { RepoType } from "../types/repo-type.js";
import { buildWebProjectSchema } from "./project-schema.js";
import type { WebProjectSchema } from "./project-schema.js";
import { fetchInjectSchema, emptyInjectSchema } from "./inject-schema.js";
import type { InjectWizardSchema } from "./inject-schema.js";
import { startCreateWebServer } from "./server.js";
import { openBrowser } from "./open-browser.js";

/**
 * create `--web` mode (decisions.md D30, the LAST web milestone — the create half). One browser page,
 * TWO stacked sections: "Project" (create's genesis Model) then "Skills" (inject's schema, fetched via
 * the `--emit-schema` CLI contract — D4 intact). On Confirm, create scaffolds + applies its
 * architecture overlay, then runs inject HEADLESS with the collected selections (`--include-skills`/
 * `--exclude-skills` deltas forwarded). No second browser tab; no reimplementation of inject's
 * selection UI — create HOSTS inject's schema, single source of truth.
 *
 * Structure mirrors inject's own `src/web/run-web-install.ts` closely: build first-paint schema →
 * serve → open browser → await the submit → run the real pipeline → done. The difference is the
 * submit RUNS create's pipeline (scaffold + overlay + headless inject) rather than resolving an
 * inject plan, and the page hosts a second (Project) section.
 */

/** The exact shape the page POSTs back — the two sections' collected answers. Plain JSON. */
export interface CreateWebAnswers {
  /** Project name/path (the `projectNameOrPath` handed to `runCreateCommand`). */
  projectPath: string;
  /** Chosen PRIMARY repo type (single). */
  repoType: RepoType;
  /** Secondary `--also` skill-domain types (never includes the primary). */
  alsoTypes: RepoType[];
  /** Recorded package manager, or null when not chosen/applicable. */
  packageManager?: "npm" | "pnpm" | "yarn" | "bun" | null;
  /** Architecture preset name, or `false` for --no-arch. */
  architecture: string | false;
  /** inject skills-version to spawn; undefined = latest. */
  skillsVersion?: string;
  /** Adapters chosen in the Skills section (from inject's schema). */
  adapters: string[];
  /** General (non-razor) skill deltas off the tier defaults. */
  skills: { excluded: string[]; included: string[] };
  /** Razor-layer deltas (all optional; `included` = chosen razor skills, `excluded` always empty). */
  razor: { excluded: string[]; included: string[] };
  /**
   * D36: the surfaced upstream-scaffolder option answers collected in the
   * Project section (keyed by each `UpstreamOption.key`), forwarded to the
   * type's `buildCommand`. Absent/empty for types with no options.
   */
  upstreamOptions?: Record<string, unknown>;
  confirmed?: boolean;
}

/** Structured outcome of a web submit — the page shows done/failed off `ok`; the CLI already printed the full summary to the terminal. */
export interface CreateWebSubmitResult {
  ok: boolean;
  exitCode: number;
  projectPath: string;
  /**
   * D36 / PART A: set when the chosen repo type's upstream scaffolder can't run
   * headlessly (Shopify Partner login). The submit does NOT run the doomed
   * headless pipeline — it hands the user back to their terminal with the exact
   * command to finish with. The page renders a "finish in your terminal" state;
   * `runCreateWeb` prints the same to the terminal. `ok` is false (nothing was
   * created) but this is a deliberate handoff, not a crash — exit code 0.
   */
  requiresTerminal?: { reason: string; command: string };
}

export interface CreateWebOptions {
  json?: boolean;
  /** `--no-open`: serve + print the URL but do not auto-launch a browser. */
  noOpen?: boolean;
  /** Pins `inject-nockta-skills@<version>` for BOTH the emit-schema spawn and the install spawn (decisions.md D14). */
  skillsVersion?: string;
  /** Pre-seed the Project section from `--type`/`--also`/`--arch`/`--adapters` (the `--web` + flags combo — flags pre-seed, the page is authoritative, D30). */
  presetType?: RepoType;
  presetAlso?: RepoType[];
  presetArch?: string | false;
  presetAdapters?: string[];
  /** Test-injection only — defaults to `process.cwd()`. The dir create scaffolds into / spawns inject in. */
  cwd?: string;
  /** Test-injection only — replaces the real page renderer. */
  renderPage?: (project: WebProjectSchema, skills: InjectWizardSchema, token: string) => string;
  /** Test-injection only — replaces the real create pipeline runner (so an e2e test can assert the argv/outcome without the real spawn chain). */
  runPipeline?: (answers: CreateWebAnswers) => Promise<CreateWebSubmitResult>;
}

/**
 * Converts the web answers into the SAME `CreateCommandCliOptions` a non-interactive
 * `create <name> --type <t> --also <..> --adapters <..> --yes` would produce — PLUS the web-collected
 * skill deltas forwarded as `--include-skills`/`--exclude-skills` (brief item 4). `yes: true` forces
 * create's HEADLESS inject path (decisions.md D29/D20), so the page's selections drive a captured
 * `--yes --json` install rather than re-opening inject's own terminal wizard.
 */
export function answersToCliOptions(answers: CreateWebAnswers, options: CreateWebOptions): CreateCommandCliOptions {
  const includeSkills = [...(answers.skills?.included ?? []), ...(answers.razor?.included ?? [])];
  const excludeSkills = [...(answers.skills?.excluded ?? []), ...(answers.razor?.excluded ?? [])];
  return {
    type: answers.repoType,
    also: answers.alsoTypes && answers.alsoTypes.length > 0 ? answers.alsoTypes.join(",") : undefined,
    arch: answers.architecture,
    adapters: answers.adapters && answers.adapters.length > 0 ? answers.adapters.join(",") : undefined,
    skills: true,
    skillsVersion: answers.skillsVersion ?? options.skillsVersion,
    includeSkills,
    excludeSkills,
    yes: true,
    // D36: forward the page's surfaced upstream-scaffolder option answers to
    // buildCommand, and detach the upstream spawn's stdin (PART A) so this
    // browser-driven run never depends on the launching terminal.
    upstreamOptions: answers.upstreamOptions,
    nonInteractiveUpstream: true,
    json: options.json,
    cwd: options.cwd,
  };
}

/**
 * D36 / PART A: the terminal-handoff CLI line shown when a `requiresTerminal`
 * type is submitted from the web flow — re-runs create in `--cli` mode so the
 * upstream scaffolder gets a real terminal for its login/prompts.
 */
export function terminalHandoffCommand(projectPath: string, repoType: string): string {
  const pathArg = projectPath && projectPath.length > 0 ? projectPath : "<path>";
  return `npm create nockta-repo@latest -- ${pathArg} --type ${repoType} --cli`;
}

/**
 * Runs create's REAL pipeline for a web submit (brief item 4): reuses `runCreateCommand` verbatim —
 * scaffolder → architecture overlay → headless inject install with the forwarded skill deltas — no
 * duplication of any of those code paths. `runCreateCommand` prints the human/JSON summary to the
 * terminal and sets `process.exitCode`; this reads that back into a structured result for the page.
 */
export async function runCreateWebSubmit(
  answers: CreateWebAnswers,
  options: CreateWebOptions,
): Promise<CreateWebSubmitResult> {
  // D36 / PART A: a `requiresTerminal` type (Shopify Partner login) can't run
  // headlessly — never spawn a doomed headless pipeline that would hang or fail
  // opaquely. Hand back to the terminal with the exact command, and let the
  // page render the "finish in your terminal" state.
  let requiresTerminal: { reason: string } | undefined;
  try {
    requiresTerminal = resolveScaffolder(answers.repoType).requiresTerminal;
  } catch (error) {
    if (!(error instanceof UnknownRepoTypeError)) throw error;
    // Unknown type falls through to the normal pipeline, which reports it
    // structurally (exit 2) — not this handoff branch's concern.
  }
  if (requiresTerminal) {
    return {
      ok: false,
      exitCode: 0,
      projectPath: answers.projectPath,
      requiresTerminal: {
        reason: requiresTerminal.reason,
        command: terminalHandoffCommand(answers.projectPath, answers.repoType),
      },
    };
  }

  const cliOptions = answersToCliOptions(answers, options);
  const prev = process.exitCode;
  process.exitCode = 0;
  await runCreateCommand(answers.projectPath, cliOptions);
  const exitCode = typeof process.exitCode === "number" ? process.exitCode : 0;
  // Restore so the web submit's outcome doesn't leak into the orchestrator's own exit unless it means to.
  process.exitCode = prev;
  return { ok: exitCode === 0, exitCode, projectPath: answers.projectPath };
}

/**
 * Impure orchestration (mirrors inject's `runWebInstall`): build the first-paint Project + Skills
 * schemas, serve them, open the browser, await the submit (which runs the pipeline), then exit with
 * the submit's code. Narration → STDERR so a `--json` consumer's stdout stays the single clean line.
 */
export async function runCreateWeb(options: CreateWebOptions): Promise<never> {
  const project = buildWebProjectSchema({
    presetType: options.presetType,
    presetAlso: options.presetAlso,
    presetArch: options.presetArch,
  });

  // First-paint Skills schema: only when a primary type is pre-seeded (else the page shows the
  // "pick a project type" placeholder and fetches reactively). Never fatal — a failed pre-fetch just
  // falls back to the placeholder; the reactive fetch retries on the first toggle.
  let initialSkills: InjectWizardSchema = emptyInjectSchema();
  if (options.presetType) {
    const types = [options.presetType, ...(options.presetAlso ?? [])].join(",");
    const adapters = (options.presetAdapters ?? []).join(",");
    try {
      initialSkills = await fetchInjectSchema({ types, adapters, skillsVersion: options.skillsVersion });
    } catch {
      initialSkills = emptyInjectSchema();
    }
  }

  const runPipeline = options.runPipeline ?? ((answers: CreateWebAnswers) => runCreateWebSubmit(answers, options));

  const handle = await startCreateWebServer({
    project,
    initialSkills,
    skillsVersion: options.skillsVersion,
    cwd: options.cwd,
    renderPage: options.renderPage,
    runPipeline,
  });

  const onSigint = (): void => {
    process.stderr.write("\nCancelled (Ctrl-C) — no changes made.\n");
    void handle.close().finally(() => process.exit(130));
  };
  process.on("SIGINT", onSigint);

  process.stderr.write(`\n  create-nockta-repo is running at:\n    ${handle.url}\n\n`);
  if (options.noOpen) {
    process.stderr.write("  Open that URL in your browser to continue. (Ctrl-C to cancel)\n");
  } else {
    openBrowser(handle.url);
    process.stderr.write("  Opening your browser… if it didn't open, paste the URL above. (Ctrl-C to cancel)\n");
  }

  let result: CreateWebSubmitResult;
  try {
    result = await handle.waitForResult();
  } catch (error) {
    process.removeListener("SIGINT", onSigint);
    process.stderr.write(`\n  Cancelled: ${(error as Error).message}\n`);
    await handle.close().catch(() => {});
    process.exit(1);
  }
  process.removeListener("SIGINT", onSigint);
  await handle.close().catch(() => {});
  // D36 / PART A: a requiresTerminal handoff — the browser can't finish this
  // type; print the exact terminal command so the user can continue there.
  if (result.requiresTerminal) {
    process.stderr.write(
      `\n  This project type must be finished in your terminal:\n    ${result.requiresTerminal.reason}\n\n` +
        `  Run:\n    ${result.requiresTerminal.command}\n\n`,
    );
  }
  process.exit(result.exitCode);
}
