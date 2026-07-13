import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { NocktaRepoProfile } from "../types/profile.js";

/**
 * Reads `<projectDir>/.nockta/repo-profile.json`, if present and parseable
 * (spec §9, §19 Milestone 7). Returns `undefined` rather than throwing on
 * any problem (missing file, invalid JSON) — same tolerant-read convention
 * as `inject-nockta-skills`' `core/read-profile.ts::readSkillsProfile()`.
 *
 * Not consumed by `write-repo-profile.ts` itself (see that module's header
 * comment for why — every write here is a fresh first write, never a
 * re-install over an existing target). Exists for round-trip test
 * verification and future tooling (e.g. a possible later `info`/`list
 * --details` command) that wants to inspect an already-created project's
 * recorded profile.
 */
export function readRepoProfile(projectDir: string): NocktaRepoProfile | undefined {
  const profilePath = path.join(projectDir, ".nockta", "repo-profile.json");
  if (!existsSync(profilePath)) return undefined;

  try {
    return JSON.parse(readFileSync(profilePath, "utf8")) as NocktaRepoProfile;
  } catch {
    return undefined;
  }
}
