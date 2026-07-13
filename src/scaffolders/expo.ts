import type { ScaffolderDefinition } from "../types/scaffold.js";

/**
 * Expo — decisions.md D25. Verified 2026-07-11 against primary sources (`create-expo` CLI source
 * on GitHub, the real `expo-template-default@57.0.6` tarball, npm registry metadata) — see
 * `scratchpad/react-native-tooling-research.md` §1 for the full citation trail.
 *
 * Command shape:
 * `npx create-expo-app@latest <project-path> --yes --no-install --template default@sdk-57 --no-agents-md`
 *
 * - `<project-path>` is positional (CLI source `cli.ts`'s usage string: `create-expo-app <path>
 *   [options]`) — always pass it explicitly (omitting it + `--yes` falls back to `process.cwd()`,
 *   wrong for a resolved target path).
 * - `--yes`: non-interactive — skips both the app-name prompt (moot, path is already given) and
 *   the SDK-57-transition "alternatives" prompt.
 * - `--no-install`: this package controls the install step itself, not create-expo-app.
 * - `--template default@sdk-57`: explicit, because `create-expo-app@latest` WITHOUT `--template`
 *   currently creates an SDK 54 project during the SDK 57 transition window (per Expo's own docs)
 *   — pinning `default@sdk-57` gets the current SDK, not the transitional default.
 * - `--no-agents-md` (decisions.md D24): suppresses Expo's own generated `AGENTS.md`/`CLAUDE.md`/
 *   `.claude/settings.json` stub files — Nockta authors its own `AGENTS.md` (the inject-nockta-
 *   skills `agent` adapter) plus curated react-native/expo pack skill content instead of vendoring
 *   Expo's thin, host-dependent stubs.
 *
 * Note (not encoded here — `create-expo-app` has no flag for it): it always silently `git init`s
 * the new project directory (unless already inside a git tree) — there is no suppressing flag, per
 * research. This package's own no-commit rule is unaffected (it never itself commits), but the
 * scaffolded dir will already be a git repo the moment this command returns.
 */
export const expoScaffolder: ScaffolderDefinition = {
  repoType: "expo",
  displayName: "Expo",
  upstreamTool: "create-expo-app",
  conceptualCommand:
    "npx create-expo-app@latest <project-path> --yes --no-install --template default@sdk-57 --no-agents-md",
  interactiveStdio: false,
  provisional: false,
  buildCommand: (targetPath, passthroughArgs = []) => ({
    name: "create-expo-app",
    command: "npx",
    args: [
      "create-expo-app@latest",
      targetPath,
      "--yes",
      "--no-install",
      "--template",
      "default@sdk-57",
      "--no-agents-md",
      ...passthroughArgs,
    ],
  }),
  notes:
    "Passthrough args (spec §5.4) are appended after --no-agents-md. --no-agents-md (decisions.md " +
    "D24) suppresses Expo's own stub AI files so Nockta's own agent-adapter AGENTS.md + curated " +
    "expo pack skills own that space instead. --template default@sdk-57 is explicit because " +
    "create-expo-app@latest without --template currently creates an SDK 54 project during the " +
    "SDK 57 transition window (verified against Expo's own docs, 2026-07-11).",
};
