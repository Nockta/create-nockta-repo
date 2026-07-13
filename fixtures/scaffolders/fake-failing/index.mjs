#!/usr/bin/env node
// Fixture scaffolder (spec §16.2) that simulates an upstream scaffolder
// crashing. Deliberately creates nothing and exits non-zero, so integration
// tests can assert the create pipeline stops immediately on upstream
// failure with no post-processing (spec §13) and the documented
// upstream-failure exit code (spec §5.9). Exit code 7 is arbitrary and
// distinct from create-nockta-repo's own exit code 1, specifically so tests
// can tell the difference between "the child's real exit code" (carried in
// UpstreamResult.exitCode) and "create-nockta-repo's normalized exit code"
// (process.exitCode === 1 per the spec §5.9 table).
console.error("fake-failing fixture: simulated upstream scaffolder failure");
process.exit(7);
