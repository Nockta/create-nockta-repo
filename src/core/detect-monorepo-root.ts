import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Spec §6.2 monorepo-root signals. `"package.json:workspaces"` is not a
 * separate file — it means "the package.json file at this directory has a
 * `workspaces` field", checked separately from the plain marker files below.
 */
export type MonorepoSignal =
  | "pnpm-workspace.yaml"
  | "turbo.json"
  | "nx.json"
  | "lerna.json"
  | "rush.json"
  | "package.json:workspaces";

/** The marker-file subset of {@link MonorepoSignal} — plain "does this file exist" checks. */
const MONOREPO_MARKER_FILES: readonly Exclude<MonorepoSignal, "package.json:workspaces">[] = [
  "pnpm-workspace.yaml",
  "turbo.json",
  "nx.json",
  "lerna.json",
  "rush.json",
];

export type MonorepoRootDetection =
  | { isMonorepoRoot: true; root: string; signals: MonorepoSignal[] }
  | { isMonorepoRoot: false; root: null; signals: [] };

/**
 * True when `package.json` at `packageJsonPath` declares a `workspaces`
 * field, in either recognized shape:
 *
 * - array form (npm/pnpm/yarn classic): `"workspaces": ["packages/*"]`
 * - object form (yarn nohoist): `"workspaces": { "packages": [...] }`
 *
 * An empty array/`packages` list still counts — spec §6.2 just says
 * "package.json workspaces", with no stated minimum-entries rule; the
 * field's mere presence is the signal. A missing or unparseable
 * `package.json` is simply not a usable signal, not an error this module
 * surfaces — detection must stay a tolerant, best-effort read (a malformed
 * `package.json` elsewhere in a real repo is not this module's problem to
 * report).
 */
function hasPackageJsonWorkspaces(packageJsonPath: string): boolean {
  if (!existsSync(packageJsonPath)) return false;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  } catch {
    return false;
  }

  if (typeof parsed !== "object" || parsed === null) return false;
  const workspaces = (parsed as Record<string, unknown>).workspaces;

  if (Array.isArray(workspaces)) return true;
  if (
    typeof workspaces === "object" &&
    workspaces !== null &&
    Array.isArray((workspaces as Record<string, unknown>).packages)
  ) {
    return true;
  }
  return false;
}

/**
 * Detects whether `cwd` **itself** — not any ancestor directory — carries
 * one or more of the spec §6.2 monorepo-root signals. Spec §6.3's own
 * example is `cd existing-monorepo && npx create-nockta-repo apps/web ...`:
 * the user is expected to already be standing at the monorepo root, so this
 * module deliberately does not walk upward looking for one (that would be a
 * different, unspecced feature — see `src/core/CONTEXT.md`).
 *
 * All matching signals are reported, not just the first — a real monorepo
 * commonly carries more than one at once (e.g. both `pnpm-workspace.yaml`
 * and `turbo.json`). Pure synchronous read, no side effects.
 */
export function detectMonorepoRoot(cwd: string = process.cwd()): MonorepoRootDetection {
  const signals: MonorepoSignal[] = [];

  for (const file of MONOREPO_MARKER_FILES) {
    if (existsSync(path.join(cwd, file))) signals.push(file);
  }
  if (hasPackageJsonWorkspaces(path.join(cwd, "package.json"))) {
    signals.push("package.json:workspaces");
  }

  if (signals.length === 0) {
    return { isMonorepoRoot: false, root: null, signals: [] };
  }
  return { isMonorepoRoot: true, root: cwd, signals };
}
