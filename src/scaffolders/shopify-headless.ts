import type { ScaffolderDefinition } from "../types/scaffold.js";

/**
 * Shopify Headless — spec §3.7. PROVISIONAL.
 *
 * The spec explicitly states the conceptual upstream command "may use
 * Shopify/Hydrogen/Remix tooling depending on the chosen preset" and that
 * this entry should be "isolated behind a shopify-headless registry entry"
 * (§3.7) precisely because the concrete command is not settled. Everything
 * below — `upstreamTool`, `conceptualCommand`, `buildCommand` — is a
 * best-effort placeholder (current Hydrogen CLI shape) and is expected to
 * change without notice once the concrete preset is decided. Do not treat
 * this module's command shape as stable; `provisional: true` marks that
 * explicitly for any consumer (e.g. `list --json`).
 *
 * Verified (2026-07-10) against two live sources, not assumed:
 *
 * 1. shopify.dev getting-started
 *    (https://shopify.dev/docs/storefronts/headless/hydrogen/getting-started)
 *    documents the scaffold invocation as
 *    `npm create @shopify/hydrogen@latest -- --quickstart` — an `npm create`
 *    call with flags forwarded after a `--` separator, not a bare positional
 *    path.
 * 2. `@shopify/create-hydrogen`'s own source
 *    (github.com/Shopify/hydrogen, packages/cli/src/commands/hydrogen/init.ts)
 *    defines `path` as a *named* oclif flag ("The path to the directory of
 *    the new Hydrogen storefront.") — there is no positional path argument
 *    on the `init` command at all. Target directory must be passed as
 *    `--path <dir>`, never positional.
 *
 * `--` separator conclusion: verified against npm's own docs
 * (docs.npmjs.com/cli/v10/commands/npm-init) — `npm init foo -- --hello` is
 * documented as equivalent to `npm exec -- create-foo --hello`; flags before
 * `--` are npm's own (e.g. `-y`, `--registry`), flags after `--` are
 * forwarded verbatim to the invoked package's bin. The separator is required
 * for forwarding, not merely stylistic — omitting it would let npm try to
 * interpret `--path` as one of its own flags instead of forwarding it to
 * `create-hydrogen`. So `--` must appear exactly once, before `--path`.
 */
export const shopifyHeadlessScaffolder: ScaffolderDefinition = {
  repoType: "shopify-headless",
  displayName: "Shopify Headless",
  upstreamTool: "@shopify/create-hydrogen (provisional)",
  conceptualCommand:
    "npm create @shopify/hydrogen@latest -- --path <project-path>  # PROVISIONAL, preset-dependent",
  interactiveStdio: true,
  provisional: true,
  buildCommand: (targetPath, passthroughArgs = []) => ({
    name: "create-hydrogen (provisional)",
    command: "npm",
    args: ["create", "@shopify/hydrogen@latest", "--", "--path", targetPath, ...passthroughArgs],
  }),
  notes:
    "PROVISIONAL per spec §3.7: exact upstream tooling depends on the chosen headless " +
    "preset (Hydrogen, Remix, custom storefront) and is not fixed. Isolated in this single " +
    "module so a preset decision only touches this file, not a shared abstraction (§18.1). " +
    "Command shape verified 2026-07-10 against shopify.dev getting-started and the " +
    "@shopify/create-hydrogen source (packages/cli/src/commands/hydrogen/init.ts, `path` is a " +
    "named flag, not positional) — see module header comment for the full citation and the " +
    "`--` separator reasoning (verified against npm's own docs).",
};
