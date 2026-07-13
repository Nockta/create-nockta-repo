import type { ScaffolderDefinition } from "../types/scaffold.js";

/**
 * Vite React TypeScript — spec §3.3. Conceptual upstream command:
 * `npm create vite@latest <project-path> -- --template react-ts`.
 *
 * `npm create` requires its own `--` separator to forward flags to the
 * underlying `create-vite` package — that separator is baked into the base
 * args here, not something the caller supplies. Passthrough args (spec
 * §5.4) are appended *after* `--template react-ts`, inside the same
 * forwarded segment; they do not need (and must not add) a second `--`.
 */
export const viteReactTsScaffolder: ScaffolderDefinition = {
  repoType: "vite-react-ts",
  displayName: "Vite React TypeScript",
  upstreamTool: "create-vite",
  conceptualCommand: "npm create vite@latest <project-path> -- --template react-ts",
  interactiveStdio: false,
  // D36: the repo-type contract pins `--template react-ts`, which is the only
  // choice create-vite would prompt for — so there are NO surfaced options.
  upstreamOptions: [],
  buildCommand: (targetPath, passthroughArgs = []) => ({
    name: "create-vite",
    command: "npm",
    args: ["create", "vite@latest", targetPath, "--", "--template", "react-ts", ...passthroughArgs],
  }),
  notes:
    "The `--` separator is part of the base args (required by `npm create` to forward " +
    "flags to create-vite), not appended per-call — passthrough args land after " +
    "`--template react-ts` inside that same forwarded segment.",
};
