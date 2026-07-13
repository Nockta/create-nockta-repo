import { Command, Option } from "commander";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { runCreateEntry, runWizardEntry } from "./commands/create-entry.js";
import { runListCommand } from "./commands/list.js";

// `Command#rawArgs` is a real runtime property (commander/lib/command.js:
// `this.rawArgs = argv.slice()`, set during `parse`/`parseAsync`) but is not
// part of commander's public .d.ts. Declared here rather than cast at every
// call site — see `extractPassthroughArgs` below for why it's needed.
declare module "commander" {
  interface Command {
    rawArgs: string[];
  }
}

const VERSION = "0.1.0";

export const program = new Command();

program
  .name("create-nockta-repo")
  .description(
    "Creates new repositories or project targets using official framework scaffolders, " +
      "Nockta architecture overlays, and inject-nockta-skills adapter rendering.",
  )
  .version(VERSION)
  .option("--json", "print machine-readable JSON output instead of human-formatted text")
  .option(
    "--skills-version <version|dist-tag>",
    "pin the inject-nockta-skills version/dist-tag to spawn; defaults to @latest",
  );

program
  .command("create")
  .description("create a new project — also the default when no subcommand is given")
  .argument("[projectNameOrPath]", "project name or path to create")
  .option("--type <repoType>", "repo type (see `create-nockta-repo list`)")
  .option(
    "--also <types>",
    "comma-separated secondary skill-domain repo types unioned with --type and forwarded to " +
      "inject-nockta-skills — never a second scaffolder/overlay",
  )
  .option("--arch <preset>", "architecture preset (default: standard)")
  .option("--no-arch", "skip the architecture overlay entirely")
  .option("--adapters <list>", "comma-separated AI adapters, e.g. claude,cursor (default: claude)")
  .option("--no-skills", "skip the inject-nockta-skills step entirely")
  .option(
    "--web",
    "open a local browser page (Project + Skills sections) to set up the project (decisions.md D30). " +
      "Falls back to the terminal wizard (or --yes) when no display is available.",
  )
  .option("--cli", "force the terminal path even if --web is also given (decisions.md D30)")
  .option("--no-open", "with --web: serve and print the URL but do not auto-launch a browser (decisions.md D30)")
  .option("--dry-run", "print the plan without creating anything")
  .option(
    "--yes",
    "required for non-interactive execution — --dry-run is exempt",
  )
  .option("--force", "overwrite an existing target directory")
  // Passthrough args (spec §5.4) land after a literal `--`, which Commander
  // folds into extra positional operands beyond the single `[projectNameOrPath]`
  // argument it declares — without this, Commander rejects them outright as
  // "too many arguments". extractPassthroughArgs() below recovers them
  // precisely from the raw argv instead of trusting Commander's own
  // positional-arg bookkeeping (see its doc comment for why).
  .allowExcessArguments(true)
  .action(async (projectNameOrPath: string | undefined, options, command: Command) => {
    const globalOptions = command.optsWithGlobals();
    const passthroughArgs = extractPassthroughArgs(program.rawArgs);
    // Milestone 7 (spec §6-equivalent reasoning, decisions.md-mirrored
    // routing): sufficient flags -> unchanged non-interactive path;
    // insufficient + TTY -> the real wizard; insufficient + non-TTY ->
    // structured, non-hanging error. See commands/create-entry.ts.
    await runCreateEntry(projectNameOrPath, {
      ...options,
      passthroughArgs,
      // D30: `--web`/`--cli`, and commander's `--no-open` negation (`options.open === false`).
      web: options.web,
      cli: options.cli,
      noOpen: options.open === false,
      skillsVersion: options.skillsVersion ?? globalOptions.skillsVersion,
      json: options.json ?? globalOptions.json,
    });
  });

program
  .command("list")
  .description("list supported repo types and their upstream scaffolder commands")
  .option("--details", "show scaffolder/architecture/skill-pack detail (not yet implemented)")
  .action(async (options, command: Command) => {
    const globalOptions = command.optsWithGlobals();
    await runListCommand({ ...options, json: globalOptions.json });
  });

program
  .command("wizard")
  .description("run the interactive create wizard directly (requires a real TTY)")
  .action(async (_options, command: Command) => {
    const globalOptions = command.optsWithGlobals();
    await runWizardEntry({ json: globalOptions.json });
  });

const KNOWN_SUBCOMMANDS = new Set(["create", "list", "wizard", "help"]);

/**
 * Root cause (bigger than it first looked): the argv-preprocessing loop
 * below decides where to splice in the implicit `create` token by walking
 * leading `-`-prefixed tokens and, historically, treating *every* one of
 * them as safely skippable — as if every option were either global or
 * irrelevant to the insertion point. That's only true for options `program`
 * itself recognizes (`--json`, `--skills-version`, Commander's own
 * `--help`/`--version`). Any `create`-scoped option — `--type`, `--arch`,
 * `--adapters`, and just as much the *boolean* ones (`--dry-run`, `--yes`,
 * `--force`) — isn't recognized by the root `program` at all, so `create`
 * must be spliced in *before* it, not after. The old code only got this
 * right by accident, whenever a plain positional happened to appear before
 * any such option; `resolveArgv(["--type", "next"])` (no path) walked past
 * `--type` as if skippable, mistook `"next"` for the positional, and
 * inserted `create` *between* the flag and its value
 * (`["--type", "create", "next"]`) — Commander then rejected the leading,
 * still-unrecognized `--type` with `error: unknown option '--type'` and
 * printed no JSON even under `--json` (D13 violation). Widening the
 * "value-taking options" list to include `--type` alone does NOT fix this —
 * verified by hand: it just changes the broken splice point
 * (`["--type", "next", "create"]`), and `--type` is still the first token
 * Commander sees, still unrecognized at the root. The actual fix (below) is
 * to only skip over options `program` truly owns; hitting anything else ends
 * the scan right there, exactly like hitting a positional does.
 *
 * `GLOBAL_OPTION_FLAGS`/`GLOBAL_OPTIONS_WITH_VALUE` are derived from
 * `program.options` — the single source of truth for what `program` itself
 * recognizes — plus Commander's own built-in `-h`/`--help` (which, unless
 * `.helpOption()` is called to customize it, Commander manages internally
 * rather than through the `.option()` array `program.options` exposes, so it
 * can't be derived the same way; `--version`/`-V` needs no such exception
 * since `.version()` above adds it as a real, discoverable option). A new
 * value-taking (or boolean) option added to `create` in the future needs no
 * update here at all — it's simply not a global flag, so it already falls
 * into the "stop the scan" branch that inserting `create` correctly in front
 * of it.
 */
function flagsOf(options: readonly Option[]): string[] {
  return options.flatMap((option) => [option.short, option.long].filter((flag): flag is string => Boolean(flag)));
}
function valueTakingFlagsOf(options: readonly Option[]): string[] {
  return flagsOf(options.filter((option) => option.required || option.optional));
}

const GLOBAL_OPTION_FLAGS = new Set([
  ...flagsOf(program.options),
  "-h",
  "--help", // Commander's built-in help flag; not in `program.options` (see above).
]);
const GLOBAL_OPTIONS_WITH_VALUE = new Set(valueTakingFlagsOf(program.options));

/**
 * `create-nockta-repo` is a "default command" CLI (spec §4/§5.1/§5.2), like
 * `create-next-app` — running it bare or with a project path and no
 * subcommand name should behave like `create-nockta-repo create ...`.
 * Commander doesn't support a root action *and* same-named subcommand
 * options coexisting (their flags collide), so instead we rewrite argv to
 * insert the implicit `create` subcommand name before handing off to
 * Commander, exactly the trick `npm create vite@latest` and friends use.
 */
export function resolveArgv(rawArgs: string[]): string[] {
  const args = [...rawArgs];
  let firstPositionalIndex: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") break;
    if (arg.startsWith("-")) {
      if (!GLOBAL_OPTION_FLAGS.has(arg)) {
        // Not an option `program` itself recognizes — a `create`-scoped
        // option (`--type`, `--dry-run`, ...) or something unknown. Either
        // way Commander can't resolve it before `create` is in front, so
        // this is the insertion point, exactly like hitting a positional.
        firstPositionalIndex = i;
        break;
      }
      if (GLOBAL_OPTIONS_WITH_VALUE.has(arg)) i++;
      continue;
    }
    firstPositionalIndex = i;
    break;
  }

  const firstPositional = firstPositionalIndex === undefined ? undefined : args[firstPositionalIndex];

  if (firstPositional === undefined || !KNOWN_SUBCOMMANDS.has(firstPositional)) {
    const insertIndex = firstPositionalIndex ?? args.length;
    args.splice(insertIndex, 0, "create");
  }

  return args;
}

/**
 * Recovers spec §5.4 pass-through args — everything after a literal `--` in
 * the argv the user actually typed — by looking them up directly in the raw
 * argv rather than trusting Commander's own positional-arg bookkeeping.
 *
 * Commander (as configured here, with `allowExcessArguments(true)` on
 * `create`) folds `--`-separated operands into the exact same `command.args`
 * array as ordinary excess positionals, with no boundary marker of its own —
 * confirmed by hand: `create my-project --type next -- --tailwind` yields
 * `command.args === ["my-project", "--tailwind"]`, the `--` already
 * stripped. Slicing that array is only safe when a project path was given
 * (index 0 is reliably consumed by `[projectNameOrPath]`); when it's
 * omitted, Commander's own greedy positional matching swallows the first
 * pass-through token as the "path" instead, silently corrupting it. Scanning
 * `program.rawArgs` for the literal `--` sidesteps that ambiguity entirely.
 */
export function extractPassthroughArgs(rawArgs: readonly string[]): string[] {
  const separatorIndex = rawArgs.indexOf("--");
  return separatorIndex === -1 ? [] : [...rawArgs.slice(separatorIndex + 1)];
}

// Only run when invoked directly (as the bin / `node dist/cli.js`), not when
// imported — e.g. by tests that inspect `program`.
//
// `realpathSync` matters here: package managers install CLI `bin` entries as
// symlinks (e.g. node_modules/.bin/create-nockta-repo -> ../create-nockta-repo/dist/cli.js),
// and `npx`/`npm link` do the same. Node resolves `import.meta.url` to the
// symlink TARGET, but `process.argv[1]` stays the symlink PATH the user invoked —
// comparing them directly silently no-ops the whole CLI under a symlinked bin.
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return import.meta.url === pathToFileURL(entry).href;
  }
}

if (isMainModule()) {
  const argv = [...process.argv.slice(0, 2), ...resolveArgv(process.argv.slice(2))];
  program.parseAsync(argv).catch((error) => {
    // @inquirer prompts reject with `ExitPromptError` on Ctrl-C (SIGINT).
    // Checked by `.name` (not `instanceof`) so this stays robust across
    // @inquirer/core versions/import paths — every prompt in the wizard
    // funnels through this one top-level catch on cancel.
    if (error instanceof Error && error.name === "ExitPromptError") {
      process.stderr.write("\nCancelled.\n");
      process.exitCode = 130; // standard SIGINT exit code
      return;
    }
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
