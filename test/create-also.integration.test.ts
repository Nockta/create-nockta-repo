import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Worker brief (decisions.md D22, spec §5.2's --also documentation) headline
// integration coverage: `create apps/x --type next --also vite-react-ts --yes`
// through the REAL BUILT create-nockta-repo CLI spawning the REAL BUILT
// inject-nockta-skills CLI (never faked on the inject side — mirrors
// test/create-skills.integration.test.ts's own convention exactly). Upstream
// is still a fixture scaffolder (spec §16.2) — this suite proves the --also
// UNION mechanism end to end (create -> inject, both types actually arrive),
// not that create-next-app works.
//
// Honest scope note (proof-of-done): at the time of this pass, only the
// `common` pack carries real authored skill content (decisions.md D6) — the
// `next`/`vite-react-ts` stack packs are declared (pack.json + a skills[]
// list) but not yet authored, so inject reports them as `skippedPacks`
// ("no authored content yet"), not `installedPacks`. This suite asserts
// against that REAL observed shape (verified by hand against the real built
// inject dist before writing these assertions — see this file's own
// beforeAll) rather than asserting fabricated next/vite-react-ts-specific
// SKILL.md files that don't exist yet. What IS proven for real: the union
// request reaches inject intact (both "next" AND "vite-react-ts" show up,
// each with its own correct missingSkills list from its own pack.json), and
// inject's own repoTypes: string[] (D22) records the full union — the exact
// mechanism `--also` exists to prove.

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const distCliPath = path.join(packageRoot, "dist", "cli.js");
const fixturesRoot = path.join(packageRoot, "fixtures", "scaffolders");
const fakeNextBin = path.join(fixturesRoot, "fake-next", "index.mjs");

const injectRoot = path.join(packageRoot, "..", "inject-nockta-skills");
const injectDistCliPath = path.join(injectRoot, "dist", "cli.js");

beforeAll(() => {
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
  cwd = mkdtempSync(path.join(tmpdir(), "create-nockta-repo-also-integration-"));
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
  // Deterministic, uncolored child output — see
  // test/create-command.integration.test.ts's runCli() comment for the
  // flaky-stdout root cause this guards against.
  env.NO_COLOR = "1";
  delete env.FORCE_COLOR;
  return spawnSync(process.execPath, [distCliPath, ...args], { cwd, env, encoding: "utf8" });
}

function parseSingleJsonLine(stdout: string): Record<string, any> {
  const lines = stdout.split("\n").filter((line) => line.length > 0);
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]);
}

describe("create --type next --also vite-react-ts -> REAL inject-nockta-skills (decisions.md D22 full chain)", () => {
  it("union reaches inject for real: repoTypes/skippedPacks name BOTH types, profile.repoTypes carries the union, primary-only overlay/scaffolder", () => {
    const result = runCli(["apps/x", "--type", "next", "--also", "vite-react-ts", "--yes", "--json"], {
      fixtureBin: fakeNextBin,
      injectBin: injectDistCliPath,
    });
    expect(result.status).toBe(0);

    const parsed = parseSingleJsonLine(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.status).toBe("created");
    // The primary type stays the sole scaffolder/overlay owner (D22).
    expect(parsed.repoType).toBe("next");
    expect(parsed.alsoTypes).toEqual(["vite-react-ts"]);
    expect(parsed.repoTypes).toEqual(["next", "vite-react-ts"]);
    // fixtureBin override in play here (spec §16.2, no live network) — the
    // fixture's own name still names the PRIMARY type ("next"), proving the
    // scaffolder resolution used the primary, not a --also type.
    expect(parsed.officialScaffolder.name).toContain("next");
    expect(parsed.architecture.status).toBe("applied");
    expect(parsed.architecture.preset).toBe("standard"); // next's own overlay only — never a vite-react-ts overlay

    // --- The union actually reached inject (this IS the --also proof) ---
    expect(parsed.skillsInjected).toBe(true);
    expect(parsed.skills.mode).toBe("standalone");
    // Content-import drift (decisions.md D26, sibling read-only package):
    // next/vite-react-ts now carry real authored content, so both land in
    // installedPacks rather than skippedPacks — this originally asserted
    // against an earlier, pre-content-import build of inject-nockta-skills
    // (see this file's own header "honest scope note", now stale). Updated
    // to the real observed shape (verified by hand against the current
    // built inject dist) while keeping the actual proof intact: BOTH
    // requested types reached inject, neither silently dropped.
    expect(parsed.skills.installedPacks).toEqual(expect.arrayContaining(["common", "next", "vite-react-ts"]));
    expect(parsed.skills.skippedPacks).toEqual([]);

    const projectDir = path.join(cwd, "apps", "x");
    for (const skill of ["paper-trail", "proof-of-done", "subagent-delegation"]) {
      expect(existsSync(path.join(projectDir, ".claude", "skills", skill, "SKILL.md"))).toBe(true);
    }
    expect(existsSync(path.join(projectDir, ".claude", "agents", "worker.md"))).toBe(true);

    // inject's OWN skills-profile.json — repoTypes: string[] (D22), the union.
    const injectProfile = JSON.parse(readFileSync(path.join(projectDir, ".nockta", "skills-profile.json"), "utf8"));
    expect(injectProfile.repoTypes).toEqual(["next", "vite-react-ts"]);

    // create's OWN repo-profile.json — repoTypes[] (D22, this worker pass),
    // primary first; officialScaffolder still names only the primary.
    const createProfile = JSON.parse(readFileSync(path.join(projectDir, ".nockta", "repo-profile.json"), "utf8"));
    expect(createProfile.tool).toBe("create-nockta-repo");
    expect(createProfile.repoTypes).toEqual(["next", "vite-react-ts"]);
    expect(createProfile.architecture).toBe("standard");
    expect(createProfile.officialScaffolder.name).toContain("next"); // fixture override — primary type still named
    expect(createProfile.skillsInjected).toBe(true);

    // The --json envelope's `metadata.profile` mirrors the same written object.
    expect(parsed.metadata.status).toBe("written");
    expect(parsed.metadata.profile.repoTypes).toEqual(["next", "vite-react-ts"]);
  });

  it("an --also type equal to the primary is deduped with a WARNING (not an error) — surfaced in --json warnings", () => {
    const result = runCli(["apps/dup", "--type", "next", "--also", "next", "--no-skills", "--yes", "--json"], {
      fixtureBin: fakeNextBin,
    });
    expect(result.status).toBe(0);
    const parsed = parseSingleJsonLine(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.alsoTypes).toEqual([]); // deduped away
    expect(parsed.repoTypes).toEqual(["next"]);
    expect(parsed.warnings.some((w: string) => w.includes("next") && w.toLowerCase().includes("duplicate"))).toBe(
      true,
    );
  });

  it("an unknown --also value is a hard invalid-input error, exit 2, nothing created", () => {
    const result = runCli(["apps/bad", "--type", "next", "--also", "not-a-real-type", "--yes", "--json"], {
      fixtureBin: fakeNextBin,
    });
    expect(result.status).toBe(2);
    const parsed = parseSingleJsonLine(result.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("invalid-also");
    expect(existsSync(path.join(cwd, "apps", "bad"))).toBe(false);
  });
});

describe("dry run shows the union inject command (spec §5.7, decisions.md D22)", () => {
  it("--json: the forwarded inject commandLine carries the comma-joined union; metadata.preview.repoTypes too", () => {
    const result = runCli(["apps/x", "--type", "next", "--also", "vite-react-ts", "--dry-run", "--json"]);
    expect(result.status).toBe(0);
    const parsed = parseSingleJsonLine(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.status).toBe("dry-run");
    expect(parsed.repoTypes).toEqual(["next", "vite-react-ts"]);
    expect(parsed.skills.status).toBe("planned");
    expect(parsed.skills.repoTypes).toEqual(["next", "vite-react-ts"]);
    expect(parsed.skills.commandLine).toContain("install --type next,vite-react-ts");
    expect(parsed.metadata.status).toBe("planned");
    expect(parsed.metadata.preview.repoTypes).toEqual(["next", "vite-react-ts"]);
    // Nothing actually ran/wrote (dry run's existing guarantee, unaffected by --also).
    expect(existsSync(path.join(cwd, "apps"))).toBe(false);
  });

  it("human mode: prints the PRIMARY scaffolder command AND the forwarded inject command with the union", () => {
    const result = runCli(["apps/x", "--type", "next", "--also", "vite-react-ts,nest", "--dry-run"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("create-next-app@latest apps/x");
    expect(result.stdout).toContain("also types       vite-react-ts, nest");
    expect(result.stdout).toContain("install --type next,vite-react-ts,nest");
  });
});
