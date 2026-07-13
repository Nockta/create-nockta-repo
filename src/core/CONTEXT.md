# CONTEXT.md — src/core/

## Purpose

The upstream runner (spec §10, §19 Milestone 3), monorepo target support (spec §6, §19 Milestone
5), the skills-injector integration (spec §8, §19 Milestone 6), and — new this pass — the repo
profile writer/reader (spec §9, §19 Milestone 7): the primitives the `create` command composes to
actually run a scaffolder into the right place, classify/validate the target, spawn
`inject-nockta-skills` for real (including its new dry-run preview mode, Milestone 7), and record
what happened as `.nockta/repo-profile.json`. Still not present: `create-repo.ts`,
`apply-architecture.ts` (that logic lives in `src/architecture/`, not `core/` — see
`src/architecture/CONTEXT.md`), `resolve-repo-type.ts`, `resolve-adapters.ts` — adapter
parsing/validation is real as of Milestone 6 but lives inline in `commands/create.ts`'s own
`parseAdapters()`, not a separate `core/` module, since it's a five-line pure function with one
caller (see `commands/create.ts`'s own header comment). Orchestration lives directly in
`commands/create.ts`, not in a `core/create-repo.ts` orchestrator — see that file's own header
comment for why (the combined scope is still small enough that a separate orchestrator would just
be an extra hop).

## Modules

- **`run-upstream.ts`** — thin wrapper over `node:child_process.spawn`. `shell: false` always;
  args are always an array, never shell-interpolated (verified in
  `test/run-upstream.test.ts`'s "no shell interpolation" case, which round-trips a
  semicolon/backtick-laden string through untouched). Defaults `stdio` to `"inherit"`
  unconditionally for every scaffolder — not just the Shopify family — because even the
  "non-interactive" ones (create-next-app, create-vite, @nestjs/cli) can prompt when passthrough
  args under-specify options; branching stdio per `interactiveStdio` would just mean guessing
  wrong sometimes. Resolves a structured `UpstreamResult` (`{ok, exitCode, signal, command, args,
  durationMs}`) on success; throws the typed `UpstreamFailure` (carries the same `.result`, plus
  the original spawn error as `.cause` when the command couldn't even launch) on anything else.
  Supports `cwd` and a `dryRun` short-circuit that never calls `spawn` at all — belt-and-suspenders
  on top of `commands/create.ts`'s own dry-run branch, which already never calls this module in
  the first place.
  **Headless-scaffolder `CI=true` fix (verified bug, fixed this pass):** `stdio: "inherit"` alone
  is not enough when nobody is actually watching the inherited stdio — an AI agent/CI driving
  `create` non-interactively, or the `--web` submit path (`web/run-create-web.ts`, running inside
  an HTTP handler, not a terminal a human is reading). In that shape, upstream scaffolders like
  `create-next-app` print their interactive prompt, get no input, and exit 0 having written
  **nothing** — unless their own env has `CI` set. Verified directly against bare `npx
  create-next-app@latest`: non-TTY + no `CI` → no files; `CI=true` → scaffolds correctly. Fix:
  `RunUpstreamOptions.forceCI` (opt-in per call) merges `CI: "true"` onto `{...process.env}` (never
  drops the rest of the env, never clobbers an already-truthy `CI` the caller set).
  `commands/create.ts` passes `forceCI: cliOptions.yes === true` — true for BOTH the CLI `--yes`
  flag and the `--web` submit path (`answersToCliOptions()` always sets `yes: true`), false for the
  wizard path (`runCreateWizard()` calls `runCreateCommand()` without `--yes`, and
  `commands/create-entry.ts` only ever reaches the wizard when `isTTY` is real — so that path stays
  genuinely interactive, e.g. for the Shopify family's own prompts, and must not have `CI` forced
  on it). Proven at three levels: the unit-level `forceCI` behavior itself
  (`test/run-upstream.test.ts`'s `forceCI` describe block — sets/doesn't-clobber/doesn't-drop-rest-
  of-env), the real built CLI's `--yes` path end to end
  (`test/create-command.integration.test.ts`'s "headless-scaffolder CI=true fix" case, spawning the
  actual `dist/cli.js`), and the real `--web` submit path end to end
  (`test/web-create-e2e.test.ts`'s POST `/submit` test, asserting the fixture scaffolder's marker
  records `CI: "true"`) — all three delete the ambient `CI` first so the assertion can't pass
  vacuously under a CI runner that already has `CI=true`. Per-scaffolder non-interactive flags were
  also checked while fixing this: `create-expo-app` already passes `--yes` (own comment in
  `scaffolders/expo.ts`); `create-vite` is fully arg-driven (template + path, no prompt surface);
  `create-next-app`, `@nestjs/cli`, `@react-native-community/cli`, and the Shopify CLI family were
  NOT given an additional flag — `CI=true` alone was the verified, sufficient fix, and stacking a
  per-tool flag on top wasn't justified without an equally concrete repro for that tool.
- **`validate-target-dir.ts`** — spec §13: fails with a structured `InvalidTargetDirError` (same
  convention as `scaffolders/registry.ts`'s `UnknownRepoTypeError` — a typed class with a `.code`,
  not a bare string throw) if the target directory already exists; `create-nockta-repo` never
  merges into an existing directory. Also enforces two path-safety rules that are this module's
  own explicit call, not spec-mandated line items: absolute target paths are rejected
  (`absolute-path-not-allowed`) and any target that resolves outside `cwd` via `..` traversal is
  rejected (`escapes-parent`). Every spec §5.2–§5.4 example uses a plain relative path; there's no
  documented use case for either, and allowing them would let the tool write anywhere on disk.
  Pure synchronous `fs.existsSync` check — never creates, deletes, or writes anything itself
  (verified directly in `test/validate-target-dir.test.ts`'s "does not create, delete, or write
  anything" case). As of Milestone 5, `resolve-target-path.ts` (below) is the module that now
  "owns" path resolution end to end — it composes this module's checks unchanged rather than
  duplicating them; `validate-target-dir.ts` itself did not change at all in Milestone 5.
- **`detect-monorepo-root.ts`** (Milestone 5, spec §6.2) — pure synchronous detection of whether
  `cwd` **itself** carries one or more monorepo-root signals: `pnpm-workspace.yaml`, `turbo.json`,
  `nx.json`, `lerna.json`, `rush.json` (plain `existsSync` checks), or `package.json`'s own
  `workspaces` field in either the array form (`["packages/*"]`) or the object form
  (`{ packages: [...] }`, yarn nohoist) — an empty array/list still counts, since the field's mere
  presence is the signal (spec §6.2 states no minimum-entries rule). Deliberately does **not** walk
  upward through ancestor directories looking for a root — spec §6.3's own worked example is `cd
  existing-monorepo && npx create-nockta-repo apps/web ...`, i.e. the user is expected to already be
  standing at the root; an upward walk would be a different, unspecced feature. A malformed
  `package.json` is tolerated (not a usable signal, not a thrown error) rather than surfaced —
  detection must stay a tolerant, best-effort read. Returns every matching signal, not just the
  first, since a real monorepo commonly carries more than one at once.
- **`resolve-target-path.ts`** (Milestone 5, spec §6.3) — `resolveTargetPath(targetPath, {cwd})`
  composes `detectMonorepoRoot(cwd)` + `validateTargetDir(targetPath, {cwd})` (unchanged safety
  checks — `already-exists`/`absolute-path-not-allowed`/`escapes-parent` propagate through as the
  same `InvalidTargetDirError`, no new error type) and adds monorepo-target classification on top,
  as a superset of `ValidateTargetDirResult`. Three cases (spec §6.2/§6.3, and this module's own
  explicit semantics for the third, since the spec only describes the first two):
  1. **monorepo root detected at `cwd`** — any target path (nested or not) is
     `isMonorepoTarget: true`, `infoLine` names the detected signals;
  2. **nested-looking path (`apps/web`) at a non-monorepo `cwd`** — `isMonorepoTarget: false`; this
     is a standalone create at that relative path, not a monorepo target — an `infoLine` documents
     this explicitly rather than silently reinterpreting the path;
  3. **plain name at a non-monorepo `cwd`** — the original Milestone 1-4 standalone flow,
     byte-for-byte unchanged: `isMonorepoTarget: false`, `infoLine: null`.

  "Stays inside the repo" (spec §6.3 point 1) and "must not exist" fall directly out of composing
  `validateTargetDir` unchanged — a monorepo root is detected at `cwd` itself in MVP (no upward
  walk), so "inside the repo" and "inside `cwd`" are the same boundary. "Parent dirs may be
  created" (spec §6.3) is left to the upstream scaffolder, same as `validateTargetDir` already
  leaves the target directory itself to be created downstream — this module is pure, no
  filesystem writes.
- **`run-inject-skills.ts`** (Milestone 6, spec §8) — builds and spawns `inject-nockta-skills`'s
  own CLI as a child process (decisions.md D4: never an npm dependency, never a programmatic
  import). Two pieces, deliberately split so dry-run can use the first without ever touching the
  second (same "resolve first, spawn separately" pattern `run-upstream.ts`/`commands/create.ts`
  already use for the upstream scaffolder command):
  - `buildInjectSkillsCommand({mode, repoType, adapters, skillsVersion?, targetPath?, cwd})` — pure,
    no spawning. `mode: "standalone"` builds `install --type <repoType> --adapters <list> --yes
    --json`; `mode: "monorepo-target"` builds `install --target <path>:<type> --adapters <list>
    --yes --json` (decisions.md D9's canonical colon form) and requires `targetPath`. Binary
    resolution: `CREATE_NOCKTA_REPO_TEST_INJECT_BIN` env var wins if set (`node <that path>
    install ...`); otherwise `npx inject-nockta-skills@latest` or, with `skillsVersion` set, `npx
    inject-nockta-skills@<version|dist-tag>` (spec §5.2/§8.1). Returns `{command, args, cwd,
    commandLine, usesTestOverride}` — `commandLine` is what `commands/create.ts`'s dry-run plan
    prints verbatim (spec §5.7, this milestone's brief item 3).
  - `runInjectSkills(options)` — spawns the built command for real
    (`stdio: ["ignore","pipe","pipe"]`, `shell: false`), captures stdout/stderr, and resolves a
    structured `InjectSkillsSuccess` (`{ok, command, args, cwd, exitCode, durationMs, result,
    skillsVersion}`) or rejects with a typed `InjectSkillsFailure` (`.details`: `reason`
    — `"spawn-error" | "nonzero-exit" | "unparseable-output"` — plus `exitCode`, `signal`, `stdout`,
    a bounded `stderrTail`). Spec §7.9's own contract ("`--json` prints exactly one structured
    result object to stdout") is enforced literally: zero lines, more than one line, or invalid
    JSON on stdout is `"unparseable-output"`, never guessed at; any nonzero exit or signal is
    `"nonzero-exit"` regardless of what (if anything) parsed. `result` is `InjectJsonResult` — a
    **local mirror** of inject's `install` command's real `--json` shape (`InjectInstallData`:
    `installedPacks`, `skippedPacks`, `renderedFiles`, `profilePath`, `manifestPath`, `isMonorepo`,
    `targets`, `targetsPath`, `warnings`, …), verified directly against its actual built
    `dist/cli.js` output during this milestone's build, the same "duplicate the contract, don't
    import it" posture decisions.md D7 already applies to `RepoType`/`AdapterType`.
  - **`buildInjectSkillsInteractiveCommand({mode, repoType, repoTypes?, skillsVersion?, targetPath?,
    cwd})` + `runInjectSkillsInteractive(options)` (decisions.md D29, this pass)** — the INTERACTIVE
    create→inject handoff. The builder produces `install --type <types>` (standalone) or
    `install --target <path>:<type>[+<type>...]` (monorepo-target) and NOTHING else — deliberately NO
    `--adapters`, NO `--yes`, NO `--json`: the point of D29 is to hand the user to inject's OWN wizard
    (which asks for adapters/skills/razor) with only the type step pre-filled. Same binary resolution
    as `buildInjectSkillsCommand` (the `CREATE_NOCKTA_REPO_TEST_INJECT_BIN` override IS honored here
    too — brief item E; `--skills-version` still pins the npx `@<version>` spec). `runInjectSkillsInteractive`
    spawns it with **`stdio: "inherit"`** (inject's wizard talks to the real terminal — nothing to
    capture) and RESOLVES with inject's exit code on close, EVEN when non-zero (a user declining
    inject's confirm is their choice, not a create crash — `commands/create.ts` records that as
    skills-not-injected and still exits 0); only a genuine unspawnable-command failure rejects with a
    typed `InjectSkillsFailure` (`spawn-error`, exit 4). `commands/create.ts` branches on
    `cliOptions.yes !== true`: no `--yes` (every wizard-driven run, per D20) → this interactive
    handoff; `--yes` → the captured headless `runInjectSkills` above, exactly as before. In the
    interactive branch create reads the resolved inject version best-effort from the
    `.nockta/skills-profile.json` inject itself wrote (there is no captured `--json`). Covered by
    `test/inject-handoff.test.ts` (argv construction + the spawn contract) and
    `test/wizard-flow.test.ts` (the real handoff argv end to end via a local fixture inject bin).
  - **Finding worth flagging**: inject's real `InstallData` shape carries **no `version` field
    anywhere** — spec §9.2's "`skillsVersion` is... the actual resolved version `inject-nockta-skills`
    ran as, read from its own `--json` result" cannot be read from `result.data` at all. The
    resolved version is instead read from the `.nockta/skills-profile.json` file inject itself just
    wrote (`readInjectedSkillsVersion(result.data.profilePath)` — both the single-project and
    monorepo profile shapes carry a top-level `version` field). Never throws; a missing/unreadable
    profile just yields `null` (best-effort, doesn't fail an otherwise-successful install).
  - **D22 additions (worker pass adding create's own `--also <type>[,<type>...]` flag,
    decisions.md D22, spec §5.2)**: `BuildInjectSkillsCommandOptions` gains an optional
    `repoTypes?: readonly string[]` — the D22 union (primary first, then any `--also`
    secondary skill-domain types) — which WINS over the pre-existing, now-legacy singular
    `repoType: string` when non-empty (`resolveTypesArg()`); every pre-`--also` caller/test
    keeps working unchanged by passing only `repoType`. The two modes join the union with
    DIFFERENT separators, verified against inject's own real
    `core/parse-targets.ts::parseTargetArgs()`: standalone joins with `,` for `--type`
    (`install --type next,vite-react-ts ...`); monorepo-target joins with `+` INSIDE the
    colon `--target <path>:<type>[+<type>...]` form (`install --target apps/web:next+vite-react-ts
    ...`) — never the same separator for both, since inject's colon-form parser specifically
    expects `+`, not `,`, on the right-hand side of the colon. `commands/create.ts`'s own
    `resolveCreatePlan()` computes and validates this union (`parseAlsoTypes()`: unknown
    `--also` value is a hard exit-2 error; a `--also` type equal to the primary, or repeated
    within `--also` itself, is silently deduped with a WARNING, never an error) and threads it
    through `buildSkillsPlan()`/the real `runInjectSkills()` call identically, so the dry-run
    preview and the real run can never diverge on which types get forwarded. `InjectInstallData.repoType`
    and `InjectTargetSummary.repoType` were also renamed to `repoTypes: string[]`/
    `repoTypes: string[] | null` respectively to match inject's own real D22-verified
    `--json` shape (`src/commands/install.ts`'s `InstallData`, `src/core/inject-skills-monorepo.ts`'s
    per-target summary) — declared for shape fidelity; neither field was actually read by this
    package's own code before or after this change (create only ever installs ONE target per
    invocation and reads its own separately-resolved `plan.repoTypes` for that).
  - **Milestone 7 additions**: a `dryRun?: boolean` option on `buildInjectSkillsCommand()`/
    `runInjectSkills()` appends `--dry-run` to the built `install` args — used ONLY by
    `wizard/steps/preview-plan.ts`'s PREVIEW step (decisions.md D18), never by the real (write)
    skill-injection call `commands/create.ts` makes. And `InjectInstallData` gained an OPTIONAL
    `version?: string` field, landing on inject's own `install` command in the SAME batch (a
    sibling worker's pass, not verified against a real built `dist/cli.js` the way the rest of
    this module's mirrored shape was) — `runInjectSkills()`'s `skillsVersion` resolution now
    PREFERS `result.data.version` when present, falling back to the pre-existing
    `readInjectedSkillsVersion()` profile-read workaround unchanged when it's absent (an older
    inject build, or any other reason). Flagged explicitly as an assumption about field location
    (`data.version`, not a top-level `InjectJsonResult.version`) — the sibling worker's actual
    choice could not be coordinated with directly.
- **`read-package-version.ts`** (Milestone 7) — `readRunningPackageVersion()`: reads THIS
  package's own `package.json` `version` field, for `write-repo-profile.ts`'s `NocktaRepoProfile.version`
  (spec §9.2/§9.3 — "this package's own version, not the upstream scaffolder's, not inject's").
  Reuses `architecture/get-architecture-path.ts::getArchitecturePackageRoot()`'s existing dist-safe
  package-root resolution rather than duplicating that dist-vs-src detection a second time; mirrors
  `inject-nockta-skills`' identically-named `core/read-package-version.ts::readRunningPackageVersion()`.
- **`write-repo-profile.ts`** (Milestone 7, spec §9) — `writeRepoProfile({projectDir, profile})`:
  writes `<projectDir>/.nockta/repo-profile.json`, pretty-printed with a trailing newline (same
  on-disk convention as inject's own `.nockta/skills-profile.json`). `projectDir` is always the
  created project/target's OWN root (`<project>` standalone, `<target>` for a monorepo target —
  spec §9.1, decisions.md D5) — `commands/create.ts` always passes `validated.resolvedPath`, the
  same directory the architecture overlay and standalone-mode `inject-nockta-skills` write into.
  There is deliberately no root-level write path here at all — root `.nockta/targets.json` +
  `skills-profile.json` stay entirely `inject-nockta-skills`' own responsibility (spec §6.4/§6.5).
  Throws a typed `WriteRepoProfileError` (carrying the resolved path) on any write failure —
  `commands/create.ts` treats this as a genuine create failure (new dedicated exit code `5`, fails
  loudly per this milestone's own brief: "a created project without its profile is incomplete"),
  never a silently swallowed warning. Unlike `inject-nockta-skills`' `write-profile.ts`, there is no
  "preserve `createdAt` across re-installs" concern — `create-nockta-repo` never writes into an
  existing target directory at all (`validateTargetDir`'s `already-exists` check, composed by
  `resolveTargetPath`), so every profile write is a fresh, first (and only) write.
- **`read-repo-profile.ts`** (Milestone 7, spec §9) — `readRepoProfile(projectDir)`: tolerant read
  (missing file, malformed JSON -> `undefined`, never throws — same convention as inject's
  `read-profile.ts::readSkillsProfile()`). Not consumed by `write-repo-profile.ts` itself (see that
  module's own note above for why); exists for round-trip test verification
  (`test/repo-profile.test.ts`) and future tooling.

## Exit codes (spec §5.9)

This module (`core/`) itself only ever produces `1` (upstream scaffolder failure, from an
`UpstreamFailure`) and `2` (invalid target, from an `InvalidTargetDirError`). Mapping
unknown-`--type`/unknown-`--arch`/invalid-`--adapters`/insufficient-flags to `2` as well is
`commands/create.ts`'s (and, for insufficient flags on a non-TTY invocation,
`commands/create-entry.ts`'s) own choice — the spec's exit-code table has no dedicated code for a
bad/missing flag value, and `2` is the closest documented fit ("nothing ran, your input was
invalid"). `3` (architecture overlay failure) is reachable as of Milestone 4 — but from
`src/architecture/` + `commands/create.ts`, not from this module; see `src/architecture/CONTEXT.md`.
`4` (skill injection failure) is reachable as of Milestone 6, from an `InjectSkillsFailure` thrown
by `run-inject-skills.ts` and caught in `commands/create.ts`. `5` (repo profile write failure,
Milestone 7 — an extension beyond spec §5.9's literal table, same "every failure surface earns its
own code" precedent `3`/`4` already set) is reachable from a `WriteRepoProfileError` thrown by
`write-repo-profile.ts` and caught in `commands/create.ts` — every failure surface this package
knows about now has a real producer. See `commands/create.ts`'s `EXIT_CODE` comment for the full,
current mapping in code.

## Dependents

- `commands/create.ts` — the primary consumer of every module here. Resolves the scaffolder command
  from `scaffolders/registry.ts`, calls `resolveTargetPath` (Milestone 5 — internally calls
  `detectMonorepoRoot` + `validateTargetDir`), then either prints the dry-run plan (never touching
  `run-upstream.ts` or `run-inject-skills.ts`'s `runInjectSkills` — though it DOES call
  `buildInjectSkillsCommand` even under dry-run, to print the exact command, spec §5.7) or calls
  `runUpstream` for real and stops immediately with no post-processing on `UpstreamFailure` (spec
  §13). Once upstream and (if enabled) the architecture overlay have both succeeded, it calls
  `runInjectSkills` (Milestone 6) — standalone: `cwd` is the resolved created-project directory;
  monorepo target: `cwd` is the monorepo root (the same cwd `resolveTargetPath`/`detectMonorepoRoot`
  used), `targetPath` is the target's relative path as typed (spec §6.4/§6.5, decisions.md D5 — root
  adapters + `.nockta/targets.json` land there, not inside the target). An `InjectSkillsFailure`
  produces a `"skills-failed"` outcome kind, exit code 4, reporting the honest partial state
  (project + overlay already exist, only skills failed, no rollback). Once skills has resolved
  (injected or legitimately skipped via `--no-skills`), it calls `read-package-version.ts` +
  `write-repo-profile.ts` (Milestone 7, the TRUE final step) — a `WriteRepoProfileError` produces a
  `"profile-failed"` outcome kind, exit code 5, same honest-partial-state posture. The resolved
  target path is the same string throughout (nested or not) — the upstream scaffolder, the
  architecture overlay, `inject-nockta-skills` (standalone mode), and the repo profile all resolve
  against it unchanged from earlier milestones.
- `resolve-target-path.ts` — the only consumer of `detect-monorepo-root.ts` and the only consumer
  of `validate-target-dir.ts` other than `commands/create.ts` itself (which now calls
  `resolve-target-path.ts` instead, not `validate-target-dir.ts` directly).
- `wizard/steps/preview-plan.ts` (Milestone 7, new) — the only consumer of `run-inject-skills.ts`'s
  new `dryRun` option; never touches `write-repo-profile.ts`/`read-repo-profile.ts` (the wizard's
  preview step shows the PLANNED profile path/fields from `commands/create.ts`'s own `CreatePlan`,
  never writes anything itself — see `src/wizard/CONTEXT.md`).

## Testing note — the fixture-override env var

Milestone 3's integration tests (`test/create-command.integration.test.ts`) exercise the *real
built* `dist/cli.js` end to end, per spec §16.2, but must never invoke a real framework
scaffolder (no network in CI or in this build). `commands/create.ts` reads
`process.env.CREATE_NOCKTA_REPO_TEST_FIXTURE_BIN` — when set, it swaps the registry-resolved
upstream command for `node <that path> <targetPath> [...passthroughArgs]`, keeping every other
step of the real pipeline (argv parsing, `resolveArgv`, registry lookup, target validation, exit
codes, `--json` shaping) genuinely real. It is not a documented CLI flag, not read anywhere else,
and not part of the public interface — see that file's own header comment. The fixture scripts
themselves live in `fixtures/scaffolders/` at the package root (spec §16.2): `fake-next/` and
`fake-vite-react-ts/` each create the target directory plus a `.fixture-marker.json` recording
their argv (proving both "target created" and "passthrough args arrived" in one artifact);
`fake-failing/` creates nothing and exits non-zero (code `7`, deliberately distinct from
`create-nockta-repo`'s own normalized exit code `1`) to prove upstream-failure handling.

## Testing note — the skills-injector bin-override env var (Milestone 6)

`run-inject-skills.ts` reads `process.env.CREATE_NOCKTA_REPO_TEST_INJECT_BIN` itself (not
`commands/create.ts`, unlike the two Milestone 3/4 overrides below — the swap is local to how this
one module resolves its binary, so `commands/create.ts` doesn't need to know about it at all). When
set, `buildInjectSkillsCommand` spawns `node <that path> install ...` instead of `npx
inject-nockta-skills@<version> install ...`. This is:

- how `test/run-inject-skills.test.ts` exercises `runInjectSkills`'s own spawn/parse/error paths
  against tiny hand-written local fixture scripts (success, nonzero-exit, unparseable-output) —
  fast, deterministic, no relation to the real `inject-nockta-skills` package at all;
- how `test/create-skills.integration.test.ts` — this milestone's headline suite — points the real
  built CLI at the sibling package's own real built `dist/cli.js` (built in that suite's `beforeAll`
  if missing, never touching `inject-nockta-skills`' source) for the full two-package convergence
  proof, and separately at `fixtures/inject/fake-inject-failing/index.mjs` (exits `3`, prints
  nothing to stdout) to engineer a deterministic skill-injection failure (exit code 4) without
  depending on triggering a real render failure in the real build;
- **the only way to test this integration until `inject-nockta-skills` is published** — the real
  `npx inject-nockta-skills@<version>` path only ever gets a code-path test (`buildInjectSkillsCommand`'s
  command/args construction, including `--skills-version` pinning), never a live-network test. This
  boundary is deliberate, not an oversight — flagged explicitly here and in
  `test/run-inject-skills.test.ts`'s own header comment.

Not part of the public CLI surface; not documented in README/help text; not read anywhere else in
this package.

## Testing note — the monorepo fixture (Milestone 5)

No new env-var escape hatch was needed for monorepo testing — a monorepo root is just a temp dir
with a real `pnpm-workspace.yaml` in it (spec §6.2's own signal, not a stand-in), so
`test/create-monorepo.integration.test.ts` simply `writeFileSync`s one into the spawned CLI's `cwd`
before each test, alongside the existing `CREATE_NOCKTA_REPO_TEST_FIXTURE_BIN` override for the
upstream scaffolder itself. `test/detect-monorepo-root.test.ts` and
`test/resolve-target-path.test.ts` cover the two new modules directly (per-signal detection,
malformed-`package.json` tolerance, valid/rejected/escaping nested targets, non-monorepo-cwd
semantics) against hand-built temp dirs, same pattern as `test/validate-target-dir.test.ts`.
