import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ADAPTER_TYPES, REPO_TYPES } from "../src/index.js";

/**
 * The D7 drift guard (decisions.md D7, spec §16.2's own worked example):
 * `create-nockta-repo` duplicates (never imports) `inject-nockta-skills`'
 * `RepoType`/`AdapterType` unions locally — see src/types/repo-type.ts and
 * src/types/adapter.ts's own header comments. inject-nockta-skills is the
 * canonical semantic owner of those unions; this test is the CI-enforced
 * proof the two copies haven't silently drifted apart.
 *
 * Spec §16.2's own wording runs this against `npx inject-nockta-skills list
 * --json` — not viable here since inject-nockta-skills is unpublished
 * (Milestone 8's own constraint: never `npm publish`). This spawns the REAL
 * LOCAL built `inject-nockta-skills` CLI instead — `node <sibling
 * dist/cli.js> list --json` — building it first only if its `dist/` is
 * missing (read-only against the sibling package otherwise, mirroring
 * `test/create-skills.integration.test.ts`'s own beforeAll convention
 * exactly; never touches inject's source). This is still the REAL sibling
 * CLI, not a fixture or a hand-copied enum list — the only thing substituted
 * is the resolution mechanism (`node <local dist>` instead of `npx <a
 * published package that doesn't exist yet>`), which is exactly the same
 * substitution `core/run-inject-skills.ts`'s own
 * `CREATE_NOCKTA_REPO_TEST_INJECT_BIN` override makes for every other
 * real-inject integration test in this suite.
 */

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const injectRoot = path.join(packageRoot, "..", "inject-nockta-skills");
const injectDistCliPath = path.join(injectRoot, "dist", "cli.js");

function ensureInjectBuilt(): void {
  if (existsSync(injectDistCliPath)) return;
  execFileSync("pnpm", ["build"], { cwd: injectRoot, stdio: "pipe" });
  if (!existsSync(injectDistCliPath)) {
    throw new Error(
      `Expected sibling package build output at ${injectDistCliPath}, but it does not exist even after building it.`,
    );
  }
}

type InjectListData = {
  repoTypes: string[];
  adapterTypes: string[];
};

type InjectListResult = {
  ok: boolean;
  command: string;
  data: InjectListData;
};

function runRealInjectList(): InjectListResult {
  ensureInjectBuilt();
  const stdout = execFileSync(process.execPath, [injectDistCliPath, "list", "--json"], {
    cwd: injectRoot,
    encoding: "utf8",
  });
  const lines = stdout.split("\n").filter((line) => line.length > 0);
  expect(lines).toHaveLength(1); // D13: exactly one compact JSON line.
  return JSON.parse(lines[0]) as InjectListResult;
}

describe("enum-parity contract test (spec §16.2, decisions.md D7) — REAL local inject-nockta-skills dist", () => {
  it("inject-nockta-skills' real list --json RepoType set exactly matches create-nockta-repo's own REPO_TYPES", () => {
    const result = runRealInjectList();
    expect(result.ok).toBe(true);
    expect(result.command).toBe("list");
    expect(Array.isArray(result.data.repoTypes)).toBe(true);

    const injectRepoTypes = [...result.data.repoTypes].sort();
    const createRepoTypes = [...REPO_TYPES].sort();
    expect(injectRepoTypes).toEqual(createRepoTypes);
  });

  it("inject-nockta-skills' real list --json AdapterType set exactly matches create-nockta-repo's own ADAPTER_TYPES", () => {
    const result = runRealInjectList();
    expect(Array.isArray(result.data.adapterTypes)).toBe(true);

    const injectAdapterTypes = [...result.data.adapterTypes].sort();
    const createAdapterTypes = [...ADAPTER_TYPES].sort();
    expect(injectAdapterTypes).toEqual(createAdapterTypes);
  });
});
