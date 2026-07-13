import type { RepoType } from "./repo-type.js";
import type { ArchitectureChanges } from "../architecture/apply-architecture-manifest.js";

/**
 * The result shape spec §11.4 declares for a create run — matches it
 * exactly, including `isMonorepoTarget` (spec §6, §19 Milestone 5) and
 * `skillsInjected` (spec §8, §19 Milestone 6). This is the canonical,
 * spec-shaped type; `commands/create.ts`'s actual `--json` envelope is a
 * richer, outcome-specific superset (it also carries `status`/`ok`/per-kind
 * fields like `upstream`, plus a fuller `skills`/`metadata` detail object
 * beyond the plain fields here) — see that file's own `toJsonResult()`.
 * `projectDir` and `warnings` are real as of Milestone 7 (repo-profile
 * writing) — `commands/create.ts::buildCreateNocktaRepoResult()` is the
 * formal, pure assembler of this exact literal shape, exposed inside the
 * `--json` envelope under its own `result` key alongside the richer
 * per-status fields, so a consumer reading strictly against spec §11.4 has a
 * single object to read.
 */
export type CreateNocktaRepoResult = {
  projectNameOrPath: string;
  projectDir: string;
  repoType: RepoType;
  architecture: string | null;
  isMonorepoTarget: boolean;
  officialScaffolder: {
    name: string;
    command: string;
    args: string[];
  };
  architectureChanges: ArchitectureChanges;
  skillsInjected: boolean;
  warnings: string[];
};
