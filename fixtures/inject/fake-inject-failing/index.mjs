#!/usr/bin/env node
// Fixture "inject-nockta-skills install" stand-in (spec §19 Milestone 6,
// §5.9 exit code 4 "skill injection failure"). Simulates the real inject
// CLI crashing/failing before it can print its single-line --json result —
// deliberately writes nothing to stdout (so create-nockta-repo's
// unparseable-output guard is exercised the same way a real crash would)
// and exits non-zero with inject's own real "render failure" code (spec
// §7.9 exit code 3), so integration tests can assert create-nockta-repo's
// own skill-injection-failure handling (exit code 4, honest partial-state
// report — project + architecture overlay already exist) without depending
// on engineering a real render failure in the real inject-nockta-skills
// build. Invocation shape mirrors the real CLI: `node index.mjs install
// --type <t> --adapters <a> --yes --json` or `... --target <p>:<t> ...`.
console.error("fake-inject-failing fixture: simulated inject-nockta-skills render failure");
process.exit(3);
