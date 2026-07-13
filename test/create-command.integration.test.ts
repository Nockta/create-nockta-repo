import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Spec §16.2/§19 Milestone 3: run the *real built* create flow — argv
// parsing, resolveArgv's implicit `create`, the scaffolder registry,
// target-dir validation, the upstream runner, exit codes, --json shaping —
// end to end against fixture scaffolders in real vitest temp dirs. Never
// against a real framework scaffolder (no network; a hard constraint on
// this milestone).

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const distCliPath = path.join(packageRoot, "dist", "cli.js");
const fixturesRoot = path.join(packageRoot, "fixtures", "scaffolders");
const fakeNextBin = path.join(fixturesRoot, "fake-next", "index.mjs");
const fakeViteBin = path.join(fixturesRoot, "fake-vite-react-ts", "index.mjs");
const fakeFailingBin = path.join(fixturesRoot, "fake-failing", "index.mjs");

beforeAll(() => {
  // Fresh dist so this suite can never pass vacuously against stale output
  // (mirrors test/symlink-entrypoint.test.ts's own rebuild-in-beforeAll).
  execFileSync("pnpm", ["exec", "tsup"], { cwd: packageRoot, stdio: "pipe" });
  if (!existsSync(distCliPath)) {
    throw new Error(`Expected build output at ${distCliPath}, but it does not exist.`);
  }
}, 60_000);

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "create-nockta-repo-create-integration-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function runCli(args: string[], options: { fixtureBin?: string; deleteAmbientCI?: boolean } = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (options.fixtureBin) {
    env.CREATE_NOCKTA_REPO_TEST_FIXTURE_BIN = options.fixtureBin;
  } else {
    delete env.CREATE_NOCKTA_REPO_TEST_FIXTURE_BIN;
  }
  // Headless-scaffolder CI=true fix (core/run-upstream.ts's `forceCI`): some tests below assert
  // the spawned fixture scaffolder observes CI=true purely from `--yes`, regardless of whatever
  // ambient CI value this suite itself happens to run under — delete it from the outer env first
  // so the assertion actually exercises `forceCI`'s own default rather than passing vacuously
  // because the *outer* test runner already had CI=true.
  if (options.deleteAmbientCI) {
    delete env.CI;
  }
  // Root-cause fix for a flaky stdout assertion (worker brief item 1): picocolors
  // (src/commands/create.ts's `pc`) reads NO_COLOR/FORCE_COLOR/CI/isTTY from the
  // CHILD process's own env — spawnSync inherits the outer shell's env verbatim
  // (`{...process.env}` above), so whether e.g. FORCE_COLOR happens to be set in
  // whatever shell/CI runs this suite silently changes whether the spawned CLI's
  // dry-run output is colorized. Only ONE line was ever brittle to this
  // (`pc.cyan(command)` wraps just the "npx" token, not the whole command line,
  // so an ANSI reset sequence lands mid-string and breaks a contiguous
  // `toContain("npx create-next-app@latest ...")` match) — every other assertion
  // in this suite happened to still pass either way. Forcing NO_COLOR here makes
  // the spawned CLI's output deterministic across every invoking environment,
  // matching real non-interactive/non-TTY usage (this is a spawned child with
  // piped stdout, never a real terminal) rather than loosening the assertion to
  // tolerate ANSI noise.
  env.NO_COLOR = "1";
  delete env.FORCE_COLOR;
  return spawnSync(process.execPath, [distCliPath, ...args], { cwd, env, encoding: "utf8" });
}

describe("create — dry run (spec §5.7)", () => {
  it("prints the plan (upstream command incl. passthrough, target, skip lines) and writes nothing", () => {
    const result = runCli(["apps/web", "--type", "next", "--dry-run", "--", "--tailwind", "--eslint"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("dry run");
    expect(result.stdout).toContain("npx create-next-app@latest apps/web --tailwind --eslint");
    // Milestone 4: dry run now prints the *real* architecture plan (read
    // from the actual next/standard/arch.json), not a "Milestone 4" skip
    // stub — spec §5.7 "dry run must include architecture plan".
    expect(result.stdout).toContain("Architecture overlay:");
    expect(result.stdout).toContain('preset "standard"');
    expect(result.stdout).toContain("src/components/ui");
    expect(result.stdout).toContain("src/features/_template/README.md");
    expect(result.stdout).toContain("src/app/page.tsx -> src/app/(public)/page.tsx (optional)");
    // Milestone 6: dry run now prints the *real* inject-nockta-skills command
    // (spec §5.7, this milestone's brief item 3), not a "Milestone 6" skip
    // stub. Milestone 7: the repo-profile plan is real too — path + field
    // preview, not a skip stub.
    expect(result.stdout).toContain("AI skill injection:    standalone install via inject-nockta-skills — would run:");
    expect(result.stdout).toContain("npx inject-nockta-skills@latest install --type next --adapters claude --yes --json");
    expect(result.stdout).toContain("Repo profile metadata: would write:");
    expect(result.stdout).toContain(path.join(cwd, "apps", "web", ".nockta", "repo-profile.json"));
    expect(result.stdout).toContain("Nothing was written.");
    // The strongest proof: the target directory was never created at all.
    expect(existsSync(path.join(cwd, "apps", "web"))).toBe(false);
    expect(existsSync(path.join(cwd, "apps"))).toBe(false);
  });

  it("never spawns anything — even pointed at the fixture-override env var, dry run still writes nothing", () => {
    const result = runCli(["apps/web", "--type", "next", "--dry-run"], { fixtureBin: fakeNextBin });
    expect(result.status).toBe(0);
    expect(existsSync(path.join(cwd, "apps"))).toBe(false);
  });

  it("--json dry run: exactly one compact JSON line, parseable, carrying the full plan", () => {
    const result = runCli(["apps/web", "--type", "next", "--dry-run", "--json", "--", "--tailwind"]);
    expect(result.status).toBe(0);
    const lines = result.stdout.split("\n").filter((line) => line.length > 0);
    expect(lines).toHaveLength(1);
    expect(result.stdout).not.toContain("\n  "); // no pretty-printed indentation
    const parsed = JSON.parse(lines[0]);
    expect(parsed.ok).toBe(true);
    expect(parsed.status).toBe("dry-run");
    expect(parsed.repoType).toBe("next");
    expect(parsed.targetPath).toBe("apps/web");
    expect(parsed.passthroughArgs).toEqual(["--tailwind"]);
    expect(parsed.officialScaffolder.args).toEqual(["create-next-app@latest", "apps/web", "--tailwind"]);
    // Milestone 4: --json dry run carries the real architecture plan
    // (status "planned"), read from the real next/standard manifest, plus
    // an always-present, still-empty architectureChanges (spec §11.4) since
    // dry run writes nothing.
    expect(parsed.architecture.status).toBe("planned");
    expect(parsed.architecture.preset).toBe("standard");
    expect(parsed.architecture.plan.directories).toContain("src/components/ui");
    expect(parsed.architecture.plan.moves).toEqual([
      { from: "src/app/page.tsx", to: "src/app/(public)/page.tsx", optional: true },
    ]);
    expect(parsed.architectureChanges).toEqual({ created: [], updated: [], moved: [], skipped: [] });
    // Milestone 6: dry run now prints the real, exact inject-nockta-skills
    // command that would run (spec §5.7, this milestone's brief item 3) —
    // no longer a "skipped (milestone 6)" stub. Nothing was spawned (see the
    // "never spawns anything" dry-run test above for the strongest proof of
    // that, and the "writes nothing" assertion below).
    expect(parsed.skills.status).toBe("planned");
    expect(parsed.skills.mode).toBe("standalone");
    expect(parsed.skills.command).toBe("npx");
    expect(parsed.skills.args[0]).toBe("inject-nockta-skills@latest");
    expect(parsed.skills.commandLine).toContain("npx inject-nockta-skills@latest install --type next --adapters claude --yes --json");
    expect(parsed.skillsInjected).toBe(false);
    // Milestone 7: the repo-profile plan is real — "planned" (dry run) with
    // the resolved write path and a field preview, not a skip stub.
    expect(parsed.metadata.status).toBe("planned");
    expect(parsed.metadata.path).toBe(path.join(cwd, "apps", "web", ".nockta", "repo-profile.json"));
    expect(parsed.metadata.preview.tool).toBe("create-nockta-repo");
    // D22 (worker pass adding --also): repoTypes[] (primary first), was
    // singular repoType — this create call has no --also, so it's still the
    // trivial one-element case.
    expect(parsed.metadata.preview.repoTypes).toEqual(["next"]);
    expect(parsed.metadata.preview.architecture).toBe("standard");
    expect(parsed.metadata.preview.isMonorepoTarget).toBe(false);
    expect(parsed.metadata.preview.skillsInjected).toBe(true); // planned, not a real outcome
    // Spec §11.4 CreateNocktaRepoResult formal assembly (this milestone's
    // brief item 3) — present even under dry run, honestly reflecting
    // nothing has happened yet.
    expect(parsed.result.projectDir).toBe(path.join(cwd, "apps", "web"));
    expect(parsed.result.skillsInjected).toBe(false);
    expect(parsed.result.warnings).toEqual([]);
    expect(parsed.projectDir).toBe(path.join(cwd, "apps", "web"));
  });

  it("covers the Vite -- separator interaction: passthrough args land inside vite's own forwarded segment", () => {
    const result = runCli(["apps/web", "--type", "vite-react-ts", "--dry-run", "--json", "--", "--overwrite"]);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.officialScaffolder.args).toEqual([
      "create",
      "vite@latest",
      "apps/web",
      "--",
      "--template",
      "react-ts",
      "--overwrite",
    ]);
    expect(parsed.officialScaffolder.args.filter((a: string) => a === "--")).toHaveLength(1);
  });
});

describe("create — real run against fixture scaffolders (spec §16.2)", () => {
  it("fake-next: creates the target directory, marker file, and forwards passthrough args in order", () => {
    // Milestone 6: skill injection is now real by default — --no-skills
    // keeps this Milestone-3-scoped test hermetic (no npx/network); the
    // skills step itself is covered by test/create-skills.integration.test.ts.
    const result = runCli(
      ["apps/web", "--type", "next", "--no-skills", "--yes", "--", "--tailwind", "--eslint", "--src-dir", "--app"],
      { fixtureBin: fakeNextBin },
    );
    expect(result.status).toBe(0);
    const markerPath = path.join(cwd, "apps", "web", ".fixture-marker.json");
    expect(existsSync(markerPath)).toBe(true);
    const marker = JSON.parse(readFileSync(markerPath, "utf8"));
    expect(marker.fixture).toBe("fake-next");
    expect(marker.targetPath).toBe("apps/web");
    expect(marker.passthroughArgs).toEqual(["--tailwind", "--eslint", "--src-dir", "--app"]);
  });

  it("headless-scaffolder CI=true fix: --yes forces CI=true in the real spawned scaffolder's env end to end", () => {
    // Demonstrates the verified bug's fix through the REAL built CLI (dist/cli.js), not just the
    // runUpstream unit. Deletes the ambient CI first so this can't pass vacuously if the suite
    // itself happens to run under CI=true already (see runCli's deleteAmbientCI comment).
    const result = runCli(
      ["apps/web", "--type", "next", "--no-skills", "--yes", "--", "--tailwind", "--eslint", "--src-dir", "--app"],
      { fixtureBin: fakeNextBin, deleteAmbientCI: true },
    );
    expect(result.status).toBe(0);
    const marker = JSON.parse(readFileSync(path.join(cwd, "apps", "web", ".fixture-marker.json"), "utf8"));
    expect(marker.env.CI).toBe("true");
  });

  it("fake-vite-react-ts: second fixture type also creates target + marker", () => {
    const result = runCli(["apps/storefront", "--type", "vite-react-ts", "--no-skills", "--yes", "--", "--overwrite"], {
      fixtureBin: fakeViteBin,
    });
    expect(result.status).toBe(0);
    const markerPath = path.join(cwd, "apps", "storefront", ".fixture-marker.json");
    expect(existsSync(markerPath)).toBe(true);
    const marker = JSON.parse(readFileSync(markerPath, "utf8"));
    expect(marker.fixture).toBe("fake-vite-react-ts");
    expect(marker.passthroughArgs).toEqual(["--overwrite"]);
  });

  it("--json real success: one compact JSON line with ok:true, status created, and upstream result", () => {
    const result = runCli(["apps/web", "--type", "next", "--no-skills", "--yes", "--json"], { fixtureBin: fakeNextBin });
    expect(result.status).toBe(0);
    const lines = result.stdout.split("\n").filter((line) => line.length > 0);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.ok).toBe(true);
    expect(parsed.status).toBe("created");
    // Milestone 6: real (skipped-via-flag) skills status now flows through.
    expect(parsed.skills.status).toBe("skipped");
    expect(parsed.skillsInjected).toBe(false);
    expect(parsed.upstream.ok).toBe(true);
    expect(parsed.upstream.exitCode).toBe(0);
    expect(typeof parsed.upstream.durationMs).toBe("number");
    // Milestone 4: architecture overlay actually applied (default preset
    // "standard") on top of the fake-next fixture's output — spec §11.4
    // architectureChanges populated, not stubbed.
    expect(parsed.architecture.status).toBe("applied");
    expect(parsed.architecture.preset).toBe("standard");
    expect(parsed.architectureChanges.created).toContain("src/components/ui");
    expect(parsed.architectureChanges.created).toContain("src/features/_template/README.md");
    // fake-next never creates src/app/page.tsx, so the optional move is skipped, not an error.
    expect(parsed.architectureChanges.skipped).toEqual([
      "src/app/page.tsx -> src/app/(public)/page.tsx (optional, source missing)",
    ]);
    expect(existsSync(path.join(cwd, "apps", "web", "src", "components", "ui"))).toBe(true);
    expect(existsSync(path.join(cwd, "apps", "web", "src", "features", "_template", "README.md"))).toBe(true);
  });
});

describe("create — upstream failure handling (spec §13)", () => {
  it("stops immediately, no post-processing, no target directory, and exits with the upstream-failure code", () => {
    const result = runCli(["apps/broken", "--type", "next", "--yes"], { fixtureBin: fakeFailingBin });
    expect(result.status).toBe(1);
    expect(existsSync(path.join(cwd, "apps", "broken"))).toBe(false);
    expect(existsSync(path.join(cwd, "apps"))).toBe(false);
    expect(result.stderr).toContain("create failed");
    expect(result.stderr).toContain("Stopping — no post-processing runs after an upstream failure.");
  });

  it("--json failure: still exactly one compact JSON line, ok:false, status upstream-failed, real child exit code surfaced", () => {
    const result = runCli(["apps/broken", "--type", "next", "--yes", "--json"], { fixtureBin: fakeFailingBin });
    expect(result.status).toBe(1);
    const lines = result.stdout.split("\n").filter((line) => line.length > 0);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.ok).toBe(false);
    expect(parsed.status).toBe("upstream-failed");
    expect(parsed.upstream.ok).toBe(false);
    expect(parsed.upstream.exitCode).toBe(7); // fixture's real exit code, not create-nockta-repo's normalized 1
  });
});

describe("create — target directory validation (spec §13)", () => {
  it("fails with exit code 2 and never spawns the scaffolder when the target already exists", () => {
    mkdirSync(path.join(cwd, "apps", "web"), { recursive: true });
    const result = runCli(["apps/web", "--type", "next", "--yes"], { fixtureBin: fakeNextBin });
    expect(result.status).toBe(2);
    // Prove upstream never ran: no marker file was dropped into the
    // already-existing directory.
    expect(existsSync(path.join(cwd, "apps", "web", ".fixture-marker.json"))).toBe(false);
    expect(result.stderr).toContain("already exists");
  });

  it("rejects an absolute target path with exit code 2", () => {
    const result = runCli([path.join(cwd, "outside-target"), "--type", "next", "--yes"]);
    expect(result.status).toBe(2);
  });

  it("rejects a target path that escapes cwd via .. with exit code 2", () => {
    const result = runCli(["../escaped-target", "--type", "next", "--yes"]);
    expect(result.status).toBe(2);
    expect(existsSync(path.join(path.dirname(cwd), "escaped-target"))).toBe(false);
  });

  it("rejects an unknown --type with exit code 2", () => {
    const result = runCli(["apps/web", "--type", "django", "--yes"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Unknown repo type");
  });
});
