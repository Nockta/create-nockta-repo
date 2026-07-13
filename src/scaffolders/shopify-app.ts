import type { ScaffolderDefinition } from "../types/scaffold.js";

/**
 * Shopify App — spec §3.5. Conceptual upstream command is bare
 * `shopify app init` (no positional path shown in the spec — the Shopify
 * CLI names/places the app interactively or via its own flags).
 *
 * This registry entry routes `create-nockta-repo`'s resolved target path
 * through the CLI's own `--path` flag so `buildCommand`'s signature stays
 * uniform across all six scaffolders (spec §18.1: isolate configs, avoid
 * over-abstraction — the isolation lives here, in this one module, not in a
 * shared abstraction). Shopify CLI flags are known to shift between
 * versions (spec §18.1/§18.5) — verify `--path`/`--name` against the
 * installed CLI version before Milestone 3 wires real execution.
 */
export const shopifyAppScaffolder: ScaffolderDefinition = {
  repoType: "shopify-app",
  displayName: "Shopify App",
  upstreamTool: "Shopify CLI (app)",
  conceptualCommand: "shopify app init",
  interactiveStdio: true,
  // D36: no headless options are surfaced — the whole command needs a terminal
  // (see requiresTerminal below).
  upstreamOptions: [],
  // D36 / PART A: `shopify app init` MUST open a browser to log in to a Shopify
  // Partner organization and select/create the app — verified 2026-07-13
  // against shopify.dev + Shopify/cli issues #4682/#115 (the CLI cannot
  // authenticate without a browser; there is no flag to bypass the login/org
  // step). So it cannot run headlessly from the web flow; the page warns up
  // front and hands back to the terminal on submit rather than hanging.
  requiresTerminal: {
    reason:
      "Shopify app scaffolding must open a browser to log in to your Partner organization and " +
      "select or create the app — this can't be completed from the browser wizard. Finish it in " +
      "your terminal.",
  },
  buildCommand: (targetPath, passthroughArgs = []) => ({
    name: "shopify-cli",
    command: "shopify",
    args: ["app", "init", "--path", targetPath, ...passthroughArgs],
  }),
  notes:
    "Spec §3.5 documents the bare `shopify app init` form; `--path <target>` is this " +
    "registry's own isolation choice to route the resolved target path, isolated to this " +
    "module per §18.1. Requires interactive stdio (§18.5) — the Shopify CLI prompts for " +
    "app name/config unless enough flags are supplied via passthrough args.",
};
