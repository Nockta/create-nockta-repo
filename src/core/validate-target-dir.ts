import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Structured reasons {@link validateTargetDir} can refuse a target path.
 * Spec §13 only mandates "fail if target directory already exists" /
 * "never merge"; the absolute-path and parent-escape checks are this
 * module's own explicit safety calls (not spec-mandated line items), made so
 * `create-nockta-repo <path>` can never be pointed at an arbitrary
 * filesystem location outside the resolved working directory. See
 * `src/core/CONTEXT.md` for the full reasoning — flagged there and in the
 * Milestone 3 report as a deviation worth revisiting once monorepo/target
 * resolution (Milestone 5) exists and may have its own opinion here.
 */
export type TargetDirErrorCode = "already-exists" | "absolute-path-not-allowed" | "escapes-parent";

/**
 * Thrown by {@link validateTargetDir} — a structured error (spec §13, §5.9
 * machine interface) rather than a bare string throw, matching the
 * `UnknownRepoTypeError` convention already established in
 * `src/scaffolders/registry.ts`.
 */
export class InvalidTargetDirError extends Error {
  readonly code: TargetDirErrorCode;
  readonly targetPath: string;
  readonly resolvedPath?: string;

  constructor(params: { code: TargetDirErrorCode; message: string; targetPath: string; resolvedPath?: string }) {
    super(params.message);
    this.name = "InvalidTargetDirError";
    this.code = params.code;
    this.targetPath = params.targetPath;
    this.resolvedPath = params.resolvedPath;
  }
}

export type ValidateTargetDirOptions = {
  /** Base directory relative targets resolve against. Defaults to `process.cwd()`. */
  cwd?: string;
};

export type ValidateTargetDirResult = {
  ok: true;
  /** The path exactly as given by the caller (spec examples always show this form, e.g. "apps/web"). */
  targetPath: string;
  /** Absolute resolution of `targetPath` against `cwd` — for diagnostics/plan printing only. */
  resolvedPath: string;
};

/**
 * Spec §13 safety rules: fail (structured error, never a silent merge) if
 * the target directory already exists. Also enforces two explicit
 * path-safety checks this module adds on top of the spec text:
 *
 * - reject absolute paths outright — every documented example (spec §5.2,
 *   §5.3, §5.4) uses a path relative to the current directory; there is no
 *   spec-described use case for an absolute target, and allowing one would
 *   let `create-nockta-repo` write anywhere on disk.
 * - reject any relative path that resolves outside `cwd` via `..`
 *   traversal (e.g. `../../etc`) — same reasoning, "safe and predictable"
 *   (spec §2.4.11).
 *
 * Pure synchronous fs existence check — this module never creates,
 * deletes, or writes anything. Directory creation is the upstream
 * scaffolder's job (spec §13); this only decides whether it's safe to let
 * that happen.
 */
export function validateTargetDir(targetPath: string, options: ValidateTargetDirOptions = {}): ValidateTargetDirResult {
  const cwd = options.cwd ?? process.cwd();

  if (path.isAbsolute(targetPath)) {
    throw new InvalidTargetDirError({
      code: "absolute-path-not-allowed",
      message:
        `Target path "${targetPath}" is absolute. create-nockta-repo only creates targets ` +
        "relative to the current directory.",
      targetPath,
    });
  }

  const resolvedPath = path.resolve(cwd, targetPath);
  const relativeFromCwd = path.relative(cwd, resolvedPath);

  if (relativeFromCwd === ".." || relativeFromCwd.startsWith(`..${path.sep}`) || path.isAbsolute(relativeFromCwd)) {
    throw new InvalidTargetDirError({
      code: "escapes-parent",
      message:
        `Target path "${targetPath}" resolves outside the current directory (${cwd}); ` +
        "create-nockta-repo refuses to create targets that escape the working directory via `..`.",
      targetPath,
      resolvedPath,
    });
  }

  if (existsSync(resolvedPath)) {
    throw new InvalidTargetDirError({
      code: "already-exists",
      message:
        `Target directory "${targetPath}" already exists. create-nockta-repo never merges into ` +
        "an existing directory — remove it first or choose a different target.",
      targetPath,
      resolvedPath,
    });
  }

  return { ok: true, targetPath, resolvedPath };
}
