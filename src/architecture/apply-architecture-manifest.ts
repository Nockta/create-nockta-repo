import { copyFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import type { ArchitectureManifest } from "../types/architecture.js";

/**
 * Spec §11.4 `CreateNocktaRepoResult.architectureChanges` shape exactly.
 * `updated` stays empty in Milestone 4 by design — see the module doc below,
 * "never overwrite" rule: there is currently no code path that overwrites an
 * existing destination, so nothing is ever recorded as "updated" yet. The
 * field exists because the spec type declares it, ready for a future
 * milestone that adds a deliberate, explicit update mechanism.
 */
export type ArchitectureChanges = {
  created: string[];
  updated: string[];
  moved: string[];
  skipped: string[];
};

export type ApplyArchitectureManifestOptions = {
  manifest: ArchitectureManifest;
  /** Directory containing the manifest's `arch.json` and `files/` — base for resolving `files[].from`. */
  manifestDir: string;
  /** The generated project root to apply the overlay into. */
  targetDir: string;
};

export type ArchitectureApplyErrorCode = "move-source-missing";

/**
 * Thrown when applying the manifest cannot continue (spec §5.9 exit code 3,
 * "architecture overlay failure"). Carries the partial {@link ArchitectureChanges}
 * accumulated up to the point of failure — Milestone 4 does no rollback, so
 * the caller can honestly report what was already created before the
 * failure (spec §7.3/§13 — never invent success, never silently discard
 * partial state).
 */
export class ArchitectureApplyError extends Error {
  readonly code: ArchitectureApplyErrorCode;
  readonly changes: ArchitectureChanges;
  readonly detail: Record<string, unknown>;

  constructor(params: { code: ArchitectureApplyErrorCode; message: string; changes: ArchitectureChanges; detail: Record<string, unknown> }) {
    super(params.message);
    this.name = "ArchitectureApplyError";
    this.code = params.code;
    this.changes = params.changes;
    this.detail = params.detail;
  }
}

/**
 * Applies an already-read, already-validated {@link ArchitectureManifest} to
 * a target project directory (spec §10 `apply-architecture-manifest.ts`,
 * §19 Milestone 4). Executes in manifest order — directories, then files,
 * then moves — mirroring spec §7.2's own field order (dirs/files exist
 * before moves might want to land inside them).
 *
 * Safety rules enforced here (spec §7.3, §13):
 * - only creates directories, copies files, and performs moves *explicitly
 *   listed* in the manifest — no other filesystem operation happens, so
 *   files not mentioned by the manifest are never touched;
 * - never overwrites an existing destination (directory-already-exists,
 *   file-already-exists-at-destination, or move-destination-already-exists
 *   are all recorded as `skipped`, not silently clobbered);
 * - a `moves[]` entry only runs when explicitly listed; a missing source is
 *   only tolerated when `optional: true` (recorded `skipped`) — a
 *   non-optional missing source throws {@link ArchitectureApplyError} and
 *   stops the whole apply (no partial move, no rollback of what already
 *   happened before it).
 */
export function applyArchitectureManifest(options: ApplyArchitectureManifestOptions): ArchitectureChanges {
  const { manifest, manifestDir, targetDir } = options;
  const changes: ArchitectureChanges = { created: [], updated: [], moved: [], skipped: [] };

  for (const dir of manifest.directories) {
    const dest = path.join(targetDir, dir);
    if (existsSync(dest)) {
      changes.skipped.push(`${dir} (directory already exists)`);
      continue;
    }
    mkdirSync(dest, { recursive: true });
    changes.created.push(dir);
  }

  for (const file of manifest.files) {
    const source = path.join(manifestDir, file.from);
    const dest = path.join(targetDir, file.to);
    if (existsSync(dest)) {
      changes.skipped.push(`${file.to} (file already exists, not overwritten)`);
      continue;
    }
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(source, dest);
    changes.created.push(file.to);
  }

  for (const move of manifest.moves) {
    const source = path.join(targetDir, move.from);
    const dest = path.join(targetDir, move.to);

    if (existsSync(dest)) {
      changes.skipped.push(`${move.from} -> ${move.to} (destination already exists, not overwritten)`);
      continue;
    }

    if (!existsSync(source)) {
      if (move.optional) {
        changes.skipped.push(`${move.from} -> ${move.to} (optional, source missing)`);
        continue;
      }
      throw new ArchitectureApplyError({
        code: "move-source-missing",
        message:
          `Architecture move source "${move.from}" does not exist and this move is not optional ` +
          `(target: "${targetDir}"). Nothing beyond this point in the manifest was applied.`,
        changes,
        detail: { from: move.from, to: move.to },
      });
    }

    mkdirSync(path.dirname(dest), { recursive: true });
    renameSync(source, dest);
    changes.moved.push(`${move.from} -> ${move.to}`);
  }

  return changes;
}
