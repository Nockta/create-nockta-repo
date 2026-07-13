import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Spec §8, §19 Milestone 6 headline integration coverage (this milestone's
// brief item 5 — "the point of this milestone"): the built create-nockta-repo
// CLI spawning the REAL built inject-nockta-skills CLI — the actual
// convergence of the two sibling packages, never faked on the inject side.
// Upstream is still a fixture scaffolder (spec §16.2) — this suite is not
// about proving create-next-app works, it's about proving create-nockta-repo
// -> inject-nockta-skills works, end to end, for real.
//
// Complements test/run-inject-skills.test.ts (module-level: command
// construction, error/parse paths against tiny local fixture scripts) and
// test/create-command.integration.test.ts / test/create-architecture.integration.test.ts
// / test/create-monorepo.integration.test.ts (Milestones 3-5, all updated
// this pass to pass --no-skills so they stay scoped to what they test, now
// that skill injection is a real, default-on step).

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const distCliPath = path.join(packageRoot, "dist", "cli.js");
const fixturesRoot = path.join(packageRoot, "fixtures", "scaffolders");
const fakeNextBin = path.join(fixturesRoot, "fake-next", "index.mjs");
const fakeInjectFailingBin = path.join(packageRoot, "fixtures", "inject", "fake-inject-failing", "index.mjs");

const injectRoot = path.join(packageRoot, "..", "inject-nockta-skills");
const injectDistCliPath = path.join(injectRoot, "dist", "cli.js");

beforeAll(() => {
  // Fresh dist for this package, same convention as the other integration
  // suites — this suite can never pass vacuously against stale output.
  execFileSync("pnpm", ["exec", "tsup"], { cwd: packageRoot, stdio: "pipe" });
  if (!existsSync(distCliPath)) {
    throw new Error(`Expected build output at ${distCliPath}, but it does not exist.`);
  }

  // inject-nockta-skills is READ-ONLY for this package (worker brief
  // constraint) except for running its own build/dist for tests — build it
  // only if its dist isn't already there, never touch its source.
  if (!existsSync(injectDistCliPath)) {
    execFileSync("pnpm", ["build"], { cwd: injectRoot, stdio: "pipe" });
  }
  if (!existsSync(injectDistCliPath)) {
    throw new Error(
      `Expected sibling package build output at ${injectDistCliPath}, but it does not exist even after building it.`,
    );
  }
}, 180_000);

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "create-nockta-repo-skills-integration-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function runCli(args: string[], options: { fixtureBin?: string; injectBin?: string } = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (options.fixtureBin) {
    env.CREATE_NOCKTA_REPO_TEST_FIXTURE_BIN = options.fixtureBin;
  } else {
    delete env.CREATE_NOCKTA_REPO_TEST_FIXTURE_BIN;
  }
  if (options.injectBin) {
    env.CREATE_NOCKTA_REPO_TEST_INJECT_BIN = options.injectBin;
  } else {
    delete env.CREATE_NOCKTA_REPO_TEST_INJECT_BIN;
  }
  // Deterministic, uncolored child output regardless of the invoking shell's
  // NO_COLOR/FORCE_COLOR/CI env — see test/create-command.integration.test.ts's
  // own runCli() comment for the flaky-stdout root cause this guards against.
  env.NO_COLOR = "1";
  delete env.FORCE_COLOR;
  return spawnSync(process.execPath, [distCliPath, ...args], { cwd, env, encoding: "utf8" });
}

/** Spec §7.9/D13: `--json` prints exactly one compact line. Fails loudly (not silently) if that contract is violated. */
function parseSingleJsonLine(stdout: string): Record<string, any> {
  const lines = stdout.split("\n").filter((line) => line.length > 0);
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]);
}

describe("create -> REAL inject-nockta-skills (standalone, spec §12.1 step 10, §8)", () => {
  it("installs common-pack skills for real: .claude/skills/*, .claude/agents/worker.md, .nockta/{skills-profile,generated-manifest}.json all exist with correct key fields", () => {
    const result = runCli(["my-project", "--type", "next", "--yes", "--json"], {
      fixtureBin: fakeNextBin,
      injectBin: injectDistCliPath,
    });
    expect(result.status).toBe(0);

    const parsed = parseSingleJsonLine(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.status).toBe("created");
    expect(parsed.skillsInjected).toBe(true);
    expect(parsed.skills.status).toBe("injected");
    expect(parsed.skills.mode).toBe("standalone");
    expect(parsed.skills.installedPacks).toContain("common");
    expect(typeof parsed.skills.skillsVersion).toBe("string");
    expect(parsed.skills.isMonorepo).toBe(false);

    const projectDir = path.join(cwd, "my-project");

    // Filesystem proof, not just the JSON envelope.
    for (const skill of ["paper-trail", "proof-of-done", "subagent-delegation"]) {
      expect(existsSync(path.join(projectDir, ".claude", "skills", skill, "SKILL.md"))).toBe(true);
    }
    expect(existsSync(path.join(projectDir, ".claude", "agents", "worker.md"))).toBe(true);

    const profile = JSON.parse(readFileSync(path.join(projectDir, ".nockta", "skills-profile.json"), "utf8"));
    expect(profile.tool).toBe("inject-nockta-skills");
    expect(profile.isMonorepo).toBe(false);
    // D22: inject-nockta-skills now writes repoTypes: string[] (was singular
    // repoType) — this is create's own test catching up to inject's VERIFIED
    // D22 change, not a reversion of it.
    expect(profile.repoTypes).toEqual(["next"]);
    expect(profile.installedAdapters).toEqual(["claude"]);
    expect(profile.version).toBe(parsed.skills.skillsVersion);

    const manifest = JSON.parse(readFileSync(path.join(projectDir, ".nockta", "generated-manifest.json"), "utf8"));
    expect(Array.isArray(manifest.files)).toBe(true);
    expect(manifest.files.length).toBeGreaterThan(0);
    expect(manifest.files.map((f: { path: string }) => f.path)).toContain(".claude/agents/worker.md");

    // The architecture overlay also actually ran before skills, per spec
    // §12.1's own step order (9 before 10).
    expect(existsSync(path.join(projectDir, "src", "components", "ui"))).toBe(true);
    // Upstream's own output survived too.
    expect(existsSync(path.join(projectDir, ".fixture-marker.json"))).toBe(true);
  });
});

describe("create -> REAL inject-nockta-skills (monorepo target, spec §12.2 steps 4-6, §6.4/§6.5, decisions.md D5)", () => {
  it("root-only .claude/ + root .nockta/targets.json (entry for apps/web) — NO apps/web/.claude anywhere", () => {
    writeFileSync(path.join(cwd, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");

    const result = runCli(["apps/web", "--type", "next", "--yes", "--json"], {
      fixtureBin: fakeNextBin,
      injectBin: injectDistCliPath,
    });
    expect(result.status).toBe(0);

    const parsed = parseSingleJsonLine(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.isMonorepoTarget).toBe(true);
    expect(parsed.skillsInjected).toBe(true);
    expect(parsed.skills.mode).toBe("monorepo-target");
    expect(parsed.skills.isMonorepo).toBe(true);
    expect(parsed.skills.targetsPath).toBe(path.join(cwd, ".nockta", "targets.json"));
    // Milestone 7: the repo profile is REAL now — written at the TARGET's
    // own .nockta (apps/web), never at the monorepo root (spec §9.1,
    // decisions.md D5) — a separate file from inject's root targets.json/
    // skills-profile.json, which the skills.* fields above already prove
    // were written for real this run.
    expect(parsed.metadata.status).toBe("written");
    expect(parsed.metadata.path).toBe(path.join(cwd, "apps", "web", ".nockta", "repo-profile.json"));
    expect(parsed.metadata.profile.isMonorepoTarget).toBe(true);
    expect(parsed.metadata.profile.skillsInjected).toBe(true);
    expect(parsed.metadata.profile.skillsVersion).toBe(parsed.skills.skillsVersion);
    expect(parsed.metadata.profile.adapters).toEqual(["claude"]);

    // Root-only placement (spec §6.4) — no adapter output inside the target.
    expect(existsSync(path.join(cwd, ".claude", "skills", "paper-trail", "SKILL.md"))).toBe(true);
    expect(existsSync(path.join(cwd, ".claude", "agents", "worker.md"))).toBe(true);
    expect(existsSync(path.join(cwd, "apps", "web", ".claude"))).toBe(false);

    const targets = JSON.parse(readFileSync(path.join(cwd, ".nockta", "targets.json"), "utf8"));
    expect(targets.isMonorepo).toBe(true);
    const webEntry = targets.targets.find((t: { path: string }) => t.path === "apps/web");
    expect(webEntry).toBeDefined();
    // D22: inject's targets.json entries now carry repoTypes: string[] (was
    // singular repoType) — same drift-catch-up as the standalone case above.
    expect(webEntry.repoTypes).toEqual(["next"]);

    const profile = JSON.parse(readFileSync(path.join(cwd, ".nockta", "skills-profile.json"), "utf8"));
    expect(profile.isMonorepo).toBe(true);

    // create-nockta-repo itself writes nothing to root .nockta beyond what
    // inject-nockta-skills wrote (decisions.md D5) — repo-profile.json is a
    // per-target concept (spec §9.1) and only ever lives at
    // <target>/.nockta/, never at the monorepo root.
    expect(existsSync(path.join(cwd, ".nockta", "repo-profile.json"))).toBe(false);
    expect(existsSync(path.join(cwd, "apps", "web", ".nockta", "repo-profile.json"))).toBe(true);
    const targetProfile = JSON.parse(readFileSync(path.join(cwd, "apps", "web", ".nockta", "repo-profile.json"), "utf8"));
    expect(targetProfile.tool).toBe("create-nockta-repo");
    expect(targetProfile.officialScaffolder.args).toContain("apps/web"); // the real resolved args (fixture override in this test)

    // The target itself still got its own overlay (unrelated to skills placement).
    expect(existsSync(path.join(cwd, "apps", "web", "src", "components", "ui"))).toBe(true);
  });
});

describe("--no-skills (spec §5.6)", () => {
  it("skips injection entirely: no .claude anywhere, but the repo profile (Milestone 7) is still real, skillsInjected false", () => {
    const result = runCli(["my-project", "--type", "next", "--no-skills", "--yes", "--json"], {
      fixtureBin: fakeNextBin,
      injectBin: injectDistCliPath, // present but must never be spawned
    });
    expect(result.status).toBe(0);
    const parsed = parseSingleJsonLine(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.skillsInjected).toBe(false);
    expect(parsed.skills.status).toBe("skipped");
    expect(parsed.metadata.status).toBe("written");
    expect(parsed.metadata.profile.skillsInjected).toBe(false);
    expect(parsed.metadata.profile.skillsVersion).toBeUndefined();
    expect(parsed.metadata.profile.adapters).toBeUndefined();

    const projectDir = path.join(cwd, "my-project");
    // Skill injection never ran — no .claude anywhere in the project.
    expect(existsSync(path.join(projectDir, ".claude"))).toBe(false);
    // The repo profile IS written regardless — it's create-nockta-repo's own
    // step (spec §12.1 step 11), independent of whether skills ran.
    expect(existsSync(path.join(projectDir, ".nockta", "repo-profile.json"))).toBe(true);
    const profile = JSON.parse(readFileSync(path.join(projectDir, ".nockta", "repo-profile.json"), "utf8"));
    expect(profile.skillsInjected).toBe(false);
    // Everything else still happened.
    expect(existsSync(path.join(projectDir, ".fixture-marker.json"))).toBe(true);
    expect(existsSync(path.join(projectDir, "src", "components", "ui"))).toBe(true);
  });
});

describe("skill injection failure (spec §5.9 exit code 4)", () => {
  it("create exits 4 and reports the honest partial state: project + overlay exist, skills failed, no rollback", () => {
    const result = runCli(["my-project", "--type", "next", "--yes", "--json"], {
      fixtureBin: fakeNextBin,
      injectBin: fakeInjectFailingBin, // deliberately NOT the real inject build
    });
    expect(result.status).toBe(4);

    const parsed = parseSingleJsonLine(result.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.status).toBe("skills-failed");
    expect(parsed.skillsInjected).toBe(false);
    expect(parsed.skills.status).toBe("failed");
    expect(parsed.skills.exitCode).toBe(3); // the fixture's real exit code
    expect(parsed.skills.reason).toBe("nonzero-exit");
    // Partial state honestly reported: upstream + architecture already succeeded.
    expect(parsed.upstream.ok).toBe(true);
    expect(parsed.architecture.status).toBe("applied");

    const projectDir = path.join(cwd, "my-project");
    expect(existsSync(path.join(projectDir, ".fixture-marker.json"))).toBe(true); // project exists
    expect(existsSync(path.join(projectDir, "src", "components", "ui"))).toBe(true); // overlay exists
    expect(existsSync(path.join(projectDir, ".claude"))).toBe(false); // skills never landed
    expect(existsSync(path.join(projectDir, ".nockta"))).toBe(false);
  });

  it("human (non-JSON) mode: stderr names the failure and the no-rollback posture", () => {
    const result = runCli(["my-project", "--type", "next", "--yes"], {
      fixtureBin: fakeNextBin,
      injectBin: fakeInjectFailingBin,
    });
    expect(result.status).toBe(4);
    expect(result.stderr).toContain("skill injection failed");
    expect(result.stderr).toContain("no rollback");
  });
});

describe("dry run prints the exact inject command without spawning anything (spec §5.7, this milestone's brief item 3)", () => {
  it("default --skills-version: shows npx inject-nockta-skills@latest, writes/spawns nothing", () => {
    const result = runCli(["my-project", "--type", "next", "--dry-run", "--json"], { fixtureBin: fakeNextBin });
    expect(result.status).toBe(0);
    const parsed = parseSingleJsonLine(result.stdout);
    expect(parsed.status).toBe("dry-run");
    expect(parsed.skills.status).toBe("planned");
    expect(parsed.skills.command).toBe("npx");
    expect(parsed.skills.args[0]).toBe("inject-nockta-skills@latest");
    expect(parsed.skills.commandLine).toBe(
      "npx inject-nockta-skills@latest install --type next --adapters claude --yes --json",
    );
    expect(existsSync(path.join(cwd, "my-project"))).toBe(false);
  });

  it("--skills-version pins the constructed npx command (unit-level assert, still no live network)", () => {
    const result = runCli(["my-project", "--type", "next", "--dry-run", "--json", "--skills-version", "2.4.1"], {
      fixtureBin: fakeNextBin,
    });
    expect(result.status).toBe(0);
    const parsed = parseSingleJsonLine(result.stdout);
    expect(parsed.skills.args[0]).toBe("inject-nockta-skills@2.4.1");
    expect(parsed.skills.commandLine).toContain("npx inject-nockta-skills@2.4.1 install");
  });

  it("--adapters claude,cursor lands in the constructed command", () => {
    const result = runCli(["my-project", "--type", "next", "--dry-run", "--json", "--adapters", "claude,cursor"], {
      fixtureBin: fakeNextBin,
    });
    expect(result.status).toBe(0);
    const parsed = parseSingleJsonLine(result.stdout);
    expect(parsed.skills.args).toContain("claude,cursor");
  });

  it("a monorepo target's dry-run plan shows --target <path>:<type>, spawned at the root", () => {
    writeFileSync(path.join(cwd, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
    const result = runCli(["apps/web", "--type", "next", "--dry-run", "--json"], { fixtureBin: fakeNextBin });
    expect(result.status).toBe(0);
    const parsed = parseSingleJsonLine(result.stdout);
    expect(parsed.skills.mode).toBe("monorepo-target");
    expect(parsed.skills.args).toContain("apps/web:next");
    expect(parsed.skills.cwd).toBe(cwd);
  });

  it("--no-skills dry run shows the skip reason, not a command", () => {
    const result = runCli(["my-project", "--type", "next", "--dry-run", "--no-skills", "--json"], {
      fixtureBin: fakeNextBin,
    });
    expect(result.status).toBe(0);
    const parsed = parseSingleJsonLine(result.stdout);
    expect(parsed.skills.status).toBe("skipped");
    expect(parsed.skills.reason).toContain("--no-skills");
  });
});

describe("--adapters validation (spec §16.1, exit code 2, nothing runs)", () => {
  it("rejects an unknown adapter before the upstream scaffolder ever runs", () => {
    const result = runCli(["my-project", "--type", "next", "--adapters", "bogus", "--yes"], { fixtureBin: fakeNextBin });
    expect(result.status).toBe(2);
    expect(existsSync(path.join(cwd, "my-project"))).toBe(false);
    expect(result.stderr).toContain("invalid --adapters");
  });

  it("--json: structured error envelope, not a crash", () => {
    const result = runCli(["my-project", "--type", "next", "--adapters", "bogus", "--yes", "--json"], {
      fixtureBin: fakeNextBin,
    });
    expect(result.status).toBe(2);
    const parsed = parseSingleJsonLine(result.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("invalid-adapters");
  });
});
