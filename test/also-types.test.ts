import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EXIT_CODE, resolveCreatePlan } from "../src/commands/create.js";

// Unit-level coverage (module source, no build/spawn) for decisions.md D22's
// --also flag — worker brief's own "Tests" list item 1: "--also parse/
// validate (unknown type, dup-with-primary, --also without --type)".
// Complements test/run-inject-skills.test.ts (command construction) and
// test/create-also.integration.test.ts (process-level, real inject dist,
// full-chain proof).

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "create-nockta-repo-also-types-unit-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("resolveCreatePlan — --also validation (decisions.md D22)", () => {
  it("no --also at all: alsoTypes/repoTypes/inputWarnings are the trivial one-element case", () => {
    const resolved = resolveCreatePlan("my-project", { type: "next", dryRun: true, cwd });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.plan.repoType).toBe("next");
    expect(resolved.plan.alsoTypes).toEqual([]);
    expect(resolved.plan.repoTypes).toEqual(["next"]);
    expect(resolved.plan.inputWarnings).toEqual([]);
  });

  it("a valid --also union: alsoTypes/repoTypes carry it, primary first, no warnings", () => {
    const resolved = resolveCreatePlan("my-project", { type: "shopify-theme", also: "vite-react-ts", dryRun: true, cwd });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.plan.alsoTypes).toEqual(["vite-react-ts"]);
    expect(resolved.plan.repoTypes).toEqual(["shopify-theme", "vite-react-ts"]);
    expect(resolved.plan.inputWarnings).toEqual([]);
    // The forwarded inject command reflects the union.
    expect(resolved.plan.skills.enabled).toBe(true);
    if (resolved.plan.skills.enabled) {
      expect(resolved.plan.skills.commandLine).toContain("--type shopify-theme,vite-react-ts");
    }
  });

  it("multiple --also types, comma-separated, all carried through", () => {
    const resolved = resolveCreatePlan("my-project", { type: "next", also: "vite-react-ts,nest", dryRun: true, cwd });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.plan.alsoTypes).toEqual(["vite-react-ts", "nest"]);
    expect(resolved.plan.repoTypes).toEqual(["next", "vite-react-ts", "nest"]);
  });

  it("unknown --also value: invalid-input, exit code 2, nothing resolved", () => {
    const resolved = resolveCreatePlan("my-project", { type: "next", also: "not-a-real-type", dryRun: true, cwd });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.exitCode).toBe(EXIT_CODE.INVALID_TARGET);
    expect(resolved.error.code).toBe("invalid-also");
    expect(resolved.error.message).toContain("not-a-real-type");
  });

  it("one unknown value among several: still a hard error, names the offender(s) specifically", () => {
    const resolved = resolveCreatePlan("my-project", { type: "next", also: "vite-react-ts,bogus-type", dryRun: true, cwd });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.exitCode).toBe(EXIT_CODE.INVALID_TARGET);
    expect(resolved.error.details.invalid).toEqual(["bogus-type"]);
  });

  it("--also type equal to the primary --type: deduped with a WARNING, not an error", () => {
    const resolved = resolveCreatePlan("my-project", { type: "next", also: "next", dryRun: true, cwd });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.plan.alsoTypes).toEqual([]); // deduped away — never appears twice
    expect(resolved.plan.repoTypes).toEqual(["next"]);
    expect(resolved.plan.inputWarnings.length).toBe(1);
    expect(resolved.plan.inputWarnings[0]).toContain("next");
  });

  it("mixed: primary-duplicate deduped with a warning, the genuinely-new type kept", () => {
    const resolved = resolveCreatePlan("my-project", { type: "next", also: "next,vite-react-ts", dryRun: true, cwd });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.plan.alsoTypes).toEqual(["vite-react-ts"]);
    expect(resolved.plan.repoTypes).toEqual(["next", "vite-react-ts"]);
    expect(resolved.plan.inputWarnings.length).toBe(1);
  });

  it("a type repeated within --also itself is deduped with a warning too", () => {
    const resolved = resolveCreatePlan("my-project", { type: "next", also: "vite-react-ts,vite-react-ts", dryRun: true, cwd });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.plan.alsoTypes).toEqual(["vite-react-ts"]);
    expect(resolved.plan.inputWarnings.length).toBe(1);
  });

  it("--also \"\" (present but empty) is a clean no-op — same as omitting the flag", () => {
    const resolved = resolveCreatePlan("my-project", { type: "next", also: "", dryRun: true, cwd });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.plan.alsoTypes).toEqual([]);
    expect(resolved.plan.inputWarnings).toEqual([]);
  });

  it("--also with an unknown PRIMARY --type: the primary's own unknown-repo-type error fires first (--also is never reached)", () => {
    const resolved = resolveCreatePlan("my-project", { type: "not-a-real-type", also: "next", dryRun: true, cwd });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.exitCode).toBe(EXIT_CODE.INVALID_TARGET);
    expect(resolved.error.code).toBe("unknown-repo-type");
  });

  it("architecture overlay stays PRIMARY-type only (D22) — the resolved plan's architecturePlan never mentions --also types", () => {
    const resolved = resolveCreatePlan("my-project", { type: "next", also: "vite-react-ts", dryRun: true, cwd });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.plan.architecturePlan.enabled).toBe(true);
    if (resolved.plan.architecturePlan.enabled) {
      expect(resolved.plan.architecturePlan.preset).toBe("standard"); // next's own overlay, unmodified
    }
  });
});
