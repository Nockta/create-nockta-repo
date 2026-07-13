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
 * Builds the concrete upstream command for a repo type, given the resolved
 * target path and any caller-supplied passthrough args (spec §5.4).
 *
 * Pure and side-effect-free — no child-process execution happens here. That
 * is Milestone 3's upstream runner; this milestone only resolves *what*
 * command would run.
 */
export type ScaffolderArgsBuilder = (
  targetPath: string,
  passthroughArgs?: string[],
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
