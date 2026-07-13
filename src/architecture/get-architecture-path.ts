import { existsSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolves the package root of `create-nockta-repo` itself, so the bundled
 * `packs/<repo-type>/architecture/<preset>/` directories can be found
 * regardless of how this module ends up running. Spec §10
 * (`src/architecture/get-architecture-path.ts`), §19 Milestone 4.
 *
 * Mirrors `inject-nockta-skills`' `src/packs/get-pack-path.ts` dist-safe
 * pattern exactly (same two runtime shapes, same `realpathSync` reasoning —
 * see that module's header comment for the full explanation):
 *
 * - Built: `dist/cli.js` lives directly under `<packageRoot>/dist/`, one
 *   directory above the root — what a real `npx create-nockta-repo` run uses.
 * - Source: `src/architecture/get-architecture-path.ts` lives under
 *   `<packageRoot>/src/architecture/`, two directories above the root —
 *   what vitest runs directly against TS source, no build step.
 *
 * Unlike `inject-nockta-skills`' `get-pack-path.ts`, there's no naming
 * collision to guard against here: this module's own directory is
 * `src/architecture/`, not `src/packs/`, so a bare `packs` marker under a
 * candidate root can't false-positive on this module's own folder. The
 * marker is still made specific (a concrete `arch.json` known to exist once
 * Milestone 4 content is authored) rather than a bare `packs` dir, purely
 * for parity with the sibling package's pattern and to fail loudly if the
 * standard `next` overlay is ever accidentally removed from the bundle.
 */
function currentModulePath(): string {
  const url = import.meta.url;
  try {
    return realpathSync(fileURLToPath(url));
  } catch {
    return fileURLToPath(url);
  }
}

let cachedPackageRoot: string | undefined;

const PACKS_MARKER = join("packs", "next", "architecture", "standard", "arch.json");

export function getArchitecturePackageRoot(): string {
  if (cachedPackageRoot) return cachedPackageRoot;

  const moduleDir = dirname(currentModulePath());
  const distShapeRoot = join(moduleDir, ".."); // moduleDir = <root>/dist
  const srcShapeRoot = join(moduleDir, "..", ".."); // moduleDir = <root>/src/architecture

  if (existsSync(join(distShapeRoot, PACKS_MARKER))) {
    cachedPackageRoot = distShapeRoot;
  } else if (existsSync(join(srcShapeRoot, PACKS_MARKER))) {
    cachedPackageRoot = srcShapeRoot;
  } else {
    // Neither candidate has the marker (e.g. a corrupted install). Fall back
    // to the dist-shape assumption, matching the published bin entry's real
    // layout, so callers get a sensible (if wrong) path rather than an
    // exception thrown from path math.
    cachedPackageRoot = distShapeRoot;
  }

  return cachedPackageRoot;
}

/** `<packageRoot>/packs/<repoType>/architecture/` — the parent of every preset dir for a repo type. */
export function getArchitectureBasePath(repoType: string): string {
  return join(getArchitecturePackageRoot(), "packs", repoType, "architecture");
}

/** `<packageRoot>/packs/<repoType>/architecture/<preset>/` — a specific preset's manifest dir. */
export function getArchitecturePresetPath(repoType: string, preset: string): string {
  return join(getArchitectureBasePath(repoType), preset);
}

/**
 * Names of preset directories available for a repo type (e.g. `["standard"]`).
 * Returns `[]` if the repo type has no `architecture/` directory at all
 * rather than throwing — used only for building helpful "unknown preset"
 * error details, never for control flow.
 */
export function listArchitecturePresets(repoType: string): string[] {
  const base = getArchitectureBasePath(repoType);
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}
