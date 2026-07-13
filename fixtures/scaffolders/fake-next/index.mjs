#!/usr/bin/env node
// Fixture scaffolder (spec §16.2). Stands in for a real
// `npx create-next-app@latest <target>` invocation in integration tests, so
// the real create-nockta-repo pipeline can be exercised end to end without
// ever touching the network or a real framework CLI.
//
// Invocation shape: `node index.mjs <targetPath> [...passthroughArgs]`
// Behavior: creates <targetPath> (recursive) and drops a marker file inside
// recording exactly what argv it received — this both proves "the target
// was created" and "passthrough args reached the scaffolder" (spec §5.4) in
// one artifact. Also records `process.env.CI` so tests can assert
// `runUpstream`'s `forceCI` option actually reaches the child's real env
// (the headless-scaffolder CI=true fix, core/run-upstream.ts).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const [, , targetPath, ...passthroughArgs] = process.argv;

if (!targetPath) {
  console.error("fake-next fixture: missing target path argument");
  process.exit(1);
}

mkdirSync(targetPath, { recursive: true });
writeFileSync(
  path.join(targetPath, ".fixture-marker.json"),
  JSON.stringify(
    {
      fixture: "fake-next",
      targetPath,
      passthroughArgs,
      argv: process.argv.slice(2),
      cwd: process.cwd(),
      env: { CI: process.env.CI ?? null, hasPath: typeof process.env.PATH === "string" && process.env.PATH.length > 0 },
    },
    null,
    2,
  ),
);

process.exit(0);
