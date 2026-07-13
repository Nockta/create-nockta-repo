import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { NocktaRepoProfile } from "../types/profile.js";

/**
 * Writes `.nockta/repo-profile.json` (spec §9, §19 Milestone 7) — the FINAL
 * create step (spec §12.1 step 11 / §12.2 step 6).
 *
 * Placement (spec §9.1, decisions.md D5): `projectDir` here is the created
 * project/target's OWN root — `<project>` for a standalone create,
 * `<target>` for a monorepo target (e.g. `apps/web`, NOT the monorepo root).
 * `commands/create.ts` always passes `validated.resolvedPath` (the resolved
 * target directory `resolveTargetPath()` already computed) — the same
 * directory the architecture overlay and `inject-nockta-skills` (standalone
 * mode) write into. There is deliberately no root-level equivalent of this
 * file — root `.nockta/targets.json` + `skills-profile.json` are owned by
 * `inject-nockta-skills`, written by IT (not this module) when
 * `commands/create.ts` spawns it in monorepo-target mode (spec §6.4/§6.5).
 *
 * `create-nockta-repo` never writes into an existing target directory
 * (`validateTargetDir`'s `already-exists` check, spec §13, composed by
 * `resolveTargetPath`) — so unlike `inject-nockta-skills`'
 * `write-profile.ts`, there is no "preserve `createdAt` across re-installs"
 * concern here: every write is a fresh, first (and only) write for that
 * target. `read-repo-profile.ts` exists for round-trip verification and
 * future tooling, not to feed this module.
 */
export type WriteRepoProfileOptions = {
  /** The created project/target's own root directory (never `.nockta` itself, never a monorepo root for a target — see header comment). */
  projectDir: string;
  profile: NocktaRepoProfile;
};

export type WriteRepoProfileResult = {
  /** Absolute path to the written `repo-profile.json`. */
  path: string;
  profile: NocktaRepoProfile;
};

/**
 * Thrown when the profile write itself fails (e.g. a permissions error) —
 * spec §9/§19 Milestone 7's brief: "a created project without its profile is
 * incomplete" — `commands/create.ts` treats this as a genuine create failure
 * (new dedicated exit code, fails loudly) rather than a silently swallowed
 * warning. Same typed-error convention as `UpstreamFailure`/
 * `InjectSkillsFailure`/`ArchitectureApplyError` elsewhere in this package.
 */
export class WriteRepoProfileError extends Error {
  readonly path: string;

  constructor(profilePath: string, cause: unknown) {
    super(
      `Failed to write repo profile at "${profilePath}": ${cause instanceof Error ? cause.message : String(cause)}`,
      cause !== undefined ? { cause } : undefined,
    );
    this.name = "WriteRepoProfileError";
    this.path = profilePath;
  }
}

/**
 * Writes `<projectDir>/.nockta/repo-profile.json`. Pretty-printed with a
 * trailing newline (`JSON.stringify(profile, null, 2) + "\n"`) — same
 * on-disk convention `inject-nockta-skills`' `write-profile.ts` uses for its
 * own `.nockta/skills-profile.json`, for readability parity across every
 * file under `.nockta/`. `--json`/machine consumers get the object directly
 * in `commands/create.ts`'s own `--json` output, not by re-parsing this file.
 */
export function writeRepoProfile(options: WriteRepoProfileOptions): WriteRepoProfileResult {
  const nocktaDir = path.join(options.projectDir, ".nockta");
  const profilePath = path.join(nocktaDir, "repo-profile.json");

  try {
    mkdirSync(nocktaDir, { recursive: true });
    writeFileSync(profilePath, `${JSON.stringify(options.profile, null, 2)}\n`, "utf8");
  } catch (error) {
    throw new WriteRepoProfileError(profilePath, error);
  }

  return { path: profilePath, profile: options.profile };
}
