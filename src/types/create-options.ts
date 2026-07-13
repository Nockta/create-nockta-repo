import type { AdapterType } from "./adapter.js";
import type { RepoType } from "./repo-type.js";

/**
 * Options accepted by the create flow, whether sourced from the wizard or
 * from non-interactive CLI flags. Mirrors spec §11.3 exactly.
 */
export type CreateNocktaRepoOptions = {
  projectNameOrPath: string;
  repoType: RepoType;
  /**
   * Secondary skill-domain repo types (decisions.md D22, spec §5.2's `--also`
   * documentation) — forwarded, together with `repoType` (the primary), to
   * `inject-nockta-skills`' multi-type install as a union. Does NOT add a
   * second genesis scaffolder or a second architecture overlay — those stay
   * `repoType`-only (D22: "create keeps ONE primary scaffolder").
   */
  alsoTypes?: RepoType[];
  architecture?: string;
  adapters?: AdapterType[];
  /** Pins the inject-nockta-skills version/dist-tag to spawn (spec §5.2, §8.1). */
  skillsVersion?: string;
  passthroughArgs?: string[];
  dryRun?: boolean;
  yes?: boolean;
  force?: boolean;
  installSkills?: boolean;
  applyArchitecture?: boolean;
  monorepoTarget?: boolean;
};
