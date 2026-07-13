import pc from "picocolors";
import { EXIT_CODE, emitError, runCreateCommand } from "./create.js";
import type { CreateCommandCliOptions } from "./create.js";
import { runCreateWizard } from "../wizard/run-create-wizard.js";
import type { Presenter } from "../wizard/view/presenter.js";
import { resolveWebPrecedence } from "../web/precedence.js";
import { detectDisplay } from "../web/display.js";
import { runCreateWeb } from "../web/run-create-web.js";
import { isRepoType } from "../types/repo-type.js";
import type { RepoType } from "../types/repo-type.js";

/**
 * Routing entry point for the default/`create` command (spec §4/§5.1/§5.2,
 * this milestone's brief item 6) — mirrors `inject-nockta-skills`'
 * `src/commands/install-entry.ts` exactly (same routing shape, same names
 * where sensible): `src/cli.ts` calls this from BOTH the implicit default
 * command AND the `create` subcommand action with equivalent parsed options,
 * so the two stay byte-for-byte identical by construction — one routing
 * decision function, not two copies that could drift (same reasoning as
 * inject's own header comment).
 *
 * Routing:
 * - sufficient flags (`projectNameOrPath` AND `--type` AND (`--yes` OR
 *   `--dry-run`) — see `hasSufficientCreateFlags()`'s own header comment for
 *   the Milestone 8 / decisions.md D20 `--yes` widening) -> the EXISTING
 *   non-interactive path (`runCreateCommand()`), completely unchanged
 *   behavior.
 * - insufficient flags, but NOT a real TTY -> a structured, NON-HANGING error
 *   (spec §6-equivalent reasoning, this milestone's brief item 6): never
 *   prints wizard text to a non-TTY/JSON consumer, never calls
 *   `@inquirer/prompts`. This is `inject-nockta-skills`' own "commander
 *   root-flags-only lesson" applied here too — see `emitInsufficientFlagsError()`
 *   below, which reuses `commands/create.ts::emitError()`'s exact "one JSON
 *   line / human error" shaping rather than inventing a second one.
 * - insufficient flags AND a real TTY -> the interactive wizard
 *   (`runCreateWizard()`), which receives whatever partial flags WERE given
 *   as step presets (mirrors inject's own "flags fill in wizard steps, they
 *   are not simply discarded" principle) — this now ALSO includes the case
 *   of "path + --type given, --yes missing, real TTY" (D20 consequence, see
 *   `hasSufficientCreateFlags()`).
 */
export interface CreateEntryOptions extends CreateCommandCliOptions {
  /** Test-injection only — defaults to a real TTY check (`process.stdin.isTTY && process.stdout.isTTY`), same convention as `inject-nockta-skills`' `commands/install-entry.ts::defaultIsTTY()`. */
  isTTY?: boolean;
  /** Test-injection only — replaces the wizard's real CLI two-pane presenter (the View) with a scripted fake. */
  wizardPresenter?: Presenter;
  /** Test-injection only — replaces the wizard's narration log function. */
  wizardLog?: (message: string) => void;
  /** D30 `--web`: opt into the browser page. */
  web?: boolean;
  /** D30 `--cli`: force the terminal path even alongside `--web`. */
  cli?: boolean;
  /** D30 `--no-open`: serve + print the URL without auto-launching a browser (also treated as display-available). */
  noOpen?: boolean;
  /** Test-injection only — defaults to the real display heuristic (`web/display.ts`). */
  hasDisplay?: boolean;
}

function defaultIsTTY(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/**
 * Pure "is this invocation non-interactive-capable" gate. Base check
 * (`projectNameOrPath` AND `cliOptions.type` both present) is the SAME one
 * `commands/create.ts::runCreateCommand()` has used since Milestone 1.
 *
 * **Milestone 8 / decisions.md D20 (was deliberately NOT the case through
 * Milestone 7 — see that decision for the full reconciliation)**: now ALSO
 * requires `--yes` (or `--dry-run`), widened to match `inject-nockta-skills`'
 * own `hasSufficientInstallFlags()` exactly — same shape, same `--dry-run`
 * exemption (a dry run never writes and never needs confirmation, spec §5.7;
 * `commands/create.ts`'s own dry-run branch bypasses every write path before
 * `--yes` would ever matter). D20's own wording: "non-interactive create-
 * nockta-repo EXECUTION requires --yes (aligning with inject-nockta-skills
 * and the spec's own §5.2 example; --dry-run remains exempt)". Spec §5.2
 * itself: "Non-interactive execution requires --yes; without it (and without
 * a TTY) the command exits with invalid input."
 *
 * Consequence, called out explicitly (not hidden in a diff): `--type next
 * my-project` given from a REAL TTY with no `--yes` and no `--dry-run` now
 * counts as "insufficient" too — it no longer runs straight through
 * non-interactively; it falls into the same "insufficient + TTY -> wizard"
 * branch as any other missing-flag case below (presets threaded through, so
 * only the confirm step genuinely prompts). This mirrors inject's own
 * behavior for `install` and is a deliberate, not incidental, part of this
 * decision — no code path exists to require `--yes` only for the truly
 * non-interactive case without ALSO changing what counts as "sufficient" for
 * routing, since the wizard's own step-11 handoff
 * (`wizard/run-create-wizard.ts::runCreateWizard()`) calls
 * `commands/create.ts::runCreateCommand()` directly, without ever setting
 * `cliOptions.yes` — confirmation there comes from the interactive step 10
 * prompt, not the flag. Putting the `--yes` requirement here (the ROUTING
 * gate), rather than inside `runCreateCommand()`/`resolveCreatePlan()`
 * themselves, is exactly what keeps the wizard's real (confirmed) execution
 * unaffected, per D20/this milestone's brief: "--dry-run and wizard-TTY
 * paths unaffected."
 */
export function hasSufficientCreateFlags(
  projectNameOrPath: string | undefined,
  cliOptions: Pick<CreateCommandCliOptions, "type" | "yes" | "dryRun">,
): boolean {
  const hasPathAndType = Boolean(projectNameOrPath) && Boolean(cliOptions.type);
  return hasPathAndType && (cliOptions.yes === true || cliOptions.dryRun === true);
}

function emitInsufficientFlagsError(
  cliOptions: CreateCommandCliOptions,
  projectNameOrPath: string | undefined,
): void {
  const missing: string[] = [];
  if (!projectNameOrPath) missing.push("a project name/path");
  if (!cliOptions.type) missing.push("--type <repoType>");
  // D20: --yes is only "missing" once path+type are both present and it's
  // not a dry run — an incomplete invocation should name the more
  // fundamental problem first, not pile on a --yes complaint for an
  // invocation that was never going anywhere regardless.
  if (projectNameOrPath && cliOptions.type && cliOptions.yes !== true && cliOptions.dryRun !== true) {
    missing.push("--yes (non-interactive execution requires confirmation — --dry-run is exempt)");
  }
  const message =
    `create-nockta-repo needs ${missing.join(" and ")} to run non-interactively, and no interactive ` +
    "terminal was detected, so the wizard cannot run either (the wizard requires a real TTY). " +
    "Re-run with the missing flag(s), or from an interactive terminal.";
  emitError(cliOptions, {
    code: "insufficient-flags",
    message,
    details: {
      projectNameOrPath: projectNameOrPath ?? null,
      type: cliOptions.type ?? null,
      yes: cliOptions.yes ?? false,
      dryRun: cliOptions.dryRun ?? false,
      missing,
    },
  });
}

/** CSV → validated RepoType list (drops unknowns — the web page/pipeline re-validate authoritatively; these are only pre-seeds). */
function parseRepoTypeCsv(raw: string | undefined): RepoType[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is RepoType => isRepoType(s));
}

export async function runCreateEntry(
  projectNameOrPath: string | undefined,
  options: CreateEntryOptions,
): Promise<void> {
  const isTTY = options.isTTY ?? defaultIsTTY();

  // D30 web-vs-CLI precedence, mirrored from inject's `commands/install-entry.ts`. `--cli` forces the
  // CLI route; `--no-open` makes the box count as display-available (serve + print the URL). `--web`
  // outranks `--yes` when a display is available (the page is authoritative; flags only pre-seed it).
  const wantWeb = options.web === true && options.cli !== true;
  const hasDisplay =
    options.hasDisplay ?? (options.noOpen === true ? true : detectDisplay(process.env, process.platform));
  const decision = resolveWebPrecedence({ web: wantWeb, yes: options.yes === true, hasDisplay, isTTY });

  if (decision.mode === "web") {
    // The page collects the project name/path itself; the flags pre-seed the Project section (D30).
    const presetType = options.type && isRepoType(options.type) ? (options.type as RepoType) : undefined;
    await runCreateWeb({
      json: options.json,
      noOpen: options.noOpen,
      skillsVersion: options.skillsVersion,
      presetType,
      presetAlso: parseRepoTypeCsv(options.also),
      presetArch: options.arch,
      presetAdapters: options.adapters ? options.adapters.split(",").map((s) => s.trim()).filter((s) => s.length > 0) : [],
      cwd: options.cwd,
    });
    return;
  }

  if (decision.mode === "error") {
    // No display, no TTY, no --yes to fall back to (only reachable with --web set). Clean exit-1, never a hang.
    const message = `create-nockta-repo cannot proceed: ${decision.reason}`;
    if (options.json) {
      console.log(JSON.stringify({ ok: false, error: { code: "no-display-no-tty", message, details: {} } }));
    } else {
      console.error(pc.bold(pc.red("create-nockta-repo — cannot open the web page")));
      console.error(message);
    }
    process.exitCode = 1;
    return;
  }

  // decision.mode === "cli": the existing routing decides sufficient / non-TTY error / wizard.
  const sufficient = hasSufficientCreateFlags(projectNameOrPath, options);

  if (sufficient) {
    await runCreateCommand(projectNameOrPath, options);
    return;
  }

  if (!isTTY) {
    emitInsufficientFlagsError(options, projectNameOrPath);
    process.exitCode = EXIT_CODE.INVALID_TARGET;
    return;
  }

  await runCreateWizard({
    presetProjectPath: projectNameOrPath,
    presetType: options.type,
    presetAlso: options.also,
    presetArch: options.arch,
    presetAdapters: options.adapters,
    presetSkillsVersion: options.skillsVersion,
    presetPassthroughArgs: options.passthroughArgs,
    json: options.json,
    presenter: options.wizardPresenter,
    log: options.wizardLog,
    cwd: options.cwd,
  });
}

/**
 * Routing for the standalone `wizard` subcommand (pre-existing since
 * Milestone 1, spec §10's own file tree implies no dedicated entry beyond
 * `runCreateWizard()` itself — this package adds one). Now that the wizard
 * is REAL (Milestone 7) rather than a print-only shell, running it from a
 * non-TTY process would hang forever on a real `@inquirer/prompts` call —
 * gated behind the SAME TTY check as the default-command routing above, for
 * the same "never hang" reason (this milestone's brief item 6).
 */
export async function runWizardEntry(options: { json?: boolean; isTTY?: boolean } = {}): Promise<void> {
  const isTTY = options.isTTY ?? defaultIsTTY();
  if (!isTTY) {
    const message =
      "create-nockta-repo wizard requires an interactive terminal (no TTY detected) — " +
      "use non-interactive flags instead (see --help), or run this from a real terminal.";
    if (options.json) {
      console.log(JSON.stringify({ ok: false, error: { code: "no-tty", message, details: {} } }));
    } else {
      console.error(pc.bold(pc.red("create-nockta-repo — cannot run the wizard")));
      console.error(message);
    }
    process.exitCode = EXIT_CODE.INVALID_TARGET;
    return;
  }
  await runCreateWizard({ json: options.json });
}
