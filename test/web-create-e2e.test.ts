import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startCreateWebServer } from "../src/web/server.js";
import { buildWebProjectSchema } from "../src/web/project-schema.js";
import { emptyInjectSchema } from "../src/web/inject-schema.js";
import { renderCreateWebPage } from "../src/web/page.js";
import { runCreateWebSubmit } from "../src/web/run-create-web.js";
import type { CreateWebAnswers } from "../src/web/run-create-web.js";
import { buildInjectSkillsCommand } from "../src/core/run-inject-skills.js";

/**
 * create `--web` proof (decisions.md D30, the create half) WITHOUT a real browser (proof-of-done):
 *   - GET /inject-schema spawns the REAL built inject `wizard --emit-schema` (via the test-override)
 *     and returns its schema (next pack + razor categories); wrong/no token -> 403.
 *   - GET / serves the two-section page (Project + Skills) with the token embedded.
 *   - POST /submit runs create's REAL pipeline (scaffolder fixture + architecture overlay + REAL
 *     headless inject install with the web-collected skill deltas) into a temp target.
 * Also a pure unit-level assert that the skill deltas reach inject's `--include-skills`/`--exclude-skills`.
 */

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const fixturesRoot = path.join(packageRoot, "fixtures", "scaffolders");
const fakeNextBin = path.join(fixturesRoot, "fake-next", "index.mjs");
const injectRoot = path.join(packageRoot, "..", "inject-nockta-skills");
const injectDistCliPath = path.join(injectRoot, "dist", "cli.js");

// This suite drives create's web layer straight from `src/` (no create dist needed) and only spawns
// the REAL built inject CLI via the test-override. So it builds ONLY inject's dist, and only if it's
// missing — never a force-rebuild that would race the other integration suite's own dist rebuild.
beforeAll(() => {
  if (!existsSync(injectDistCliPath)) {
    execFileSync("pnpm", ["build"], { cwd: injectRoot, stdio: "pipe" });
  }
  if (!existsSync(injectDistCliPath)) throw new Error(`Expected sibling build at ${injectDistCliPath}`);
}, 180_000);

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "create-web-e2e-"));
  process.env.CREATE_NOCKTA_REPO_TEST_INJECT_BIN = injectDistCliPath;
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  delete process.env.CREATE_NOCKTA_REPO_TEST_INJECT_BIN;
  delete process.env.CREATE_NOCKTA_REPO_TEST_FIXTURE_BIN;
});

function startServer(runPipeline: (a: CreateWebAnswers) => Promise<{ ok: boolean; exitCode: number; projectPath: string }>) {
  return startCreateWebServer({
    project: buildWebProjectSchema(),
    initialSkills: emptyInjectSchema(),
    runPipeline,
  });
}

describe("skill deltas reach inject's include/exclude flags (brief item 4)", () => {
  it("forwards --include-skills / --exclude-skills in the built install argv", () => {
    const built = buildInjectSkillsCommand({
      mode: "standalone",
      repoType: "next",
      repoTypes: ["next"],
      adapters: ["claude"],
      includeSkills: ["bounded-diff", "map-the-blast-radius"],
      excludeSkills: ["some-default"],
      cwd,
    });
    expect(built.args).toContain("--include-skills");
    expect(built.args).toContain("bounded-diff,map-the-blast-radius");
    expect(built.args).toContain("--exclude-skills");
    expect(built.args).toContain("some-default");
  });

  it("emits NO include/exclude flag when the deltas are empty (every pre-web caller unaffected)", () => {
    const built = buildInjectSkillsCommand({ mode: "standalone", repoType: "next", adapters: ["claude"], cwd });
    expect(built.args).not.toContain("--include-skills");
    expect(built.args).not.toContain("--exclude-skills");
    expect(built.commandLine).toContain("install --type next --adapters claude --yes --json");
  });
});

describe("GET /inject-schema (reactive Skills-section source, spawns real inject emit-schema)", () => {
  it("types=next -> inject's schema with the next pack + Domain: Next.js razor category", async () => {
    const handle = await startServer(async (a) => ({ ok: true, exitCode: 0, projectPath: a.projectPath }));
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/inject-schema?t=${handle.token}&types=next&adapters=claude`);
      expect(res.status).toBe(200);
      const schema = await res.json();
      const stepIds = schema.steps.map((s: { id: string }) => s.id);
      expect(stepIds).toContain("adapters");
      expect(stepIds).toContain("skills");
      expect(stepIds).toContain("razor");
      const skills = schema.steps.find((s: { id: string }) => s.id === "skills");
      const packs = [...new Set(skills.choices.map((c: { pack: string }) => c.pack))];
      expect(packs).toContain("common");
      expect(packs).toContain("next");
      const razor = schema.steps.find((s: { id: string }) => s.id === "razor");
      const razorLabels = razor.sections.map((s: { label: string }) => s.label);
      expect(razorLabels).toContain("Domain: Next.js");
    } finally {
      await handle.close();
    }
  });

  it("empty types -> empty-skills marker (no spawn, page shows placeholder)", async () => {
    const handle = await startServer(async (a) => ({ ok: true, exitCode: 0, projectPath: a.projectPath }));
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/inject-schema?t=${handle.token}&types=`);
      expect(res.status).toBe(200);
      const schema = await res.json();
      expect(schema.steps).toEqual([]);
    } finally {
      await handle.close();
    }
  });

  it("wrong/missing token -> 403", async () => {
    const handle = await startServer(async (a) => ({ ok: true, exitCode: 0, projectPath: a.projectPath }));
    try {
      expect((await fetch(`http://127.0.0.1:${handle.port}/inject-schema?types=next`)).status).toBe(403);
      expect((await fetch(`http://127.0.0.1:${handle.port}/inject-schema?t=deadbeef&types=next`)).status).toBe(403);
    } finally {
      await handle.close();
    }
  });
});

describe("GET / serves the two-section page", () => {
  it("embeds both section bands and the token", async () => {
    const handle = await startServer(async (a) => ({ ok: true, exitCode: 0, projectPath: a.projectPath }));
    try {
      const res = await fetch(handle.url);
      expect(res.status).toBe(200);
      const html = await res.text();
      // The two section bands are built client-side from these exact string literals.
      expect(html).toContain('el("h2", null, "Project")');
      expect(html).toContain('el("h2", null, "Skills")');
      expect(html).toContain('"repo-type"');
      expect(html).toContain(handle.token);
    } finally {
      await handle.close();
    }
  });

  it("rejects GET / without the token (403)", async () => {
    const handle = await startServer(async (a) => ({ ok: true, exitCode: 0, projectPath: a.projectPath }));
    try {
      expect((await fetch(`http://127.0.0.1:${handle.port}/`)).status).toBe(403);
    } finally {
      await handle.close();
    }
  });
});

describe("POST /submit runs create's REAL pipeline (scaffold + overlay + headless inject with deltas)", () => {
  it("scaffolds, applies the overlay, installs skills incl. a forwarded razor delta, exit ok", async () => {
    process.env.CREATE_NOCKTA_REPO_TEST_FIXTURE_BIN = fakeNextBin;
    // Headless-scaffolder CI=true fix, --web submit path (run-create-web.ts::answersToCliOptions()
    // always sets `yes: true`): delete the ambient CI first so the assertion below can't pass
    // vacuously just because this suite happens to run under CI=true already.
    const originalCI = process.env.CI;
    delete process.env.CI;
    const handle = await startCreateWebServer({
      project: buildWebProjectSchema(),
      initialSkills: emptyInjectSchema(),
      runPipeline: (answers) => runCreateWebSubmit(answers, { cwd, json: true }),
    });

    const answers: CreateWebAnswers = {
      projectPath: "my-app",
      repoType: "next",
      alsoTypes: [],
      packageManager: "npm",
      architecture: "standard",
      adapters: ["claude"],
      skills: { excluded: [], included: [] },
      razor: { excluded: [], included: ["bounded-diff"] },
      confirmed: true,
    };

    try {
      const resultPromise = handle.waitForResult();
      const res = await fetch(`http://127.0.0.1:${handle.port}/submit?t=${handle.token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: handle.token, answers }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.result.exitCode).toBe(0);

      const result = await resultPromise;
      expect(result.ok).toBe(true);

      const projectDir = path.join(cwd, "my-app");
      // Upstream fixture ran.
      expect(existsSync(path.join(projectDir, ".fixture-marker.json"))).toBe(true);
      // Headless-scaffolder CI=true fix: the --web submit path forces CI=true onto the real
      // spawned scaffolder's env (run-upstream.ts's forceCI, wired from cliOptions.yes which
      // answersToCliOptions() always sets true) — this is the verified bug's actual fix, proven
      // end to end through the real HTTP submit, not just the runUpstream unit.
      const marker = JSON.parse(readFileSync(path.join(projectDir, ".fixture-marker.json"), "utf8"));
      expect(marker.env.CI).toBe("true");
      // Architecture overlay applied.
      expect(existsSync(path.join(projectDir, "src", "components", "ui"))).toBe(true);
      // Skills installed for real (common required skills + the forwarded razor delta).
      for (const skill of ["paper-trail", "proof-of-done", "subagent-delegation"]) {
        expect(existsSync(path.join(projectDir, ".claude", "skills", skill, "SKILL.md"))).toBe(true);
      }
      expect(existsSync(path.join(projectDir, ".claude", "skills", "bounded-diff", "SKILL.md"))).toBe(true);
      // create's own profile + inject's profile both landed.
      expect(existsSync(path.join(projectDir, ".nockta", "repo-profile.json"))).toBe(true);
      const injectProfile = JSON.parse(readFileSync(path.join(projectDir, ".nockta", "skills-profile.json"), "utf8"));
      expect(injectProfile.repoTypes).toEqual(["next"]);
      expect(injectProfile.installedAdapters).toEqual(["claude"]);
    } finally {
      await handle.close();
      if (originalCI === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = originalCI;
      }
    }
  }, 60_000);
});
