/**
 * Architecture overlay manifest shape (spec §7.2, §10 `src/types/architecture.ts`,
 * §19 Milestone 4). Matches the `arch.json` example in spec §7.2 exactly.
 */

/** One `files[]` entry: copy `from` (relative to the preset dir) to `to` (relative to the target project). */
export type ArchitectureFileEntry = {
  from: string;
  to: string;
};

/**
 * One `moves[]` entry: move an upstream-scaffolder-generated file from one
 * path to another, both relative to the target project. `optional: true`
 * means a missing `from` is not an error — it's recorded as skipped
 * (spec §7.3 "move official generated files if explicitly defined").
 */
export type ArchitectureMoveEntry = {
  from: string;
  to: string;
  optional?: boolean;
};

/**
 * The full manifest shape (spec §7.2). `deletes` is part of the type because
 * the schema documents it, but the field is DISABLED at read time — spec §13
 * ("deletes should be disabled by default"): `read-architecture-manifest.ts`
 * rejects any manifest with a non-empty `deletes` array rather than silently
 * ignoring it. See `src/architecture/CONTEXT.md`.
 */
export type ArchitectureManifest = {
  name: string;
  directories: string[];
  files: ArchitectureFileEntry[];
  moves: ArchitectureMoveEntry[];
  deletes: string[];
};
