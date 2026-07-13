# Context — create-nockta-repo package

Documentation layout profile: **federated** — `CONTEXT.md`/`USAGE.md` live inside each module
directory next to the code they describe. This `context.md` is the root index: pointers and
one-line takeaways only, no accumulated prose.

Decision records for this package are **not local**: architecture decisions binding both
`create-nockta-repo` and `inject-nockta-skills` live in the workspace-level rolling log at
`../decisions.md` (D1–D20 as of Milestone 8). Read that file before any design/architecture work
here — see spec `../startup docs/create-nockta-repo.updated.md` §10.1 and decisions.md D7 for why
this package has no shared library with its sibling and duplicates the `RepoType`/`AdapterType`
unions locally instead. Milestone 5 (monorepo target support) is governed specifically by D5 (per-target
repo profiles, root `targets.json` is inject-owned) and D12 (no monorepo-root creation in MVP).
Milestone 6 (skills injector integration) is governed specifically by D4 (spawn inject's CLI only —
never an npm dependency, never a programmatic import), D5 (root adapters + `targets.json` are
inject-owned, triggered by create), D13 (both CLIs' `--json`/exit-code machine interface is a
stable contract), and D14 (`--skills-version` flag, resolved version recorded from inject's own
output). Milestone 8 is governed specifically by D6 (real end-to-end run = the acceptance proof),
D7 (the enum-parity contract test this milestone finally builds), and D20 (non-interactive create
EXECUTION now requires `--yes`, aligning with `inject-nockta-skills` and spec §5.2's own example;
`--dry-run` stays exempt).

**License**: no `license` field is set in `package.json` (Milestone 8 — the previous placeholder
`"UNLICENSED"` value was removed rather than kept or replaced with a guess). License choice is an
explicit OWNER pre-publish decision, not invented by this or any milestone; see `README.md`'s own
"License" section for the same note where a user/owner will actually see it.

## Current state (bugfix, this pass, 2026-07-11 — headless-scaffolder `CI=true` fix)

Fixes a verified real bug: when `create` spawns an upstream scaffolder (`create-next-app`, etc.)
non-interactively (no human at the inherited stdio — the CLI `--yes` flag, or the `--web` submit
path running inside an HTTP handler), the scaffolder printed its interactive prompt, got no input,
and exited 0 having **written nothing** — unless its own env had `CI` set. Verified directly
against bare `npx create-next-app@latest`: non-TTY + no `CI` → no files; `CI=true` → scaffolds
correctly. This silently broke headless `create` runs (AI agents/CI driving it non-interactively),
an explicitly-supported use case.

Fix: `src/core/run-upstream.ts`'s new `RunUpstreamOptions.forceCI` merges `CI: "true"` onto
`{...process.env}` for the spawned scaffolder (never drops the rest of the env, never clobbers an
already-truthy `CI`). `commands/create.ts` passes `forceCI: cliOptions.yes === true` at its one
`runUpstream()` call site — true for the CLI `--yes` path AND the `--web` submit path
(`web/run-create-web.ts::answersToCliOptions()` always sets `yes: true`), false for the wizard
path (TTY-gated by construction at `commands/create-entry.ts`, so it stays genuinely interactive —
Shopify's own scaffolder prompts are preserved there). Full detail, the three-level test proof
(unit `forceCI` behavior, real built CLI `--yes` end to end, real `--web` submit end to end), and
the per-scaffolder non-interactive-flag audit are in `src/core/CONTEXT.md`'s `run-upstream.ts`
entry. No regressions: 329 tests pass / 1 skip (+6 on top of the verified baseline of 323 pass / 1
skip); `pnpm typecheck` and `pnpm build` both clean.

## Previous pass (D25, 2026-07-11 — `react-native` + `expo` repo types)

Adds two new `RepoType`s, `react-native` and `expo`, and their scaffolders + standard overlays
(decisions.md D25) — this pass covers ONLY the create-nockta-repo side of a cross-package change
also landing in `inject-nockta-skills` (the `RepoType` mirror, two new skill packs, detection) in
the same pass; see that package's own `context.md` for its half. No regressions; 296 tests
pass / 1 skip as of this pass (+16, on top of the verified Milestone-8 baseline of 280 pass/1 skip).

**1. `types/repo-type.ts`** mirrors `inject-nockta-skills` exactly (D7 enum parity) —
`"react-native"` and `"expo"` appended at the end of the union/array, same order both packages.
`test/enum-parity.contract.test.ts` (spawns the REAL built `inject-nockta-skills` dist) confirmed
GREEN post-change.

**2. Two new scaffolders, `src/scaffolders/react-native.ts` and `expo.ts`**, both NOT provisional
(command shapes verified against primary sources — CLI source, real template tarball/repo tree —
`scratchpad/react-native-tooling-research.md`), registered in `scaffolders/registry.ts` (the
`Record<RepoType, ScaffolderDefinition>` completeness check now covers all 8 types, typechecked).
`expo.ts`: `npx create-expo-app@latest <path> --yes --no-install --template default@sdk-57
--no-agents-md`; `react-native.ts`: `npx @react-native-community/cli@latest init <Name>
--directory <path> --skip-install --skip-git-init true`, where `<Name>` is DERIVED from the
target path's basename (`deriveReactNativeAppName()`, exported alongside the scaffolder — the RN
CLI's positional `Name` must be a bare identifier, unlike every other scaffolder here where the
raw target path itself is the positional/named arg).

**3. Two new architecture overlays, `packs/react-native/architecture/standard/` and
`packs/expo/architecture/standard/`**, byte-for-byte the same minimal shape as
`shopify-headless`'s (one `docs/nockta/ARCHITECTURE.md`, zero directories/moves beyond that) —
neither creates an `app/` directory, since the current SDK 57 Expo default template nests
expo-router's file-based routes under `src/app/`, not a bare top-level `app/`.

**4. Test growth: 280→296 pass (+16, 1 skip unchanged).** `test/standard-overlays.test.ts`'s
pre-existing `describe.each(REPO_TYPES)` block automatically gained 8 new tests for the two new
types (4 assertions × 2 types) with zero test-file changes beyond a comment/count update, plus 2
new tests in a new "react-native/expo stay minimal" describe block. `test/scaffolder-registry.test.ts`
gained 6 new tests (both real command shapes, the Name-derivation edge cases — dashes/underscores,
leading-digit basename, all-punctuation basename — and passthrough-arg composition for both).
`test/types.test.ts`'s exact-union assertion was updated (not a new test). `test/list-command.test.ts`
and the wizard-step tests needed ZERO changes — both are already fully data-driven off `REPO_TYPES`/
`listScaffolders()`, so the two new types flow through for free.

**Suite/build:** `pnpm typecheck` clean, `pnpm build` clean, `pnpm test` — 27 files (26 passed, 1
skipped — the env-gated real-scaffolder acceptance suite, unchanged), 296 tests passed / 1 skipped.

**Deviations from the brief, one line each:** (1) `react-native`/`expo` were NOT added to
`select-package-manager.ts`'s `REPO_TYPES_ASKING_PACKAGE_MANAGER` list — that step is explicitly
"record only, not wired into any scaffolder flag" per its own pre-existing header comment, and the
brief didn't ask for it; flagged here since `react-native.ts`'s upstream CLI does accept a `--pm`
flag in principle (unused by this package, same as every other RN CLI flag beyond what's hard-coded).
(2) no dedicated `--packs-root`-equivalent CLI demo exists for create's dry-run proof beyond the
pre-existing `--dry-run` flag itself — used directly (matches every prior milestone's own
proof-of-done pattern, see this file's Milestone 8 section for precedent).

## Index

- **`src/CONTEXT.md`** — purpose, dependencies, key concepts of the CLI source tree.
- **`src/scaffolders/CONTEXT.md`** — the scaffolder registry: one module per `RepoType`, pure
  `buildCommand()` resolution, no child-process execution (Milestone 2). D25 (this pass):
  `react-native.ts`/`expo.ts` added — 8 modules total.
- **`src/core/CONTEXT.md`** — the upstream runner: `run-upstream.ts` (spawn wrapper, structured
  result/failure) and `validate-target-dir.ts` (spec §13 safety checks) — Milestone 3; plus monorepo
  target support: `detect-monorepo-root.ts` (spec §6.2 signals, checked at cwd only) and
  `resolve-target-path.ts` (spec §6.3 nested-target classification, composes `validateTargetDir`) —
  Milestone 5; plus the skills-injector integration: `run-inject-skills.ts` (spec §8 — builds and
  spawns `inject-nockta-skills`'s own CLI, `CREATE_NOCKTA_REPO_TEST_INJECT_BIN` test override, the
  "inject's `InstallData` has no `version` field" finding, and — Milestone 7 — a `dryRun` mode plus
  defensive consumption of inject's new optional `data.version` field) — Milestone 6; plus the repo
  profile: `write-repo-profile.ts`/`read-repo-profile.ts`/`read-package-version.ts` (spec §9,
  per-target placement per decisions.md D5, new exit code 5 on write failure) — Milestone 7.
- **`src/architecture/CONTEXT.md`** — the architecture overlay system: manifest reading/validation,
  manifest applying (dirs/files/moves, never-overwrite, no-rollback-on-failure), dist-safe pack path
  resolution, and the per-repo-type standard-overlay design rationale — Milestone 4.
- **`src/wizard/CONTEXT.md`** (Milestone 7, new) — the REAL interactive create wizard (spec §5.1,
  never separately scheduled by spec §19's milestone list but required by spec §4's wizard-first UX
  principle): the injectable `WizardPrompts` architecture (mirrored, read-only, from
  `inject-nockta-skills`' own `src/wizard/*`), the 10 collected steps + step 11's delegation to the
  existing (reused, not reimplemented) `commands/create.ts` internals, and the preview step's
  decisions.md D18 data-delegation to inject's own `install --dry-run --json`.
- **`README.md`** — user-facing install/usage guide, incl. the wizard.
- **`RELEASING.md`** — maintainer release process: tag push -> `release.yml` -> OIDC trusted
  publishing -> `npm publish --provenance`; first-release bootstrap (npm has no pending-publisher
  mechanism for an unpublished name — verified mid-2026); `inject-nockta-skills` must publish
  first (this package spawns it at runtime); troubleshooting; owner-vs-Fable step split. Not in
  the npm `files` whitelist — doesn't ship in the tarball.
- **`packs/`** — per-repo-type architecture packs (`<repo-type>/architecture/standard/arch.json` +
  `files/`) — real, authored content for all eight repo types (six as of Milestone 4, plus
  `react-native`/`expo` added D25 this pass). See `src/architecture/CONTEXT.md`'s "Standard
  overlays" section for each type's design.
- **`fixtures/scaffolders/`** — tiny fake scaffolders (spec §16.2, Milestone 3) used by
  `test/create-command.integration.test.ts` and friends to exercise the real built CLI without ever
  running a real framework scaffolder. See `src/core/CONTEXT.md`'s "Testing note".
- **`fixtures/inject/`** (Milestone 6) — `fake-inject-failing/` — a tiny fake `inject-nockta-skills`
  stand-in that exits `3` printing nothing to stdout, used only by
  `test/create-skills.integration.test.ts` to engineer a deterministic skill-injection failure (exit
  code 4) without depending on a real render failure in the real sibling package.
- **`test/`** — vitest suite: type-union parity (`types.test.ts`), CLI wiring/help
  (`cli.test.ts`), the implicit-default-command argv rewrite (`resolve-argv.test.ts`), passthrough-arg
  extraction (`passthrough-args.test.ts`), the symlinked-entrypoint regression
  (`symlink-entrypoint.test.ts`), scaffolder registry completeness/passthrough-arg composition
  (`scaffolder-registry.test.ts`), `list`/`list --json` shape (`list-command.test.ts`), the
  upstream runner (`run-upstream.test.ts`), target-dir validation (`validate-target-dir.test.ts`),
  the full built-CLI create flow against fixture scaffolders (`create-command.integration.test.ts`),
  architecture manifest reading (`read-architecture-manifest.test.ts`), the manifest applier
  (`apply-architecture-manifest.test.ts`), all six real standard overlays parsing/applying cleanly
  (`standard-overlays.test.ts`), and the overlay wired into the real create flow — applied,
  `--no-arch`, dry-run plan, overlay-failure exit 3 (`create-architecture.integration.test.ts`).
  Milestone 5 adds: monorepo-root signal detection (`detect-monorepo-root.test.ts`), nested
  target path resolution/classification (`resolve-target-path.test.ts`), and the monorepo-target
  create flow wired into the real built CLI inside a fixture monorepo temp dir — nested create with
  overlay, `isMonorepoTarget`/`monorepo` in `--json`, monorepo-aware dry-run plan, existing-target
  and escape-attempt rejection, non-monorepo-cwd semantics unchanged
  (`create-monorepo.integration.test.ts`). Milestone 6 adds: `run-inject-skills.ts`'s command
  construction, `CREATE_NOCKTA_REPO_TEST_INJECT_BIN` override, and spawn/parse/error paths against
  tiny local fixture scripts (`run-inject-skills.test.ts`), and the headline convergence suite —
  the real built `create-nockta-repo` CLI spawning the REAL built `inject-nockta-skills` CLI:
  standalone install (`.claude/skills/*`, `.claude/agents/worker.md`, `.nockta/{skills-profile,
  generated-manifest}.json`), monorepo-target install (root-only placement, `targets.json` entry,
  no `apps/web/.claude`), `--no-skills`, skill-injection-failure exit code 4 with honest partial
  state, and dry-run command-line printing incl. `--skills-version` pinning
  (`create-skills.integration.test.ts`). The three pre-existing integration test files above were
  updated in the same pass to pass `--no-skills` on their real-run invocations, since skill
  injection stopped being a stub and is now a real, default-on step — keeps them scoped to what
  they've always tested (upstream/overlay/monorepo plumbing), with the skills step itself covered
  by the new suite. Milestone 7 adds: repo-profile write/read round-trip, both placements
  (standalone + monorepo target, decisions.md D5), every field incl. the `skillsVersion` fallback
  chain, `--no-arch` null, a genuine write failure (`repo-profile.test.ts`); the wizard's pure
  planner functions + thin prompt-wrapper functions against a minimal scripted `WizardPrompts`
  fake (`wizard-steps.test.ts`); the full wizard flow (`runWizardFlow()`/`runCreateWizard()`)
  against injected, scripted answers — standalone happy path (asserts the real written profile),
  monorepo-target happy path (profile at the target, never the root), a declined confirm, and the
  preview-unavailable graceful-degradation path — using tiny local fixture inject scripts, never
  live `npx` (`wizard-flow.test.ts`); and the process-level non-TTY matrix proving the wizard is
  never reachable (let alone hung on) from a non-interactive process, for both the default command
  and the standalone `wizard` subcommand (`create-entry-process.test.ts`). The five pre-existing
  tests that asserted Milestone-6-era "not yet written"/"skipped" profile behavior, plus two
  `resolve-argv.test.ts` tests that asserted the OLD unconditional wizard-shell fallback for
  insufficient flags, were updated in the same pass to assert the new, real Milestone 7 behavior —
  the same "keep milestone-N tests honest about milestone-N+1 reality" precedent Milestones 4-6 each
  set against their predecessor's tests. Milestone 8 adds: the D7 drift-guard
  `enum-parity.contract.test.ts` (spawns the REAL, locally built `inject-nockta-skills list --json`,
  building it first only if missing, read-only against the sibling package — never `npx`, since it's
  unpublished — and asserts its reported `repoTypes`/`adapterTypes` exactly match this package's own
  `REPO_TYPES`/`ADAPTER_TYPES`), and the env-gated (`RUN_REAL_SCAFFOLDER_TESTS=1`,
  `describe.skipIf` at collection time so `pnpm test`/CI stay offline by default)
  `real-scaffolder-acceptance.test.ts` — the reproducible harness for decisions.md D6/spec §16.3's
  acceptance proof: a REAL `npx create-next-app@latest` (no fixture override, hits the real npm
  registry), the REAL architecture overlay, and the REAL LOCAL `inject-nockta-skills` dist (via
  `CREATE_NOCKTA_REPO_TEST_INJECT_BIN`, since the sibling is unpublished) — see the worker report
  for this pass for the verbatim evidence from the actual run, and this test file's own header
  comment for exactly what's real vs. overridden. Scope note: this covers the "next" repo type as
  the headline real run (decisions.md D6 requires "a real end-to-end run", not one per type); spec
  §16.3's own six-type matrix is periodic/manual-or-scheduled CI, not this milestone's automation
  scope. Milestone 8 / decisions.md D20 also updated `create-entry-process.test.ts` (new cases
  proving path+`--type` without `--yes` now hits the structured exit-2 error, and that `--dry-run`
  stays exempt) and added `--yes` to every REAL (non-dry-run) invocation across the four
  pre-existing process-level integration suites (`create-command.integration.test.ts`,
  `create-architecture.integration.test.ts`, `create-monorepo.integration.test.ts`,
  `create-skills.integration.test.ts`) — including invocations that test an UNRELATED failure mode
  (unknown `--type`, existing-target rejection, unknown `--arch`, invalid `--adapters`, upstream
  failure) that would otherwise have started tripping the new `--yes` gate first and asserted the
  wrong error message/code entirely; none of these were behavior regressions to fix, only
  invocations to update so each test keeps proving what it always proved.

## Build & tooling notes

- **`pnpm.onlyBuiltDependencies: ["esbuild"]`** (`package.json`) — pnpm gates native
  postinstall/build scripts behind an interactive approval prompt; without this allowlist entry,
  `pnpm install` hangs waiting for approval in headless environments (CI, agents). `esbuild` is
  tsup's bundler and needs its build script to run.
- **`typescript: "^5.9.x"` pin** (`package.json`) — TS 7.x's native (Go-based) compiler breaks
  tsup's `.d.ts` bundling (`dts: true` in `tsup.config.ts`); reproduced locally, not hypothetical.
  Do not bump past 5.9.x until tsup supports the TS 7 compiler.

## Status

Milestone 1 (CLI Skeleton, spec §19) complete: package setup, TS/build/test config, CLI
entrypoint with `create`/`list`/`wizard` routing, wizard shell (prints spec §5.1 step sequence
incl. the D14 skills-version step), local `RepoType`/`AdapterType`/`CreateNocktaRepoOptions` type
mirrors (spec §11.1–11.3), packs skeleton.

Milestone 2 (Scaffolder Registry, spec §19) complete: `src/types/scaffold.ts`
(`ScaffolderDefinition`/`ScaffolderCommand`/`ScaffolderArgsBuilder`) and `src/scaffolders/`
(`registry.ts` + one module per `RepoType` — `next.ts`, `vite-react-ts.ts`, `nest.ts`,
`shopify-app.ts`, `shopify-theme.ts`, `shopify-headless.ts`). `resolveScaffolder()` /
`listScaffolders()` are pure — no child-process execution (that's Milestone 3, Upstream Runner).
See `src/scaffolders/CONTEXT.md` for the passthrough-arg composition rules (including the Vite
`--` separator nuance) and the Shopify isolation/provisional-entry notes.

Milestone 3 (Upstream Runner, spec §19) complete: `src/core/run-upstream.ts` (spawn wrapper —
args always an array, `shell: false`, `stdio: "inherit"` by default, structured
`UpstreamResult`/typed `UpstreamFailure`, `dryRun` short-circuit) and
`src/core/validate-target-dir.ts` (spec §13 — fails structured on an already-existing target,
rejects absolute paths and `..`-escapes). `create` is now wired end to end for what exists: resolve
repo type → validate target → dry run (prints the full plan, never calls the runner, writes
nothing) or real execution (stops immediately with no post-processing on upstream failure, spec
§13). Architecture overlay and skill injection print honest `"skipped (milestone N)"` lines, not
fake success. `fixtures/scaffolders/` (spec §16.2) + `test/create-command.integration.test.ts`
exercise the real built CLI end to end without ever running a real framework scaffolder. See
`src/core/CONTEXT.md` for the runner/validator, the exit-code mapping, and the test-only
fixture-override mechanism.

Two Milestone-2-era defects were fixed in the same pass (both independently verified, not spec
line items):

- **F1** — `commands/list.ts --json` pretty-printed (`JSON.stringify(data, null, 2)`), which
  violates decisions.md D13's "exactly one line" machine-interface contract (a pretty-printed
  object still passes a naive "one `console.log` call" test while embedding real newlines in the
  actual stdout stream). Switched to compact `JSON.stringify(data)`; `commands/create.ts`'s own
  `--json` output was written compact from the start.
- **F2** — `scaffolders/shopify-headless.ts` encoded `npx @shopify/create-hydrogen@latest <path>`
  (positional target path). Verified against shopify.dev's getting-started page and
  `@shopify/create-hydrogen`'s own source (`path` is a named oclif flag, no positional argument
  exists) that the real invocation is `npm create @shopify/hydrogen@latest -- --path <target>`.
  Corrected; still `provisional: true`. Full citations in the module's header comment and
  `src/scaffolders/CONTEXT.md`.

Milestone 4 (Architecture Overlay System, spec §19) complete: `src/types/architecture.ts`
(`ArchitectureManifest`/`ArchitectureFileEntry`/`ArchitectureMoveEntry`, matching spec §7.2 exactly
— `deletes: string[]` exists in the type because the schema documents it, but is disabled at read
time, spec §13) and `src/architecture/` (`get-architecture-path.ts` — dist-safe `packs/<repoType>/
architecture/<preset>/` resolution, mirroring `inject-nockta-skills`' `get-pack-path.ts` pattern;
`read-architecture-manifest.ts` — parse + validate, structured `ArchitectureManifestError` for
malformed JSON/bad schema/unsafe paths/non-empty `deletes`/disallowed top-level fields;
`apply-architecture-manifest.ts` — creates directories, copies `files/`, performs only
explicitly-listed `moves[]` with optional-vs-required missing-source handling, never overwrites an
existing destination, never touches an unlisted file, no rollback on failure). Real, authored
standard overlays for all six repo types under `packs/<repoType>/architecture/standard/` — `next`
is spec §7.2's own worked example verbatim; `vite-react-ts` mirrors it minus the app-router move (no
equivalent convention to move into); `nest` is modules/common-shaped instead of frontend-shaped;
the three Shopify types are deliberately minimal (a single `docs/nockta/` convention folder each,
spec §18.2) because their real structure is entirely upstream-scaffolder-owned. `commands/create.ts`
now follows spec §12.1's step order precisely: resolves + validates the architecture preset (step 3)
*before* validating the target directory, applies the overlay (step 9) only after upstream has
actually succeeded, adds the `--no-arch` flag (spec §5.5, a genuine three-state pairing with
`--arch <preset>` via Commander's negatable-option support) and exit code 3 (architecture overlay
failure, spec §5.9) — an unknown `--arch` preset is exit 2 (bad flag value, same bucket as unknown
`--type`) while every other manifest/apply failure is exit 3. Dry run now prints the real
architecture plan read from the actual manifest (spec §5.7) instead of a "Milestone 4" skip stub;
`--json` output's `architectureChanges` (spec §11.4) is always present, populated once the overlay
actually applies. Skill injection and repo-profile writing (spec §12.1 steps 10–11) remain honest
`"skipped (milestone N)"` lines. See `src/architecture/CONTEXT.md` for the full module-by-module
detail, the per-type overlay design rationale, and the `CREATE_NOCKTA_REPO_TEST_ARCH_DIR` test-only
escape hatch used to engineer a deterministic overlay failure in integration tests.

Milestone 5 (Monorepo Target Support, spec §19/§6) complete: `src/core/detect-monorepo-root.ts`
(spec §6.2 — `pnpm-workspace.yaml`, `turbo.json`, `nx.json`, `lerna.json`, `rush.json`,
`package.json` `workspaces` in either array or object form; checked at `cwd` only, no upward
directory walk — spec §6.3's own example already has the user `cd`'d into the monorepo root) and
`src/core/resolve-target-path.ts` (spec §6.3 — classifies a target path as a monorepo target, a
nested-but-standalone create, or a plain standalone create; composes `validateTargetDir()` rather
than duplicating its already-exists/absolute-path/`..`-escape checks, exactly the refactor
`src/core/CONTEXT.md` had flagged as likely back in Milestone 3). `commands/create.ts` now calls
`resolveTargetPath()` in place of `validateTargetDir()` at the same point in the step sequence —
one code path serves both spec §12.1 (standalone) and §12.2 (monorepo target) flows, distinguished
only by what that call classifies, not by a separate branch. The plan/`--json` output carries
`isMonorepoTarget` (spec §11.4, now given a formal home in `src/types/create-result.ts`'s
`CreateNocktaRepoResult`, re-exported from `src/index.ts`) plus a `monorepo` detail object
(`isMonorepoRoot`, `signals`, `isNestedPath`, `infoLine`); dry-run human/`--json` output is
monorepo-aware. Skill injection and repo-profile/root-metadata writing (spec §12.1 steps 10-11,
§12.2 steps 5-6, Milestones 6-7) remain honest `"skipped (milestone N)"` stubs — no `.nockta/`
directory is written anywhere by this milestone — but the metadata stub now also carries the
*future* root-`.nockta/targets.json` intent for a monorepo target (decisions.md D5: that file is
inject-owned, only triggered by create in Milestone 6) so dry-run output isn't silent about it.
`test/create-monorepo.integration.test.ts` exercises the real built CLI inside a fixture monorepo
temp dir (`pnpm-workspace.yaml`, spec §16.2-style fixtures) — nested create with fixture marker +
architecture overlay both landing inside `apps/web`, `isMonorepoTarget: true` in `--json`,
monorepo-aware dry run, existing-target and `..`-escape rejection (exit 2, nothing written), and
explicit non-monorepo-cwd checks (plain name unchanged; nested-looking path at a non-monorepo cwd
is a standalone create at that path, not a monorepo target — documented behavior, not a silent
reinterpretation). See `src/core/CONTEXT.md` for the module-by-module detail.

Milestone 6 (Skills Injector Integration, spec §19/§8) complete: `src/core/run-inject-skills.ts`
(spec §8, decisions.md D4) — `buildInjectSkillsCommand()` (pure command construction: standalone
`install --type <repoType> --adapters <list> --yes --json`; monorepo target `install --target
<path>:<type> --adapters <list> --yes --json` at the monorepo root, spec §6.4/§6.5, decisions.md
D5; default `npx inject-nockta-skills@latest`, `--skills-version` switches to `npx
inject-nockta-skills@<version|dist-tag>`, spec §5.2/§8.1; `CREATE_NOCKTA_REPO_TEST_INJECT_BIN`
test/dev override, mirroring the Milestone 3/4 `FIXTURE_BIN`/`ARCH_DIR` pattern) and
`runInjectSkills()` (spawns for real, parses inject's single-line `--json` result per its own
spec §7.9 contract, typed `InjectSkillsFailure` on nonzero exit/signal/unparseable output carrying
the exit code + a bounded stderr tail). **Finding, not an assumption**: inject's real `InstallData`
`--json` shape carries no `version` field anywhere — verified by running its actual built
`dist/cli.js` during this milestone's build — so the resolved `skillsVersion` (spec §9.2) is read
from the `.nockta/skills-profile.json` file inject itself just wrote instead
(`readInjectedSkillsVersion()`), never from the `--json` result. `commands/create.ts` now runs the
skills step for real after the architecture step succeeds (or is legitimately skipped via
`--no-arch`) and before repo-profile writing (still Milestone 7): new `--no-skills` flag (spec
§5.6), `--adapters <list>` validated against `ADAPTER_TYPES` (default `"claude"`, exit code 2 on an
unknown value), `--skills-version` now real (was a stub). A skill-injection failure produces the
new `"skills-failed"` outcome kind, `process.exitCode = 4` (spec §5.9 — every documented exit code
now has a real producer), reporting the honest partial state (project + architecture overlay
already exist, only skills failed, no rollback — `upstream`/`architecture` in the `--json` output
prove it). `skillsInjected` (spec §11.4, top-level boolean) and a richer `skills` detail object
(mirroring `architecture`'s own plan/attempted/real-outcome branching) flow through the
plan/`--json` output; for a monorepo target where skills actually ran, the metadata skip stub's
`rootMetadataIntent` note is upgraded from "would happen" to "did happen, here's where" (root
`.nockta/targets.json`/`skills-profile.json` really were written this run, by
`inject-nockta-skills`) while `status`/`reason` stay "skipped"/Milestone 7, since
`repo-profile.json` itself genuinely isn't written yet. Dry run prints the exact
`inject-nockta-skills` command that would run (spec §5.7) without ever spawning it.

**The headline proof** (this milestone's actual point): `test/create-skills.integration.test.ts`
spawns the real built `create-nockta-repo` CLI, which spawns the REAL built
`inject-nockta-skills` CLI (built in the test's own `beforeAll` if its `dist/` is missing — read-only
against the sibling package, never touching its source) — the actual two-package convergence, not a
fake on either side. Standalone: `.claude/skills/{paper-trail,proof-of-done,subagent-delegation}/`,
`.claude/agents/worker.md`, `.nockta/{skills-profile,generated-manifest}.json` all verified to exist
with correct key fields. Monorepo target `apps/web`: root-only `.claude/`+`.nockta/targets.json`
(with an `apps/web` entry), explicitly asserting `apps/web/.claude` does NOT exist. Plus `--no-skills`
(nothing written), the exit-code-4 failure path (via `fixtures/inject/fake-inject-failing/`, exits
`3`), and dry-run command-line assertions including `--skills-version` pinning. `test/run-inject-skills.test.ts`
covers the module directly — command construction (including the real `npx` path, code-path only,
no live network — the ONLY way to test that path until `inject-nockta-skills` is published) and
spawn/parse/error behavior against tiny local fixture scripts (not the real sibling package).

20 vitest suites (up from 17), **202 tests** (175 M1–M5 + 27 new this pass, zero regressions — three
M3-5-era integration test files were updated, not broken: `create-command.integration.test.ts`,
`create-architecture.integration.test.ts`, and `create-monorepo.integration.test.ts` now pass
`--no-skills` on their real-run invocations, since skill injection stopped being a stub and became
a real, default-on step; one dry-run assertion in `create-command.integration.test.ts` was updated
from asserting a "Milestone 6" skip-stub string to asserting the real printed inject command line,
the same "keep milestone-N tests honest about milestone-N+1 reality" precedent Milestone 4 set
against Milestone 3's file).

Milestone 7 (Repo Profile, spec §19/§9) complete — AND, alongside it, the real interactive wizard
(spec §5.1/§4), which spec §19's own milestone list never separately schedules but spec §4's
wizard-first UX principle requires; this package's Milestone 1 print-only wizard shell had never
been upgraded until now.

**Repo profile**: `src/types/profile.ts` (`NocktaRepoProfile`, matching spec §9.2 exactly, incl.
field order matching the spec §9.3 example) + `src/core/write-repo-profile.ts`/`read-repo-profile.ts`
(spec §9 — `<target>/.nockta/repo-profile.json`, ALWAYS the target's own root, decisions.md D5;
never a monorepo-root write) + `src/core/read-package-version.ts` (this package's own running
version for the profile's `version` field, reusing `architecture/get-architecture-path.ts`'s
dist-safe package-root resolution). `commands/create.ts` writes the profile as the TRUE final step
(spec §12.1 step 11/§12.2 step 6) once skills has resolved (injected or `--no-skills`-skipped) —
`skillsVersion` is populated from the ALREADY-resolved chain in `core/run-inject-skills.ts` (see
below); `adapters` is populated only when skills actually injected (a judgment call: recording
adapters for a run where skill injection never happened would misrepresent what was configured,
flagged as a deliberate reading of the spec §9.2 type's optionality, not a spec-stated rule). A
genuine write failure (`WriteRepoProfileError`) is a NEW `"profile-failed"` outcome kind and a NEW
exit code **5** — spec §5.9's table stops at 4, but every milestone since 4 has added its own
failure-surface code (`3` for the overlay, `4` for skills) rather than folding a new failure into
an existing bucket, and this milestone's own brief was explicit: "a created project without its
profile is incomplete" — recommending failing loudly, not warning-and-continuing. Dry run now
prints the REAL repo-profile plan (path + a field preview) in place of the old "skipped (milestone
7)" stub (spec §5.7's "print the metadata plan" requirement). `CreateNocktaRepoResult` (spec §11.4)
is now FORMALLY assembled (`buildCreateNocktaRepoResult()`) — `projectDir`/`warnings` (deferred by
Milestone 6) are real; the `--json` envelope carries it under a new `result` key alongside the
existing richer per-status fields, and `projectDir` is also added as a top-level alias.
`core/run-inject-skills.ts` gained a `dryRun` option (used only by the wizard's preview step, see
below) and now PREFERS inject's own `--json` `data.version` field for the resolved `skillsVersion`
when present (a field landing on inject's `install` command in the SAME batch, a sibling worker's
pass — not yet verified against a real build the way the rest of that module's mirrored shape was,
flagged explicitly), falling back to the pre-existing `.nockta/skills-profile.json`-read workaround
unchanged when it's absent.

**The real wizard** (spec §5.1, `src/wizard/`, architecture read-only mirrored from
`inject-nockta-skills`' own `src/wizard/*` per this milestone's own brief): an injectable
`WizardPrompts` interface (`prompts.ts`) backing 8 step modules under `steps/` — project path +
monorepo-target detection (auto-detected/narrated, not a real prompt — there is no
`--monorepo-target` flag to answer with), repo type (lists from the scaffolder registry), package
manager (spec §5.1 step 4 — RECORD ONLY, never wired into any scaffolder invocation or the profile,
since neither has a package-manager field/flag today), architecture preset (enumerates real bundled
presets via `listArchitecturePresets()`), AI adapters, inject-nockta-skills version (decisions.md
D14 — latest default, custom-entry input), advanced scaffolder args, and confirm. The PREVIEW step
(decisions.md D18) shows TWO things: `commands/create.ts`'s own plan — via a NEWLY EXPORTED,
side-effect-free `resolveCreatePlan()` extracted from what used to be the first half of
`runCreateCommand()` itself — and inject's REAL resolved skills plan, fetched by spawning inject
`install --dry-run --json` (the SAME `buildInjectSkillsCommand()`/`runInjectSkills()` the real
write path uses, with a new `dryRun` flag, never a duplicated command-construction path); ANY
failure fetching that plan (a spawn error, a nonzero exit — e.g. an inject build predating
`--dry-run`, unparseable output) degrades gracefully to a "skills plan unavailable" warning and the
wizard still proceeds — this milestone's brief was explicit that this must hold unconditionally, as
the real production behavior, not only as a stopgap. Once confirmed, step 11 hands off to
`commands/create.ts`'s own EXPORTED `runCreateCommand()` directly — reused, never reimplemented, so
a wizard-driven create has identical exit codes/`--json` shape/safety guarantees to the flag-driven
path. Routing (`src/commands/create-entry.ts`, new — mirrors `inject-nockta-skills`'
`commands/install-entry.ts` exactly): sufficient flags (`projectNameOrPath` AND `--type`, the SAME
gate this package has used since Milestone 1, deliberately NOT widened to also require `--yes` the
way inject's own gate does — this package's non-interactive path never has) -> the unchanged
non-interactive path; insufficient + a real TTY -> the real wizard, with whatever partial flags WERE
given threaded through as step presets; insufficient + non-TTY -> a structured, NEVER-HANGING error
(one JSON line under `--json`, exit code 2). The standalone `wizard` subcommand (pre-existing since
Milestone 1) gets the identical TTY gate now that running it for real from a non-TTY process would
otherwise hang on `@inquirer/prompts`.

24 vitest suites (up from 20), **247 tests** (212 M1–M6 + 35 new this pass, zero regressions — seven
M1-6-era tests were updated, not broken, to assert the new real Milestone 7 behavior in place of
what used to be honest "not implemented yet" stubs: five profile-related assertions across
`create-command.integration.test.ts`, `create-monorepo.integration.test.ts`, and
`create-skills.integration.test.ts` now assert the real written/planned repo profile instead of a
"skipped"/"Milestone 7" stub string, and two `resolve-argv.test.ts` tests now assert the new
TTY-aware structured error instead of the old unconditional wizard-shell fallback for a non-TTY
spawned process with insufficient flags — the same "keep milestone-N tests honest about
milestone-N+1 reality" precedent Milestones 4-6 each set against their predecessors' tests).
Real, built-CLI proof of the profile at both placements (standalone + monorepo target, `--no-skills`
`skillsInjected: false`), the wizard's full step sequence via scripted prompts (standalone +
monorepo-target happy paths, a declined confirm, the preview-unavailable graceful path), and the
non-TTY matrix (default command + `wizard` subcommand, never hanging, never reaching a real prompt)
are documented in the worker report for this pass; see `src/core/CONTEXT.md` and
`src/wizard/CONTEXT.md` for the full module-by-module detail.

Milestone 8 (Testing and Publish Prep, spec §19) complete: the real-scaffolder acceptance proof,
the enum-parity contract test, `--yes` alignment (decisions.md D20), and publish preparation.

**Decisions.md D20 — non-interactive EXECUTION now requires `--yes`.** Supersedes Milestone 7's
own `commands/create-entry.ts::hasSufficientCreateFlags()` note above ("deliberately NOT widened
... this package's non-interactive path never has") — that was Milestone 7's real, accurate
behavior at the time; D20 changes it. `hasSufficientCreateFlags()` is now `projectNameOrPath` AND
`--type` AND (`--yes` OR `--dry-run`) — the exact shape `inject-nockta-skills`' own
`hasSufficientInstallFlags()` has always had, aligning the two sibling CLIs and matching spec
§5.2's own worked example (which already showed `--yes` on its non-interactive `create` call).
`--dry-run` stays exempt (never writes, never needs confirmation) and the real interactive wizard
stays unaffected (`wizard/run-create-wizard.ts::runCreateWizard()` calls `runCreateCommand()`
directly for its own step 11 without ever setting `cliOptions.yes` — the interactive step-10
confirm prompt IS the confirmation; the `--yes` requirement lives at the `create-entry.ts` ROUTING
layer specifically so it can never reach that call). One real, deliberate, and explicitly
documented consequence: a real-TTY invocation with a path and `--type` but no `--yes` (and no
`--dry-run`) now falls through to the wizard (presets threaded from whatever WAS given) rather
than running straight through non-interactively as it did through Milestone 7 — see
`src/commands/create-entry.ts`'s own header comment and `src/CONTEXT.md` for the full reasoning.

**The enum-parity contract test** (spec §16.2, decisions.md D7 — a long-standing gap, flagged but
never built through Milestone 7): `test/enum-parity.contract.test.ts` spawns the REAL, locally
built `inject-nockta-skills list --json` (building it first only if its `dist/` is missing,
read-only against the sibling package) and asserts its reported `repoTypes`/`adapterTypes` sets
exactly match this package's own local `REPO_TYPES`/`ADAPTER_TYPES` mirrors. Passes as of this
pass — no drift found. Runs `npx inject-nockta-skills list --json` in spec §16.2's own literal
wording; substitutes the real LOCAL dist here instead (`node <sibling dist/cli.js> list --json`)
because the sibling package is unpublished and this milestone forbids `npm publish` — flagged
explicitly as a deliberate, documented substitution of the resolution mechanism only, not of the
CLI being tested (same substitution `core/run-inject-skills.ts`'s own
`CREATE_NOCKTA_REPO_TEST_INJECT_BIN` override already makes everywhere else in this suite).

**THE ACCEPTANCE PROOF** (decisions.md D6, spec §16.3): one REAL end-to-end run performed this
pass in a scratch temp directory — `npx create-next-app@latest` over the real network (no fixture
override; the default `https://registry.npmjs.org/`, no custom registry configured anywhere in
this package), then the real `packs/next/architecture/standard/` overlay, then the REAL LOCAL
`inject-nockta-skills` dist (via `CREATE_NOCKTA_REPO_TEST_INJECT_BIN`, the only override —
everything else in the chain, including the upstream scaffolder, was completely real). Exit code
0; real Next.js 16.2.10 + React 19.2.4 app (`node_modules` really `npm install`-ed, 358 packages);
overlay applied (`src/components/ui`, `src/features/_template/`, `src/app/page.tsx` moved to
`src/app/(public)/page.tsx`); `.claude/skills/{paper-trail,proof-of-done,subagent-delegation}/`
+ `.claude/agents/worker.md` real inject output; `.nockta/repo-profile.json` +
`skills-profile.json` + `generated-manifest.json` all written, profile fields correct
(`skillsInjected: true`, `skillsVersion: "0.1.0"`, `adapters: ["claude"]`). No retry was needed —
the first attempt succeeded cleanly; full verbatim evidence (exit code, tree listing, profile
JSON, timing) is in the worker report for this pass, not duplicated into this file per the
"pointers and one-line takeaways only" doc-layout profile stated at the top of this file. Encoded
as a reproducible, opt-in test file, `test/real-scaffolder-acceptance.test.ts`
(`RUN_REAL_SCAFFOLDER_TESTS=1`-gated via `describe.skipIf` at collection time) — `pnpm test`/CI
stay offline and fast by default (this is the ONLY test file in the suite that touches the
network); re-run confirmed the harness itself passes against the same real chain. Scope: covers
the "next" repo type as the headline run — decisions.md D6 requires "a real end-to-end run", not
one per supported type; spec §16.3's own six-type matrix (vite-react-ts, nest, the three Shopify
types) is periodic/manual-or-scheduled CI, explicitly left as follow-on scope, not automated by
this milestone.

**Publish preparation** (`package.json`): added `"private": true` (safety default — the owner
removes it immediately before the real first `npm publish`; parity with the `inject-nockta-skills`
sibling package, which already carries it), `exports` (mirrors the sibling's `.`/`types`/`import`
shape, was previously missing here), `publishConfig.access: "public"`, and `README.md` in `files`
(alongside the already-present `dist`/`packs` — the architecture overlay packs, verified in the
tarball listing below to actually ship). Removed the unused `fs-extra`/`@types/fs-extra`
dependency (flagged "still unused" since Milestone 1; every filesystem write in this package has
always used plain `node:fs`) — `pnpm install` re-run to keep the lockfile honest. Removed the
placeholder `"license": "UNLICENSED"` field entirely rather than guessing a real license —
license choice is an explicit OWNER pre-publish decision, not invented by this milestone; see
this package's own `README.md` "License" section for the same note where a user/owner will
actually see it. `npm pack --dry-run` was run via the same transient `private: false` flip the
`inject-nockta-skills` sibling package already used (flipped, packed, flipped back — the tree was
never left modified; verified via a pre/post file read and a clean `pnpm build`/`pnpm test` run
afterward): 25 files, 93.0 kB packed / 352.8 kB unpacked, `dist/*` present, all six repo types'
`packs/<type>/architecture/standard/{arch.json,files/}` present, `README.md` present, and —
verified explicitly, not just eyeballed — no `fixtures/`, `test/`, or `src/` anywhere in the
listing. Full tarball listing is in the worker report for this pass.

`cli.ts`'s `--yes` help text and the `list` subcommand's stale "placeholder in Milestone 1"
description (accurate through Milestone 1, wrong ever since `list` became registry-wired in
Milestone 2 — found during this milestone's "accurate, not aspirational" README pass) were both
corrected in the same pass — small, in-scope doc-accuracy fixes, not new features.

**Known, deliberately undocumented-as-functional gap found this pass, not fixed** (out of this
milestone's scope, flagged rather than silently left for someone to discover via `--help`): the
`create` subcommand's `--force` flag is parsed by `cli.ts` and threaded onto
`CreateCommandCliOptions.force`, but is never read anywhere in `commands/create.ts` — it does
nothing. `README.md`'s flags reference documents this explicitly rather than describing invented
behavior for it.

25 vitest suites (up from 23; 24 run under `pnpm test`, the 25th —
`real-scaffolder-acceptance.test.ts` — is present but `describe.skipIf`-skipped by default, network-
gated), **252 tests run + 1 skipped by default = 253** (247 M1–M7 + 3 new D20 cases in
`create-entry-process.test.ts` + 2 new this pass unconditionally [`enum-parity.contract.test.ts`]
+ 1 skipped-by-default [the real-scaffolder acceptance test], zero regressions — the four pre-existing
process-level integration suites listed in the Index above had `--yes` added to their REAL
(non-dry-run) invocations, including ones testing an unrelated failure mode that would otherwise
have started tripping the new `--yes` gate first; every such update keeps that test proving what
it always proved, none is a behavior regression). Full suite, typecheck, and build all green — see
the worker report for this pass for exact before/after counts and the `--yes`-missing exit-2
error demonstrated against the real built CLI.
