import { REPO_TYPES, isRepoType, type RepoType } from "../types/repo-type.js";
import type { ScaffolderDefinition } from "../types/scaffold.js";
import { expoScaffolder } from "./expo.js";
import { nestScaffolder } from "./nest.js";
import { nextScaffolder } from "./next.js";
import { reactNativeScaffolder } from "./react-native.js";
import { shopifyAppScaffolder } from "./shopify-app.js";
import { shopifyHeadlessScaffolder } from "./shopify-headless.js";
import { shopifyThemeScaffolder } from "./shopify-theme.js";
import { viteReactTsScaffolder } from "./vite-react-ts.js";

/**
 * Typed map of every MVP RepoType (spec §11.1) to its scaffolder definition
 * (spec §3, §10 `src/scaffolders/`). The `Record<RepoType, ...>` annotation
 * is itself the completeness check — this file fails to typecheck if a
 * RepoType is ever added to `types/repo-type.ts` without a matching entry
 * here.
 */
export const SCAFFOLDER_REGISTRY: Readonly<Record<RepoType, ScaffolderDefinition>> = {
  next: nextScaffolder,
  "vite-react-ts": viteReactTsScaffolder,
  nest: nestScaffolder,
  "shopify-app": shopifyAppScaffolder,
  "shopify-theme": shopifyThemeScaffolder,
  "shopify-headless": shopifyHeadlessScaffolder,
  "react-native": reactNativeScaffolder,
  expo: expoScaffolder,
};

/**
 * Structured error for an unresolvable repo type — thrown by
 * `resolveScaffolder`, not a bare string throw, so callers (CLI error
 * formatting, `--json` error envelopes in later milestones) can branch on
 * `.repoType` / `.knownRepoTypes` instead of parsing `.message`.
 */
export class UnknownRepoTypeError extends Error {
  readonly repoType: string;
  readonly knownRepoTypes: readonly RepoType[];

  constructor(repoType: string) {
    super(`Unknown repo type "${repoType}". Known repo types: ${REPO_TYPES.join(", ")}.`);
    this.name = "UnknownRepoTypeError";
    this.repoType = repoType;
    this.knownRepoTypes = REPO_TYPES;
  }
}

/**
 * Resolves a repo type string to its scaffolder definition, or throws
 * {@link UnknownRepoTypeError} for anything outside the MVP RepoType union
 * (spec §11.1). Accepts a plain `string` (not `RepoType`) because callers
 * are usually parsing untrusted CLI input (`--type <repoType>`) that has not
 * been narrowed yet.
 */
export function resolveScaffolder(repoType: string): ScaffolderDefinition {
  if (!isRepoType(repoType)) {
    throw new UnknownRepoTypeError(repoType);
  }
  return SCAFFOLDER_REGISTRY[repoType];
}

/** All scaffolder definitions, in `RepoType` declaration order (spec §11.1). */
export function listScaffolders(): readonly ScaffolderDefinition[] {
  return REPO_TYPES.map((repoType) => SCAFFOLDER_REGISTRY[repoType]);
}
