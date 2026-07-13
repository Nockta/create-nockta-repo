import type { ScaffolderDefinition, UpstreamOption } from "../types/scaffold.js";
import { buildUpstreamOptionArgs } from "./upstream-options.js";

/**
 * `nest new`'s options, surfaced as web fields (D36). Verified 2026-07-13
 * against the nest-cli source (nestjs/nest-cli `commands/new.command.ts`): the
 * only interactive prompt is the package manager; `--language`/`--strict` are
 * flag-only. Values match the CLI's own (`--package-manager npm|yarn|pnpm`,
 * `--language ts|js`, `--strict`).
 */
const nestUpstreamOptions: UpstreamOption[] = [
  {
    key: "packageManager",
    label: "Package manager",
    description: "Which package manager `nest new` installs with.",
    kind: "choice",
    choices: [
      { value: "npm", label: "npm" },
      { value: "yarn", label: "yarn" },
      { value: "pnpm", label: "pnpm" },
    ],
    default: "npm",
    flag: "--package-manager",
  },
  {
    key: "language",
    label: "Language",
    description: "TypeScript or JavaScript project.",
    kind: "choice",
    choices: [
      { value: "ts", label: "TypeScript" },
      { value: "js", label: "JavaScript" },
    ],
    default: "ts",
    flag: "--language",
  },
  {
    key: "strict",
    label: "Strict mode",
    description: "Enable TypeScript strict mode.",
    kind: "boolean",
    default: false,
    flag: "--strict",
  },
];

/**
 * NestJS — spec §3.4. Conceptual upstream command:
 * `npx @nestjs/cli new <project-path>`.
 */
export const nestScaffolder: ScaffolderDefinition = {
  repoType: "nest",
  displayName: "NestJS",
  upstreamTool: "@nestjs/cli",
  conceptualCommand: "npx @nestjs/cli new <project-path>",
  interactiveStdio: false,
  upstreamOptions: nestUpstreamOptions,
  buildCommand: (targetPath, passthroughArgs = [], upstreamAnswers) => ({
    name: "@nestjs/cli",
    command: "npx",
    args: [
      "@nestjs/cli",
      "new",
      targetPath,
      ...buildUpstreamOptionArgs(nestUpstreamOptions, upstreamAnswers),
      ...passthroughArgs,
    ],
  }),
  notes:
    "Upstream options (D36) map to `nest new`'s flags, emitted between the target path and any " +
    "passthrough args (spec §5.4). A bare buildCommand (no answers) is unchanged.",
};
