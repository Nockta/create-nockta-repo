import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Regression test for the symlinked-bin entrypoint bug: `process.argv[1]` is
// the symlink path (how npm link / global bins / npx invoke `bin` entries)
// while `import.meta.url` resolves to the real file's URL, so a naive
// `import.meta.url === pathToFileURL(process.argv[1]).href` guard never
// matches and the CLI silently no-ops (empty stdout, exit 0). This test
// proves the fix at the process level by actually spawning the built CLI
// through a symlink, the same way a package manager's bin shim would.

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const distCliPath = path.join(packageRoot, "dist", "cli.js");

let tmpDir: string;
let symlinkPath: string;

beforeAll(() => {
  // Build a fresh dist so this test can never pass vacuously against a stale
  // or missing dist/cli.js.
  execFileSync("pnpm", ["exec", "tsup"], { cwd: packageRoot, stdio: "pipe" });
  if (!existsSync(distCliPath)) {
    throw new Error(`Expected build output at ${distCliPath}, but it does not exist.`);
  }

  tmpDir = mkdtempSync(path.join(tmpdir(), "create-nockta-repo-symlink-test-"));
  symlinkPath = path.join(tmpDir, "create-nockta-repo");
  symlinkSync(distCliPath, symlinkPath);
}, 60_000);

afterAll(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe("CLI entrypoint guard under a symlinked bin invocation", () => {
  it("prints help and exits 0 when invoked through a symlink with --help", () => {
    const result = execFileSync("node", [symlinkPath, "--help"], { encoding: "utf8" });
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain("create-nockta-repo");
    expect(result).toContain("Commands:");
  });

  it("produces parseable, non-empty JSON for `list --json` when invoked through a symlink", () => {
    const result = execFileSync("node", [symlinkPath, "list", "--json"], { encoding: "utf8" });
    expect(result.trim().length).toBeGreaterThan(0);
    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty("repoTypes");
    expect(Array.isArray(parsed.repoTypes)).toBe(true);
    expect(parsed.repoTypes.length).toBeGreaterThan(0);
  });

  it("`list --json` is exactly one compact line on real stdout (D13, Milestone 3 defect fix F1)", () => {
    // A mock that captures per-console.log-call (as test/list-command.test.ts
    // does) can't tell a pretty-printed `JSON.stringify(data, null, 2)` call
    // apart from a compact one — both are still "one call". Only a real
    // spawned process's actual stdout stream exposes the embedded newlines a
    // pretty-printed call leaves behind, which is what F1 fixed and what
    // this assertion regression-guards against.
    const result = execFileSync("node", [symlinkPath, "list", "--json"], { encoding: "utf8" });
    const lines = result.split("\n").filter((line) => line.length > 0);
    expect(lines).toHaveLength(1);
  });
});
