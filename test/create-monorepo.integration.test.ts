import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Spec §6/§12.2/§19 Milestone 5 integration coverage: monorepo root
// detection + nested target path resolution wired into the real create flow,
// exercised against the real built dist/cli.js and fixture scaffolders
// (spec §16.2) inside a fixture monorepo temp dir (pnpm-workspace.yaml) —
// never a real framework scaffolder. Complements
// test/detect-monorepo-root.test.ts and test/resolve-target-path.test.ts
// (module-level) and test/create-command.integration.test.ts /
// test/create-architecture.integration.test.ts (Milestones 3-4, whose
// continued green run is this milestone's "standalone flow untouched" proof
// — this file adds its own explicit non-monorepo-cwd checks on top, scoped
// to the isMonorepoTarget field specifically).

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const distCliPath = path.join(packageRoot, "dist", "cli.js");
const fixturesRoot = path.join(packageRoot, "fixtures", "scaffolders");
const fakeNextBin = path.join(fixturesRoot, "fake-next", "index.mjs");

beforeAll(() => {
  execFileSync("pnpm", ["exec", "tsup"], { cwd: packageRoot, stdio: "pipe" });
  if (!existsSync(distCliPath)) {
    throw new Error(`Expected build output at ${distCliPath}, but it does not exist.`);
  }
}, 60_000);

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "create-nockta-repo-monorepo-integration-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function makeMonorepoRoot(): void {
  // pnpm-workspace.yaml — the spec §5.3/§12.2 worked example's own package
  // manager (spec §15 recommends pnpm) — one of six equally-valid §6.2 signals.
  writeFileSync(path.join(cwd, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
}

function runCli(args: string[], options: { fixtureBin?: string } = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (options.fixtureBin) {
    env.CREATE_NOCKTA_REPO_TEST_FIXTURE_BIN = options.fixtureBin;
  } else {
    delete env.CREATE_NOCKTA_REPO_TEST_FIXTURE_BIN;
  }
  // Deterministic, uncolored child output regardless of the invoking shell's
  // NO_COLOR/FORCE_COLOR/CI env — see test/create-command.integration.test.ts's
  // own runCli() comment for the flaky-stdout root cause this guards against.
  env.NO_COLOR = "1";
  delete env.FORCE_COLOR;
  return spawnSync(process.execPath, [distCliPath, ...args], { cwd, env, encoding: "utf8" });
}

describe("create at a monorepo root — nested target create (spec §12.2)", () => {
  beforeEach(() => {
    makeMonorepoRoot();
  });

  it("apps/web succeeds: fixture marker + architecture overlay both land inside apps/web", () => {
    // Milestone 6: skill injection is now real by default — --no-skills
    // keeps this Milestone-5-scoped test hermetic (no npx/network); the real
    // monorepo skills flow (root-only placement, targets.json) is covered by
    // test/create-skills.integration.test.ts.
    const result = runCli(["apps/web", "--type", "next", "--no-skills", "--yes"], { fixtureBin: fakeNextBin });
    expect(result.status).toBe(0);

    const projectDir = path.join(cwd, "apps", "web");
    expect(existsSync(path.join(projectDir, ".fixture-marker.json"))).toBe(true);
    expect(existsSync(path.join(projectDir, "src", "components", "ui"))).toBe(true);
    expect(existsSync(path.join(projectDir, "src", "features", "_template", "README.md"))).toBe(true);

    expect(result.stdout).toContain("monorepo target  yes");
    expect(result.stdout).toContain("Monorepo root detected");
  });

  it("--json: isMonorepoTarget true, monorepo detail carries the pnpm-workspace.yaml signal", () => {
    const result = runCli(["apps/web", "--type", "next", "--no-skills", "--yes", "--json"], { fixtureBin: fakeNextBin });
    expect(result.status).toBe(0);
    const lines = result.stdout.split("\n").filter((line) => line.length > 0);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.ok).toBe(true);
    expect(parsed.isMonorepoTarget).toBe(true);
    expect(parsed.monorepo.isMonorepoRoot).toBe(true);
    expect(parsed.monorepo.signals).toEqual(["pnpm-workspace.yaml"]);
    expect(parsed.monorepo.isNestedPath).toBe(true);
    expect(parsed.architecture.status).toBe("applied");
    expect(parsed.architectureChanges.created).toContain("src/components/ui");
    // Skills still skipped (--no-skills), but the repo profile is REAL as of
    // Milestone 7 — written at the TARGET's own .nockta, never at the
    // monorepo root (spec §9.1, decisions.md D5), with skillsInjected: false
    // since --no-skills was passed.
    expect(parsed.metadata.status).toBe("written");
    expect(parsed.metadata.path).toBe(path.join(cwd, "apps", "web", ".nockta", "repo-profile.json"));
    expect(parsed.metadata.profile.isMonorepoTarget).toBe(true);
    expect(parsed.metadata.profile.projectPath).toBe("apps/web");
    expect(parsed.metadata.profile.skillsInjected).toBe(false);
    expect(parsed.metadata.profile.adapters).toBeUndefined();
    expect(parsed.skills.status).toBe("skipped");
    // No root-level repo-profile.json (D5 — root .nockta is inject-owned).
    expect(existsSync(path.join(cwd, ".nockta", "repo-profile.json"))).toBe(false);
    expect(existsSync(path.join(cwd, "apps", "web", ".nockta", "repo-profile.json"))).toBe(true);
  });

  it("dry run: monorepo-aware plan, writes nothing", () => {
    const result = runCli(["apps/web", "--type", "next", "--dry-run"], { fixtureBin: fakeNextBin });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("dry run");
    expect(result.stdout).toContain("monorepo target  yes");
    expect(result.stdout).toContain("Monorepo root detected");
    expect(result.stdout).toContain('preset "standard"'); // real architecture plan still shown
    expect(existsSync(path.join(cwd, "apps"))).toBe(false);
  });

  it("dry run --json: isMonorepoTarget true, still writes nothing", () => {
    const result = runCli(["apps/web", "--type", "next", "--dry-run", "--json"], { fixtureBin: fakeNextBin });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.status).toBe("dry-run");
    expect(parsed.isMonorepoTarget).toBe(true);
    expect(existsSync(path.join(cwd, "apps"))).toBe(false);
  });

  it("rejects an existing target: exit 2, nothing written, upstream never spawned", () => {
    mkdirSync(path.join(cwd, "apps", "web"), { recursive: true });
    const result = runCli(["apps/web", "--type", "next", "--yes"], { fixtureBin: fakeNextBin });
    expect(result.status).toBe(2);
    expect(existsSync(path.join(cwd, "apps", "web", ".fixture-marker.json"))).toBe(false);
    expect(result.stderr).toContain("already exists");
  });

  it("rejects an escape attempt: exit 2, nothing written outside the repo", () => {
    const result = runCli(["../escaped-target", "--type", "next", "--yes"], { fixtureBin: fakeNextBin });
    expect(result.status).toBe(2);
    expect(existsSync(path.join(path.dirname(cwd), "escaped-target"))).toBe(false);
  });
});

describe("non-monorepo cwd — semantics unchanged (spec §6.2/§6.3)", () => {
  it("plain name: standalone flow byte-for-byte unchanged, isMonorepoTarget false, no info line", () => {
    const result = runCli(["my-project", "--type", "next", "--no-skills", "--yes", "--json"], { fixtureBin: fakeNextBin });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.isMonorepoTarget).toBe(false);
    expect(parsed.monorepo.isMonorepoRoot).toBe(false);
    expect(parsed.monorepo.infoLine).toBeNull();
    expect(existsSync(path.join(cwd, "my-project", ".fixture-marker.json"))).toBe(true);
  });

  it("nested-looking path with no monorepo root: standalone create at that path, not a monorepo target", () => {
    const result = runCli(["apps/web", "--type", "next", "--no-skills", "--yes", "--json"], { fixtureBin: fakeNextBin });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.isMonorepoTarget).toBe(false);
    expect(parsed.monorepo.isNestedPath).toBe(true);
    expect(parsed.monorepo.infoLine).toContain("standalone create");
    expect(existsSync(path.join(cwd, "apps", "web", ".fixture-marker.json"))).toBe(true);
  });
});
