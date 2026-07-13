import { basename } from "node:path";
import type { ScaffolderDefinition } from "../types/scaffold.js";

/**
 * Derives a valid `@react-native-community/cli init` positional `Name` argument from the
 * resolved target path's basename (decisions.md D25).
 *
 * The RN community CLI's `init <Name>` positional arg doubles as the app's default display name
 * — it must be a bare identifier (letters/digits, starting with a letter), NOT an arbitrary path
 * segment (which may contain `-`, `_`, spaces, or start with a digit). `--directory <path>`
 * decouples the actual on-disk folder (the real resolved target path, passed through verbatim)
 * from this name — so the derivation only needs to produce *some* valid identifier, not preserve
 * the original path segment exactly.
 *
 * Rule: split the basename on every run of non-alphanumeric characters, PascalCase each
 * surviving segment, and concatenate (e.g. `my-cool-app` -> `MyCoolApp`, `my_app_2` ->
 * `MyApp2`). Falls back to `"App"` when nothing alphanumeric survives (e.g. a basename of only
 * punctuation); prefixes `"App"` when the result would start with a digit (e.g. `2024-app` ->
 * `App2024App`) — identifiers cannot start with a digit.
 */
export function deriveReactNativeAppName(targetPath: string): string {
  const base = basename(targetPath);
  const segments = base.split(/[^a-zA-Z0-9]+/).filter((segment) => segment.length > 0);
  const pascalCased = segments
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("");

  if (pascalCased.length === 0) return "App";
  if (/^[0-9]/.test(pascalCased)) return `App${pascalCased}`;
  return pascalCased;
}

/**
 * React Native (bare) — decisions.md D25. Verified 2026-07-11 against primary sources
 * (`react-native-community/cli`'s own `docs/init.md`/`docs/commands.md` on GitHub, the
 * `react-native-community/template` repo tree) — see
 * `scratchpad/react-native-tooling-research.md` §2 for the full citation trail.
 *
 * Command shape:
 * `npx @react-native-community/cli@latest init <Name> --directory <project-path> --skip-install --skip-git-init true`
 *
 * - `npx react-native init` is DEPRECATED (react-native/react-native#45804) — the community CLI's
 *   own `init` is the current, recommended replacement.
 * - `<Name>` is positional and REQUIRED — unlike Expo's `create-expo-app`, this CLI has no
 *   cwd-fallback path. It also doubles as the folder name UNLESS `--directory` is also given
 *   (which this scaffolder always does, to decouple the app's placeholder name from the actual
 *   resolved target path) — see `deriveReactNativeAppName()` above for the derivation.
 * - `--directory <project-path>`: the real resolved target path, verbatim.
 * - `--skip-install`: this package controls the install step itself, not the RN CLI.
 * - `--skip-git-init true`: explicit control over git init (unlike Expo's CLI, which has no
 *   equivalent flag and always silently git-inits).
 */
export const reactNativeScaffolder: ScaffolderDefinition = {
  repoType: "react-native",
  displayName: "React Native",
  upstreamTool: "@react-native-community/cli",
  conceptualCommand:
    "npx @react-native-community/cli@latest init <Name> --directory <project-path> --skip-install --skip-git-init true",
  interactiveStdio: false,
  provisional: false,
  buildCommand: (targetPath, passthroughArgs = []) => ({
    name: "@react-native-community/cli",
    command: "npx",
    args: [
      "@react-native-community/cli@latest",
      "init",
      deriveReactNativeAppName(targetPath),
      "--directory",
      targetPath,
      "--skip-install",
      "--skip-git-init",
      "true",
      ...passthroughArgs,
    ],
  }),
  notes:
    "Passthrough args (spec §5.4) are appended after --skip-git-init true. The positional Name " +
    "(before --directory) is DERIVED from the target path's basename via " +
    "deriveReactNativeAppName() (PascalCased, letters/digits only, never starts with a digit) — " +
    "not the raw path segment, since the RN CLI's Name arg must be a bare identifier. " +
    "`npx react-native init` is deprecated in favor of this community-cli form (verified against " +
    "react-native/react-native#45804, 2026-07-11).",
};
