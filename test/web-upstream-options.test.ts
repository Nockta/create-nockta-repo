import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  answersToCliOptions,
  runCreateWebSubmit,
  terminalHandoffCommand,
} from "../src/web/run-create-web.js";
import type { CreateWebAnswers } from "../src/web/run-create-web.js";
import { resolveCreatePlan, upstreamStdio } from "../src/commands/create.js";
import { buildWebProjectSchema } from "../src/web/project-schema.js";
import { renderCreateWebPage } from "../src/web/page.js";
import { emptyInjectSchema } from "../src/web/inject-schema.js";

/**
 * D36 web-side proof: the surfaced upstream options reach buildCommand's argv,
 * the web submit detaches upstream stdin (PART A), and a requiresTerminal type
 * hands back to the terminal instead of spawning a doomed headless run.
 */

const baseAnswers = (over: Partial<CreateWebAnswers>): CreateWebAnswers => ({
  projectPath: "my-app",
  repoType: "next",
  alsoTypes: [],
  architecture: "standard",
  adapters: ["claude"],
  skills: { excluded: [], included: [] },
  razor: { excluded: [], included: [] },
  ...over,
});

describe("answersToCliOptions forwards upstream options + PART A stdin marker (D36)", () => {
  it("forwards upstreamOptions and always sets nonInteractiveUpstream", () => {
    const cli = answersToCliOptions(
      baseAnswers({ upstreamOptions: { tailwind: false, importAlias: "~/*" } }),
      {},
    );
    expect(cli.upstreamOptions).toEqual({ tailwind: false, importAlias: "~/*" });
    expect(cli.nonInteractiveUpstream).toBe(true);
    expect(cli.yes).toBe(true);
  });
});

describe("upstreamStdio (PART A / D36)", () => {
  it("detaches stdin for the web submit path, inherits everything else", () => {
    expect(upstreamStdio({ nonInteractiveUpstream: true })).toEqual(["ignore", "inherit", "inherit"]);
  });
  it("every other path keeps uniform inherit", () => {
    expect(upstreamStdio({})).toBe("inherit");
    expect(upstreamStdio({ nonInteractiveUpstream: false })).toBe("inherit");
  });
});

describe("web-submitted upstream options reach the real officialScaffolder argv (D36)", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), "web-uopts-"));
    delete process.env.CREATE_NOCKTA_REPO_TEST_FIXTURE_BIN;
  });
  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  it("overridden options map through answersToCliOptions -> resolveCreatePlan -> argv", () => {
    const cli = answersToCliOptions(
      baseAnswers({ upstreamOptions: { typescript: false, tailwind: false, srcDir: true, importAlias: "~/*" } }),
      { cwd },
    );
    const resolved = resolveCreatePlan("my-app", cli);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const args = resolved.plan.officialScaffolder.args;
    expect(args).toContain("--javascript");
    expect(args).toContain("--no-tailwind");
    expect(args).toContain("--src-dir");
    expect(args).toContain("--import-alias");
    expect(args[args.indexOf("--import-alias") + 1]).toBe("~/*");
  });

  it("a plain --yes run with NO upstreamOptions falls back to the schema defaults (single source)", () => {
    const resolved = resolveCreatePlan("my-app", { type: "next", yes: true, cwd });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    // Same defaults the web page pre-fills — CLI and web can't drift.
    expect(resolved.plan.officialScaffolder.args).toEqual([
      "create-next-app@latest",
      "my-app",
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

  it("the wizard/interactive path (no --yes, no options) stays a bare command", () => {
    const resolved = resolveCreatePlan("my-app", { type: "next", cwd });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.plan.officialScaffolder.args).toEqual(["create-next-app@latest", "my-app"]);
  });
});

describe("requiresTerminal handoff (PART A / D36)", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), "web-uopts-rt-"));
  });
  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  it("shopify-app short-circuits to a terminal handoff and never scaffolds", async () => {
    const result = await runCreateWebSubmit(baseAnswers({ repoType: "shopify-app", projectPath: "shop" }), { cwd });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.requiresTerminal).toBeDefined();
    expect(result.requiresTerminal!.reason).toContain("terminal");
    expect(result.requiresTerminal!.command).toBe("npm create nockta-repo@latest -- shop --type shopify-app --cli");
    // Nothing was created — the doomed headless pipeline never ran.
    expect(existsSync(path.join(cwd, "shop"))).toBe(false);
  });

  it("terminalHandoffCommand falls back to <path> when the path is empty", () => {
    expect(terminalHandoffCommand("", "shopify-app")).toBe("npm create nockta-repo@latest -- <path> --type shopify-app --cli");
  });
});

describe("buildWebProjectSchema embeds the option + requiresTerminal maps (D36)", () => {
  it("next carries surfaced options; option-pinned types carry []", () => {
    const schema = buildWebProjectSchema();
    expect(schema.upstreamOptionsByType.next.map((o) => o.key)).toEqual([
      "typescript",
      "tailwind",
      "eslint",
      "app",
      "srcDir",
      "turbopack",
      "importAlias",
    ]);
    expect(schema.upstreamOptionsByType["vite-react-ts"]).toEqual([]);
    expect(schema.upstreamOptionsByType.expo).toEqual([]);
  });

  it("only shopify-app appears in requiresTerminalByType", () => {
    const schema = buildWebProjectSchema();
    expect(Object.keys(schema.requiresTerminalByType)).toEqual(["shopify-app"]);
    expect(schema.requiresTerminalByType["shopify-app"]).toContain("terminal");
  });
});

describe("renderCreateWebPage surfaces the options section + requiresTerminal warning (D36)", () => {
  it("embeds the maps and the Upstream scaffolder options card + handoff literals", () => {
    const html = renderCreateWebPage(buildWebProjectSchema(), emptyInjectSchema(), "tok");
    expect(html).toContain("upstreamOptionsByType");
    expect(html).toContain("requiresTerminalByType");
    expect(html).toContain("Upstream scaffolder options");
    expect(html).toContain("rebuildUpstreamOptions");
    expect(html).toContain("collectUpstreamOptions");
    // The requiresTerminal warning + result handoff paths are present.
    expect(html).toContain("Finish in your terminal");
    expect(html).toContain("can't be created from the browser");
  });
});
