import type { RepoType } from "./repo-type.js";

/**
 * The resolved upstream scaffolder invocation shape. Matches the
 * `officialScaffolder` field recorded in the repo profile (spec §9.2) and
 * returned in `CreateNocktaRepoResult` (spec §11.4) — deliberately the same
 * `{ name, command, args }` triple in both places.
 */
export type ScaffolderCommand = {
  name: string;
  command: string;
  args: string[];
};

/**
 * One surfaced upstream-scaffolder choice (D36) — the declarative description
 * of a single interactive prompt the upstream tool would otherwise ask, so
 * both the web form and the non-interactive `--yes`/web-submit args-builder
 * can drive it without the tool ever prompting. Kept deliberately flat and
 * JSON-serializable (the web page embeds these verbatim, like the arch preset
 * map). `buildCommand` consumes an answers object keyed by `key`; the schema
 * itself owns the flag mapping and the default (single source — the CLI `--yes`
 * path and the web page pull the SAME defaults, so they can never drift).
 */
export type UpstreamOptionKind = "boolean" | "choice" | "text";

/** One selectable value for a `kind: "choice"` option. */
export type UpstreamOptionChoice = { value: string; label: string };

export type UpstreamOption = {
  /** Answer key — `buildCommand`'s answers object is keyed by this. */
  key: string;
  /** Web form field label. */
  label: string;
  /** Web form field help text. */
  description: string;
  kind: UpstreamOptionKind;
  /** Present iff `kind === "choice"`. */
  choices?: UpstreamOptionChoice[];
  /** Default answer — boolean for `kind: "boolean"`, a string otherwise. The single source of truth for both the CLI `--yes` path and the web page's pre-fill. */
  default: boolean | string;
  /**
   * Flag mapping. For `kind: "boolean"`: the flag emitted when the answer is
   * true. For `kind: "choice"`/`"text"`: the flag emitted immediately before
   * the value (as two argv tokens, `flag value`).
   */
  flag: string;
  /**
   * `kind: "boolean"` only — the flag emitted when the answer is false (e.g.
   * `--javascript`, `--no-tailwind`, `--webpack`). Omitted for booleans whose
   * upstream default-without-flag already matches the "false" case (then a
   * false answer emits nothing).
   */
  negatedFlag?: string;
};

/**
 * Marks a repo type whose upstream scaffolder CANNOT run non-interactively —
 * it unavoidably needs a real terminal/browser (Shopify's Partner login for
 * `shopify app init`). The web flow surfaces this up front (an inline warning
 * on that type) and, on submit, hands the user back to their terminal rather
 * than silently hanging or pretending success (D36 / PART A).
 */
export type RequiresTerminal = { reason: string };

/**
 * Builds the concrete upstream command for a repo type, given the resolved
 * target path, any caller-supplied passthrough args (spec §5.4), and any
 * surfaced upstream-option answers (D36). The answers object is keyed by each
 * `UpstreamOption.key`; only keys actually present in it emit args, so a bare
 * `buildCommand(path)` / `buildCommand(path, passthrough)` call (the wizard /
 * interactive-genesis path, which keeps upstream prompts interactive by
 * design) is unchanged — option flags are added ONLY on the `--yes`/web path
 * that passes a real answers object.
 *
 * Pure and side-effect-free — no child-process execution happens here.
 */
export type ScaffolderArgsBuilder = (
  targetPath: string,
  passthroughArgs?: string[],
  upstreamAnswers?: Record<string, unknown>,
) => ScaffolderCommand;

/**
 * Static registry entry describing one repo type's upstream scaffolder
 * (spec §3, §10 `src/scaffolders/`, §18.1 scaffolder-change risk, §18.5
 * Shopify tooling variance).
 */
export type ScaffolderDefinition = {
  /** The RepoType this definition serves (spec §11.1). */
  repoType: RepoType;
  /** Human display name, e.g. "Next.js". */
  displayName: string;
  /** Name of the upstream tool being wrapped, e.g. "create-next-app". */
  upstreamTool: string;
  /**
   * Conceptual upstream command as documented in spec §3.2-3.7, e.g.
   * "npx create-next-app@latest <project-path>". Display-only (`list`,
   * dry-run plans) — the executable shape comes from `buildCommand`.
   */
  conceptualCommand: string;
  /** Builds the `{ name, command, args }` triple for a given target path + passthrough args. */
  buildCommand: ScaffolderArgsBuilder;
  /**
   * True when the upstream tool expects an interactive TTY / inherited
   * stdio rather than running fully non-interactively — true for the
   * Shopify CLI family (spec §18.5: "allow interactive stdio"). Milestone 3's
   * runner will use this to decide stdio inheritance; Milestone 2 only
   * records the fact so `list` can surface it.
   */
  interactiveStdio: boolean;
  /**
   * True when the command shape is provisional/preset-dependent and may
   * change once concrete tooling is chosen (spec §3.7 Shopify Headless).
   * Absent (falsy) for stable entries.
   */
  provisional?: boolean;
  /**
   * The interactive choices this scaffolder would prompt for, surfaced as web
   * form fields and mapped to non-interactive flags (D36). Omitted/empty for
   * types whose contract pins every relevant choice (e.g. vite-react-ts pins
   * `--template react-ts`, expo pins `--template default@sdk-57`). `buildCommand`
   * consumes the answers.
   */
  upstreamOptions?: UpstreamOption[];
  /**
   * Present when the upstream scaffolder cannot run headlessly at all (needs a
   * real terminal/browser — Shopify Partner login). The web flow warns up front
   * and hands back to the terminal on submit (D36 / PART A). Independent of
   * `interactiveStdio` (which merely says "may prompt"); `requiresTerminal`
   * means "cannot proceed without a human at a terminal".
   */
  requiresTerminal?: RequiresTerminal;
  /**
   * Node.js version floor this scaffolder needs, if the spec states one
   * beyond the package baseline (spec §14: `Node.js >= 20`, "effective
   * required Node version is the highest requirement among ... the selected
   * official scaffolder"). Left undefined where the spec does not state a
   * per-scaffolder figure — not fabricated.
   */
  minNodeVersion?: string;
  /** Freeform implementation/isolation notes (spec §18.1, §18.5). */
  notes?: string;
};
