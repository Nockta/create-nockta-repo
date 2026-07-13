import type { AdapterType } from "./adapter.js";
import type { RepoType } from "./repo-type.js";

/**
 * `.nockta/repo-profile.json` shape — spec §9.2, matched field-for-field
 * (including field order, for readability parity with the spec §9.3
 * example). §19 Milestone 7.
 *
 * Placement (spec §9.1, decisions.md D5):
 * - standalone project: `<project>/.nockta/repo-profile.json`;
 * - monorepo target: `<target>/.nockta/repo-profile.json` — never at the
 *   monorepo root. Root `.nockta/` (`targets.json`, `skills-profile.json`) is
 *   owned by `inject-nockta-skills`, not this file (see
 *   `src/core/write-repo-profile.ts`'s own header comment).
 *
 * `skillsVersion` (spec §9.2's own qualifying note): "not the
 * `--skills-version` flag echoed back — it is the actual resolved version
 * `inject-nockta-skills` ran as, read from its own `--json` result." See
 * `src/core/run-inject-skills.ts`'s `InjectSkillsSuccess.skillsVersion` for
 * the fallback chain that resolves it (prefers inject's own `--json`
 * `data.version` field if present, else falls back to reading the
 * `.nockta/skills-profile.json` file inject itself wrote).
 *
 * `repoTypes` (decisions.md D22, worker pass adding `--also`): evolved from a
 * pre-D22 singular `repoType: RepoType` to `repoTypes: RepoType[]` — the
 * PRIMARY type (from `--type`, the sole genesis scaffolder/architecture
 * overlay owner) first, followed by any `--also <type>[,<type>...]`
 * secondary skill-domain types, mirroring `inject-nockta-skills`' own D22
 * `repoTypes: string[]` shape for symmetry across both packages' `.nockta/`
 * files. `officialScaffolder` still names only the PRIMARY type's scaffolder
 * — `--also` types are skill-domain-only, never a second scaffolder/overlay
 * (D22: "architecture overlay remains PRIMARY-type only"). No published
 * `create-nockta-repo` versions exist yet, so this is a non-breaking rename
 * in practice (same reasoning D22 gave for inject's own profile/targets
 * schema change) — no legacy read-shim was added.
 */
export type NocktaRepoProfile = {
  tool: "create-nockta-repo";
  /** This package's own running version (not the upstream scaffolder's, not inject's). */
  version: string;
  /** Primary type first (index 0 — the `--type`/genesis-scaffolder owner), then any `--also` secondary skill-domain types (decisions.md D22). A single-type create is still a one-element array. */
  repoTypes: RepoType[];
  /** The applied architecture preset name, or `null` when `--no-arch` skipped the overlay. */
  architecture: string | null;
  /** The path exactly as given by the caller (spec §9.3 example: `"apps/web"`), not an absolute path. */
  projectPath: string;
  isMonorepoTarget?: boolean;
  officialScaffolder: {
    name: string;
    command: string;
    args: string[];
  };
  skillsInjected: boolean;
  skillsVersion?: string;
  adapters?: AdapterType[];
  createdAt: string;
};
