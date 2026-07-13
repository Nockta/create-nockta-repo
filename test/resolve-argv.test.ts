import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { resolveArgv } from "../src/cli.js";

describe("resolveArgv (implicit default `create` command)", () => {
  it("inserts create for a bare invocation", () => {
    expect(resolveArgv([])).toEqual(["create"]);
  });

  it("inserts create before a bare project path", () => {
    expect(resolveArgv(["my-project", "--type", "next"])).toEqual([
      "create",
      "my-project",
      "--type",
      "next",
    ]);
  });

  it("leaves an explicit create subcommand untouched", () => {
    expect(resolveArgv(["create", "apps/web", "--type", "next"])).toEqual([
      "create",
      "apps/web",
      "--type",
      "next",
    ]);
  });

  it("leaves an explicit list subcommand untouched", () => {
    expect(resolveArgv(["list", "--details"])).toEqual(["list", "--details"]);
  });

  it("appends create after a value-taking global flag with no positional", () => {
    expect(resolveArgv(["--skills-version", "2.4.1"])).toEqual([
      "--skills-version",
      "2.4.1",
      "create",
    ]);
  });

  it("does not mistake a global flag's value for a subcommand name", () => {
    expect(resolveArgv(["--skills-version", "list"])).toEqual([
      "--skills-version",
      "list",
      "create",
    ]);
  });
});

// Regression coverage for the `--type` bug: `resolveArgv` used to treat every
// leading `-`-prefixed token as safely skippable, as if it were either global
// or irrelevant to the insertion point. That's only true for options
// `program` itself recognizes (`--json`, `--skills-version`, `--help`,
// `--version`) — any `create`-scoped option (value-taking or boolean) isn't,
// so `create` must be spliced in *before* it. `resolveArgv(["--type",
// "next"])` used to walk past `--type`, mistake `"next"` for the positional,
// and splice `create` *between* the flag and its value
// (`["--type", "create", "next"]`) — Commander then rejected the still-first,
// still-unrecognized `--type` with `error: unknown option '--type'` before it
// ever reached the trailing `create` token, printing no JSON even under
// `--json` (D13 violation). Widening only the value-taking-options list to
// include `--type` does NOT fix this (verified by hand — it merely changes
// the broken splice point to `["--type", "next", "create"]`, and `--type` is
// still the first, still-unrecognized token); the actual fix, and what these
// cases pin down, is that `create` must land at index 0 whenever ANY
// `create`-scoped option opens the argv.
describe("resolveArgv — create-scoped options never mistaken for skippable globals", () => {
  it("bare --type with no path: create lands before --type, not between it and its value", () => {
    expect(resolveArgv(["--type", "next"])).toEqual(["create", "--type", "next"]);
  });

  it("bare --arch with no path", () => {
    expect(resolveArgv(["--arch", "standard"])).toEqual(["create", "--arch", "standard"]);
  });

  it("bare --adapters with no path", () => {
    expect(resolveArgv(["--adapters", "claude,cursor"])).toEqual([
      "create",
      "--adapters",
      "claude,cursor",
    ]);
  });

  it("bare boolean create-scoped option with no path (--dry-run) — same bug class, no value involved", () => {
    expect(resolveArgv(["--dry-run"])).toEqual(["create", "--dry-run"]);
  });

  it("option-value ordering: create-scoped option before a global flag", () => {
    expect(resolveArgv(["--type", "next", "--json"])).toEqual([
      "create",
      "--type",
      "next",
      "--json",
    ]);
  });

  it("option-value ordering: global flag before a create-scoped option, no path", () => {
    expect(resolveArgv(["--json", "--type", "next"])).toEqual([
      "--json",
      "create",
      "--type",
      "next",
    ]);
  });

  it("option-value ordering: value-taking global flag followed by a create-scoped option, no path", () => {
    expect(resolveArgv(["--skills-version", "2.4.1", "--type", "next"])).toEqual([
      "--skills-version",
      "2.4.1",
      "create",
      "--type",
      "next",
    ]);
  });

  it("a project path before --type is unaffected (already worked, guards against regressing it)", () => {
    expect(resolveArgv(["my-app", "--type", "next", "--dry-run"])).toEqual([
      "create",
      "my-app",
      "--type",
      "next",
      "--dry-run",
    ]);
  });
});

// Process-level proof, against the real built CLI, that the Commander crash
// this bug caused (`error: unknown option '--type'`, exit 1, no JSON even
// under `--json`) is actually gone — a passing resolveArgv() unit test alone
// doesn't prove Commander accepts the resulting argv. Mirrors the
// build-in-beforeAll pattern already used by
// test/symlink-entrypoint.test.ts and test/create-command.integration.test.ts.
describe("resolveArgv regression — real dist/cli.js no longer crashes on bare --type", () => {
  const packageRoot = fileURLToPath(new URL("..", import.meta.url));
  const distCliPath = path.join(packageRoot, "dist", "cli.js");

  beforeAll(() => {
    execFileSync("pnpm", ["exec", "tsup"], { cwd: packageRoot, stdio: "pipe" });
    if (!existsSync(distCliPath)) {
      throw new Error(`Expected build output at ${distCliPath}, but it does not exist.`);
    }
  }, 60_000);

  // Milestone 7 (spec §6-equivalent reasoning, commands/create-entry.ts): a
  // spawned child with default `spawnSync` stdio is genuinely non-TTY (piped
  // stdin), so "insufficient flags" (`--type` alone, no path) now routes to
  // the structured, non-hanging error — never the (now-real, would-hang-on-
  // stdin) wizard, and never the Commander crash this suite originally
  // guarded against. Still the same regression proof either way: no
  // "unknown option" crash, real JSON under --json.
  it("`--type next` with no path, non-TTY: no Commander error, structured exit 2 (never the wizard, never a crash)", () => {
    const result = spawnSync(process.execPath, [distCliPath, "--type", "next"], { encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stderr).not.toContain("unknown option");
    expect(result.stderr).toContain("non-interactively");
  });

  it("`--type next --json` with no path also avoids the crash: one structured JSON error line, exit 2", () => {
    const withType = spawnSync(process.execPath, [distCliPath, "--type", "next", "--json"], {
      encoding: "utf8",
    });
    const bareJson = spawnSync(process.execPath, [distCliPath, "--json"], { encoding: "utf8" });
    expect(withType.stderr).not.toContain("unknown option");
    expect(withType.status).toBe(2);
    expect(bareJson.status).toBe(2);
    // Milestone 7: the structured error is now flag-specific (only the
    // MISSING flag(s) are named), so the two invocations' messages legitimately
    // differ — `--type next --json` is missing only the path, bare `--json`
    // is missing both. Same shape, same exit code, different `details.missing`.
    const withTypeParsed = JSON.parse(withType.stdout.trim());
    const bareJsonParsed = JSON.parse(bareJson.stdout.trim());
    expect(withTypeParsed.ok).toBe(false);
    expect(withTypeParsed.error.code).toBe("insufficient-flags");
    expect(withTypeParsed.error.details.missing).toEqual(["a project name/path"]);
    expect(bareJsonParsed.error.details.missing).toEqual(["a project name/path", "--type <repoType>"]);
  });

  it("`my-app --type next --dry-run` is unchanged (regression guard, spec §5.7)", () => {
    const result = spawnSync(process.execPath, [distCliPath, "my-app", "--type", "next", "--dry-run"], {
      encoding: "utf8",
      cwd: packageRoot,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("dry run");
    expect(result.stdout).toContain("Nothing was written.");
    expect(existsSync(path.join(packageRoot, "my-app"))).toBe(false);
  });
});
