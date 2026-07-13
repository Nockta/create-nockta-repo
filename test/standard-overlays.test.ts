import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyArchitectureManifest } from "../src/architecture/apply-architecture-manifest.js";
import { readArchitectureManifestForPreset } from "../src/architecture/read-architecture-manifest.js";
import { REPO_TYPES } from "../src/types/repo-type.js";

// Spec §19 Milestone 4: every repo type's real, bundled packs/<type>/architecture/standard/
// content parses cleanly and applies cleanly against an empty target dir —
// the strongest available proof that all eight standard overlays (six MVP + react-native/expo,
// decisions.md D25) are real, lightweight (spec §18.2), and never assume upstream-generated
// content that isn't there (every move, if any, must be optional).

describe.each(REPO_TYPES)("standard overlay: %s", (repoType) => {
  let targetDir: string;

  beforeEach(() => {
    targetDir = mkdtempSync(path.join(tmpdir(), `create-nockta-repo-standard-overlay-${repoType}-`));
  });

  afterEach(() => {
    rmSync(targetDir, { recursive: true, force: true });
  });

  it("parses without error and has a non-empty name", () => {
    const { manifest } = readArchitectureManifestForPreset(repoType, "standard");
    expect(manifest.name).toBe("standard");
    expect(manifest.deletes).toEqual([]);
  });

  it("declares only optional moves (so it can apply cleanly against a scaffolder that hasn't run)", () => {
    const { manifest } = readArchitectureManifestForPreset(repoType, "standard");
    for (const move of manifest.moves) {
      expect(move.optional).toBe(true);
    }
  });

  it("applies cleanly on an empty target dir — creates at least one directory or file, touches nothing else", () => {
    const { manifest, manifestDir } = readArchitectureManifestForPreset(repoType, "standard");
    const changes = applyArchitectureManifest({ manifest, manifestDir, targetDir });

    expect(changes.created.length).toBeGreaterThan(0);
    expect(changes.updated).toEqual([]);

    for (const dir of manifest.directories) {
      expect(existsSync(path.join(targetDir, dir))).toBe(true);
    }
    for (const file of manifest.files) {
      expect(existsSync(path.join(targetDir, file.to))).toBe(true);
    }
  });

  it("is idempotent-safe: applying twice never overwrites, second pass reports everything skipped", () => {
    const { manifest, manifestDir } = readArchitectureManifestForPreset(repoType, "standard");
    applyArchitectureManifest({ manifest, manifestDir, targetDir });
    const second = applyArchitectureManifest({ manifest, manifestDir, targetDir });
    expect(second.created).toEqual([]);
    expect(second.moved).toEqual([]);
  });
});

describe("standard overlay design intent — Shopify types stay minimal (spec §18.2)", () => {
  it.each(["shopify-app", "shopify-theme", "shopify-headless"] as const)(
    "%s: no directories/moves that could collide with the upstream scaffolder's own layout",
    (repoType) => {
      const { manifest } = readArchitectureManifestForPreset(repoType, "standard");
      // Only a docs/ convention folder — never touches src/app, sections/,
      // templates/, or any other scaffolder-owned path.
      expect(manifest.directories).toEqual(["docs/nockta"]);
      expect(manifest.moves).toEqual([]);
    },
  );
});

describe("standard overlay design intent — react-native/expo stay minimal (decisions.md D25)", () => {
  it.each(["react-native", "expo"] as const)(
    "%s: no directories/moves that could collide with the upstream scaffolder's own layout (android/, ios/, src/app, etc.)",
    (repoType) => {
      const { manifest } = readArchitectureManifestForPreset(repoType, "standard");
      expect(manifest.directories).toEqual(["docs/nockta"]);
      expect(manifest.moves).toEqual([]);
    },
  );
});
