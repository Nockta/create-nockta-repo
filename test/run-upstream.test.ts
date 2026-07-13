import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UpstreamFailure, runUpstream } from "../src/core/run-upstream.js";

const fixturesRoot = fileURLToPath(new URL("../fixtures/scaffolders/", import.meta.url));
const fakeNextBin = path.join(fixturesRoot, "fake-next", "index.mjs");
const fakeFailingBin = path.join(fixturesRoot, "fake-failing", "index.mjs");

describe("runUpstream (spec §10 core/run-upstream.ts, §19 Milestone 3)", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), "create-nockta-repo-run-upstream-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("dryRun short-circuits before ever spawning — synthetic success, no side effects", async () => {
    const result = await runUpstream({
      command: process.execPath,
      args: [fakeNextBin, path.join(cwd, "apps", "web")],
      dryRun: true,
    });
    expect(result).toEqual({
      ok: true,
      exitCode: 0,
      signal: null,
      command: process.execPath,
      args: [fakeNextBin, path.join(cwd, "apps", "web")],
      durationMs: 0,
    });
    expect(existsSync(path.join(cwd, "apps", "web"))).toBe(false);
  });

  it("resolves a structured UpstreamResult on success and actually ran the command", async () => {
    const targetPath = path.join(cwd, "apps", "web");
    const result = await runUpstream({
      command: process.execPath,
      args: [fakeNextBin, targetPath, "--tailwind"],
      cwd,
    });
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.command).toBe(process.execPath);
    expect(typeof result.durationMs).toBe("number");
    expect(existsSync(targetPath)).toBe(true);
  });

  it("rejects with a typed UpstreamFailure carrying the real child exit code on non-zero exit", async () => {
    await expect(
      runUpstream({ command: process.execPath, args: [fakeFailingBin], cwd }),
    ).rejects.toBeInstanceOf(UpstreamFailure);

    try {
      await runUpstream({ command: process.execPath, args: [fakeFailingBin], cwd });
      expect.unreachable("runUpstream should have rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(UpstreamFailure);
      const failure = error as UpstreamFailure;
      expect(failure.result.ok).toBe(false);
      expect(failure.result.exitCode).toBe(7);
      expect(failure.result.signal).toBeNull();
    }
  });

  it("rejects with UpstreamFailure when the command can't even launch (ENOENT)", async () => {
    try {
      await runUpstream({ command: path.join(cwd, "does-not-exist-binary"), args: [], cwd });
      expect.unreachable("runUpstream should have rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(UpstreamFailure);
      const failure = error as UpstreamFailure;
      expect(failure.result.ok).toBe(false);
      expect(failure.result.exitCode).toBeNull();
      expect(failure.cause).toBeDefined();
    }
  });

  it("passes args as an array with no shell interpolation — special characters survive verbatim", async () => {
    const targetPath = path.join(cwd, "apps", "web");
    const dangerousArg = "hello world; rm -rf / && echo pwned $(whoami) `id`";
    await runUpstream({
      command: process.execPath,
      args: [fakeNextBin, targetPath, "--message", dangerousArg],
      cwd,
    });
    const marker = JSON.parse(readFileSync(path.join(targetPath, ".fixture-marker.json"), "utf8"));
    expect(marker.passthroughArgs).toEqual(["--message", dangerousArg]);
  });

  it("honors the cwd option — spawned process's cwd matches, independent of process.cwd()", async () => {
    const marker = path.join(cwd, "apps", "web", ".fixture-marker.json");
    await runUpstream({
      command: process.execPath,
      args: [fakeNextBin, path.join("apps", "web")],
      cwd,
    });
    const parsed = JSON.parse(readFileSync(marker, "utf8"));
    expect(parsed.cwd).toBe(cwd);
  });

  describe("forceCI (headless-scaffolder CI=true fix — the verified bug)", () => {
    const originalCI = process.env.CI;

    afterEach(() => {
      if (originalCI === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = originalCI;
      }
    });

    it("forceCI: true sets CI=true in the child's real env when the caller's CI is unset", async () => {
      delete process.env.CI;
      const targetPath = path.join(cwd, "apps", "web");
      await runUpstream({ command: process.execPath, args: [fakeNextBin, targetPath], cwd, forceCI: true });
      const marker = JSON.parse(readFileSync(path.join(targetPath, ".fixture-marker.json"), "utf8"));
      expect(marker.env.CI).toBe("true");
    });

    it("forceCI: false (default) leaves CI unset — the wizard/interactive path", async () => {
      delete process.env.CI;
      const targetPath = path.join(cwd, "apps", "web");
      await runUpstream({ command: process.execPath, args: [fakeNextBin, targetPath], cwd });
      const marker = JSON.parse(readFileSync(path.join(targetPath, ".fixture-marker.json"), "utf8"));
      expect(marker.env.CI).toBeNull();
    });

    it("forceCI: true does NOT clobber an already-truthy CI the caller/environment set", async () => {
      process.env.CI = "1";
      const targetPath = path.join(cwd, "apps", "web");
      await runUpstream({ command: process.execPath, args: [fakeNextBin, targetPath], cwd, forceCI: true });
      const marker = JSON.parse(readFileSync(path.join(targetPath, ".fixture-marker.json"), "utf8"));
      expect(marker.env.CI).toBe("1");
    });

    it('forceCI: true still defaults CI=true when the ambient CI is falsy ("false")', async () => {
      process.env.CI = "false";
      const targetPath = path.join(cwd, "apps", "web");
      await runUpstream({ command: process.execPath, args: [fakeNextBin, targetPath], cwd, forceCI: true });
      const marker = JSON.parse(readFileSync(path.join(targetPath, ".fixture-marker.json"), "utf8"));
      expect(marker.env.CI).toBe("true");
    });

    it("forceCI: true still merges the rest of process.env onto the child — nothing else is dropped", async () => {
      delete process.env.CI;
      const targetPath = path.join(cwd, "apps", "web");
      await runUpstream({ command: process.execPath, args: [fakeNextBin, targetPath], cwd, forceCI: true });
      const marker = JSON.parse(readFileSync(path.join(targetPath, ".fixture-marker.json"), "utf8"));
      expect(marker.env.CI).toBe("true");
      expect(marker.env.hasPath).toBe(true);
    });
  });
});
