import path from "node:path";
import { detectMonorepoRoot, type MonorepoRootDetection } from "./detect-monorepo-root.js";
import { validateTargetDir, type ValidateTargetDirOptions, type ValidateTargetDirResult } from "./validate-target-dir.js";

export type ResolveTargetPathOptions = ValidateTargetDirOptions;

/**
 * {@link validateTargetDir}'s result plus monorepo-target classification
 * (spec §6, §19 Milestone 5). Deliberately a superset, not a parallel shape —
 * `targetPath`/`resolvedPath` mean exactly what they mean there.
 */
export type ResolveTargetPathResult = ValidateTargetDirResult & {
  /**
   * True only when `cwd` itself is a detected monorepo root (spec §6.2/§6.3).
   * A nested-looking path (`apps/web`) at a plain, non-monorepo `cwd` is
   * *not* a monorepo target — see `isNestedPath`/`infoLine` below for that
   * case's own semantics.
   */
  isMonorepoTarget: boolean;
  /** The monorepo-root detection this classification was based on. */
  monorepoRoot: MonorepoRootDetection;
  /** True when `targetPath` contains a path separator (e.g. "apps/web" vs "my-project"). */
  isNestedPath: boolean;
  /**
   * Human-readable note explaining which semantics applied, or `null` when
   * none is needed (a plain name at a non-monorepo cwd — the original,
   * unchanged standalone flow). See this module's own doc comment for the
   * three cases.
   */
  infoLine: string | null;
};

/**
 * Resolves and validates a create target path, classifying it as a monorepo
 * target or not (spec §6.3, §19 Milestone 5). Composes on top of
 * {@link validateTargetDir} rather than duplicating its safety checks —
 * "must not exist" / "stays inside the repo" (§6.3 points 1, and the
 * absolute-path/`..`-escape rules) are exactly `validateTargetDir`'s
 * existing rules, unchanged, because a monorepo root is detected at `cwd`
 * itself in MVP (no upward directory walk, see `detect-monorepo-root.ts`) —
 * so "inside the repo" and "inside `cwd`" are the same boundary here.
 * `validateTargetDir`'s own `InvalidTargetDirError` (`already-exists`,
 * `absolute-path-not-allowed`, `escapes-parent`) propagates unchanged; this
 * module adds no new error type or exit-code bucket.
 *
 * Three cases, matching spec §6.2/§6.3 exactly:
 *
 * 1. **Monorepo root detected at `cwd`** — any `targetPath` (nested or not)
 *    is classified `isMonorepoTarget: true`, with an info line naming the
 *    detected signals (spec §6.3 steps 1-2).
 * 2. **Nested path (`apps/web`) at a non-monorepo `cwd`** — *not* a monorepo
 *    target. This is a standalone create at that relative path — the nested
 *    path is just where the project lands, same as any other relative
 *    target. `isMonorepoTarget: false`, but an info line documents the
 *    semantics explicitly (nothing here is silently reinterpreted).
 * 3. **Plain name (`my-project`) at a non-monorepo `cwd`** — the original
 *    Milestone 1-4 standalone flow, byte-for-byte unchanged:
 *    `isMonorepoTarget: false`, `infoLine: null`.
 *
 * Pure — no filesystem writes, no directory creation. Spec §6.3's "parent
 * dirs may be created" is left to the upstream scaffolder (every fixture and
 * every real scaffolder already `mkdir -p`s its own target), exactly like
 * `validateTargetDir` already leaves the target directory itself to be
 * created downstream.
 */
export function resolveTargetPath(
  targetPath: string,
  options: ResolveTargetPathOptions = {},
): ResolveTargetPathResult {
  const cwd = options.cwd ?? process.cwd();

  const monorepoRoot = detectMonorepoRoot(cwd);
  const validated = validateTargetDir(targetPath, { cwd });
  const isNestedPath = targetPath.split(path.sep).join("/").includes("/");

  if (monorepoRoot.isMonorepoRoot) {
    return {
      ...validated,
      isMonorepoTarget: true,
      monorepoRoot,
      isNestedPath,
      infoLine:
        `Monorepo root detected at "${cwd}" (signals: ${monorepoRoot.signals.join(", ")}) — ` +
        `creating "${targetPath}" as a nested monorepo target.`,
    };
  }

  if (isNestedPath) {
    return {
      ...validated,
      isMonorepoTarget: false,
      monorepoRoot,
      isNestedPath,
      infoLine:
        `No monorepo root detected at "${cwd}" — "${targetPath}" is a standalone create at that ` +
        "relative path, not a monorepo target (nested-looking paths only trigger " +
        "monorepo-target behavior when a monorepo root signal is present at cwd).",
    };
  }

  return {
    ...validated,
    isMonorepoTarget: false,
    monorepoRoot,
    isNestedPath,
    infoLine: null,
  };
}
