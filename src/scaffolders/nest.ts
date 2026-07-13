import type { ScaffolderDefinition } from "../types/scaffold.js";

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
  buildCommand: (targetPath, passthroughArgs = []) => ({
    name: "@nestjs/cli",
    command: "npx",
    args: ["@nestjs/cli", "new", targetPath, ...passthroughArgs],
  }),
  notes: "Passthrough args (spec §5.4) are appended after the target path.",
};
