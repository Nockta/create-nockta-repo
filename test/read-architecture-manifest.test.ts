import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ArchitectureManifestError,
  readArchitectureManifestForPreset,
  readArchitectureManifestFromDir,
} from "../src/architecture/read-architecture-manifest.js";

// Spec §10 (src/architecture/read-architecture-manifest.ts), §19 Milestone 4.
// Manifest reading is exercised directly against hand-built temp dirs here —
// valid, malformed, non-empty deletes, disallowed fields, unknown preset —
// independent of the real bundled packs/ content (that's
// test/standard-overlays.test.ts).

describe("readArchitectureManifestFromDir", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "create-nockta-repo-arch-manifest-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeManifest(content: unknown) {
    writeFileSync(path.join(dir, "arch.json"), typeof content === "string" ? content : JSON.stringify(content));
  }

  it("parses a valid manifest matching spec §7.2 exactly", () => {
    writeManifest({
      name: "standard",
      directories: ["src/components/ui"],
      files: [{ from: "files/readme.md", to: "src/README.md" }],
      moves: [{ from: "src/app/page.tsx", to: "src/app/(public)/page.tsx", optional: true }],
      deletes: [],
    });
    const manifest = readArchitectureManifestFromDir(dir);
    expect(manifest.name).toBe("standard");
    expect(manifest.directories).toEqual(["src/components/ui"]);
    expect(manifest.files).toEqual([{ from: "files/readme.md", to: "src/README.md" }]);
    expect(manifest.moves).toEqual([{ from: "src/app/page.tsx", to: "src/app/(public)/page.tsx", optional: true }]);
    expect(manifest.deletes).toEqual([]);
  });

  it("allows moves without the optional field", () => {
    writeManifest({
      name: "standard",
      directories: [],
      files: [],
      moves: [{ from: "a.txt", to: "b.txt" }],
      deletes: [],
    });
    const manifest = readArchitectureManifestFromDir(dir);
    expect(manifest.moves).toEqual([{ from: "a.txt", to: "b.txt" }]);
  });

  it("rejects a directory whose arch.json is missing (manifest-not-found)", () => {
    // Directory exists but is empty — no arch.json inside.
    expect(() => readArchitectureManifestFromDir(dir)).toThrowError(ArchitectureManifestError);
    try {
      readArchitectureManifestFromDir(dir);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ArchitectureManifestError);
      expect((error as ArchitectureManifestError).code).toBe("manifest-not-found");
    }
  });

  it("rejects a manifest directory that does not exist at all (preset-not-found)", () => {
    const missing = path.join(dir, "does-not-exist");
    try {
      readArchitectureManifestFromDir(missing);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ArchitectureManifestError);
      expect((error as ArchitectureManifestError).code).toBe("preset-not-found");
    }
  });

  it("rejects malformed JSON with a structured malformed-json error", () => {
    writeManifest("{ this is not json");
    try {
      readArchitectureManifestFromDir(dir);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ArchitectureManifestError);
      expect((error as ArchitectureManifestError).code).toBe("malformed-json");
    }
  });

  it("rejects a non-empty deletes array (spec §13: deletes disabled by default)", () => {
    writeManifest({
      name: "standard",
      directories: [],
      files: [],
      moves: [],
      deletes: ["src/some-file.ts"],
    });
    try {
      readArchitectureManifestFromDir(dir);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ArchitectureManifestError);
      const err = error as ArchitectureManifestError;
      expect(err.code).toBe("deletes-disabled");
      expect(err.message).toContain("Deletes are disabled by default");
    }
  });

  it("rejects an unsupported top-level field (script-like-content guard, spec §7.3/§13)", () => {
    writeManifest({
      name: "standard",
      directories: [],
      files: [],
      moves: [],
      deletes: [],
      scripts: { postInstall: "rm -rf /" },
    });
    try {
      readArchitectureManifestFromDir(dir);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ArchitectureManifestError);
      const err = error as ArchitectureManifestError;
      expect(err.code).toBe("disallowed-field");
      expect(err.message).toContain("scripts");
    }
  });

  it("rejects a directories entry that escapes via ..", () => {
    writeManifest({ name: "standard", directories: ["../../etc"], files: [], moves: [], deletes: [] });
    try {
      readArchitectureManifestFromDir(dir);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ArchitectureManifestError);
      expect((error as ArchitectureManifestError).code).toBe("invalid-schema");
    }
  });

  it("rejects an absolute path in files[].to", () => {
    writeManifest({
      name: "standard",
      directories: [],
      files: [{ from: "files/x.md", to: "/etc/passwd" }],
      moves: [],
      deletes: [],
    });
    try {
      readArchitectureManifestFromDir(dir);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ArchitectureManifestError);
      expect((error as ArchitectureManifestError).code).toBe("invalid-schema");
    }
  });

  it("rejects a manifest that is a JSON array, not an object", () => {
    writeManifest([]);
    try {
      readArchitectureManifestFromDir(dir);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ArchitectureManifestError);
      expect((error as ArchitectureManifestError).code).toBe("invalid-schema");
    }
  });

  it("rejects a missing/empty name", () => {
    writeManifest({ directories: [], files: [], moves: [], deletes: [] });
    try {
      readArchitectureManifestFromDir(dir);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ArchitectureManifestError);
      expect((error as ArchitectureManifestError).code).toBe("invalid-schema");
    }
  });
});

describe("readArchitectureManifestForPreset (packs/<repoType>/architecture/<preset>/ resolution)", () => {
  it("reads the real bundled next/standard manifest from source (spec §7.2 path convention)", () => {
    const { manifest, manifestDir } = readArchitectureManifestForPreset("next", "standard");
    expect(manifest.name).toBe("standard");
    expect(manifest.directories).toContain("src/components/ui");
    expect(manifestDir.endsWith(path.join("packs", "next", "architecture", "standard"))).toBe(true);
  });

  it("throws preset-not-found with knownPresets for an unknown preset", () => {
    try {
      readArchitectureManifestForPreset("next", "does-not-exist-preset");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ArchitectureManifestError);
      const err = error as ArchitectureManifestError;
      expect(err.code).toBe("preset-not-found");
      expect(err.details.knownPresets).toContain("standard");
      expect(err.message).toContain("does-not-exist-preset");
    }
  });
});
