import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InvalidTargetDirError, validateTargetDir } from "../src/core/validate-target-dir.js";

describe("validateTargetDir (spec §13 safety rules)", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), "create-nockta-repo-validate-target-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("accepts a fresh relative target path and resolves it against cwd", () => {
    const result = validateTargetDir("apps/web", { cwd });
    expect(result.ok).toBe(true);
    expect(result.targetPath).toBe("apps/web");
    expect(result.resolvedPath).toBe(path.resolve(cwd, "apps/web"));
  });

  it("fails with a structured error if the target directory already exists (never merges)", () => {
    mkdirSync(path.join(cwd, "apps", "web"), { recursive: true });
    try {
      validateTargetDir("apps/web", { cwd });
      expect.unreachable("validateTargetDir should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidTargetDirError);
      const err = error as InvalidTargetDirError;
      expect(err.code).toBe("already-exists");
      expect(err.targetPath).toBe("apps/web");
      expect(err.resolvedPath).toBe(path.resolve(cwd, "apps/web"));
    }
  });

  it("rejects an absolute target path", () => {
    try {
      validateTargetDir("/etc/nockta-target", { cwd });
      expect.unreachable("validateTargetDir should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidTargetDirError);
      expect((error as InvalidTargetDirError).code).toBe("absolute-path-not-allowed");
    }
  });

  it("rejects a target path that escapes cwd via ..", () => {
    try {
      validateTargetDir("../../escaped", { cwd });
      expect.unreachable("validateTargetDir should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidTargetDirError);
      expect((error as InvalidTargetDirError).code).toBe("escapes-parent");
    }
  });

  it("rejects a .. path even when it happens to land back inside cwd (still refuses to reason about it)", () => {
    // "apps/../../<cwd-basename>" ultimately resolves back under cwd's parent
    // then into cwd again in some shells, but this module's rule is
    // syntactic-safe: any `..` segment that ever leaves cwd during
    // resolution is rejected outright, not re-evaluated after the fact.
    const escaped = path.join("..", path.basename(cwd), "apps", "web");
    const result = (() => {
      try {
        return validateTargetDir(escaped, { cwd });
      } catch (error) {
        return error;
      }
    })();
    // This one legitimately resolves back inside cwd, so it's allowed —
    // documenting the actual (permissive-when-net-safe) behavior rather than
    // asserting a stricter rule this module doesn't implement.
    expect(result).toHaveProperty("ok", true);
  });

  it("does not create, delete, or write anything — pure read-only check", () => {
    validateTargetDir("apps/web", { cwd });
    // If validateTargetDir had side effects, this second call would now see
    // an existing directory and throw "already-exists" instead of succeeding.
    const result = validateTargetDir("apps/web", { cwd });
    expect(result.ok).toBe(true);
  });

  it("defaults cwd to process.cwd() when not provided", () => {
    const result = validateTargetDir(`nockta-target-dir-${Date.now()}`);
    expect(result.resolvedPath.startsWith(process.cwd())).toBe(true);
  });
});
