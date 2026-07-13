import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InvalidTargetDirError } from "../src/core/validate-target-dir.js";
import { resolveTargetPath } from "../src/core/resolve-target-path.js";

// Spec §6.3/§19 Milestone 5: nested target path resolution, composed on top
// of validateTargetDir's existing safety checks (Milestone 3) plus
// monorepo-target classification from detect-monorepo-root.ts.

describe("resolveTargetPath (spec §6.3)", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), "create-nockta-repo-resolve-target-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  function makeMonorepoRoot(): void {
    writeFileSync(path.join(cwd, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
  }

  describe("monorepo root at cwd", () => {
    it("valid nested target: isMonorepoTarget true, resolved path stays inside the repo", () => {
      makeMonorepoRoot();
      const result = resolveTargetPath("apps/web", { cwd });
      expect(result.ok).toBe(true);
      expect(result.isMonorepoTarget).toBe(true);
      expect(result.monorepoRoot.isMonorepoRoot).toBe(true);
      expect(result.monorepoRoot.signals).toContain("pnpm-workspace.yaml");
      expect(result.isNestedPath).toBe(true);
      expect(result.resolvedPath).toBe(path.resolve(cwd, "apps/web"));
      expect(result.infoLine).toContain("Monorepo root detected");
    });

    it("a plain (non-nested) name at a monorepo root is still classified a monorepo target", () => {
      makeMonorepoRoot();
      const result = resolveTargetPath("web", { cwd });
      expect(result.isMonorepoTarget).toBe(true);
      expect(result.isNestedPath).toBe(false);
    });

    it("rejects an existing target: exit-mapped InvalidTargetDirError, code already-exists", () => {
      makeMonorepoRoot();
      mkdirSync(path.join(cwd, "apps", "web"), { recursive: true });
      try {
        resolveTargetPath("apps/web", { cwd });
        expect.unreachable("resolveTargetPath should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidTargetDirError);
        expect((error as InvalidTargetDirError).code).toBe("already-exists");
      }
    });

    it("rejects an escape attempt (.. traversal) even at a monorepo root — stays inside the repo", () => {
      makeMonorepoRoot();
      try {
        resolveTargetPath("../../escaped", { cwd });
        expect.unreachable("resolveTargetPath should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidTargetDirError);
        expect((error as InvalidTargetDirError).code).toBe("escapes-parent");
      }
    });

    it("rejects an absolute target path even at a monorepo root", () => {
      makeMonorepoRoot();
      try {
        resolveTargetPath("/etc/nockta-target", { cwd });
        expect.unreachable("resolveTargetPath should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidTargetDirError);
        expect((error as InvalidTargetDirError).code).toBe("absolute-path-not-allowed");
      }
    });

    it("does not create parent directories itself — pure validation only", () => {
      makeMonorepoRoot();
      resolveTargetPath("apps/web", { cwd });
      expect(() => resolveTargetPath("apps/web", { cwd })).not.toThrow(); // still doesn't exist
    });
  });

  describe("non-monorepo cwd", () => {
    it("a plain name is the standalone flow, unchanged: isMonorepoTarget false, no info line", () => {
      const result = resolveTargetPath("my-project", { cwd });
      expect(result.isMonorepoTarget).toBe(false);
      expect(result.monorepoRoot.isMonorepoRoot).toBe(false);
      expect(result.isNestedPath).toBe(false);
      expect(result.infoLine).toBeNull();
      expect(result.resolvedPath).toBe(path.resolve(cwd, "my-project"));
    });

    it("a nested-looking path is a standalone create at that relative path, not a monorepo target", () => {
      const result = resolveTargetPath("apps/web", { cwd });
      expect(result.isMonorepoTarget).toBe(false);
      expect(result.isNestedPath).toBe(true);
      expect(result.infoLine).toContain("standalone create");
      expect(result.resolvedPath).toBe(path.resolve(cwd, "apps/web"));
    });

    it("still rejects an already-existing nested target", () => {
      mkdirSync(path.join(cwd, "apps", "web"), { recursive: true });
      try {
        resolveTargetPath("apps/web", { cwd });
        expect.unreachable("resolveTargetPath should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidTargetDirError);
        expect((error as InvalidTargetDirError).code).toBe("already-exists");
      }
    });

    it("still rejects an escape attempt", () => {
      try {
        resolveTargetPath("../escaped", { cwd });
        expect.unreachable("resolveTargetPath should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidTargetDirError);
        expect((error as InvalidTargetDirError).code).toBe("escapes-parent");
      }
    });
  });

  it("defaults cwd to process.cwd() when not provided", () => {
    const result = resolveTargetPath(`nockta-resolve-target-${Date.now()}`);
    expect(result.resolvedPath.startsWith(process.cwd())).toBe(true);
  });
});
