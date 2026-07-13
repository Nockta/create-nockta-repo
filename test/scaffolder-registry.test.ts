import { describe, expect, it } from "vitest";
import {
  SCAFFOLDER_REGISTRY,
  UnknownRepoTypeError,
  listScaffolders,
  resolveScaffolder,
} from "../src/scaffolders/registry.js";
import { upstreamOptionDefaults } from "../src/scaffolders/upstream-options.js";
import { REPO_TYPES } from "../src/types/repo-type.js";

describe("scaffolder registry completeness (spec §11.1, §10 src/scaffolders/)", () => {
  it("resolves every MVP RepoType", () => {
    for (const repoType of REPO_TYPES) {
      const def = resolveScaffolder(repoType);
      expect(def.repoType).toBe(repoType);
    }
  });

  it("listScaffolders returns exactly the eight MVP repo types, in RepoType order", () => {
    const listed = listScaffolders().map((def) => def.repoType);
    expect(listed).toEqual([...REPO_TYPES]);
  });

  it("SCAFFOLDER_REGISTRY has exactly the eight MVP repo types as keys", () => {
    expect(Object.keys(SCAFFOLDER_REGISTRY).sort()).toEqual([...REPO_TYPES].sort());
  });

  it("throws a structured UnknownRepoTypeError for an unknown repo type", () => {
    expect(() => resolveScaffolder("django")).toThrow(UnknownRepoTypeError);
    try {
      resolveScaffolder("django");
      expect.unreachable("resolveScaffolder should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownRepoTypeError);
      const err = error as UnknownRepoTypeError;
      expect(err.repoType).toBe("django");
      expect([...err.knownRepoTypes].sort()).toEqual([...REPO_TYPES].sort());
      expect(err.message).toContain("django");
      expect(err.message).toContain("next");
    }
  });

  it("throws UnknownRepoTypeError for an empty string", () => {
    expect(() => resolveScaffolder("")).toThrow(UnknownRepoTypeError);
  });
});

describe("per-type command/args (spec §3.2-3.7, §9.2 officialScaffolder shape)", () => {
  it("next: npx create-next-app@latest <path>", () => {
    const cmd = resolveScaffolder("next").buildCommand("apps/web");
    expect(cmd).toEqual({
      name: "create-next-app",
      command: "npx",
      args: ["create-next-app@latest", "apps/web"],
    });
  });

  it("vite-react-ts: npm create vite@latest <path> -- --template react-ts", () => {
    const cmd = resolveScaffolder("vite-react-ts").buildCommand("apps/web");
    expect(cmd).toEqual({
      name: "create-vite",
      command: "npm",
      args: ["create", "vite@latest", "apps/web", "--", "--template", "react-ts"],
    });
  });

  it("nest: npx @nestjs/cli new <path>", () => {
    const cmd = resolveScaffolder("nest").buildCommand("apps/api");
    expect(cmd).toEqual({
      name: "@nestjs/cli",
      command: "npx",
      args: ["@nestjs/cli", "new", "apps/api"],
    });
  });

  it("shopify-app: shopify app init --path <path>", () => {
    const cmd = resolveScaffolder("shopify-app").buildCommand("apps/shop");
    expect(cmd).toEqual({
      name: "shopify-cli",
      command: "shopify",
      args: ["app", "init", "--path", "apps/shop"],
    });
  });

  it("shopify-theme: shopify theme init <path>", () => {
    const cmd = resolveScaffolder("shopify-theme").buildCommand("apps/theme");
    expect(cmd).toEqual({
      name: "shopify-cli",
      command: "shopify",
      args: ["theme", "init", "apps/theme"],
    });
  });

  it("shopify-headless: provisional, isolated entry", () => {
    const def = resolveScaffolder("shopify-headless");
    expect(def.provisional).toBe(true);
    const cmd = def.buildCommand("apps/storefront");
    expect(cmd.command).toBe("npm");
    expect(cmd.args).toContain("apps/storefront");
  });

  it("shopify-headless: npm create @shopify/hydrogen@latest -- --path <path> (F2 fix)", () => {
    const cmd = resolveScaffolder("shopify-headless").buildCommand("apps/storefront");
    expect(cmd).toEqual({
      name: "create-hydrogen (provisional)",
      command: "npm",
      args: ["create", "@shopify/hydrogen@latest", "--", "--path", "apps/storefront"],
    });
  });

  it("Shopify entries mark interactiveStdio (spec §18.5)", () => {
    expect(resolveScaffolder("shopify-app").interactiveStdio).toBe(true);
    expect(resolveScaffolder("shopify-theme").interactiveStdio).toBe(true);
    expect(resolveScaffolder("shopify-headless").interactiveStdio).toBe(true);
  });

  it("non-Shopify entries do not require interactive stdio", () => {
    expect(resolveScaffolder("next").interactiveStdio).toBe(false);
    expect(resolveScaffolder("vite-react-ts").interactiveStdio).toBe(false);
    expect(resolveScaffolder("nest").interactiveStdio).toBe(false);
    expect(resolveScaffolder("react-native").interactiveStdio).toBe(false);
    expect(resolveScaffolder("expo").interactiveStdio).toBe(false);
  });

  it("react-native/expo are NOT provisional (decisions.md D25 — both commands verified against primary sources)", () => {
    expect(resolveScaffolder("react-native").provisional).toBeFalsy();
    expect(resolveScaffolder("expo").provisional).toBe(false);
  });
});

describe("react-native / expo commands (decisions.md D25)", () => {
  it("expo: npx create-expo-app@latest <path> --yes --no-install --template default@sdk-57 --no-agents-md", () => {
    const cmd = resolveScaffolder("expo").buildCommand("apps/mobile");
    expect(cmd).toEqual({
      name: "create-expo-app",
      command: "npx",
      args: [
        "create-expo-app@latest",
        "apps/mobile",
        "--yes",
        "--no-install",
        "--template",
        "default@sdk-57",
        "--no-agents-md",
      ],
    });
  });

  it("expo appends passthrough args after --no-agents-md", () => {
    const cmd = resolveScaffolder("expo").buildCommand("apps/mobile", ["--example", "with-router"]);
    expect(cmd.args).toEqual([
      "create-expo-app@latest",
      "apps/mobile",
      "--yes",
      "--no-install",
      "--template",
      "default@sdk-57",
      "--no-agents-md",
      "--example",
      "with-router",
    ]);
  });

  it("react-native: npx @react-native-community/cli@latest init <Name> --directory <path> --skip-install --skip-git-init true", () => {
    const cmd = resolveScaffolder("react-native").buildCommand("apps/mobile-app");
    expect(cmd).toEqual({
      name: "@react-native-community/cli",
      command: "npx",
      args: [
        "@react-native-community/cli@latest",
        "init",
        "MobileApp",
        "--directory",
        "apps/mobile-app",
        "--skip-install",
        "--skip-git-init",
        "true",
      ],
    });
  });

  it("react-native derives the positional Name from the target path's basename, PascalCased", () => {
    expect(resolveScaffolder("react-native").buildCommand("apps/my-cool-app").args).toContain("MyCoolApp");
    expect(resolveScaffolder("react-native").buildCommand("/abs/path/to/shop_mobile").args).toContain("ShopMobile");
    // A basename starting with a digit gets an "App" prefix (identifiers cannot start with a digit).
    expect(resolveScaffolder("react-native").buildCommand("apps/2024-app").args).toContain("App2024App");
    // A basename with nothing alphanumeric survives falls back to "App".
    expect(resolveScaffolder("react-native").buildCommand("apps/---").args).toContain("App");
  });

  it("react-native appends passthrough args after --skip-git-init true", () => {
    const cmd = resolveScaffolder("react-native").buildCommand("apps/mobile-app", ["--pm", "npm"]);
    expect(cmd.args).toEqual([
      "@react-native-community/cli@latest",
      "init",
      "MobileApp",
      "--directory",
      "apps/mobile-app",
      "--skip-install",
      "--skip-git-init",
      "true",
      "--pm",
      "npm",
    ]);
  });
});

describe("passthrough argument composition (spec §5.4)", () => {
  it("next appends passthrough args after the target path", () => {
    const cmd = resolveScaffolder("next").buildCommand("apps/web", ["--tailwind", "--eslint", "--src-dir", "--app"]);
    expect(cmd.args).toEqual([
      "create-next-app@latest",
      "apps/web",
      "--tailwind",
      "--eslint",
      "--src-dir",
      "--app",
    ]);
  });

  it("vite-react-ts appends passthrough args inside the existing -- forwarded segment (separator nuance)", () => {
    const cmd = resolveScaffolder("vite-react-ts").buildCommand("apps/web", ["--overwrite"]);
    expect(cmd.args).toEqual([
      "create",
      "vite@latest",
      "apps/web",
      "--",
      "--template",
      "react-ts",
      "--overwrite",
    ]);
    // Exactly one `--` separator — passthrough args must not introduce a second one.
    expect(cmd.args.filter((arg) => arg === "--")).toHaveLength(1);
  });

  it("nest appends passthrough args after the target path", () => {
    const cmd = resolveScaffolder("nest").buildCommand("apps/api", ["--package-manager", "pnpm"]);
    expect(cmd.args).toEqual(["@nestjs/cli", "new", "apps/api", "--package-manager", "pnpm"]);
  });

  it("shopify-app appends passthrough args after --path <target>", () => {
    const cmd = resolveScaffolder("shopify-app").buildCommand("apps/shop", ["--name", "my-shop"]);
    expect(cmd.args).toEqual(["app", "init", "--path", "apps/shop", "--name", "my-shop"]);
  });

  it("shopify-theme appends passthrough args after the target path", () => {
    const cmd = resolveScaffolder("shopify-theme").buildCommand("apps/theme", ["--clone-url", "x"]);
    expect(cmd.args).toEqual(["theme", "init", "apps/theme", "--clone-url", "x"]);
  });

  it("shopify-headless appends passthrough args after --path <target>, inside the forwarded segment", () => {
    const cmd = resolveScaffolder("shopify-headless").buildCommand("apps/storefront", ["--language", "ts"]);
    expect(cmd.args).toEqual([
      "create",
      "@shopify/hydrogen@latest",
      "--",
      "--path",
      "apps/storefront",
      "--language",
      "ts",
    ]);
    // Exactly one `--` separator — required by npm to forward flags at all
    // (verified against npm's own docs, see shopify-headless.ts header).
    expect(cmd.args.filter((arg) => arg === "--")).toHaveLength(1);
  });

  it("omitted passthrough args default to no trailing args beyond the base command", () => {
    for (const repoType of REPO_TYPES) {
      const withNoArgs = resolveScaffolder(repoType).buildCommand("target");
      const withEmptyArgs = resolveScaffolder(repoType).buildCommand("target", []);
      expect(withNoArgs).toEqual(withEmptyArgs);
    }
  });
});

describe("upstream option schema (D36)", () => {
  it("every registry entry declares a well-formed upstreamOptions array", () => {
    for (const def of listScaffolders()) {
      expect(Array.isArray(def.upstreamOptions)).toBe(true);
      for (const opt of def.upstreamOptions ?? []) {
        expect(typeof opt.key).toBe("string");
        expect(opt.key.length).toBeGreaterThan(0);
        expect(typeof opt.label).toBe("string");
        expect(typeof opt.description).toBe("string");
        expect(["boolean", "choice", "text"]).toContain(opt.kind);
        expect(typeof opt.flag).toBe("string");
        expect(opt.flag.startsWith("--")).toBe(true);
        if (opt.kind === "boolean") {
          expect(typeof opt.default).toBe("boolean");
          expect("choices" in opt && opt.choices !== undefined).toBe(false);
        } else if (opt.kind === "choice") {
          expect(typeof opt.default).toBe("string");
          expect(Array.isArray(opt.choices)).toBe(true);
          expect(opt.choices!.length).toBeGreaterThan(0);
          // The default must be one of the offered choice values.
          expect(opt.choices!.map((c) => c.value)).toContain(opt.default);
        } else {
          expect(typeof opt.default).toBe("string");
        }
      }
    }
  });

  it("only shopify-app declares requiresTerminal (Shopify Partner login)", () => {
    const flagged = REPO_TYPES.filter((t) => resolveScaffolder(t).requiresTerminal !== undefined);
    expect(flagged).toEqual(["shopify-app"]);
    expect(resolveScaffolder("shopify-app").requiresTerminal!.reason).toContain("terminal");
  });

  it("types that pin every choice surface no options (vite-react-ts, expo, shopify-theme, shopify-app)", () => {
    for (const t of ["vite-react-ts", "expo", "shopify-theme", "shopify-app"] as const) {
      expect(resolveScaffolder(t).upstreamOptions).toEqual([]);
    }
  });
});

describe("upstream options -> args (D36)", () => {
  it("next: no answers -> bare command (wizard/interactive path unchanged)", () => {
    expect(resolveScaffolder("next").buildCommand("apps/web").args).toEqual(["create-next-app@latest", "apps/web"]);
  });

  it("next: schema defaults produce the recommended non-interactive argv", () => {
    const def = resolveScaffolder("next");
    const cmd = def.buildCommand("apps/web", [], upstreamOptionDefaults(def.upstreamOptions));
    expect(cmd.args).toEqual([
      "create-next-app@latest",
      "apps/web",
      "--typescript",
      "--tailwind",
      "--eslint",
      "--app",
      "--no-src-dir",
      "--turbopack",
      "--import-alias",
      "@/*",
    ]);
  });

  it("next: overridden answers map to the negated/alternate flags", () => {
    const cmd = resolveScaffolder("next").buildCommand("apps/web", [], {
      typescript: false,
      tailwind: false,
      eslint: false,
      app: false,
      srcDir: true,
      turbopack: false,
      importAlias: "~/*",
    });
    expect(cmd.args).toEqual([
      "create-next-app@latest",
      "apps/web",
      "--javascript",
      "--no-tailwind",
      "--no-linter",
      "--no-app",
      "--src-dir",
      "--webpack",
      "--import-alias",
      "~/*",
    ]);
  });

  it("next: option args land BEFORE passthrough args", () => {
    const cmd = resolveScaffolder("next").buildCommand("apps/web", ["--empty"], { tailwind: false });
    expect(cmd.args).toEqual(["create-next-app@latest", "apps/web", "--no-tailwind", "--empty"]);
  });

  it("nest: packageManager/language/strict overrides", () => {
    const cmd = resolveScaffolder("nest").buildCommand("apps/api", [], {
      packageManager: "pnpm",
      language: "js",
      strict: true,
    });
    expect(cmd.args).toEqual(["@nestjs/cli", "new", "apps/api", "--package-manager", "pnpm", "--language", "js", "--strict"]);
  });

  it("nest: strict false emits nothing (no negated flag)", () => {
    const cmd = resolveScaffolder("nest").buildCommand("apps/api", [], { strict: false });
    expect(cmd.args).toEqual(["@nestjs/cli", "new", "apps/api"]);
  });

  it("shopify-headless: option args land INSIDE the -- forwarded segment, after --path, one -- only", () => {
    const cmd = resolveScaffolder("shopify-headless").buildCommand("apps/storefront", [], {
      language: "js",
      styling: "none",
      markets: "subfolders",
    });
    expect(cmd.args).toEqual([
      "create",
      "@shopify/hydrogen@latest",
      "--",
      "--path",
      "apps/storefront",
      "--language",
      "js",
      "--styling",
      "none",
      "--markets",
      "subfolders",
    ]);
    expect(cmd.args.filter((a) => a === "--")).toHaveLength(1);
  });

  it("react-native: pm override lands after --skip-git-init true, before passthrough", () => {
    const cmd = resolveScaffolder("react-native").buildCommand("apps/mobile-app", ["--pm-extra"], { pm: "bun" });
    expect(cmd.args).toEqual([
      "@react-native-community/cli@latest",
      "init",
      "MobileApp",
      "--directory",
      "apps/mobile-app",
      "--skip-install",
      "--skip-git-init",
      "true",
      "--pm",
      "bun",
      "--pm-extra",
    ]);
  });

  it("optionless types ignore an answers object", () => {
    expect(resolveScaffolder("vite-react-ts").buildCommand("apps/web", [], { anything: true }).args).toEqual([
      "create",
      "vite@latest",
      "apps/web",
      "--",
      "--template",
      "react-ts",
    ]);
    expect(resolveScaffolder("expo").buildCommand("apps/m", [], { anything: "x" }).args[0]).toBe("create-expo-app@latest");
  });
});
