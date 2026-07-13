import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Multiple integration test files each unconditionally rebuild this package's OWN
    // dist/cli.js in their own beforeAll (`pnpm exec tsup`, cwd: packageRoot) — deliberate,
    // so no test ever passes vacuously against stale output. Run in parallel (vitest's
    // default file parallelism), those concurrent rebuilds race on the same output
    // directory: one file's tsup "Cleaning output folder" can delete/truncate another
    // file's in-progress dist/cli.js, producing a corrupted CLI that then returns wrong
    // exit codes (observed in CI run 29241461929: "expected 1 to be 2" in
    // create-command.integration.test.ts / create-entry-process.test.ts — no such failure
    // is reproducible locally, where the rebuilds are fast enough the race window rarely
    // opens). Serializing test FILES only in CI removes the race without slowing local dev.
    fileParallelism: !process.env.CI,
  },
});
