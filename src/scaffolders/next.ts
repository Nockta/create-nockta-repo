import type { ScaffolderDefinition, UpstreamOption } from "../types/scaffold.js";
import { buildUpstreamOptionArgs } from "./upstream-options.js";

/**
 * create-next-app's interactive prompts, surfaced as web form fields and
 * mapped to its non-interactive flags (D36). Verified 2026-07-13 against the
 * official CLI reference (nextjs.org/docs/app/api-reference/cli/create-next-app,
 * create-next-app 16.2.x): `--ts`/`--js`, `--tailwind`/`--no-tailwind`,
 * `--eslint`/`--no-linter`, `--app`/`--no-app`, `--src-dir`/`--no-src-dir`,
 * `--turbopack`/`--webpack`, `--import-alias <alias>`. Defaults mirror
 * create-next-app's own "recommended defaults" (TypeScript, Tailwind, ESLint,
 * App Router, `@/*` alias, Turbopack; no `src/` dir).
 */
const nextUpstreamOptions: UpstreamOption[] = [
  {
    key: "typescript",
    label: "TypeScript",
    description: "Initialize as a TypeScript project (vs. JavaScript).",
    kind: "boolean",
    default: true,
    flag: "--typescript",
    negatedFlag: "--javascript",
  },
  {
    key: "tailwind",
    label: "Tailwind CSS",
    description: "Include a Tailwind CSS config.",
    kind: "boolean",
    default: true,
    flag: "--tailwind",
    negatedFlag: "--no-tailwind",
  },
  {
    key: "eslint",
    label: "ESLint",
    description: "Include an ESLint config (off = skip linter setup entirely).",
    kind: "boolean",
    default: true,
    flag: "--eslint",
    negatedFlag: "--no-linter",
  },
  {
    key: "app",
    label: "App Router",
    description: "Use the App Router (vs. the Pages Router).",
    kind: "boolean",
    default: true,
    flag: "--app",
    negatedFlag: "--no-app",
  },
  {
    key: "srcDir",
    label: "src/ directory",
    description: "Place application code inside a `src/` directory.",
    kind: "boolean",
    default: false,
    flag: "--src-dir",
    negatedFlag: "--no-src-dir",
  },
  {
    key: "turbopack",
    label: "Turbopack",
    description: "Enable Turbopack in the generated dev/build scripts (off = Webpack).",
    kind: "boolean",
    default: true,
    flag: "--turbopack",
    negatedFlag: "--webpack",
  },
  {
    key: "importAlias",
    label: "Import alias",
    description: "The TypeScript path alias for the project root.",
    kind: "text",
    default: "@/*",
    flag: "--import-alias",
  },
];

/**
 * Next.js — spec §3.2. Conceptual upstream command:
 * `npx create-next-app@latest <project-path>`.
 */
export const nextScaffolder: ScaffolderDefinition = {
  repoType: "next",
  displayName: "Next.js",
  upstreamTool: "create-next-app",
  conceptualCommand: "npx create-next-app@latest <project-path>",
  interactiveStdio: false,
  upstreamOptions: nextUpstreamOptions,
  buildCommand: (targetPath, passthroughArgs = [], upstreamAnswers) => ({
    name: "create-next-app",
    command: "npx",
    args: [
      "create-next-app@latest",
      targetPath,
      ...buildUpstreamOptionArgs(nextUpstreamOptions, upstreamAnswers),
      ...passthroughArgs,
    ],
  }),
  notes:
    "Upstream options (D36) map to create-next-app's non-interactive flags and are emitted BETWEEN " +
    "the target path and any passthrough args (spec §5.4). A bare buildCommand (no answers) stays " +
    "`create-next-app@latest <path>` — the wizard/interactive path is unchanged.",
};
