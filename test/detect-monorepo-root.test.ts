import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectMonorepoRoot } from "../src/core/detect-monorepo-root.js";

// Spec §6.2/§19 Milestone 5: monorepo-root signals, checked at cwd only (no
// upward directory walk — spec §6.3's own example is `cd existing-monorepo
// && npx create-nockta-repo apps/web ...`, i.e. the user is already standing
// at the root).

describe("detectMonorepoRoot (spec §6.2)", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), "create-nockta-repo-detect-monorepo-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("reports no monorepo root when none of the signals are present", () => {
    const result = detectMonorepoRoot(cwd);
    expect(result.isMonorepoRoot).toBe(false);
    expect(result.root).toBeNull();
    expect(result.signals).toEqual([]);
  });

  it("detects pnpm-workspace.yaml", () => {
    writeFileSync(path.join(cwd, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
    const result = detectMonorepoRoot(cwd);
    expect(result.isMonorepoRoot).toBe(true);
    expect(result.root).toBe(cwd);
    expect(result.signals).toEqual(["pnpm-workspace.yaml"]);
  });

  it("detects turbo.json", () => {
    writeFileSync(path.join(cwd, "turbo.json"), "{}");
    const result = detectMonorepoRoot(cwd);
    expect(result.isMonorepoRoot).toBe(true);
    expect(result.signals).toEqual(["turbo.json"]);
  });

  it("detects nx.json", () => {
    writeFileSync(path.join(cwd, "nx.json"), "{}");
    const result = detectMonorepoRoot(cwd);
    expect(result.isMonorepoRoot).toBe(true);
    expect(result.signals).toEqual(["nx.json"]);
  });

  it("detects lerna.json", () => {
    writeFileSync(path.join(cwd, "lerna.json"), "{}");
    const result = detectMonorepoRoot(cwd);
    expect(result.isMonorepoRoot).toBe(true);
    expect(result.signals).toEqual(["lerna.json"]);
  });

  it("detects rush.json", () => {
    writeFileSync(path.join(cwd, "rush.json"), "{}");
    const result = detectMonorepoRoot(cwd);
    expect(result.isMonorepoRoot).toBe(true);
    expect(result.signals).toEqual(["rush.json"]);
  });

  it("detects package.json workspaces in array form (npm/pnpm/yarn classic)", () => {
    writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name: "root", workspaces: ["packages/*"] }));
    const result = detectMonorepoRoot(cwd);
    expect(result.isMonorepoRoot).toBe(true);
    expect(result.signals).toEqual(["package.json:workspaces"]);
  });

  it("detects package.json workspaces in object form (yarn nohoist)", () => {
    writeFileSync(
      path.join(cwd, "package.json"),
      JSON.stringify({ name: "root", workspaces: { packages: ["packages/*"], nohoist: ["**/react-native"] } }),
    );
    const result = detectMonorepoRoot(cwd);
    expect(result.isMonorepoRoot).toBe(true);
    expect(result.signals).toEqual(["package.json:workspaces"]);
  });

  it("an empty workspaces array still counts as a signal (mere presence, spec §6.2 states no minimum)", () => {
    writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name: "root", workspaces: [] }));
    const result = detectMonorepoRoot(cwd);
    expect(result.isMonorepoRoot).toBe(true);
  });

  it("a plain package.json with no workspaces field is not a signal", () => {
    writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name: "not-a-monorepo", version: "1.0.0" }));
    const result = detectMonorepoRoot(cwd);
    expect(result.isMonorepoRoot).toBe(false);
  });

  it("tolerates a malformed package.json — not a signal, does not throw", () => {
    writeFileSync(path.join(cwd, "package.json"), "{ not valid json");
    expect(() => detectMonorepoRoot(cwd)).not.toThrow();
    expect(detectMonorepoRoot(cwd).isMonorepoRoot).toBe(false);
  });

  it("reports every matching signal at once, not just the first", () => {
    writeFileSync(path.join(cwd, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
    writeFileSync(path.join(cwd, "turbo.json"), "{}");
    writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ workspaces: ["apps/*"] }));
    const result = detectMonorepoRoot(cwd);
    expect(result.isMonorepoRoot).toBe(true);
    expect([...result.signals].sort()).toEqual(
      ["pnpm-workspace.yaml", "turbo.json", "package.json:workspaces"].sort(),
    );
  });

  it("only checks cwd itself, not ancestor directories", () => {
    const nested = path.join(cwd, "apps", "web");
    writeFileSync(path.join(cwd, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
    // nested/ does not exist yet and carries no signal file of its own —
    // detection must not walk up to find the parent's signal.
    const result = detectMonorepoRoot(nested);
    expect(result.isMonorepoRoot).toBe(false);
  });

  it("defaults cwd to process.cwd() when not provided", () => {
    const result = detectMonorepoRoot();
    expect(result.root === null || result.root === process.cwd()).toBe(true);
  });
});
