import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  INJECT_BIN_OVERRIDE_ENV_VAR,
  InjectSkillsFailure,
  buildInjectSkillsCommand,
  readInjectedSkillsVersion,
  runInjectSkills,
} from "../src/core/run-inject-skills.js";

// Spec §8, §19 Milestone 6 unit coverage for core/run-inject-skills.ts:
// command construction (the ONLY thing tested against the real `npx` path —
// no live network, per this milestone's brief item 2) plus spawn/parse
// behavior against tiny hand-written local fixture scripts (NOT the real
// inject-nockta-skills build — see test/create-skills.integration.test.ts
// for that, the process-level headline suite).

describe("buildInjectSkillsCommand — standalone (spec §8.1, §8.2)", () => {
  afterEach(() => {
    delete process.env[INJECT_BIN_OVERRIDE_ENV_VAR];
  });

  it("defaults to npx inject-nockta-skills@latest with install --type/--adapters/--yes/--json", () => {
    const built = buildInjectSkillsCommand({
      mode: "standalone",
      repoType: "next",
      adapters: ["claude"],
      cwd: "/tmp/whatever-project",
    });
    expect(built.command).toBe("npx");
    expect(built.args).toEqual([
      "inject-nockta-skills@latest",
      "install",
      "--type",
      "next",
      "--adapters",
      "claude",
      "--yes",
      "--json",
    ]);
    expect(built.cwd).toBe("/tmp/whatever-project");
    expect(built.usesTestOverride).toBe(false);
    expect(built.commandLine).toBe(
      "npx inject-nockta-skills@latest install --type next --adapters claude --yes --json",
    );
  });

  it("--skills-version pins the npx package spec instead of @latest (code-path only, no live network)", () => {
    const built = buildInjectSkillsCommand({
      mode: "standalone",
      repoType: "next",
      adapters: ["claude", "cursor"],
      skillsVersion: "2.4.1",
      cwd: "/tmp/whatever-project",
    });
    expect(built.command).toBe("npx");
    expect(built.args[0]).toBe("inject-nockta-skills@2.4.1");
    expect(built.args).toContain("claude,cursor");
    expect(built.commandLine).toContain("npx inject-nockta-skills@2.4.1 install");
  });

  it("a dist-tag is passed through unchanged, same as a version", () => {
    const built = buildInjectSkillsCommand({
      mode: "standalone",
      repoType: "next",
      adapters: ["claude"],
      skillsVersion: "next",
      cwd: "/tmp/whatever-project",
    });
    expect(built.args[0]).toBe("inject-nockta-skills@next");
  });
});

describe("buildInjectSkillsCommand — D22 repoTypes union (worker pass adding create's --also)", () => {
  afterEach(() => {
    delete process.env[INJECT_BIN_OVERRIDE_ENV_VAR];
  });

  it("standalone: repoTypes wins over the legacy singular repoType, comma-joined for --type", () => {
    const built = buildInjectSkillsCommand({
      mode: "standalone",
      repoType: "shopify-theme",
      repoTypes: ["shopify-theme", "vite-react-ts"],
      adapters: ["claude"],
      cwd: "/tmp/whatever-project",
    });
    expect(built.args).toEqual([
      "inject-nockta-skills@latest",
      "install",
      "--type",
      "shopify-theme,vite-react-ts",
      "--adapters",
      "claude",
      "--yes",
      "--json",
    ]);
  });

  it("a one-element repoTypes behaves identically to the legacy singular repoType", () => {
    const built = buildInjectSkillsCommand({
      mode: "standalone",
      repoType: "next",
      repoTypes: ["next"],
      adapters: ["claude"],
      cwd: "/tmp/x",
    });
    expect(built.args).toContain("next");
    expect(built.commandLine).toBe(
      "npx inject-nockta-skills@latest install --type next --adapters claude --yes --json",
    );
  });

  it("an empty repoTypes array falls back to the legacy singular repoType", () => {
    const built = buildInjectSkillsCommand({
      mode: "standalone",
      repoType: "nest",
      repoTypes: [],
      adapters: ["claude"],
      cwd: "/tmp/x",
    });
    expect(built.args).toContain("nest");
  });

  it("monorepo-target: repoTypes is JOINED WITH + inside the colon --target form, NOT comma (decisions.md D22 — inject's colon-form separator differs from --type's)", () => {
    const built = buildInjectSkillsCommand({
      mode: "monorepo-target",
      repoType: "shopify-theme",
      repoTypes: ["shopify-theme", "vite-react-ts"],
      adapters: ["claude"],
      targetPath: "apps/web",
      cwd: "/tmp/monorepo-root",
    });
    expect(built.args).toEqual([
      "inject-nockta-skills@latest",
      "install",
      "--target",
      "apps/web:shopify-theme+vite-react-ts",
      "--adapters",
      "claude",
      "--yes",
      "--json",
    ]);
  });
});

describe("buildInjectSkillsCommand — monorepo target (spec §8.2, §6.4/§6.5, decisions.md D5/D9)", () => {
  it("builds install --target <path>:<type> instead of --type, spawned at the given (root) cwd", () => {
    const built = buildInjectSkillsCommand({
      mode: "monorepo-target",
      repoType: "next",
      adapters: ["claude"],
      targetPath: "apps/web",
      cwd: "/tmp/monorepo-root",
    });
    expect(built.args).toEqual([
      "inject-nockta-skills@latest",
      "install",
      "--target",
      "apps/web:next",
      "--adapters",
      "claude",
      "--yes",
      "--json",
    ]);
    expect(built.cwd).toBe("/tmp/monorepo-root");
  });

  it("throws a programmer-error if targetPath is missing in monorepo-target mode", () => {
    expect(() =>
      buildInjectSkillsCommand({ mode: "monorepo-target", repoType: "next", adapters: ["claude"], cwd: "/tmp/x" }),
    ).toThrow(/targetPath/);
  });
});

describe("CREATE_NOCKTA_REPO_TEST_INJECT_BIN override (mirrors FIXTURE_BIN/ARCH_DIR pattern, spec-adjacent, this milestone's brief item 2)", () => {
  afterEach(() => {
    delete process.env[INJECT_BIN_OVERRIDE_ENV_VAR];
  });

  it("spawns `node <bin>` instead of npx when set — the command never mentions npx at all", () => {
    process.env[INJECT_BIN_OVERRIDE_ENV_VAR] = "/some/fake/inject-bin.mjs";
    const built = buildInjectSkillsCommand({
      mode: "standalone",
      repoType: "next",
      adapters: ["claude"],
      cwd: "/tmp/x",
    });
    expect(built.command).toBe(process.execPath);
    expect(built.args[0]).toBe("/some/fake/inject-bin.mjs");
    expect(built.args).not.toContain("npx");
    expect(built.commandLine).not.toContain("npx");
    expect(built.usesTestOverride).toBe(true);
  });

  it("still overrides even when --skills-version is also set — the override wins", () => {
    process.env[INJECT_BIN_OVERRIDE_ENV_VAR] = "/some/fake/inject-bin.mjs";
    const built = buildInjectSkillsCommand({
      mode: "standalone",
      repoType: "next",
      adapters: ["claude"],
      skillsVersion: "2.4.1",
      cwd: "/tmp/x",
    });
    expect(built.command).toBe(process.execPath);
    expect(built.commandLine).not.toContain("2.4.1");
  });
});

describe("readInjectedSkillsVersion", () => {
  it("returns null for a null profilePath", () => {
    expect(readInjectedSkillsVersion(null)).toBeNull();
  });

  it("returns null for a nonexistent file rather than throwing", () => {
    expect(readInjectedSkillsVersion("/does/not/exist/skills-profile.json")).toBeNull();
  });

  it("returns null for a malformed (non-JSON) file rather than throwing", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "read-version-malformed-"));
    const p = path.join(dir, "skills-profile.json");
    writeFileSync(p, "not json");
    expect(readInjectedSkillsVersion(p)).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads the version field from a real profile file (single-project shape)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "read-version-single-"));
    const p = path.join(dir, "skills-profile.json");
    writeFileSync(p, JSON.stringify({ tool: "inject-nockta-skills", version: "1.2.3", isMonorepo: false }));
    expect(readInjectedSkillsVersion(p)).toBe("1.2.3");
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads the version field from a real profile file (monorepo shape)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "read-version-mono-"));
    const p = path.join(dir, "skills-profile.json");
    writeFileSync(p, JSON.stringify({ tool: "inject-nockta-skills", version: "3.4.5", isMonorepo: true }));
    expect(readInjectedSkillsVersion(p)).toBe("3.4.5");
    rmSync(dir, { recursive: true, force: true });
  });
});

// --- runInjectSkills against tiny hand-written local fixture scripts -----
// NOT the real inject-nockta-skills build (that's the process-level headline
// suite's job) — these exist to exercise this module's own spawn/parse/error
// paths deterministically and fast.

const scratchRoot = mkdtempSync(path.join(tmpdir(), "run-inject-skills-unit-"));
const successBin = path.join(scratchRoot, "fake-inject-success.mjs");
const nonzeroBin = path.join(scratchRoot, "fake-inject-nonzero.mjs");
const badJsonBin = path.join(scratchRoot, "fake-inject-bad-json.mjs");

beforeAll(() => {
  mkdirSync(scratchRoot, { recursive: true });

  writeFileSync(
    successBin,
    `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

// Simulates inject-nockta-skills' real --json install contract (spec §7.9)
// for run-inject-skills.ts's own unit tests only.
const cwd = process.cwd();
const nocktaDir = path.join(cwd, ".nockta");
mkdirSync(nocktaDir, { recursive: true });
const profilePath = path.join(nocktaDir, "skills-profile.json");
writeFileSync(profilePath, JSON.stringify({ tool: "inject-nockta-skills", version: "9.9.9-fixture", isMonorepo: false }));
const manifestPath = path.join(nocktaDir, "generated-manifest.json");
writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, files: [] }));

const result = {
  ok: true,
  command: "install",
  exitCode: 0,
  summary: "installed 1 file across 1 pack (common) for adapters: claude; 0 packs skipped",
  data: {
    repoType: "next",
    adapters: ["claude"],
    targetDir: cwd,
    installedPacks: ["common"],
    skippedPacks: [],
    skippedSkills: [],
    renderedFileCount: 1,
    renderedFiles: [".claude/skills/paper-trail/SKILL.md"],
    profilePath,
    manifestPath,
    isMonorepo: false,
    targets: [],
    targetsPath: null,
    warnings: [],
  },
};
process.stdout.write(JSON.stringify(result) + "\\n");
process.exit(0);
`,
  );

  writeFileSync(
    nonzeroBin,
    `#!/usr/bin/env node
console.error("fake-inject-nonzero fixture: simulated render failure");
process.exit(3);
`,
  );

  writeFileSync(
    badJsonBin,
    `#!/usr/bin/env node
process.stdout.write("not json\\nmore than one line\\n");
process.exit(0);
`,
  );
});

afterAll(() => {
  rmSync(scratchRoot, { recursive: true, force: true });
});

describe("runInjectSkills — success (unit fixture, spec §7.9 contract)", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(path.join(tmpdir(), "run-inject-skills-success-"));
    process.env[INJECT_BIN_OVERRIDE_ENV_VAR] = successBin;
  });
  afterEach(() => {
    delete process.env[INJECT_BIN_OVERRIDE_ENV_VAR];
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("parses the single JSON line, surfaces inject's summary, and resolves skillsVersion from the written profile", async () => {
    const outcome = await runInjectSkills({
      mode: "standalone",
      repoType: "next",
      adapters: ["claude"],
      cwd: projectDir,
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.exitCode).toBe(0);
    expect(typeof outcome.durationMs).toBe("number");
    expect(outcome.result.summary).toContain("installed 1 file");
    expect(outcome.result.data.installedPacks).toEqual(["common"]);
    // The headline finding this milestone's brief asked for: inject's own
    // --json InstallData carries NO version field — the resolved version
    // comes from the profile file it wrote instead.
    expect(outcome.skillsVersion).toBe("9.9.9-fixture");
    expect(existsSync(path.join(projectDir, ".nockta", "skills-profile.json"))).toBe(true);
  });
});

describe("runInjectSkills — nonzero exit (unit fixture)", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(path.join(tmpdir(), "run-inject-skills-nonzero-"));
    process.env[INJECT_BIN_OVERRIDE_ENV_VAR] = nonzeroBin;
  });
  afterEach(() => {
    delete process.env[INJECT_BIN_OVERRIDE_ENV_VAR];
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("rejects with a typed InjectSkillsFailure carrying the real exit code and a stderr tail", async () => {
    await expect(
      runInjectSkills({ mode: "standalone", repoType: "next", adapters: ["claude"], cwd: projectDir }),
    ).rejects.toBeInstanceOf(InjectSkillsFailure);

    try {
      await runInjectSkills({ mode: "standalone", repoType: "next", adapters: ["claude"], cwd: projectDir });
      expect.unreachable("runInjectSkills should have rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(InjectSkillsFailure);
      const failure = error as InjectSkillsFailure;
      expect(failure.details.reason).toBe("nonzero-exit");
      expect(failure.details.exitCode).toBe(3);
      expect(failure.details.signal).toBeNull();
      expect(failure.details.stderrTail).toContain("simulated render failure");
    }
  });
});

describe("runInjectSkills — unparseable output despite exit 0 (unit fixture)", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(path.join(tmpdir(), "run-inject-skills-badjson-"));
    process.env[INJECT_BIN_OVERRIDE_ENV_VAR] = badJsonBin;
  });
  afterEach(() => {
    delete process.env[INJECT_BIN_OVERRIDE_ENV_VAR];
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("rejects as unparseable-output — never silently treats multi-line/invalid stdout as success", async () => {
    try {
      await runInjectSkills({ mode: "standalone", repoType: "next", adapters: ["claude"], cwd: projectDir });
      expect.unreachable("runInjectSkills should have rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(InjectSkillsFailure);
      const failure = error as InjectSkillsFailure;
      expect(failure.details.reason).toBe("unparseable-output");
      expect(failure.details.exitCode).toBe(0);
    }
  });
});

// Note (proof-of-done: what was NOT covered here, stated honestly): a real
// "spawn-error" (ENOENT — the command itself can't launch) is not
// independently exercised. Unlike run-upstream.ts's own test (which controls
// `command` directly), this module always resolves `command` to either
// `"npx"` or `process.execPath` — both always exist on a machine that can
// run these tests at all — so there is no reachable path through this
// module's public options surface that forces a launch failure. The
// `child.on("error", ...)` handler mirrors run-upstream.ts's identical,
// separately-tested handling verbatim; flagged here rather than faked.
