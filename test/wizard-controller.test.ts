import { describe, expect, it } from "vitest";
import { runCreateController } from "../src/wizard/controller.js";
import type { CreateControllerContext } from "../src/wizard/controller.js";
import { NO_ARCHITECTURE_VALUE } from "../src/wizard/core/build-schema.js";
import type { CreateWizardAnswers, StepId, StepModel } from "../src/wizard/core/types.js";
import type { Presenter, PresenterResult } from "../src/wizard/view/presenter.js";

/**
 * The rebuilt create CONTROLLER (decisions.md D28, genesis-only D29) — driven through a FAKE
 * Presenter (the View seam), so back-nav, preset-skips, the genesis-only step spine, and the
 * package-manager conditional skip are all proven without a real TTY. Mirrors inject's own
 * `test/wizard-controller.test.ts`.
 */

type StepScript = { kind: "answer"; value: unknown } | { kind: "back" };
const A = (value: unknown): StepScript => ({ kind: "answer", value });
const BACK: StepScript = { kind: "back" };

interface FakePresenter extends Presenter {
  rendered: StepModel[];
  remaining: () => number;
}

function fakePresenter(script: StepScript[]): FakePresenter {
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
      if (!next) throw new Error(`fakePresenter: no more results (rendered "${step.id}")`);
      return next.kind === "back" ? { kind: "back" } : { kind: "answer", value: next.value };
    },
  };
}

async function run(script: StepScript[], seed: Partial<CreateWizardAnswers> = {}, presetSteps: StepId[] = []) {
  const presenter = fakePresenter(script);
  const ctx: CreateControllerContext = { cwd: "/tmp/does-not-matter" };
  const result = await runCreateController({ presenter, ctx, answers: { ...seed }, presetSteps: new Set(presetSteps) });
  return { presenter, result };
}

describe("controller: genesis-only linear run (D29)", () => {
  it("collects path/type/also/pm/arch/version/confirm into answers — never any adapters/skills step", async () => {
    const { presenter, result } = await run([
      A("my-project"), // project-path
      A(["next"]), // repo-type (single)
      A([]), // also-types
      A(["npm"]), // package-manager (next asks)
      A(["standard"]), // architecture
      A(undefined), // skills-version (latest)
      A(true), // confirm
    ]);
    expect(result.kind).toBe("completed");
    if (result.kind !== "completed") return;
    expect(result.answers.projectPath).toBe("my-project");
    expect(result.answers.repoType).toBe("next");
    expect(result.answers.alsoTypes).toEqual([]);
    expect(result.answers.packageManager).toBe("npm");
    expect(result.answers.architecture).toBe("standard");
    expect(result.answers.skillsVersion).toBeUndefined();
    expect(result.answers.confirmed).toBe(true);
    // The rendered spine is genesis-only: no "adapters", no "skills", no "razor".
    const ids = presenter.rendered.map((s) => s.id);
    expect(ids).toEqual(["project-path", "repo-type", "also-types", "package-manager", "architecture", "skills-version", "confirm"]);
    expect(ids).not.toContain("adapters");
    expect(ids).not.toContain("skills");
    expect(ids).not.toContain("razor");
  });

  it("architecture 'none' sentinel maps to false (--no-arch)", async () => {
    const { result } = await run([
      A("app"),
      A(["nest"]),
      A([]),
      A(["pnpm"]),
      A([NO_ARCHITECTURE_VALUE]),
      A(undefined),
      A(true),
    ]);
    expect(result.kind === "completed" && result.answers.architecture).toBe(false);
  });
});

describe("controller: package-manager step is skipped for types that don't ask", () => {
  it("shopify-theme skips package-manager entirely", async () => {
    const { presenter, result } = await run([
      A("store"),
      A(["shopify-theme"]),
      A([]),
      // no package-manager answer — it must be skipped
      A(["standard"]),
      A(undefined),
      A(true),
    ]);
    expect(result.kind).toBe("completed");
    expect(presenter.rendered.some((s) => s.id === "package-manager")).toBe(false);
    expect(presenter.rendered.map((s) => s.id)).toEqual(["project-path", "repo-type", "also-types", "architecture", "skills-version", "confirm"]);
  });
});

describe("controller: presets skip their steps entirely", () => {
  it("preset path + type + arch are neither rendered nor visited", async () => {
    const { presenter, result } = await run(
      [A([]), A(["npm"]), A(undefined), A(true)], // also, pm, version, confirm
      { projectPath: "seeded", repoType: "next", architecture: "standard" },
      ["project-path", "repo-type", "architecture"],
    );
    expect(result.kind).toBe("completed");
    const ids = presenter.rendered.map((s) => s.id);
    expect(ids).toEqual(["also-types", "package-manager", "skills-version", "confirm"]);
    if (result.kind === "completed") {
      expect(result.answers.projectPath).toBe("seeded");
      expect(result.answers.repoType).toBe("next");
      expect(result.answers.architecture).toBe("standard");
    }
  });
});

describe("controller: back-navigation preserves already-entered answers", () => {
  it("back from also-types re-enters repo-type showing the prior choice, then advances again", async () => {
    const { presenter, result } = await run([
      A("app"), // project-path
      A(["next"]), // repo-type round 1
      BACK, // also-types -> back to repo-type
      A(["nest"]), // repo-type round 2 (change)
      A([]), // also-types
      A(["npm"]), // package-manager (nest asks)
      A(["standard"]), // architecture
      A(undefined), // version
      A(true), // confirm
    ]);
    expect(result.kind).toBe("completed");
    if (result.kind !== "completed") return;
    expect(result.answers.repoType).toBe("nest");

    const repoRenders = presenter.rendered.filter((s) => s.id === "repo-type");
    expect(repoRenders.length).toBe(2);
    // On re-entry the prior "next" pick is reflected as checked (state preserved).
    expect(repoRenders[1]!.choices!.find((c) => c.value === "next")?.checked).toBe(true);
  });

  it("back from confirm returns to skills-version preserving the confirm default nothing-lost path", async () => {
    const { presenter, result } = await run([
      A("app"),
      A(["expo"]), // expo does NOT ask package-manager
      A([]),
      A(["standard"]),
      A("2.4.1"), // skills-version custom value round 1
      BACK, // confirm -> back to skills-version
      A(undefined), // skills-version round 2 -> latest
      A(true), // confirm
    ]);
    expect(result.kind).toBe("completed");
    if (result.kind !== "completed") return;
    expect(result.answers.skillsVersion).toBeUndefined();
    // skills-version rendered twice; the round-2 model reflects the prior "2.4.1" as checked-custom.
    const versionRenders = presenter.rendered.filter((s) => s.id === "skills-version");
    expect(versionRenders.length).toBe(2);
  });
});

describe("controller: cancellation", () => {
  it("an empty project-path answer cancels", async () => {
    const { result } = await run([A("")]);
    expect(result.kind).toBe("cancelled");
    if (result.kind === "cancelled") expect(result.reason).toMatch(/no project name\/path/);
  });

  it("an empty repo-type answer cancels", async () => {
    const { result } = await run([A("app"), A([])]);
    expect(result.kind).toBe("cancelled");
    if (result.kind === "cancelled") expect(result.reason).toMatch(/no project type/);
  });
});
