/**
 * Programmatic entrypoint. Re-exports the local type mirrors (spec §11) and,
 * as of Milestone 2, the scaffolder registry (spec §10 `src/scaffolders/`).
 * Command/wizard orchestration is CLI-invoked (src/cli.ts) and grows through
 * later milestones.
 */
export type { AdapterType } from "./types/adapter.js";
export { ADAPTER_TYPES, isAdapterType } from "./types/adapter.js";
export type { CreateNocktaRepoOptions } from "./types/create-options.js";
export type { CreateNocktaRepoResult } from "./types/create-result.js";
export type { NocktaRepoProfile } from "./types/profile.js";
export type { RepoType } from "./types/repo-type.js";
export { REPO_TYPES, isRepoType } from "./types/repo-type.js";
export type {
  ScaffolderArgsBuilder,
  ScaffolderCommand,
  ScaffolderDefinition,
} from "./types/scaffold.js";
export {
  SCAFFOLDER_REGISTRY,
  UnknownRepoTypeError,
  listScaffolders,
  resolveScaffolder,
} from "./scaffolders/registry.js";
export { readRepoProfile } from "./core/read-repo-profile.js";
export { WriteRepoProfileError, writeRepoProfile } from "./core/write-repo-profile.js";
