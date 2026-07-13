import { describe, expect, it } from "vitest";
import { ADAPTER_TYPES, REPO_TYPES } from "../src/index.js";
import type { AdapterType, CreateNocktaRepoOptions, RepoType } from "../src/index.js";

describe("RepoType / AdapterType local mirrors (spec §11.1, §11.2)", () => {
  it("matches the MVP RepoType union exactly", () => {
    expect([...REPO_TYPES].sort()).toEqual(
      [
        "next",
        "vite-react-ts",
        "nest",
        "shopify-app",
        "shopify-theme",
        "shopify-headless",
        "react-native",
        "expo",
      ].sort(),
    );
  });

  it("matches the AdapterType union exactly", () => {
    expect([...ADAPTER_TYPES].sort()).toEqual(["claude", "cursor", "copilot", "agent", "antigravity"].sort());
  });

  it("accepts a well-formed CreateNocktaRepoOptions (spec §11.3)", () => {
    const repoType: RepoType = "next";
    const adapters: AdapterType[] = ["claude", "cursor"];

    const options: CreateNocktaRepoOptions = {
      projectNameOrPath: "apps/web",
      repoType,
      architecture: "standard",
      adapters,
      skillsVersion: "2.4.1",
      passthroughArgs: ["--tailwind"],
      dryRun: false,
      yes: true,
      force: false,
      installSkills: true,
      applyArchitecture: true,
      monorepoTarget: true,
    };

    expect(options.repoType).toBe("next");
    expect(options.skillsVersion).toBe("2.4.1");
  });
});
