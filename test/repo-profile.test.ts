import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readRepoProfile } from "../src/core/read-repo-profile.js";
import { WriteRepoProfileError, writeRepoProfile } from "../src/core/write-repo-profile.js";
import { readInjectedSkillsVersion } from "../src/core/run-inject-skills.js";
import type { NocktaRepoProfile } from "../src/types/profile.js";

// Spec §9, §19 Milestone 7 unit coverage: write/read round-trip for BOTH
// placements (standalone project root, monorepo target root — decisions.md
// D5), every NocktaRepoProfile field incl. skillsVersion, and the
// skillsVersion fallback chain (core/run-inject-skills.ts's
// readInjectedSkillsVersion — already covered end to end in
// test/run-inject-skills.test.ts; re-asserted here in the profile's own
// context for completeness). Full-chain integration coverage (the real
// written file after a real create run) lives in
// test/create-skills.integration.test.ts and test/create-monorepo.integration.test.ts.

function fullProfile(overrides: Partial<NocktaRepoProfile> = {}): NocktaRepoProfile {
  return {
    tool: "create-nockta-repo",
    version: "0.1.0",
    // D22 (worker pass adding --also): repoTypes[] (primary first), was
    // singular repoType.
    repoTypes: ["next"],
    architecture: "standard",
    projectPath: "apps/web",
    isMonorepoTarget: true,
    officialScaffolder: { name: "create-next-app", command: "npx", args: ["create-next-app@latest", "apps/web"] },
    skillsInjected: true,
    skillsVersion: "2.4.1",
    adapters: ["claude", "cursor"],
    createdAt: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}

describe("writeRepoProfile / readRepoProfile — round trip (spec §9.1, §9.2)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "repo-profile-roundtrip-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes to <projectDir>/.nockta/repo-profile.json (standalone placement) and reads back every field", () => {
    const profile = fullProfile({ isMonorepoTarget: false, projectPath: "my-project" });
    const written = writeRepoProfile({ projectDir: dir, profile });

    expect(written.path).toBe(path.join(dir, ".nockta", "repo-profile.json"));
    expect(existsSync(written.path)).toBe(true);

    const readBack = readRepoProfile(dir);
    expect(readBack).toEqual(profile);

    // On-disk shape: pretty-printed with a trailing newline (matches
    // inject-nockta-skills' own .nockta file convention).
    const raw = readFileSync(written.path, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).toContain("\n  ");
    expect(JSON.parse(raw)).toEqual(profile);
  });

  it("writes to <target>/.nockta/repo-profile.json for a monorepo target (decisions.md D5) — never a root placement", () => {
    const monorepoRoot = mkdtempSync(path.join(tmpdir(), "repo-profile-monorepo-root-"));
    try {
      const targetDir = path.join(monorepoRoot, "apps", "web");
      mkdirSync(targetDir, { recursive: true });
      const profile = fullProfile({ isMonorepoTarget: true, projectPath: "apps/web" });

      const written = writeRepoProfile({ projectDir: targetDir, profile });

      expect(written.path).toBe(path.join(targetDir, ".nockta", "repo-profile.json"));
      expect(existsSync(path.join(targetDir, ".nockta", "repo-profile.json"))).toBe(true);
      // Never at the monorepo root (D5 — root .nockta is inject-owned: targets.json, skills-profile.json).
      expect(existsSync(path.join(monorepoRoot, ".nockta", "repo-profile.json"))).toBe(false);

      const readBack = readRepoProfile(targetDir);
      expect(readBack).toEqual(profile);
      expect(readRepoProfile(monorepoRoot)).toBeUndefined();
    } finally {
      rmSync(monorepoRoot, { recursive: true, force: true });
    }
  });

  it("round-trips every NocktaRepoProfile field, including optional ones", () => {
    const profile = fullProfile();
    writeRepoProfile({ projectDir: dir, profile });
    const readBack = readRepoProfile(dir)!;

    expect(readBack.tool).toBe("create-nockta-repo");
    expect(readBack.version).toBe("0.1.0");
    expect(readBack.repoTypes).toEqual(["next"]);
    expect(readBack.architecture).toBe("standard");
    expect(readBack.projectPath).toBe("apps/web");
    expect(readBack.isMonorepoTarget).toBe(true);
    expect(readBack.officialScaffolder).toEqual({
      name: "create-next-app",
      command: "npx",
      args: ["create-next-app@latest", "apps/web"],
    });
    expect(readBack.skillsInjected).toBe(true);
    expect(readBack.skillsVersion).toBe("2.4.1");
    expect(readBack.adapters).toEqual(["claude", "cursor"]);
    expect(readBack.createdAt).toBe("2026-07-10T00:00:00.000Z");
  });

  it("--no-arch: architecture round-trips as a literal null, not a missing field or empty string", () => {
    const profile = fullProfile({ architecture: null });
    writeRepoProfile({ projectDir: dir, profile });
    const readBack = readRepoProfile(dir)!;
    expect(readBack.architecture).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(readBack, "architecture")).toBe(true);

    const raw = JSON.parse(readFileSync(path.join(dir, ".nockta", "repo-profile.json"), "utf8"));
    expect(raw.architecture).toBeNull();
  });

  it("--no-skills: skillsInjected false, skillsVersion/adapters omitted (not written as null)", () => {
    const profile = fullProfile({ skillsInjected: false, skillsVersion: undefined, adapters: undefined });
    writeRepoProfile({ projectDir: dir, profile });

    const raw = JSON.parse(readFileSync(path.join(dir, ".nockta", "repo-profile.json"), "utf8"));
    expect(raw.skillsInjected).toBe(false);
    expect("skillsVersion" in raw).toBe(false);
    expect("adapters" in raw).toBe(false);
  });
});

describe("readRepoProfile — tolerant reads (mirrors inject-nockta-skills' readSkillsProfile convention)", () => {
  it("returns undefined for a directory with no .nockta/repo-profile.json at all", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "repo-profile-missing-"));
    try {
      expect(readRepoProfile(dir)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns undefined for a malformed (non-JSON) profile rather than throwing", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "repo-profile-malformed-"));
    try {
      mkdirSync(path.join(dir, ".nockta"), { recursive: true });
      writeFileSync(path.join(dir, ".nockta", "repo-profile.json"), "not json");
      expect(readRepoProfile(dir)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("WriteRepoProfileError — fails loudly on a genuine write failure", () => {
  it("throws a typed WriteRepoProfileError carrying the resolved path when the .nockta dir cannot be created", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "repo-profile-write-failure-"));
    try {
      // Create a FILE where .nockta needs to be a directory — mkdirSync then fails.
      writeFileSync(path.join(dir, ".nockta"), "not a directory");
      expect(() => writeRepoProfile({ projectDir: dir, profile: fullProfile() })).toThrow(WriteRepoProfileError);
      try {
        writeRepoProfile({ projectDir: dir, profile: fullProfile() });
        expect.unreachable("writeRepoProfile should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(WriteRepoProfileError);
        const failure = error as WriteRepoProfileError;
        expect(failure.path).toBe(path.join(dir, ".nockta", "repo-profile.json"));
        expect(failure.message).toContain(failure.path);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("skillsVersion fallback chain (spec §9.2's qualifying note, decisions.md D14)", () => {
  // The chain itself lives in core/run-inject-skills.ts (data.version first,
  // else the written .nockta/skills-profile.json) — this block re-asserts
  // the FALLBACK half in the repo-profile's own context (readInjectedSkillsVersion
  // is exactly what commands/create.ts's skillsOutcome.skillsVersion already
  // resolved through before it ever reaches buildRepoProfile()).
  it("readInjectedSkillsVersion reads inject's written profile when data.version is absent", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "repo-profile-skillsversion-fallback-"));
    try {
      const nocktaDir = path.join(dir, ".nockta");
      mkdirSync(nocktaDir, { recursive: true });
      const injectProfilePath = path.join(nocktaDir, "skills-profile.json");
      writeFileSync(injectProfilePath, JSON.stringify({ tool: "inject-nockta-skills", version: "3.1.4", isMonorepo: false }));

      expect(readInjectedSkillsVersion(injectProfilePath)).toBe("3.1.4");

      // The resolved value then flows into the repo profile's own skillsVersion field.
      const profile = fullProfile({ skillsVersion: readInjectedSkillsVersion(injectProfilePath) ?? undefined });
      writeRepoProfile({ projectDir: dir, profile });
      expect(readRepoProfile(dir)!.skillsVersion).toBe("3.1.4");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a missing/unreadable inject profile falls back to undefined, never throws, never blocks the create-nockta-repo write", () => {
    expect(readInjectedSkillsVersion("/does/not/exist/skills-profile.json")).toBeNull();
    const dir = mkdtempSync(path.join(tmpdir(), "repo-profile-skillsversion-unknown-"));
    try {
      const profile = fullProfile({ skillsVersion: undefined });
      const written = writeRepoProfile({ projectDir: dir, profile });
      expect(written.profile.skillsVersion).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
