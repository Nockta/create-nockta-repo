import { describe, expect, it } from "vitest";
import {
  NO_ARCHITECTURE_VALUE,
  SKILLS_VERSION_CUSTOM,
  SKILLS_VERSION_LATEST,
  buildAlsoTypesStep,
  buildArchitectureStep,
  buildConfirmStep,
  buildPackageManagerStep,
  buildRepoTypeStep,
  buildSkillsVersionStep,
  shouldAskPackageManager,
} from "../src/wizard/core/build-schema.js";
import { REPO_TYPES, REPO_TYPE_TITLES } from "../src/types/repo-type.js";

/**
 * The rebuilt wizard-core MODEL (decisions.md D28, genesis-only D29) — pure `StepModel` builders, no
 * prompts, no TTY. Mirrors inject's own `test/wizard-core.test.ts` convention. Genesis-only: there is
 * NO adapters step and NO skill/razor selection step here — those are inject's now.
 */

describe("genesis-only: the wizard core has no adapters/skills/razor steps", () => {
  it("build-schema exports ONLY genesis step builders — no buildAdapterStep / buildSkillsStep / buildRazorStep", async () => {
    const mod = await import("../src/wizard/core/build-schema.js");
    expect("buildAdapterStep" in mod).toBe(false);
    expect("buildSkillsStep" in mod).toBe(false);
    expect("buildRazorStep" in mod).toBe(false);
    // The genesis builders ARE present.
    for (const name of [
      "buildProjectPathStep",
      "buildRepoTypeStep",
      "buildAlsoTypesStep",
      "buildPackageManagerStep",
      "buildArchitectureStep",
      "buildSkillsVersionStep",
      "buildConfirmStep",
    ]) {
      expect(name in mod).toBe(true);
    }
  });
});

describe("buildRepoTypeStep — friendly titles + single-select", () => {
  it("lists every RepoType with its FRIENDLY title/description; raw enum stays in value", () => {
    const step = buildRepoTypeStep();
    expect(step.single).toBe(true);
    expect(step.kind).toBe("paginated-multiselect");
    expect(step.choices!.map((c) => c.value).sort()).toEqual([...REPO_TYPES].sort());
    for (const choice of step.choices!) {
      expect(choice.label).toBe(REPO_TYPE_TITLES[choice.value as keyof typeof REPO_TYPE_TITLES]);
      expect(choice.title).toBe(choice.label);
      expect(choice.description).toBeTruthy();
    }
    // Concrete friendly-title spot checks (brief item C).
    const byValue = new Map(step.choices!.map((c) => [c.value, c.label]));
    expect(byValue.get("next")).toBe("Next.js");
    expect(byValue.get("vite-react-ts")).toBe("Vite + React + TS");
    expect(byValue.get("nest")).toBe("NestJS");
    expect(byValue.get("shopify-headless")).toBe("Shopify Headless (Hydrogen)");
    expect(byValue.get("expo")).toBe("Expo");
  });

  it("reflects a prior selection as checked (back re-entry)", () => {
    const step = buildRepoTypeStep("nest");
    expect(step.choices!.find((c) => c.value === "nest")!.checked).toBe(true);
    expect(step.choices!.filter((c) => c.checked).length).toBe(1);
  });
});

describe("buildAlsoTypesStep — every OTHER type, multi-select", () => {
  it("offers every RepoType except the primary, as a multi-select (not single)", () => {
    const step = buildAlsoTypesStep("next");
    expect(step.single).toBeUndefined();
    const values = step.choices!.map((c) => c.value).sort();
    expect(values).toEqual([...REPO_TYPES].filter((t) => t !== "next").sort());
    expect(values).not.toContain("next");
  });

  it("reflects prior secondary selections as checked", () => {
    const step = buildAlsoTypesStep("next", ["vite-react-ts", "nest"]);
    const checked = step.choices!.filter((c) => c.checked).map((c) => c.value).sort();
    expect(checked).toEqual(["nest", "vite-react-ts"]);
  });
});

describe("buildPackageManagerStep / shouldAskPackageManager — record only", () => {
  it("asks for next/vite-react-ts/nest, not for Shopify/RN/Expo", () => {
    expect(shouldAskPackageManager("next")).toBe(true);
    expect(shouldAskPackageManager("vite-react-ts")).toBe(true);
    expect(shouldAskPackageManager("nest")).toBe(true);
    expect(shouldAskPackageManager("shopify-app")).toBe(false);
    expect(shouldAskPackageManager("react-native")).toBe(false);
    expect(shouldAskPackageManager("expo")).toBe(false);
  });

  it("defaults npm checked, single-select", () => {
    const step = buildPackageManagerStep();
    expect(step.single).toBe(true);
    expect(step.choices!.find((c) => c.checked)!.value).toBe("npm");
    expect(step.choices!.map((c) => c.value)).toEqual(["npm", "pnpm", "yarn", "bun"]);
  });
});

describe("buildArchitectureStep — real presets + none", () => {
  it("enumerates the real bundled presets for next, always offers a none/--no-arch choice, defaults to standard", () => {
    const step = buildArchitectureStep("next");
    const values = step.choices!.map((c) => c.value);
    expect(values).toContain("standard");
    expect(values).toContain(NO_ARCHITECTURE_VALUE);
    expect(step.single).toBe(true);
    expect(step.choices!.find((c) => c.checked)!.value).toBe("standard");
  });

  it("a prior --no-arch (false) reflects the none choice as checked", () => {
    const step = buildArchitectureStep("next", false);
    expect(step.choices!.find((c) => c.checked)!.value).toBe(NO_ARCHITECTURE_VALUE);
  });
});

describe("buildSkillsVersionStep — latest/custom (a create concern, kept — brief B)", () => {
  it("offers latest (default checked) and custom", () => {
    const step = buildSkillsVersionStep();
    expect(step.kind).toBe("skills-version");
    expect(step.choices!.map((c) => c.value)).toEqual([SKILLS_VERSION_LATEST, SKILLS_VERSION_CUSTOM]);
    expect(step.choices!.find((c) => c.checked)!.value).toBe(SKILLS_VERSION_LATEST);
  });

  it("a prior custom version checks the custom row and echoes the value", () => {
    const step = buildSkillsVersionStep("2.4.1");
    const custom = step.choices!.find((c) => c.value === SKILLS_VERSION_CUSTOM)!;
    expect(custom.checked).toBe(true);
    expect(custom.label).toContain("2.4.1");
  });
});

describe("buildConfirmStep — genesis preview preamble", () => {
  it("carries the preview text as preamble when given", () => {
    const step = buildConfirmStep("Genesis plan: ...");
    expect(step.kind).toBe("confirm");
    expect(step.preamble).toBe("Genesis plan: ...");
    expect(step.confirmDefault).toBe(true);
  });
});
