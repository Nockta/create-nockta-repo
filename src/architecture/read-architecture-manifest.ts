import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ArchitectureFileEntry, ArchitectureManifest, ArchitectureMoveEntry } from "../types/architecture.js";
import { getArchitecturePresetPath, listArchitecturePresets } from "./get-architecture-path.js";

/**
 * Structured reasons {@link readArchitectureManifestFromDir} can refuse a
 * manifest. Same convention as `UnknownRepoTypeError` / `InvalidTargetDirError`
 * (typed class with a `.code`, not a bare string throw) — spec §5.9 machine
 * interface.
 */
export type ArchitectureManifestErrorCode =
  | "preset-not-found"
  | "manifest-not-found"
  | "malformed-json"
  | "invalid-schema"
  | "deletes-disabled"
  | "disallowed-field";

export class ArchitectureManifestError extends Error {
  readonly code: ArchitectureManifestErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: ArchitectureManifestErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ArchitectureManifestError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Only these top-level keys are ever accepted. Spec §7.3: the overlay "must
 * not run arbitrary scripts in MVP". The manifest schema (§7.2) has no
 * scripts/hooks/command field at all — this is the enforcement side of that:
 * any manifest carrying an extra key (`scripts`, `run`, `postInstall`,
 * `exec`, or anything else) is rejected outright rather than silently
 * ignored, so a pack can never smuggle in script-like content the reader
 * would have to consciously choose to ignore. This is this module's own
 * defense-in-depth reading of §7.3/§13, not a literal spec line item —
 * flagged as a deliberate design choice.
 */
const ALLOWED_TOP_LEVEL_KEYS = new Set(["name", "directories", "files", "moves", "deletes"]);

/** No absolute paths, no `..` traversal segments, non-empty. Applies to every path-shaped field in the manifest. */
function isSafeRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (path.isAbsolute(value)) return false;
  const segments = value.split(/[/\\]/);
  return !segments.includes("..");
}

function invalidSchema(message: string, details: Record<string, unknown>): never {
  throw new ArchitectureManifestError("invalid-schema", message, details);
}

function validateDirectories(value: unknown): string[] {
  if (!Array.isArray(value)) invalidSchema('"directories" must be an array of strings.', { value });
  value.forEach((entry, index) => {
    if (!isSafeRelativePath(entry)) {
      invalidSchema(
        `"directories[${index}]" must be a safe relative path (no leading "/", no ".." segments).`,
        { index, entry },
      );
    }
  });
  return value as string[];
}

function validateFiles(value: unknown): ArchitectureFileEntry[] {
  if (!Array.isArray(value)) invalidSchema('"files" must be an array of {from, to} objects.', { value });
  value.forEach((entry, index) => {
    if (entry === null || typeof entry !== "object") {
      invalidSchema(`"files[${index}]" must be an object with "from" and "to".`, { index, entry });
    }
    const keys = Object.keys(entry as Record<string, unknown>);
    const extra = keys.filter((k) => k !== "from" && k !== "to");
    if (extra.length > 0) {
      invalidSchema(`"files[${index}]" has unsupported field(s): ${extra.join(", ")}.`, { index, extra });
    }
    const { from, to } = entry as Record<string, unknown>;
    if (!isSafeRelativePath(from)) {
      invalidSchema(`"files[${index}].from" must be a safe relative path.`, { index, from });
    }
    if (!isSafeRelativePath(to)) {
      invalidSchema(`"files[${index}].to" must be a safe relative path.`, { index, to });
    }
  });
  return value as ArchitectureFileEntry[];
}

function validateMoves(value: unknown): ArchitectureMoveEntry[] {
  if (!Array.isArray(value)) invalidSchema('"moves" must be an array of {from, to, optional?} objects.', { value });
  value.forEach((entry, index) => {
    if (entry === null || typeof entry !== "object") {
      invalidSchema(`"moves[${index}]" must be an object with "from" and "to".`, { index, entry });
    }
    const keys = Object.keys(entry as Record<string, unknown>);
    const extra = keys.filter((k) => k !== "from" && k !== "to" && k !== "optional");
    if (extra.length > 0) {
      invalidSchema(`"moves[${index}]" has unsupported field(s): ${extra.join(", ")}.`, { index, extra });
    }
    const { from, to, optional } = entry as Record<string, unknown>;
    if (!isSafeRelativePath(from)) {
      invalidSchema(`"moves[${index}].from" must be a safe relative path.`, { index, from });
    }
    if (!isSafeRelativePath(to)) {
      invalidSchema(`"moves[${index}].to" must be a safe relative path.`, { index, to });
    }
    if (optional !== undefined && typeof optional !== "boolean") {
      invalidSchema(`"moves[${index}].optional" must be a boolean when present.`, { index, optional });
    }
  });
  return value as ArchitectureMoveEntry[];
}

function validateDeletes(value: unknown, manifestPath: string): string[] {
  if (!Array.isArray(value)) invalidSchema('"deletes" must be an array (and must be empty).', { value });
  if (value.length > 0) {
    throw new ArchitectureManifestError(
      "deletes-disabled",
      `Manifest at "${manifestPath}" declares a non-empty "deletes" array (${value.length} entr${
        value.length === 1 ? "y" : "ies"
      }). Deletes are disabled by default — ` +
        "create-nockta-repo will not read or apply this manifest until deletes is emptied.",
      { deletes: value },
    );
  }
  return value as string[];
}

function validateManifestShape(parsed: unknown, manifestPath: string): ArchitectureManifest {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    invalidSchema(`Manifest at "${manifestPath}" must be a JSON object.`, { manifestPath });
  }
  const obj = parsed as Record<string, unknown>;

  const disallowed = Object.keys(obj).filter((key) => !ALLOWED_TOP_LEVEL_KEYS.has(key));
  if (disallowed.length > 0) {
    throw new ArchitectureManifestError(
      "disallowed-field",
      `Manifest at "${manifestPath}" has unsupported top-level field(s): ${disallowed.join(", ")}. ` +
        `Allowed fields: ${[...ALLOWED_TOP_LEVEL_KEYS].join(", ")}. Architecture overlays must not run ` +
        "arbitrary scripts — this manifest schema has no scripts/hooks field, so any extra " +
        "key is rejected outright rather than silently ignored.",
      { disallowed },
    );
  }

  if (typeof obj.name !== "string" || obj.name.length === 0) {
    invalidSchema(`Manifest at "${manifestPath}" must have a non-empty string "name".`, { name: obj.name });
  }

  return {
    name: obj.name,
    directories: validateDirectories(obj.directories),
    files: validateFiles(obj.files),
    moves: validateMoves(obj.moves),
    deletes: validateDeletes(obj.deletes, manifestPath),
  };
}

/**
 * Reads and validates one `arch.json` manifest directly from a directory
 * (the preset dir — the same directory that holds `files/`), without going
 * through repo-type/preset resolution. This is the low-level primitive both
 * {@link readArchitectureManifestForPreset} and tests use directly (tests
 * point it at hand-built temp directories to exercise valid/malformed/
 * non-empty-deletes cases without touching the real bundled packs).
 *
 * Throws {@link ArchitectureManifestError} with `.code`:
 * - `"preset-not-found"` — `manifestDir` itself does not exist.
 * - `"manifest-not-found"` — the dir exists but has no `arch.json`.
 * - `"malformed-json"` — `arch.json` is not valid JSON.
 * - `"invalid-schema"` — parses, but doesn't match the spec §7.2 shape.
 * - `"deletes-disabled"` — schema is otherwise valid but `deletes` is non-empty (spec §13).
 * - `"disallowed-field"` — an extra top-level key exists (script-like-content guard, see above).
 */
export function readArchitectureManifestFromDir(manifestDir: string): ArchitectureManifest {
  if (!existsSync(manifestDir)) {
    throw new ArchitectureManifestError("preset-not-found", `Architecture preset directory not found: "${manifestDir}".`, {
      manifestDir,
    });
  }

  const manifestPath = path.join(manifestDir, "arch.json");
  if (!existsSync(manifestPath)) {
    throw new ArchitectureManifestError(
      "manifest-not-found",
      `Architecture preset directory "${manifestDir}" has no arch.json.`,
      { manifestDir, manifestPath },
    );
  }

  const raw = readFileSync(manifestPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ArchitectureManifestError(
      "malformed-json",
      `Architecture manifest at "${manifestPath}" is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { manifestPath },
    );
  }

  return validateManifestShape(parsed, manifestPath);
}

export type ReadArchitectureManifestForPresetResult = {
  manifest: ArchitectureManifest;
  /** Directory containing this manifest's `arch.json` and `files/` — the base for resolving `files[].from`. */
  manifestDir: string;
};

/**
 * Resolves `packs/<repoType>/architecture/<preset>/` (spec §7.2 path
 * convention) and reads its manifest. Throws `ArchitectureManifestError`
 * with `code: "preset-not-found"` (enriched with `knownPresets`, for a
 * helpful error message) when the preset directory doesn't exist at all —
 * this is `create-nockta-repo`'s "unknown --arch preset" case.
 */
export function readArchitectureManifestForPreset(repoType: string, preset: string): ReadArchitectureManifestForPresetResult {
  const manifestDir = getArchitecturePresetPath(repoType, preset);
  try {
    const manifest = readArchitectureManifestFromDir(manifestDir);
    return { manifest, manifestDir };
  } catch (error) {
    if (error instanceof ArchitectureManifestError && error.code === "preset-not-found") {
      throw new ArchitectureManifestError(
        "preset-not-found",
        `Unknown architecture preset "${preset}" for repo type "${repoType}". Known presets: ${
          listArchitecturePresets(repoType).join(", ") || "(none)"
        }.`,
        { repoType, preset, manifestDir, knownPresets: listArchitecturePresets(repoType) },
      );
    }
    throw error;
  }
}
