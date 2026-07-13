import pc from "picocolors";
import { listScaffolders } from "../scaffolders/registry.js";
import type { ScaffolderDefinition } from "../types/scaffold.js";

export type ListCommandCliOptions = {
  details?: boolean;
  json?: boolean;
};

function toJsonEntry(def: ScaffolderDefinition) {
  return {
    repoType: def.repoType,
    displayName: def.displayName,
    upstreamTool: def.upstreamTool,
    conceptualCommand: def.conceptualCommand,
    interactiveStdio: def.interactiveStdio,
    provisional: def.provisional ?? false,
    minNodeVersion: def.minNodeVersion ?? null,
    // The real args builder output for a placeholder target path — proves
    // out passthrough-arg composition without inventing preset data.
    exampleCommand: def.buildCommand("<project-path>"),
  };
}

/**
 * `list` — spec §5.8. Milestone 2 scope: repo types + their upstream
 * scaffolder commands, sourced from the scaffolder registry
 * (src/scaffolders/registry.ts). Architecture presets and skill-pack
 * mapping columns are later milestones (§7, §8) and are deliberately not
 * printed here — no invented preset/pack data.
 */
export async function runListCommand(cliOptions: ListCommandCliOptions): Promise<void> {
  const scaffolders = listScaffolders();

  if (cliOptions.json) {
    // D13: exactly one structured JSON object on stdout, one line — compact,
    // not pretty-printed (a `null, 2` indent embeds real newlines in the
    // stream, which breaks line-oriented machine consumers even though a
    // single console.log call still looks like "one call" in tests).
    console.log(
      JSON.stringify({
        repoTypes: scaffolders.map(toJsonEntry),
      }),
    );
    return;
  }

  console.log(pc.bold("create-nockta-repo — supported project types"));
  console.log("");
  for (const def of scaffolders) {
    const tags = [def.interactiveStdio ? "interactive" : null, def.provisional ? "provisional" : null].filter(
      (tag): tag is string => tag !== null,
    );
    const suffix = tags.length > 0 ? pc.dim(` [${tags.join(", ")}]`) : "";
    console.log(`  ${pc.cyan(def.repoType.padEnd(16))} ${def.displayName}${suffix}`);
    console.log(`    ${pc.dim(def.conceptualCommand)}`);
  }
  console.log("");
  console.log(
    pc.dim(
      "Architecture presets and skill-pack mapping are not implemented yet — they land with " +
        "the architecture overlay system and skills-injector integration milestones.",
    ),
  );
  if (cliOptions.details) {
    console.log(pc.dim("--details output is not implemented yet."));
  }
}
