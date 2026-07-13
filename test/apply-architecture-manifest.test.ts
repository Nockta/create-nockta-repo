import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ArchitectureApplyError,
  applyArchitectureManifest,
} from "../src/architecture/apply-architecture-manifest.js";
import type { ArchitectureManifest } from "../src/types/architecture.js";

// Spec §10 (src/architecture/apply-architecture-manifest.ts), §19 Milestone 4,
// §7.3 overlay rules, §13 safety rules. Every case here runs against real
// temp dirs on disk — no mocking of fs.

function baseManifest(overrides: Partial<ArchitectureManifest> = {}): ArchitectureManifest {
  return { name: "test", directories: [], files: [], moves: [], deletes: [], ...overrides };
}

describe("applyArchitectureManifest", () => {
  let manifestDir: string;
  let targetDir: string;

  beforeEach(() => {
    const root = mkdtempSync(path.join(tmpdir(), "create-nockta-repo-apply-arch-"));
    manifestDir = path.join(root, "preset");
    targetDir = path.join(root, "target");
    mkdirSync(path.join(manifestDir, "files"), { recursive: true });
    mkdirSync(targetDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(path.dirname(manifestDir), { recursive: true, force: true });
  });

  it("creates every directory in the manifest and reports them as created", () => {
    const manifest = baseManifest({ directories: ["src/components/ui", "src/lib/http"] });
    const changes = applyArchitectureManifest({ manifest, manifestDir, targetDir });
    expect(existsSync(path.join(targetDir, "src", "components", "ui"))).toBe(true);
    expect(existsSync(path.join(targetDir, "src", "lib", "http"))).toBe(true);
    expect(changes.created.sort()).toEqual(["src/components/ui", "src/lib/http"].sort());
    expect(changes.updated).toEqual([]);
    expect(changes.moved).toEqual([]);
    expect(changes.skipped).toEqual([]);
  });

  it("copies files byte-identical from manifestDir/files into targetDir", () => {
    const sourceContent = "# Feature template\n\nSome content with unicode: café, 日本語.\n";
    writeFileSync(path.join(manifestDir, "files", "readme.md"), sourceContent);
    const manifest = baseManifest({
      files: [{ from: "files/readme.md", to: "src/features/_template/README.md" }],
    });
    const changes = applyArchitectureManifest({ manifest, manifestDir, targetDir });
    const destPath = path.join(targetDir, "src", "features", "_template", "README.md");
    expect(existsSync(destPath)).toBe(true);
    expect(readFileSync(destPath, "utf8")).toBe(sourceContent);
    expect(changes.created).toEqual(["src/features/_template/README.md"]);
  });

  it("copies an empty (.gitkeep-style) file correctly", () => {
    writeFileSync(path.join(manifestDir, "files", "gitkeep"), "");
    const manifest = baseManifest({ files: [{ from: "files/gitkeep", to: "src/components/ui/.gitkeep" }] });
    applyArchitectureManifest({ manifest, manifestDir, targetDir });
    const destPath = path.join(targetDir, "src", "components", "ui", ".gitkeep");
    expect(existsSync(destPath)).toBe(true);
    expect(readFileSync(destPath, "utf8")).toBe("");
  });

  it("skips an optional move whose source is missing — no error, recorded in skipped", () => {
    const manifest = baseManifest({
      moves: [{ from: "src/app/page.tsx", to: "src/app/(public)/page.tsx", optional: true }],
    });
    const changes = applyArchitectureManifest({ manifest, manifestDir, targetDir });
    expect(changes.moved).toEqual([]);
    expect(changes.skipped).toEqual(["src/app/page.tsx -> src/app/(public)/page.tsx (optional, source missing)"]);
    expect(existsSync(path.join(targetDir, "src", "app", "(public)", "page.tsx"))).toBe(false);
  });

  it("throws ArchitectureApplyError for a non-optional move whose source is missing", () => {
    const manifest = baseManifest({
      directories: ["src/components/ui"],
      moves: [{ from: "src/app/page.tsx", to: "src/app/(public)/page.tsx" }],
    });
    try {
      applyArchitectureManifest({ manifest, manifestDir, targetDir });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ArchitectureApplyError);
      const err = error as ArchitectureApplyError;
      expect(err.code).toBe("move-source-missing");
      // Partial state (the directory created before the failing move) is
      // still reported — no rollback in MVP.
      expect(err.changes.created).toEqual(["src/components/ui"]);
    }
    expect(existsSync(path.join(targetDir, "src", "components", "ui"))).toBe(true);
  });

  it("actually performs a move when the source exists and destination does not", () => {
    mkdirSync(path.join(targetDir, "src", "app"), { recursive: true });
    writeFileSync(path.join(targetDir, "src", "app", "page.tsx"), "export default function Page() {}\n");
    const manifest = baseManifest({
      moves: [{ from: "src/app/page.tsx", to: "src/app/(public)/page.tsx", optional: true }],
    });
    const changes = applyArchitectureManifest({ manifest, manifestDir, targetDir });
    expect(existsSync(path.join(targetDir, "src", "app", "page.tsx"))).toBe(false);
    expect(existsSync(path.join(targetDir, "src", "app", "(public)", "page.tsx"))).toBe(true);
    expect(changes.moved).toEqual(["src/app/page.tsx -> src/app/(public)/page.tsx"]);
  });

  it("never overwrites an existing destination file — records it skipped instead", () => {
    writeFileSync(path.join(manifestDir, "files", "readme.md"), "overlay content\n");
    const existingPath = path.join(targetDir, "src", "features", "_template", "README.md");
    mkdirSync(path.dirname(existingPath), { recursive: true });
    writeFileSync(existingPath, "user-authored content — must survive\n");

    const manifest = baseManifest({
      files: [{ from: "files/readme.md", to: "src/features/_template/README.md" }],
    });
    const changes = applyArchitectureManifest({ manifest, manifestDir, targetDir });

    expect(readFileSync(existingPath, "utf8")).toBe("user-authored content — must survive\n");
    expect(changes.created).toEqual([]);
    expect(changes.updated).toEqual([]);
    expect(changes.skipped).toEqual(["src/features/_template/README.md (file already exists, not overwritten)"]);
  });

  it("never overwrites an existing directory — records it skipped, does not error", () => {
    mkdirSync(path.join(targetDir, "src", "components", "ui"), { recursive: true });
    const manifest = baseManifest({ directories: ["src/components/ui"] });
    const changes = applyArchitectureManifest({ manifest, manifestDir, targetDir });
    expect(changes.created).toEqual([]);
    expect(changes.skipped).toEqual(["src/components/ui (directory already exists)"]);
  });

  it("never overwrites an existing move destination — records it skipped, source stays put", () => {
    mkdirSync(path.join(targetDir, "src", "app"), { recursive: true });
    writeFileSync(path.join(targetDir, "src", "app", "page.tsx"), "original\n");
    mkdirSync(path.join(targetDir, "src", "app", "(public)"), { recursive: true });
    writeFileSync(path.join(targetDir, "src", "app", "(public)", "page.tsx"), "already there\n");

    const manifest = baseManifest({
      moves: [{ from: "src/app/page.tsx", to: "src/app/(public)/page.tsx", optional: true }],
    });
    const changes = applyArchitectureManifest({ manifest, manifestDir, targetDir });

    expect(readFileSync(path.join(targetDir, "src", "app", "(public)", "page.tsx"), "utf8")).toBe("already there\n");
    expect(readFileSync(path.join(targetDir, "src", "app", "page.tsx"), "utf8")).toBe("original\n");
    expect(changes.moved).toEqual([]);
    expect(changes.skipped).toEqual([
      "src/app/page.tsx -> src/app/(public)/page.tsx (destination already exists, not overwritten)",
    ]);
  });

  it("never touches files not mentioned by the manifest (sentinel file untouched)", () => {
    const sentinelPath = path.join(targetDir, "package.json");
    writeFileSync(sentinelPath, '{"name":"sentinel","version":"1.2.3"}\n');
    const sentinelBefore = readFileSync(sentinelPath, "utf8");

    writeFileSync(path.join(manifestDir, "files", "readme.md"), "overlay content\n");
    const manifest = baseManifest({
      directories: ["src/components/ui", "src/lib/http"],
      files: [{ from: "files/readme.md", to: "src/features/_template/README.md" }],
      moves: [{ from: "src/app/page.tsx", to: "src/app/(public)/page.tsx", optional: true }],
    });
    applyArchitectureManifest({ manifest, manifestDir, targetDir });

    expect(readFileSync(sentinelPath, "utf8")).toBe(sentinelBefore);
  });
});
