#!/usr/bin/env node
// Fixture scaffolder (spec §16.2). Stands in for a real
// `npm create vite@latest <target> -- --template react-ts` invocation in
// integration tests. Same contract as fake-next/index.mjs — see that file's
// header for the full rationale.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const [, , targetPath, ...passthroughArgs] = process.argv;

if (!targetPath) {
  console.error("fake-vite-react-ts fixture: missing target path argument");
  process.exit(1);
}

mkdirSync(targetPath, { recursive: true });
writeFileSync(
  path.join(targetPath, ".fixture-marker.json"),
  JSON.stringify(
    {
      fixture: "fake-vite-react-ts",
      targetPath,
      passthroughArgs,
      argv: process.argv.slice(2),
      cwd: process.cwd(),
    },
    null,
    2,
  ),
);

process.exit(0);
