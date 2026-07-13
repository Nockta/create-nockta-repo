import type { ScaffolderDefinition } from "../types/scaffold.js";

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
  buildCommand: (targetPath, passthroughArgs = []) => ({
    name: "create-next-app",
    command: "npx",
    args: ["create-next-app@latest", targetPath, ...passthroughArgs],
  }),
  notes:
    "Passthrough args (spec §5.4) are appended after the target path, e.g. " +
    "`-- --tailwind --eslint --src-dir --app` becomes trailing args on this command.",
};
