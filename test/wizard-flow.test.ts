import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runCreateWizard, runWizardFlow } from "../src/wizard/run-create-wizard.js";
import type { StepModel } from "../src/wizard/core/types.js";
import type { Presenter, PresenterResult } from "../src/wizard/view/presenter.js";
import { INJECT_BIN_OVERRIDE_ENV_VAR } from "../src/core/run-inject-skills.js";

/**
 * Full create-wizard coverage (decisions.md D28/D29) driven by a scripted PRESENTER (the View seam)
 * — no real TTY, no real @inquirer prompt. Mirrors inject's own `test/wizard-flow.test.ts`.
 *
 * Genesis-only (D29): the wizard collects path/type/also/package-manager/architecture/version, then
 * confirms — NO adapters step, NO skill selection. Step 11 is the SAME `runCreateCommand()`, and
 * because the wizard calls it WITHOUT `--yes`, it takes D29's INTERACTIVE inject handoff: create
 * scaffolds + overlays, then spawns inject's own wizard (here: a local fixture bin via the
 * CREATE_NOCKTA_REPO_TEST_INJECT_BIN override, brief item E) with INHERITED stdio and the type
 * PRE-FILLED — never `--yes`/`--json`.
 */

type StepScript = { kind: "answer"; value: unknown } | { kind: "back" };
const A = (value: unknown): StepScript => ({ kind: "answer", value });

interface ScriptedPresenter extends Presenter {
  rendered: StepModel[];
  remaining: () => number;
}

function scriptedPresenter(script: StepScript[]): ScriptedPresenter {
  const queue = [...script];
  const rendered: StepModel[] = [];
  return {
    rendered,
    remaining: () => queue.length,
    clear() {},
    close() {},
    async renderStep(step: StepModel): Promise<PresenterResult> {
      rendered.push(step);
      const next = queue.shift();
      if (!next) throw new Error(`scriptedPresenter: no more answers (rendered "${step.id}")`);
      return next.kind === "back" ? { kind: "back" } : { kind: "answer", value: next.value };
    },
  };
}

function noopLog(): void {}

// --- Fixture inject "interactive wizard" stand-in (local, never real npx). ---
// It stands in for `inject-nockta-skills install --type <...>` running INTERACTIVELY: it reads NO
// stdin, records the argv it received (to prove the D29 handoff shape — no --yes/--json), writes the
// .nockta files inject itself would, and exits 0.

const scratchRoot = mkdtempSync(path.join(tmpdir(), "create-wizard-fixtures-"));
const injectInteractiveBin = path.join(scratchRoot, "fake-inject-interactive.mjs");
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const fakeNextBin = path.join(packageRoot, "fixtures", "scaffolders", "fake-next", "index.mjs");

beforeAll(() => {
  mkdirSync(scratchRoot, { recursive: true });
  writeFileSync(
    injectInteractiveBin,
    `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const argv = process.argv.slice(2);
const typeIdx = argv.indexOf("--type");
const targetIdx = argv.indexOf("--target");
const isMonorepo = targetIdx !== -1;
const requested = isMonorepo ? argv[targetIdx + 1] : argv[typeIdx + 1];
const cwd = process.cwd();
const nocktaDir = path.join(cwd, ".nockta");
mkdirSync(nocktaDir, { recursive: true });
// Prove the D29 handoff shape: record the exact argv (test asserts no --yes/--json, type present).
writeFileSync(path.join(nocktaDir, "inject-argv.json"), JSON.stringify(argv));
writeFileSync(
  path.join(nocktaDir, "skills-profile.json"),
  JSON.stringify({ tool: "inject-nockta-skills", version: "9.9.9-wizard-fixture", isMonorepo, requested }),
);
if (isMonorepo) {
  writeFileSync(path.join(nocktaDir, "targets.json"), JSON.stringify({ isMonorepo: true, targets: [] }));
}
process.exit(0);
`,
  );
});

afterAll(() => {
  rmSync(scratchRoot, { recursive: true, force: true });
});

let cwd: string;
let savedInject: string | undefined;

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "create-wizard-"));
  savedInject = process.env[INJECT_BIN_OVERRIDE_ENV_VAR];
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  if (savedInject === undefined) delete process.env[INJECT_BIN_OVERRIDE_ENV_VAR];
  else process.env[INJECT_BIN_OVERRIDE_ENV_VAR] = savedInject;
  delete process.env.CREATE_NOCKTA_REPO_TEST_FIXTURE_BIN;
});

describe("runWizardFlow — genesis-only happy path (D29)", () => {
  it("collects genesis steps, previews, confirms, returns would-create with adapters-free cliOptions", async () => {
    const presenter = scriptedPresenter([
      A("my-project"), // project-path
      A(["next"]), // repo-type
      A([]), // also-types
      A(["npm"]), // package-manager
      A(["standard"]), // architecture
      A(undefined), // skills-version (latest)
      A(true), // confirm
    ]);
    const result = await runWizardFlow({ presenter, log: noopLog, cwd });
    expect(result.kind).toBe("would-create");
    if (result.kind !== "would-create") return;
    expect(result.projectNameOrPath).toBe("my-project");
    expect(result.cliOptions.type).toBe("next");
    expect(result.cliOptions.arch).toBe("standard");
    expect(result.cliOptions.skillsVersion).toBeUndefined();
    // Genesis-only: create's wizard NEVER produces an adapters value or a --yes.
    expect((result.cliOptions as { adapters?: unknown }).adapters).toBeUndefined();
    expect((result.cliOptions as { yes?: unknown }).yes).toBeUndefined();
    // No adapters/skills step was ever rendered.
    const ids = presenter.rendered.map((s) => s.id);
    expect(ids).not.toContain("adapters");
    expect(ids).not.toContain("skills");
    expect(presenter.remaining()).toBe(0);
  });
});

describe("runCreateWizard — step 11 runs, D29 INTERACTIVE handoff spawns inject (inherited stdio, type pre-filled)", () => {
  it("scaffolds + overlays, then hands off to inject's wizard (no --yes/--json), writes the repo profile", async () => {
    process.env[INJECT_BIN_OVERRIDE_ENV_VAR] = injectInteractiveBin;
    process.env.CREATE_NOCKTA_REPO_TEST_FIXTURE_BIN = fakeNextBin;
    const presenter = scriptedPresenter([
      A("my-project"),
      A(["next"]),
      A([]),
      A(["npm"]),
      A(["standard"]),
      A(undefined),
      A(true),
    ]);
    await runCreateWizard({ presenter, log: noopLog, cwd });

    const projectDir = path.join(cwd, "my-project");
    expect(existsSync(path.join(projectDir, ".fixture-marker.json"))).toBe(true); // upstream ran
    expect(existsSync(path.join(projectDir, "src", "components", "ui"))).toBe(true); // overlay applied
    expect(existsSync(path.join(projectDir, ".nockta", "skills-profile.json"))).toBe(true); // inject ran

    // The D29 handoff argv: type pre-filled, and NO --yes / --json (interactive, not headless).
    const argv = JSON.parse(readFileSync(path.join(projectDir, ".nockta", "inject-argv.json"), "utf8")) as string[];
    expect(argv).toContain("install");
    expect(argv).toContain("--type");
    expect(argv[argv.indexOf("--type") + 1]).toBe("next");
    expect(argv).not.toContain("--yes");
    expect(argv).not.toContain("--json");
    expect(argv).not.toContain("--adapters");

    const profile = JSON.parse(readFileSync(path.join(projectDir, ".nockta", "repo-profile.json"), "utf8"));
    expect(profile.tool).toBe("create-nockta-repo");
    expect(profile.repoTypes).toEqual(["next"]);
    expect(profile.skillsInjected).toBe(true);
    // skillsVersion read best-effort from inject's own written profile (no captured --json in D29 interactive).
    expect(profile.skillsVersion).toBe("9.9.9-wizard-fixture");
    expect(profile.isMonorepoTarget).toBe(false);
  });
});

describe("runCreateWizard — secondary skill domains (--also, D22) flow through the handoff union", () => {
  it("picking a secondary type forwards --type next,vite-react-ts to inject and records the full union", async () => {
    process.env[INJECT_BIN_OVERRIDE_ENV_VAR] = injectInteractiveBin;
    process.env.CREATE_NOCKTA_REPO_TEST_FIXTURE_BIN = fakeNextBin;
    const presenter = scriptedPresenter([
      A("my-project"),
      A(["next"]), // primary
      A(["vite-react-ts"]), // secondary
      A(["npm"]),
      A(["standard"]),
      A(undefined),
      A(true),
    ]);
    await runCreateWizard({ presenter, log: noopLog, cwd });

    const projectDir = path.join(cwd, "my-project");
    const argv = JSON.parse(readFileSync(path.join(projectDir, ".nockta", "inject-argv.json"), "utf8")) as string[];
    // Standalone union is comma-joined on --type (inject's own separator for the flag form).
    expect(argv[argv.indexOf("--type") + 1]).toBe("next,vite-react-ts");
    const profile = JSON.parse(readFileSync(path.join(projectDir, ".nockta", "repo-profile.json"), "utf8"));
    expect(profile.repoTypes).toEqual(["next", "vite-react-ts"]);
  });
});

describe("runCreateWizard — monorepo target (D5, D29 handoff form --target <path>:<type>)", () => {
  it("creates the target, hands off inject at the root with the --target form, writes the target's own profile", async () => {
    writeFileSync(path.join(cwd, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
    process.env[INJECT_BIN_OVERRIDE_ENV_VAR] = injectInteractiveBin;
    process.env.CREATE_NOCKTA_REPO_TEST_FIXTURE_BIN = fakeNextBin;
    const presenter = scriptedPresenter([
      A("apps/web"),
      A(["next"]),
      A([]),
      A(["npm"]),
      A(["standard"]),
      A(undefined),
      A(true),
    ]);
    await runCreateWizard({ presenter, log: noopLog, cwd });

    const targetDir = path.join(cwd, "apps", "web");
    expect(existsSync(path.join(targetDir, ".fixture-marker.json"))).toBe(true);
    // Monorepo handoff runs inject at the ROOT with the --target form (D5/D29).
    const argv = JSON.parse(readFileSync(path.join(cwd, ".nockta", "inject-argv.json"), "utf8")) as string[];
    expect(argv).toContain("--target");
    expect(argv[argv.indexOf("--target") + 1]).toBe("apps/web:next");
    expect(argv).not.toContain("--yes");
    // create's OWN repo-profile lands at the TARGET, never the root (D5).
    expect(existsSync(path.join(cwd, ".nockta", "repo-profile.json"))).toBe(false);
    const profile = JSON.parse(readFileSync(path.join(targetDir, ".nockta", "repo-profile.json"), "utf8"));
    expect(profile.isMonorepoTarget).toBe(true);
    expect(profile.projectPath).toBe("apps/web");
  });
});

describe("runWizardFlow — declined confirm creates nothing", () => {
  it("returns cancelled and never scaffolds when the user declines", async () => {
    const presenter = scriptedPresenter([
      A("my-project"),
      A(["next"]),
      A([]),
      A(["npm"]),
      A(["standard"]),
      A(undefined),
      A(false), // decline
    ]);
    const result = await runWizardFlow({ presenter, log: noopLog, cwd });
    expect(result.kind).toBe("cancelled");
    expect(existsSync(path.join(cwd, "my-project"))).toBe(false);
  });
});
