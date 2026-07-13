import type { ScaffolderDefinition } from "../types/scaffold.js";

/**
 * Shopify Theme — spec §3.6. Conceptual upstream command:
 * `shopify theme init <project-path>`.
 */
export const shopifyThemeScaffolder: ScaffolderDefinition = {
  repoType: "shopify-theme",
  displayName: "Shopify Theme",
  upstreamTool: "Shopify CLI (theme)",
  conceptualCommand: "shopify theme init <project-path>",
  interactiveStdio: true,
  // D36: `shopify theme init` just clones a Git theme template (Dawn) — no
  // login/auth, no scaffold choices to surface (verified 2026-07-13 against
  // shopify.dev theme-init). No options, and NOT requiresTerminal.
  upstreamOptions: [],
  buildCommand: (targetPath, passthroughArgs = []) => ({
    name: "shopify-cli",
    command: "shopify",
    args: ["theme", "init", targetPath, ...passthroughArgs],
  }),
  notes:
    "Matches spec §3.6 literally — target path is a positional arg, unlike shopify-app. " +
    "Requires interactive stdio (§18.5).",
};
