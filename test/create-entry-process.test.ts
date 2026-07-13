import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Process-level tests against the BUILT CLI (`node dist/cli.js`), mirroring
 * `inject-nockta-skills`' own `test/install-entry-process.test.ts` convention
 * (closed stdin -> non-TTY, hard `spawnSync` timeout so a prompt-hang
 * regression fails fast instead of hanging CI). Covers Milestone 7's brief
 * item 6's non-TTY matrix: bare invocation, insufficient flags, --json
 * variants, the `wizard` subcommand — none of these may ever reach a real
 * `@inquirer/prompts` call, because closed stdin makes `process.stdin.isTTY`
 * falsy, so `commands/create-entry.ts::runCreateEntry()`/`runWizardEntry()`
 * always take the "sufficient flags OR !isTTY -> non-interactive/structured-
 * error path" branch.
 *
 * Milestone 8 / decisions.md D20 addition: `--yes` is now PART OF "sufficient
 * flags" for non-interactive execution (`--dry-run` stays exempt) — every
 * "sufficient flags" invocation below now carries `--yes` (updated, not
 * broken — same "keep milestone-N tests honest about milestone-N+1 reality"
 * precedent every milestone since 4 has set against its predecessor's tests),
 * plus new cases proving path+`--type` WITHOUT `--yes` now hits the same
 * structured, non-hanging, exit-2 error as any other missing flag, and that
 * `--dry-run` alone (no `--yes`) still succeeds.
 */

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const distCliPath = path.join(packageRoot, "dist", "cli.js");
const fixturesRoot = path.join(packageRoot, "fixtures", "scaffolders");
const fakeNextBin = path.join(fixturesRoot, "fake-next", "index.mjs");
const SPAWN_TIMEOUT_MS = 10_000;

beforeAll(() => {
  execFileSync("pnpm", ["exec", "tsup"], { cwd: packageRoot, stdio: "pipe" });
  if (!existsSync(distCliPath)) {
    throw new Error(`Expected build output at ${distCliPath}, but it does not exist.`);
  }
}, 60_000);

function runCli(args: string[], cwd: string, options: { fixtureBin?: string } = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (options.fixtureBin) {
    env.CREATE_NOCKTA_REPO_TEST_FIXTURE_BIN = options.fixtureBin;
  } else {
    delete env.CREATE_NOCKTA_REPO_TEST_FIXTURE_BIN;
  }
  delete env.CREATE_NOCKTA_REPO_TEST_INJECT_BIN;
  return spawnSync(process.execPath, [distCliPath, ...args], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"], // closed stdin -> genuinely non-TTY
    timeout: SPAWN_TIMEOUT_MS,
    encoding: "utf8",
  });
}

function oneJsonLine(stdout: string): Record<string, unknown> {
  const lines = stdout.trim().split("\n");
  expect(lines.length).toBe(1);
  return JSON.parse(lines[0] as string);
}

let targetDir: string;

beforeEach(() => {
  targetDir = mkdtempSync(path.join(tmpdir(), "create-nockta-repo-entry-proc-"));
});

afterEach(() => {
  rmSync(targetDir, { recursive: true, force: true });
});

describe("create-entry — non-TTY matrix (this milestone's brief item 6): never hangs, structured errors, never reaches the wizard", () => {
  it("bare invocation, non-TTY: structured human error, exit 2, no hang, nothing written", () => {
    const result = runCli([], targetDir);
    expect(result.signal).toBeNull(); // did not hit the spawn timeout / get killed
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("non-interactively");
    expect(result.stdout).not.toMatch(/create wizard/);
    expect(existsSync(path.join(targetDir, ".nockta"))).toBe(false);
  });

  it("bare invocation --json, non-TTY: exactly one JSON line, ok:false, exit 2, no hang", () => {
    const result = runCli(["--json"], targetDir);
    expect(result.signal).toBeNull();
    expect(result.status).toBe(2);
    const parsed = oneJsonLine(result.stdout) as { ok: boolean; error: { code: string } };
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("insufficient-flags");
  });

  it("--type next (no path), non-TTY: structured error, exit 2, no hang", () => {
    const result = runCli(["--type", "next"], targetDir);
    expect(result.signal).toBeNull();
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("non-interactively");
  });

  it("a bare project path (no --type), non-TTY: structured error, exit 2, no hang", () => {
    const result = runCli(["my-project"], targetDir);
    expect(result.signal).toBeNull();
    expect(result.status).toBe(2);
    const withJson = runCli(["my-project", "--json"], targetDir);
    const parsed = oneJsonLine(withJson.stdout) as { error: { details: { missing: string[] } } };
    expect(parsed.error.details.missing).toEqual(["--type <repoType>"]);
  });

  // Worker brief item 2 / decisions.md D22: "--also without --type or without
  // a scaffoldable primary -> invalid-input". `--also` alone never makes an
  // otherwise-insufficient invocation sufficient — the SAME insufficient-
  // flags/"missing --type" routing above fires (commands/create.ts's own
  // `resolveCreatePlan()` --also validation is never even reached — it
  // requires an already-resolved primary type, see test/also-types.test.ts's
  // unit-level coverage of THAT half).
  it("--also given but --type missing, non-TTY: same structured 'missing --type' error as any other --type-less invocation, exit 2", () => {
    const result = runCli(["my-project", "--also", "vite-react-ts"], targetDir);
    expect(result.signal).toBeNull();
    expect(result.status).toBe(2);
    const withJson = runCli(["my-project", "--also", "vite-react-ts", "--json"], targetDir);
    const parsed = oneJsonLine(withJson.stdout) as { error: { code: string; details: { missing: string[] } } };
    expect(parsed.error.code).toBe("insufficient-flags");
    expect(parsed.error.details.missing).toEqual(["--type <repoType>"]);
  });

  // --also with an unknown (unscaffoldable) primary --type: --type IS present
  // so routing treats the invocation as "sufficient" and hands off to
  // resolveCreatePlan() for real — which fails on the PRIMARY type first
  // (unknown-repo-type), never even reaching --also's own validation.
  it("--also given with an unknown/unscaffoldable primary --type, non-TTY: unknown-repo-type invalid-input, exit 2", () => {
    const result = runCli(["my-project", "--type", "not-a-real-type", "--also", "next", "--yes"], targetDir);
    expect(result.signal).toBeNull();
    expect(result.status).toBe(2);
    const withJson = runCli(
      ["my-project", "--type", "not-a-real-type", "--also", "next", "--yes", "--json"],
      targetDir,
    );
    const parsed = oneJsonLine(withJson.stdout) as { error: { code: string } };
    expect(parsed.error.code).toBe("unknown-repo-type");
  });

  it("sufficient flags (incl. --yes, decisions.md D20), non-TTY: unchanged existing success path, exit 0", () => {
    const result = runCli(["my-project", "--type", "next", "--no-skills", "--yes"], targetDir, {
      fixtureBin: fakeNextBin,
    });
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
    expect(existsSync(path.join(targetDir, "my-project", ".fixture-marker.json"))).toBe(true);
    expect(existsSync(path.join(targetDir, "my-project", ".nockta", "repo-profile.json"))).toBe(true);
  });

  // Milestone 8 / decisions.md D20: non-interactive EXECUTION now requires
  // --yes (aligning with inject-nockta-skills' own `hasSufficientInstallFlags()`
  // and the spec §5.2 example) — path + --type alone is no longer "sufficient"
  // on a non-TTY process. --dry-run remains exempt (see the "dry run" describe
  // block elsewhere in this suite/other integration files, all still --yes-free).
  it("D20: path + --type but NO --yes, non-TTY: structured invalid-input error, exit 2, nothing written, upstream never spawned", () => {
    const result = runCli(["my-project", "--type", "next", "--no-skills"], targetDir, { fixtureBin: fakeNextBin });
    expect(result.signal).toBeNull();
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("invalid input");
    expect(result.stderr).toContain("--yes");
    expect(result.stderr).toContain("non-interactively");
    expect(existsSync(path.join(targetDir, "my-project"))).toBe(false);
  });

  it("D20 --json: one JSON line, ok:false, exit 2, error names --yes as missing", () => {
    const result = runCli(["my-project", "--type", "next", "--no-skills", "--json"], targetDir, {
      fixtureBin: fakeNextBin,
    });
    expect(result.signal).toBeNull();
    expect(result.status).toBe(2);
    const parsed = oneJsonLine(result.stdout) as {
      ok: boolean;
      error: { code: string; details: { missing: string[]; yes: boolean; dryRun: boolean } };
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("insufficient-flags");
    expect(parsed.error.details.yes).toBe(false);
    expect(parsed.error.details.dryRun).toBe(false);
    expect(parsed.error.details.missing.some((m) => m.startsWith("--yes"))).toBe(true);
  });

  it("D20: --dry-run stays exempt from --yes, non-TTY: dry-run plan, exit 0, nothing written", () => {
    const result = runCli(["my-project", "--type", "next", "--dry-run"], targetDir, { fixtureBin: fakeNextBin });
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("dry run");
    expect(existsSync(path.join(targetDir, "my-project"))).toBe(false);
  });

  it("`create` subcommand form, non-TTY, insufficient flags: same structured error as the default/root form", () => {
    const result = runCli(["create"], targetDir);
    expect(result.signal).toBeNull();
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("non-interactively");
  });
});

describe("`wizard` subcommand — non-TTY: never hangs, structured error (this milestone's brief item 6)", () => {
  it("plain `wizard`, non-TTY: structured human error, exit 2, no hang, never reaches @inquirer/prompts", () => {
    const result = runCli(["wizard"], targetDir);
    expect(result.signal).toBeNull();
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("interactive terminal");
  });

  it("`wizard --json`, non-TTY: one JSON error line, exit 2, no hang", () => {
    const result = runCli(["wizard", "--json"], targetDir);
    expect(result.signal).toBeNull();
    expect(result.status).toBe(2);
    const parsed = oneJsonLine(result.stdout) as { ok: boolean; error: { code: string } };
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("no-tty");
  });
});
