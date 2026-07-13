import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * THE ACCEPTANCE PROOF (decisions.md D6, spec §16.3) — reproducible harness,
 * opt-in / env-gated so CI stays offline and fast by default.
 *
 * Spec §16.3: "The end-to-end real run — create-nockta-repo -> real upstream
 * scaffolder (e.g. real create-next-app) -> architecture overlay -> real
 * inject-nockta-skills rendering, spawned exactly as in production (8.1) —
 * is the acceptance proof for the full chain, not an optional extra."
 *
 * What's REAL here, and what's overridden, stated exactly (Milestone 8
 * brief's own requirement — "document exactly what was real vs
 * overridden"):
 * - Upstream scaffolder: REAL. `npx create-next-app@latest <path> --yes
 *   --disable-git`, exactly the command `src/scaffolders/next.ts` +
 *   `commands/create.ts` already construct for a real `--type next` run —
 *   NO `CREATE_NOCKTA_REPO_TEST_FIXTURE_BIN` override. Hits the real npm
 *   registry create-nockta-repo already targets (no `.npmrc`/custom registry
 *   anywhere in this package — the default `https://registry.npmjs.org/`).
 *   `--yes` (create-next-app's OWN flag, passed as a spec §5.4 passthrough
 *   arg, distinct from create-nockta-repo's own `--yes`) makes it use saved
 *   preferences/defaults instead of prompting; `--disable-git` skips
 *   create-next-app's own `git init` (unrelated to, and not a violation of,
 *   decisions.md D11 — create-nockta-repo itself never runs git; this only
 *   stops the UPSTREAM tool's own optional git init from leaving a nested
 *   repo inside a scratch temp dir).
 * - Architecture overlay: REAL. The actual `packs/next/architecture/standard/`
 *   content (`get-architecture-path.ts` resolution, unmodified).
 * - `inject-nockta-skills`: REAL LOCAL DIST, not a fixture. Since
 *   `inject-nockta-skills` is unpublished (Milestone 8's own "never `npm
 *   publish`" constraint), the real `npx inject-nockta-skills@latest` path
 *   is not reachable yet — `CREATE_NOCKTA_REPO_TEST_INJECT_BIN` points at
 *   the sibling package's own real built `dist/cli.js` instead (built in
 *   `beforeAll` only if missing, exactly like
 *   `test/create-skills.integration.test.ts`'s existing convention — never
 *   touches inject's source). The command spawned is otherwise byte-for-byte
 *   what production spawns (`core/run-inject-skills.ts::buildInjectSkillsCommand()`,
 *   unmodified) — the ONLY substitution is `node <local dist>` in place of
 *   `npx inject-nockta-skills@latest`.
 *
 * Scope: this proof (and this file) covers the "next" repo type as the
 * headline real-scaffolder run — decisions.md D6 requires "a real end-to-end
 * run", not one run per supported type; spec §16.3's own six-type matrix is
 * explicitly described as periodic/manual-or-scheduled CI, a broader
 * standing practice beyond what one milestone's acceptance proof needs to
 * automate. Extending this same pattern to the other five types (vite-react-
 * ts, nest, the three Shopify types) is straightforward — same shape, a
 * different `--type`/upstream command — and left as follow-on scaffolding
 * scope, not implemented here.
 *
 * Gated behind `RUN_REAL_SCAFFOLDER_TESTS=1` (checked at collection time via
 * `describe.skipIf`) so `pnpm test`/CI stays network-free and fast by
 * default — this is the ONLY test file in this package that touches the
 * network. Run explicitly with:
 *
 *   RUN_REAL_SCAFFOLDER_TESTS=1 pnpm exec vitest run test/real-scaffolder-acceptance.test.ts
 */

const RUN_REAL = process.env.RUN_REAL_SCAFFOLDER_TESTS === "1";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const distCliPath = path.join(packageRoot, "dist", "cli.js");
const injectRoot = path.join(packageRoot, "..", "inject-nockta-skills");
const injectDistCliPath = path.join(injectRoot, "dist", "cli.js");

describe.skipIf(!RUN_REAL)("REAL scaffolder acceptance proof (decisions.md D6, spec §16.3) — next", () => {
  let cwd: string;

  beforeAll(() => {
    execFileSync("pnpm", ["exec", "tsup"], { cwd: packageRoot, stdio: "pipe" });
    if (!existsSync(distCliPath)) {
      throw new Error(`Expected build output at ${distCliPath}, but it does not exist.`);
    }
    if (!existsSync(injectDistCliPath)) {
      execFileSync("pnpm", ["build"], { cwd: injectRoot, stdio: "pipe" });
    }
    if (!existsSync(injectDistCliPath)) {
      throw new Error(
        `Expected sibling package build output at ${injectDistCliPath}, but it does not exist even after building it.`,
      );
    }
    cwd = mkdtempSync(path.join(tmpdir(), "create-nockta-repo-real-acceptance-"));
  }, 120_000);

  afterAll(() => {
    if (cwd) rmSync(cwd, { recursive: true, force: true });
  });

  it(
    "real npx create-next-app@latest -> real architecture overlay -> real local inject-nockta-skills dist, end to end",
    () => {
      const env: NodeJS.ProcessEnv = { ...process.env };
      delete env.CREATE_NOCKTA_REPO_TEST_FIXTURE_BIN; // real upstream scaffolder — no fixture override.
      env.CREATE_NOCKTA_REPO_TEST_INJECT_BIN = injectDistCliPath; // real LOCAL inject dist — see file header.

      const start = Date.now();
      const result = spawnSync(
        process.execPath,
        [distCliPath, "acceptance-next-app", "--type", "next", "--adapters", "claude", "--yes", "--json", "--", "--yes", "--disable-git"],
        { cwd, env, encoding: "utf8", timeout: 300_000 },
      );
      const durationMs = Date.now() - start;

      // Proof-of-done evidence, printed unconditionally when this file actually runs.
      // eslint-disable-next-line no-console
      console.log(`[real-scaffolder-acceptance] exit=${result.status} wall-clock=${durationMs}ms cwd=${cwd}`);

      expect(result.signal).toBeNull();
      expect(result.status).toBe(0);

      // NOTE: unlike the fixture-scaffolder integration suites, this is NOT a
      // "D13 exactly one stdout line" assertion — `run-upstream.ts` spawns
      // the REAL `create-next-app` with `stdio: "inherit"` (by design — spec
      // §18.5/interactive-tool passthrough), so its own chatty npm-install
      // output (real `npm install` logs, real package counts) legitimately
      // shares this process's inherited stdout ahead of create-nockta-repo's
      // own single trailing `--json` line. D13's one-line guarantee is about
      // create-nockta-repo's OWN emitted output, not about a real, noisy
      // upstream tool's inherited stdio — the fixture scaffolders used
      // everywhere else in this suite are deliberately silent, which is what
      // makes the "exactly one line" assertion meaningful there.
      const lines = result.stdout.trim().split("\n").filter((line) => line.length > 0);
      const jsonLine = [...lines].reverse().find((line) => line.startsWith("{"));
      expect(jsonLine).toBeDefined();
      const parsed = JSON.parse(jsonLine as string) as Record<string, any>;

      expect(parsed.ok).toBe(true);
      expect(parsed.status).toBe("created");
      expect(parsed.upstream.ok).toBe(true);
      expect(parsed.upstream.exitCode).toBe(0);
      expect(parsed.officialScaffolder.command).toBe("npx");
      expect(parsed.officialScaffolder.args[0]).toBe("create-next-app@latest");

      // Architecture overlay really applied on top of the REAL create-next-app output.
      expect(parsed.architecture.status).toBe("applied");
      expect(parsed.architecture.preset).toBe("standard");
      expect(parsed.architectureChanges.created).toContain("src/components/ui");
      expect(parsed.architectureChanges.moved).toContain("src/app/page.tsx -> src/app/(public)/page.tsx");

      // Skills really injected via the real local inject dist.
      expect(parsed.skillsInjected).toBe(true);
      expect(parsed.skills.status).toBe("injected");
      expect(parsed.skills.installedPacks).toContain("common");

      // Repo profile really written.
      expect(parsed.metadata.status).toBe("written");

      const projectDir = path.join(cwd, "acceptance-next-app");

      // Tree highlights — real Next.js app files.
      expect(existsSync(path.join(projectDir, "package.json"))).toBe(true);
      expect(existsSync(path.join(projectDir, "next.config.ts"))).toBe(true);
      expect(existsSync(path.join(projectDir, "src", "app", "layout.tsx"))).toBe(true);
      expect(existsSync(path.join(projectDir, "node_modules", "next"))).toBe(true); // real npm install ran

      // Tree highlights — overlay dirs (real packs/next/architecture/standard content).
      expect(existsSync(path.join(projectDir, "src", "components", "ui"))).toBe(true);
      expect(existsSync(path.join(projectDir, "src", "features", "_template", "README.md"))).toBe(true);
      expect(existsSync(path.join(projectDir, "src", "app", "(public)", "page.tsx"))).toBe(true);

      // Tree highlights — .claude/* (real inject rendering).
      expect(existsSync(path.join(projectDir, ".claude", "agents", "worker.md"))).toBe(true);
      for (const skill of ["paper-trail", "proof-of-done", "subagent-delegation"]) {
        expect(existsSync(path.join(projectDir, ".claude", "skills", skill, "SKILL.md"))).toBe(true);
      }

      // Tree highlights — .nockta/* incl. repo-profile.json (both packages' own metadata).
      expect(existsSync(path.join(projectDir, ".nockta", "repo-profile.json"))).toBe(true);
      expect(existsSync(path.join(projectDir, ".nockta", "skills-profile.json"))).toBe(true);
      expect(existsSync(path.join(projectDir, ".nockta", "generated-manifest.json"))).toBe(true);

      const profile = JSON.parse(readFileSync(path.join(projectDir, ".nockta", "repo-profile.json"), "utf8"));
      expect(profile.tool).toBe("create-nockta-repo");
      // D22 (worker pass adding --also): repoTypes[] (was singular repoType).
      expect(profile.repoTypes).toEqual(["next"]);
      expect(profile.architecture).toBe("standard");
      expect(profile.isMonorepoTarget).toBe(false);
      expect(profile.skillsInjected).toBe(true);
      expect(profile.adapters).toEqual(["claude"]);
      expect(typeof profile.createdAt).toBe("string");

      // eslint-disable-next-line no-console
      console.log(`[real-scaffolder-acceptance] repo-profile.json: ${JSON.stringify(profile)}`);
    },
    300_000, // real npm install can take a while; generous per-test timeout.
  );
});
