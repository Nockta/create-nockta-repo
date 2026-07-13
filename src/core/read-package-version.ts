import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getArchitecturePackageRoot } from "../architecture/get-architecture-path.js";

/**
 * Reads the running `create-nockta-repo` package's own `version` field from
 * its `package.json` — used by `write-repo-profile.ts` for the profile's
 * `version` field (spec §9.2/§9.3: "this package's own version, not the
 * upstream scaffolder's, not inject's").
 *
 * Reuses `getArchitecturePackageRoot()`'s existing dist-safe package-root
 * resolution (spec §7.2/Milestone 4's `packs/` path resolution — despite its
 * "architecture"-scoped name, it resolves the whole package root, which is
 * exactly what's needed here too) rather than duplicating that dist-vs-src
 * detection a second time. Mirrors `inject-nockta-skills`'
 * `core/read-package-version.ts::readRunningPackageVersion()` pattern
 * exactly (same name, same shape) for cross-package consistency.
 */
export function readRunningPackageVersion(): string {
  const pkgPath = join(getArchitecturePackageRoot(), "package.json");
  return (JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string }).version;
}
