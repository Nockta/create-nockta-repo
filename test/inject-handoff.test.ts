import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  INJECT_BIN_OVERRIDE_ENV_VAR,
  InjectSkillsFailure,
  buildInjectSkillsInteractiveCommand,
  runInjectSkillsInteractive,
} from "../src/core/run-inject-skills.js";

/**
 * The create->inject INTERACTIVE handoff (decisions.md D29). Covers the constructed argv (the brief's
 * "assert the constructed argv" ask) — interactive vs the headless shape — plus the spawn contract
 * (inherited stdio; exit code resolved even when non-zero; spawn-failure -> typed failure) and the
 * CREATE_NOCKTA_REPO_TEST_INJECT_BIN override honored on the interactive path (brief item E).
 */

describe("buildInjectSkillsInteractiveCommand — argv is `install --type <types>`, NO --yes/--json/--adapters (D29)", () => {
  afterEach(() => {
    delete process.env[INJECT_BIN_OVERRIDE_ENV_VAR];
  });

  it("standalone: npx inject-nockta-skills@latest install --type <type> — and nothing else", () => {
    const built = buildInjectSkillsInteractiveCommand({
      mode: "standalone",
      repoType: "next",
      cwd: "/tmp/my-project",
    });
    expect(built.command).toBe("npx");
    expect(built.args).toEqual(["inject-nockta-skills@latest", "install", "--type", "next"]);
    // The whole point of D29's interactive handoff: inject's OWN wizard asks these, so they are absent.
    expect(built.args).not.toContain("--yes");
    expect(built.args).not.toContain("--json");
    expect(built.args).not.toContain("--adapters");
    expect(built.commandLine).toBe("npx inject-nockta-skills@latest install --type next");
    expect(built.usesTestOverride).toBe(false);
  });

  it("standalone union: multiple types are comma-joined on --type (D22)", () => {
    const built = buildInjectSkillsInteractiveCommand({
      mode: "standalone",
      repoType: "next",
      repoTypes: ["next", "vite-react-ts"],
      cwd: "/tmp/my-project",
    });
    expect(built.args).toEqual(["inject-nockta-skills@latest", "install", "--type", "next,vite-react-ts"]);
  });

  it("monorepo-target: install --target <path>:<type>[+<type>] (colon form, +-joined types)", () => {
    const built = buildInjectSkillsInteractiveCommand({
      mode: "monorepo-target",
      repoType: "next",
      repoTypes: ["next", "nest"],
      targetPath: "apps/web",
      cwd: "/tmp/monorepo-root",
    });
    expect(built.args).toEqual(["inject-nockta-skills@latest", "install", "--target", "apps/web:next+nest"]);
    expect(built.args).not.toContain("--yes");
    expect(built.args).not.toContain("--json");
  });

  it("--skills-version pins the npx package spec (still no --yes/--json)", () => {
    const built = buildInjectSkillsInteractiveCommand({
      mode: "standalone",
      repoType: "next",
      skillsVersion: "2.4.1",
      cwd: "/tmp/my-project",
    });
    expect(built.args[0]).toBe("inject-nockta-skills@2.4.1");
    expect(built.commandLine).toBe("npx inject-nockta-skills@2.4.1 install --type next");
  });

  it("CREATE_NOCKTA_REPO_TEST_INJECT_BIN override is honored on the interactive path too (brief item E)", () => {
    process.env[INJECT_BIN_OVERRIDE_ENV_VAR] = "/local/inject/dist/cli.js";
    const built = buildInjectSkillsInteractiveCommand({
      mode: "standalone",
      repoType: "next",
      cwd: "/tmp/my-project",
    });
    expect(built.command).toBe(process.execPath); // node runs the local build
    expect(built.args).toEqual(["/local/inject/dist/cli.js", "install", "--type", "next"]);
    expect(built.usesTestOverride).toBe(true);
    // Override path uses the LOCAL build, so no @version is applied even if skills-version were set.
    expect(built.args.some((a) => a.includes("@"))).toBe(false);
  });

  it("monorepo-target without a targetPath is a programmer error (throws)", () => {
    expect(() =>
      buildInjectSkillsInteractiveCommand({ mode: "monorepo-target", repoType: "next", cwd: "/tmp/root" }),
    ).toThrow(/targetPath/);
  });
});

describe("runInjectSkillsInteractive — inherited stdio; resolves exit code even when non-zero", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "inject-handoff-"));
  const exitZeroBin = path.join(scratch, "exit-zero.mjs");
  const exitNonZeroBin = path.join(scratch, "exit-nonzero.mjs");

  beforeAll(() => {
    // Neither reads stdin (inherited stdio is fine in a non-TTY test process).
    writeFileSync(exitZeroBin, "#!/usr/bin/env node\nprocess.exit(0);\n");
    writeFileSync(exitNonZeroBin, "#!/usr/bin/env node\nprocess.exit(7);\n");
  });
  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
    delete process.env[INJECT_BIN_OVERRIDE_ENV_VAR];
  });

  it("exit 0 resolves with exitCode 0 (the user completed inject's wizard)", async () => {
    process.env[INJECT_BIN_OVERRIDE_ENV_VAR] = exitZeroBin;
    const res = await runInjectSkillsInteractive({ mode: "standalone", repoType: "next", cwd: scratch });
    expect(res.exitCode).toBe(0);
    expect(res.usesTestOverride).toBe(true);
  });

  it("a non-zero exit RESOLVES (not rejects) — a declined inject wizard is the user's choice, not a create crash", async () => {
    process.env[INJECT_BIN_OVERRIDE_ENV_VAR] = exitNonZeroBin;
    const res = await runInjectSkillsInteractive({ mode: "standalone", repoType: "next", cwd: scratch });
    expect(res.exitCode).toBe(7);
  });

  it("a genuine spawn failure (unspawnable — cwd does not exist) rejects with a typed InjectSkillsFailure", async () => {
    // A nonexistent cwd makes `spawn` itself emit an ENOENT 'error' (vs. node merely exiting non-zero).
    process.env[INJECT_BIN_OVERRIDE_ENV_VAR] = exitZeroBin;
    await expect(
      runInjectSkillsInteractive({ mode: "standalone", repoType: "next", cwd: path.join(scratch, "no-such-dir") }),
    ).rejects.toBeInstanceOf(InjectSkillsFailure);
  });
});
