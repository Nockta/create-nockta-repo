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
