import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Spec §19 Milestone 4 integration coverage: the architecture overlay system
// wired into the real create flow, exercised against the real built
// dist/cli.js and fixture scaffolders (spec §16.2) — never a real framework
// scaffolder. Complements test/create-command.integration.test.ts (which
// covers Milestone 3 plumbing plus the now-real dry-run arch plan) and the
// module-level test/read-architecture-manifest.test.ts +
// test/apply-architecture-manifest.test.ts + test/standard-overlays.test.ts.

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
  cwd = mkdtempSync(path.join(tmpdir(), "create-nockta-repo-arch-integration-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function runCli(args: string[], options: { fixtureBin?: string; archDir?: string } = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (options.fixtureBin) {
    env.CREATE_NOCKTA_REPO_TEST_FIXTURE_BIN = options.fixtureBin;
  } else {
    delete env.CREATE_NOCKTA_REPO_TEST_FIXTURE_BIN;
  }
  if (options.archDir) {
    env.CREATE_NOCKTA_REPO_TEST_ARCH_DIR = options.archDir;
  } else {
    delete env.CREATE_NOCKTA_REPO_TEST_ARCH_DIR;
  }
  // Deterministic, uncolored child output regardless of the invoking shell's
  // NO_COLOR/FORCE_COLOR/CI env — see test/create-command.integration.test.ts's
  // own runCli() comment for the flaky-stdout root cause this guards against.
  env.NO_COLOR = "1";
  delete env.FORCE_COLOR;
  return spawnSync(process.execPath, [distCliPath, ...args], { cwd, env, encoding: "utf8" });
}

describe("create + fixture scaffold + overlay applied (spec §12.1 steps 6-9)", () => {
  it("fixture marker AND overlay content both exist afterwards, unlisted upstream files untouched", () => {
    // Milestone 6: skill injection is now real by default — --no-skills
    // keeps this Milestone-4-scoped test hermetic (no npx/network); the
    // skills step itself is covered by test/create-skills.integration.test.ts.
    const result = runCli(["apps/web", "--type", "next", "--no-skills", "--yes"], { fixtureBin: fakeNextBin });
    expect(result.status).toBe(0);

    const projectDir = path.join(cwd, "apps", "web");
    // Upstream's own output (the fixture marker) survived.
    const markerPath = path.join(projectDir, ".fixture-marker.json");
    expect(existsSync(markerPath)).toBe(true);
    expect(JSON.parse(readFileSync(markerPath, "utf8")).fixture).toBe("fake-next");

    // The overlay's own output exists alongside it.
    expect(existsSync(path.join(projectDir, "src", "components", "ui"))).toBe(true);
    expect(existsSync(path.join(projectDir, "src", "components", "layout"))).toBe(true);
    expect(existsSync(path.join(projectDir, "src", "features", "_template", "README.md"))).toBe(true);
    expect(existsSync(path.join(projectDir, "src", "components", "ui", ".gitkeep"))).toBe(true);
    // Optional move: fake-next never creates src/app/page.tsx, so no move happened.
    expect(existsSync(path.join(projectDir, "src", "app"))).toBe(false);

    expect(result.stdout).toContain("Architecture overlay applied");
  });
});

describe("--no-arch skips the overlay entirely (spec §5.5)", () => {
  it("only upstream's own output exists — no overlay directories/files anywhere", () => {
    const result = runCli(["apps/web", "--type", "next", "--no-arch", "--no-skills", "--yes"], { fixtureBin: fakeNextBin });
    expect(result.status).toBe(0);

    const projectDir = path.join(cwd, "apps", "web");
    expect(existsSync(path.join(projectDir, ".fixture-marker.json"))).toBe(true);
    expect(existsSync(path.join(projectDir, "src"))).toBe(false);
    expect(result.stdout).toContain("--no-arch");
  });

  it("--json: architectureChanges stays all-empty and architecture.status is skipped", () => {
    const result = runCli(["apps/web", "--type", "next", "--no-arch", "--no-skills", "--yes", "--json"], {
      fixtureBin: fakeNextBin,
    });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.architecture.status).toBe("skipped");
    expect(parsed.architecture.preset).toBeNull();
    expect(parsed.architectureChanges).toEqual({ created: [], updated: [], moved: [], skipped: [] });
  });
});

describe("dry-run: writes nothing, prints the real arch plan (spec §5.7)", () => {
  it("no target directory or overlay content is ever created", () => {
    const result = runCli(["apps/web", "--type", "next", "--dry-run"], { fixtureBin: fakeNextBin });
    expect(result.status).toBe(0);
    expect(existsSync(path.join(cwd, "apps"))).toBe(false);
    expect(result.stdout).toContain('Architecture overlay:  preset "standard"');
    expect(result.stdout).toContain("src/lib/http");
  });
});

describe("unknown --arch preset: exit 2, upstream never runs (spec §5.9)", () => {
  it("fails before running upstream — no marker file, no target directory", () => {
    const result = runCli(["apps/web", "--type", "next", "--arch", "does-not-exist", "--yes"], { fixtureBin: fakeNextBin });
    expect(result.status).toBe(2);
    expect(existsSync(path.join(cwd, "apps"))).toBe(false);
    expect(result.stderr).toContain("Unknown architecture preset");
  });

  it("--json: structured error envelope, not a crash", () => {
    const result = runCli(["apps/web", "--type", "next", "--arch", "does-not-exist", "--yes", "--json"]);
    expect(result.status).toBe(2);
    const lines = result.stdout.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("architecture-preset-not-found");
  });
});

describe("architecture overlay failure after upstream success: exit 3, reports what was already created (spec §5.9, §7.3, §13)", () => {
  let archDir: string;

  beforeEach(() => {
    // A hand-built preset (spec §7.2 shape) whose one move is NOT optional
    // and whose source the fake-next fixture never creates — the only way
    // to reach an apply-time overlay failure deterministically, without
    // adding a test-only preset to the real published packs/ content. See
    // ARCH_FIXTURE_OVERRIDE_ENV_VAR in src/commands/create.ts.
    const root = mkdtempSync(path.join(tmpdir(), "create-nockta-repo-arch-failure-preset-"));
    archDir = path.join(root, "broken-preset");
    mkdirSync(path.join(archDir, "files"), { recursive: true });
    writeFileSync(
      path.join(archDir, "arch.json"),
      JSON.stringify({
        name: "broken-preset",
        directories: ["src/components/ui"],
        files: [],
        moves: [{ from: "src/app/page.tsx", to: "src/app/(public)/page.tsx" }],
        deletes: [],
      }),
    );
  });

  afterEach(() => {
    rmSync(path.dirname(archDir), { recursive: true, force: true });
  });

  it("exits 3, upstream's output survives, the directory created before the failing move is reported", () => {
    const result = runCli(["apps/web", "--type", "next", "--arch", "broken-preset", "--yes"], {
      fixtureBin: fakeNextBin,
      archDir,
    });
    expect(result.status).toBe(3);

    const projectDir = path.join(cwd, "apps", "web");
    // Upstream really did succeed and its output is still there — no rollback.
    expect(existsSync(path.join(projectDir, ".fixture-marker.json"))).toBe(true);
    // The directory step ran before the failing move and its result survives.
    expect(existsSync(path.join(projectDir, "src", "components", "ui"))).toBe(true);
    // The failing move never happened.
    expect(existsSync(path.join(projectDir, "src", "app", "(public)"))).toBe(false);

    expect(result.stdout).toContain("Architecture overlay failed");
    expect(result.stdout).toContain("already created");
    expect(result.stderr).toContain("architecture overlay failed");
  });

  it("--json: ok:false, status overlay-failed, architectureChanges carries the partial state", () => {
    const result = runCli(["apps/web", "--type", "next", "--arch", "broken-preset", "--yes", "--json"], {
      fixtureBin: fakeNextBin,
      archDir,
    });
    expect(result.status).toBe(3);
    const lines = result.stdout.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.ok).toBe(false);
    expect(parsed.status).toBe("overlay-failed");
    expect(parsed.architecture.status).toBe("failed");
    expect(parsed.architecture.code).toBe("move-source-missing");
    expect(parsed.architectureChanges.created).toEqual(["src/components/ui"]);
    expect(parsed.architectureChanges.moved).toEqual([]);
  });
});
