# CONTEXT.md — src/

## Purpose

CLI source for `create-nockta-repo`. Through Milestone 7 (spec §19's own list stops there; this
pass ALSO builds the real interactive wizard, never separately scheduled by that list but required
by spec §4's wizard-first UX principle — see `wizard/CONTEXT.md`'s own Purpose section for why both
land together): a working `commander` CLI, a scaffolder registry (`scaffolders/`, spec §10, §19
Milestone 2) that resolves the official upstream command for each repo type, an upstream runner
(`core/`, spec §10, §19 Milestone 3) that actually executes it, the architecture overlay system
(`architecture/`, spec §7/§10, §19 Milestone 4) that reads and applies a repo type's `arch.json` on
top of whatever the upstream scaffolder just generated, monorepo target support
(`core/detect-monorepo-root.ts` + `core/resolve-target-path.ts`, spec §6/§10, §19 Milestone 5) that
classifies a create as a nested monorepo target or a standalone create, the skills-injector
integration (`core/run-inject-skills.ts`, spec §8, §19 Milestone 6) that spawns
`inject-nockta-skills`'s own CLI for real after the overlay step, and — new this pass — the repo
profile (`core/write-repo-profile.ts`/`read-repo-profile.ts`, spec §9, §19 Milestone 7) that
records what a create run actually did, plus the real interactive wizard (`wizard/`, spec §5.1).
`list`/`list --json` are registry-wired; `create` now runs the COMPLETE spec §12.1/§12.2 step
sequence end to end, non-interactively: dry run (§5.7 — real architecture plan, monorepo-target
classification, the exact `inject-nockta-skills` command that would run, AND the real repo-profile
plan — path plus a field preview), monorepo-aware target-path resolution (§13, §6.3), real execution
with upstream-failure handling (§13), real architecture overlay application (exit code 3), real
skill injection (exit code 4), and real repo-profile writing (a NEW exit code 5 on write failure,
this milestone's own brief: "a created project without its profile is incomplete") — one code path
serves both the standalone flow and the monorepo-target flow throughout (spec §12.1/§12.2 share
almost all their steps; they differ only in what `resolveTargetPath()` classifies the target as,
where `run-inject-skills.ts` spawns, and where `write-repo-profile.ts` writes — spec §6.4/§6.5,
decisions.md D5). `commands/create-entry.ts` (Milestone 7, new) now sits in front of both the
default command and the `wizard` subcommand, deciding — mirroring `inject-nockta-skills`'
`commands/install-entry.ts` exactly — whether sufficient flags exist (unchanged non-interactive
path), a real TTY is present with insufficient flags (the real wizard, presets threaded from
whatever partial flags WERE given), or neither (a structured, non-hanging error; `--json`: one JSON
error line). See `core/CONTEXT.md` for the runner/validator/monorepo/profile modules,
`architecture/CONTEXT.md` for the overlay system, and `wizard/CONTEXT.md` for the wizard itself.

**`--web` mode (decisions.md D30, new).** `web/` adds an opt-in `--web` flag (plus `--cli`/
`--no-open`) that serves ONE local browser page with TWO stacked sections — "Project" (create's own
genesis Model) then "Skills" (inject's schema, fetched via the `inject wizard --emit-schema` CLI
spawn — D4 intact, no npm dependency). On Confirm the page POSTs back the collected answers and the
server runs create's EXISTING pipeline (`runCreateCommand`: scaffolder + architecture overlay + the
same headless inject `--yes --json` install) with the web-collected skill deltas forwarded as
`--include-skills`/`--exclude-skills`. `commands/create-entry.ts` routes to it via the same D30
precedence resolver inject uses (`--web` if display > CLI if TTY > `--yes` headless > clean exit-1).
See `web/CONTEXT.md`.

## Dependencies

- `commander` — CLI parsing, subcommands, global options.
- `picocolors` — terminal color, no-dependency-tree footprint.
- `@inquirer/core` — **NEW dependency (decisions.md D28/D29 wizard rebuild)** — the custom two-pane
  paginated multi-select prompt (`wizard/view/paginated-multiselect.ts`) is built on its
  `createPrompt`/`useState`/`useKeypress`/`useMemo` primitives, mirroring `inject-nockta-skills`' own
  wizard View (copied, not imported — D7). Already present transitively via `@inquirer/prompts`;
  declared directly now because create's own source imports it.
- `@inquirer/prompts` — real as of Milestone 7, lazily imported by `wizard/prompts.ts`'s
  `defaultWizardPrompts` (spec §15 tech stack; installed since Milestone 1, unused until now — the
  Milestone 1 wizard shell only printed the step list, it never prompted).
- `fs-extra` — **removed from `package.json` in Milestone 8** (was flagged "still unused" through
  Milestones 1-7, since every filesystem write in this package — `architecture/`,
  `core/write-repo-profile.ts` — has always used plain `node:fs`
  (`mkdirSync`/`writeFileSync`/`copyFileSync`), matching `inject-nockta-skills`' own
  `.nockta`-writing modules. Milestone 8's publish-readiness pass finally removed the dependency
  itself, not just the note about it — a standing discrepancy against spec §15's tech-stack list,
  now closed rather than perpetually flagged.
- **No dependency on `inject-nockta-skills`** — decisions.md D4: integration is exclusively by
  spawning its CLI (`npx inject-nockta-skills@<version>`), never an import, never an npm
  dependency. Not present in `package.json` by design. Real as of Milestone 6 —
  `core/run-inject-skills.ts` spawns it; its `--json` shape is a locally-mirrored type, not an
  imported one (same posture as decisions.md D7's `RepoType`/`AdapterType` mirroring). Milestone 7
  adds a `dryRun` mode to the SAME spawn mechanism (`install --dry-run --json`, decisions.md D18) —
  still no new dependency, still just another argv shape for the same child-process spawn.

## Dependents

- `test/` (vitest) imports `src/cli.ts` (`program`, `resolveArgv`, `extractPassthroughArgs`),
  `src/index.ts` (type/registry re-exports), `src/commands/list.ts`, `src/commands/create.ts`,
  `src/commands/create-entry.ts`, `src/core/*`, `src/scaffolders/registry.ts`, `src/architecture/*`,
  and `src/wizard/*` directly against source — no build step required to run most tests. Exceptions:
  `test/symlink-entrypoint.test.ts`, `test/create-command.integration.test.ts`,
  `test/create-architecture.integration.test.ts`, `test/create-monorepo.integration.test.ts`,
  `test/create-skills.integration.test.ts`, and `test/create-entry-process.test.ts` (Milestone 7,
  new) all run `tsup` themselves in `beforeAll` and exercise the built `dist/cli.js` as a real
  spawned process (through a symlink, through fixture scaffolders, and — for the entry-process
  suite — with closed stdin to force non-TTY, respectively) — the bugs/behaviors they guard against
  (entrypoint-guard vs. symlinked invocation; real argv → real process → real exit code; the built
  module's dist-shape `packs/` path resolution, spec §10.1's own concern; a real spawned CHILD
  PROCESS talking to another real spawned child process, for `create-skills.integration.test.ts`;
  the wizard never being reachable from a non-interactive process, for
  `create-entry-process.test.ts`) only reproduce at the process/build level, not against source.
  `create-skills.integration.test.ts` additionally builds the SIBLING package
  (`inject-nockta-skills`) in its own `beforeAll` if its `dist/` is missing — the only place in this
  package's test suite that spawns another package's build, and read-only (never edits
  `inject-nockta-skills`' source). `test/wizard-steps.test.ts`/`test/wizard-flow.test.ts` (Milestone
  7, new) exercise the wizard's own step functions and full orchestration against injected, scripted
  `WizardPrompts` — no build step, no real TTY (see `wizard/CONTEXT.md`).
- The published `bin` (`dist/cli.js`, built by `tsup`) is the only consumer of `src/cli.ts` at
  runtime.

## Key Concepts

- **Implicit default command.** `create-nockta-repo` behaves like `create-next-app`: running it
  bare, or with a bare project path and no subcommand name, is equivalent to
  `create-nockta-repo create ...` (spec §5.1/§5.2). Commander doesn't support a root `.action()`
  coexisting cleanly with a same-named subcommand's own options (their flags collide — confirmed
  by hand during Milestone 1 build). Instead, `resolveArgv()` in `cli.ts` rewrites `process.argv`
  to insert the literal `create` token before Commander ever parses it, exactly like `npm create
  vite@latest` does. Exported and unit-tested (`test/resolve-argv.test.ts`) precisely because this
  routing is the trickiest part of an otherwise-static skeleton. Pitfall (hit and fixed once): the
  insertion point must be *before* any option `program` doesn't itself recognize (any `create`-scoped
  flag — `--type`, `--dry-run`, etc.), not just before a bare positional — `GLOBAL_OPTION_FLAGS`/
  `GLOBAL_OPTIONS_WITH_VALUE` are derived from `program.options` (plus Commander's own `-h`/`--help`)
  instead of hand-listed, so a newly added `create` option can't silently regress this the way
  `--type` once did (bare `--type next` used to crash Commander with `unknown option '--type'`).
- **`cli.ts` only runs when it's the entrypoint.** `program` is exported and `program.parseAsync`
  only fires behind an `isMainModule()` guard, so tests can `import { program } from "../src/cli.js"`
  and inspect wiring (subcommands, options, help text) without triggering a real parse/execution.
  The guard resolves `process.argv[1]` with `realpathSync` before comparing it to `import.meta.url`
  (wrapped in try/catch — a nonexistent argv path must not throw). This is required because package
  managers install `bin` entries as symlinks (`npm link`, global bins, `npx`'s cache) — Node
  resolves `import.meta.url` to the symlink *target* but leaves `process.argv[1]` as the symlink
  *path* the user invoked, so a naive direct comparison never matches and the CLI silently no-ops
  (empty stdout, exit 0) under any symlinked invocation. Regression-tested at the process level in
  `test/symlink-entrypoint.test.ts` (builds `dist/`, symlinks to it, spawns `node <symlink> --help`
  and `list --json`, asserts non-empty/parseable output). Mirrors `inject-nockta-skills`'s
  `isMainModule()` (`src/cli.ts`), which had this right from the start.
- **`--json` and `--skills-version` are global.** Registered on the root `program` so
  `program.optsWithGlobals()` surfaces them inside every subcommand action. `--json` is real as of
  Milestone 3 for both `list` and `create` — spec §5.9/D13 (decisions.md): exactly one *compact*
  JSON object per invocation, printed with a bare `JSON.stringify(data)` call, never
  `JSON.stringify(data, null, 2)` — a pretty-printed object still reads as "one `console.log` call"
  in a test that mocks `console.log`, but embeds real newlines in the actual stdout stream, which
  breaks a line-oriented machine reader. (This was Milestone 3's F1 defect fix — `commands/list.ts`
  used to pretty-print; `commands/create.ts` was written compact from the start.) `--skills-version`
  is real as of Milestone 6 — it flows into `core/run-inject-skills.ts`'s `buildInjectSkillsCommand`
  and switches the spawned command from `npx inject-nockta-skills@latest` to `npx
  inject-nockta-skills@<version|dist-tag>` (spec §5.2/§8.1). The `--json` result's
  `architectureChanges` field (spec §11.4) is always present — `{created: [], updated: [], moved:
  [], skipped: []}` when nothing was actually applied (dry run, `--no-arch`, or an upstream failure
  that never reached the overlay step), populated for real once the overlay actually runs.
  `skillsInjected` (spec §11.4, top-level boolean, Milestone 6) is `true` only for a `"created"`
  outcome whose `skills.status` is `"injected"`; the richer `skills` detail object mirrors
  `architecture`'s own "skipped / planned (dry run) / not-attempted / injected / failed"
  branching — see `commands/create.ts`'s `skillsStatusJson()`.
- **`--no-skills` (spec §5.6, Milestone 6).** A lone negatable flag on `create` (no positive
  `--skills <value>` counterpart needed, unlike `--arch`) — Commander defaults `cliOptions.skills`
  to `true`/`undefined` and sets it to literal `false` only when `--no-skills` is passed;
  `commands/create.ts` treats `cliOptions.skills !== false` as "enabled". `--adapters <list>`
  (default `"claude"` when omitted) is validated against `ADAPTER_TYPES` before anything runs
  (`parseAdapters()`, exit code 2 on an unknown value — same bucket as an unknown `--type`/`--arch`).
- **`--arch <preset>` / `--no-arch` is a genuine tri-state (Milestone 4), not two separate flags
  fighting over one property.** Both are declared on `create` under the same Commander attribute
  name (`arch`) — Commander's own negatable-pair support (verified by hand against the installed
  `commander@15`, not just assumed from docs) resolves this to exactly three states:
  `cliOptions.arch` is `undefined` (neither flag given → default preset `"standard"`), a `string`
  (`--arch <preset>` given → that preset), or literally `false` (`--no-arch` given → architecture
  step skipped entirely, spec §5.5). `CreateCommandCliOptions.arch` is typed `string | false` to
  match.
- **Passthrough args (spec §5.4) are recovered from raw argv, not from Commander's positional-arg
  bookkeeping.** Commander rejects `create my-project --type next -- --tailwind` outright
  ("too many arguments") unless the `create` command opts into `.allowExcessArguments(true)` — and
  even then, `command.args` folds `--`-separated operands into the same array as ordinary excess
  positionals with no boundary marker, which is ambiguous when `projectNameOrPath` is omitted
  (Commander's own positional matching then swallows the first passthrough token as the "path").
  `extractPassthroughArgs()` sidesteps this by scanning `program.rawArgs` directly for the literal
  `--`. `Command#rawArgs` is a real runtime property (`commander/lib/command.js`) missing from
  commander's public `.d.ts`; `cli.ts` restores it with a local `declare module "commander"`
  augmentation rather than casting at every call site. Covered end to end (incl. the Vite `--`
  separator interaction, spec §18/scaffolders/CONTEXT.md) in
  `test/create-command.integration.test.ts`, and directly in `test/passthrough-args.test.ts`.
- **`types/` is a local mirror, not the source of truth (for `RepoType`/`AdapterType`).**
  `RepoType`, `AdapterType` duplicate `inject-nockta-skills`'s unions verbatim (decisions.md D7);
  `CreateNocktaRepoOptions` matches spec §11.3 exactly, including `skillsVersion?: string`
  (decisions.md D14). Drift is caught by `test/enum-parity.contract.test.ts` (Milestone 8, spec
  §10.1/§16.2, decisions.md D7) — spawns the REAL, locally built `inject-nockta-skills list --json`
  (never `npx` — the sibling package is unpublished) and asserts its reported `repoTypes`/
  `adapterTypes` sets exactly match `REPO_TYPES`/`ADAPTER_TYPES` below. `types/scaffold.ts`
  (Milestone 2) is different — it's wholly owned here, not mirrored from anywhere; it defines
  `ScaffolderDefinition`/`ScaffolderCommand`/`ScaffolderArgsBuilder` for `scaffolders/`.
  `types/create-result.ts` (Milestone 5) formally declares `CreateNocktaRepoResult` matching spec
  §11.4 exactly, including `isMonorepoTarget: boolean` — the canonical spec-shaped type;
  `commands/create.ts`'s actual `--json` envelope is a richer, outcome-specific superset (dry-run
  vs. real-run discrimination, per-status fields) documented in that type's own header comment, not
  a literal `CreateNocktaRepoResult` assembly yet. `skillsInjected` is real in that envelope as of
  Milestone 6 (see above); `projectDir`/`warnings` still await Milestone 7 before this type becomes
  the literal assembled shape. `core/run-inject-skills.ts`'s `InjectInstallData`/`InjectJsonResult`
  are a second, separate local mirror (Milestone 6) — of `inject-nockta-skills`'s `install`
  command's own `--json` contract, not of its `RepoType`/`AdapterType` unions — verified against its
  real built output; see that module's own header comment for the one field it does NOT carry
  (`version` — spec §9.2's resolved version comes from the written profile file instead, not from
  the `--json` result). D22 update (worker pass adding `--also`): that same mirror's
  `InjectInstallData.repoType`/`InjectTargetSummary.repoType` were renamed to `repoTypes: string[]`
  (`| null` for the single-project case) to match inject's own real D22-verified `--json` shape —
  see `core/CONTEXT.md`'s own D22 entry for the full separator-per-mode reasoning (`,`-joined
  `--type` for standalone vs. `+`-joined inside the colon `--target` form for a monorepo target —
  never the same separator, verified against inject's real `core/parse-targets.ts`).
- **`types/profile.ts`'s `NocktaRepoProfile` evolved `repoType: RepoType` (singular) to
  `repoTypes: RepoType[]` (worker pass adding `--also`, decisions.md D22)** — primary type
  (from `--type`, the sole genesis-scaffolder/architecture-overlay owner) first, then any
  validated/deduped `--also <type>[,<type>...]` secondary skill-domain types, mirroring
  `inject-nockta-skills`' own D22 `repoTypes: string[]` shape for symmetry across both packages'
  `.nockta/` files. `officialScaffolder` still names only the PRIMARY type's scaffolder — `--also`
  never adds a second scaffolder or a second architecture overlay (D22 is explicit: "architecture
  overlay remains PRIMARY-type only"). No published `create-nockta-repo` versions exist, so this
  rename is non-breaking in practice (no legacy read-shim was added, unlike inject's own D22
  profile/targets change, which had published-version concerns and therefore did add one).
- **`commands/list.ts` is wired to the scaffolder registry (Milestone 2).** No longer a
  placeholder — `list`/`list --json` read `scaffolders/registry.ts` for real repo-type +
  upstream-command data. Human output shows `[interactive]`/`[provisional]` tags;
  `--json`'s `repoTypes[].exampleCommand` is each definition's actual
  `buildCommand("<project-path>")` output (not fabricated). Architecture presets and skill-pack
  columns (spec §5.8) are intentionally not printed — those land with later milestones and this
  package must not invent that data ahead of it. See `scaffolders/CONTEXT.md` for the registry
  itself.
- **`commands/create.ts` is registry-runner-overlay-monorepo-AND-skills-wired (Milestones 4-6),
  and follows the FULL spec §12.1/§12.2 step order precisely — every step now does something
  real.** Non-interactive path: resolve the repo type (`resolveScaffolder`, catching
  `UnknownRepoTypeError`, step 2) → resolve the architecture preset — **read and validate** the
  manifest via `architecture/read-architecture-manifest.ts`, but never apply it here (step 3;
  `--no-arch` sets `architecturePlan.enabled = false` and skips this read entirely; an unknown
  preset is exit 2 — same bucket as unknown `--type`, a bad flag value — while any other manifest
  problem, e.g. malformed JSON or a non-empty `deletes`, is exit 3, since that's the overlay
  *pack's* own content being broken, not the user's input, even though it's caught before upstream
  ever runs) → resolve `--adapters` (Milestone 6, `parseAdapters()`, default `["claude"]`, exit 2
  on an unknown value — same bucket, validated before anything runs) → detect the monorepo root and
  validate the (possibly nested) target path (`core/resolve-target-path.ts`, Milestone 5 — catching
  `InvalidTargetDirError`, step 4/spec §12.2 steps 1-2) → resolve the official scaffolder command
  against the resolved target path, nested or not (step 5) → either print the dry-run plan — **the
  real architecture plan** (directories/files/moves, spec §5.7), **the monorepo-target
  classification** (spec §12.2), **and the exact `inject-nockta-skills` command that would run**
  (Milestone 6, `buildSkillsPlan()` → `core/run-inject-skills.ts`'s `buildInjectSkillsCommand()`) —
  and return without calling `core/run-upstream.ts`, `architecture/apply-architecture-manifest.ts`,
  or `core/run-inject-skills.ts`'s `runInjectSkills()` at all (the strongest available proof that
  dry run writes nothing), or call `runUpstream` for real (steps 6–8) and, on `UpstreamFailure`,
  stop immediately with no post-processing (spec §13, neither the overlay nor skills is ever
  attempted) and set `process.exitCode` to the documented upstream-failure code. Once upstream has
  actually succeeded, step 9 applies the architecture overlay for real, inside the resolved target
  directory whether nested or not (`--no-arch` skips this too, cleanly, `architectureResult` stays
  `null`) — an `ArchitectureApplyError` (a non-optional `moves[]` entry whose source is missing)
  produces the `"overlay-failed"` outcome kind, `process.exitCode = 3`, and reports exactly what
  was already created before the failure — **no rollback**, stated honestly in both human and
  `--json` output; skill injection is never attempted after an overlay failure either. Once
  architecture has succeeded (or was legitimately skipped via `--no-arch`), step 10 invokes
  `inject-nockta-skills` for real unless `--no-skills` (Milestone 6, spec §5.6) — `runInjectSkills()`
  spawns it standalone (inside the created project dir) or monorepo-target (at the monorepo root,
  spec §6.4/§6.5, decisions.md D5); an `InjectSkillsFailure` produces the new `"skills-failed"`
  outcome kind, `process.exitCode = 4`, reporting the honest partial state (project + overlay
  already exist, only skills failed, no rollback — `architecture`/`upstream` in the `--json` output
  prove it). Once skills has resolved (injected or legitimately skipped via `--no-skills`), the
  TRUE final step (Milestone 7, spec §12.1 step 11/§12.2 step 6) writes the real repo profile
  (`core/write-repo-profile.ts`) — a `WriteRepoProfileError` produces a NEW `"profile-failed"`
  outcome kind, `process.exitCode = 5` (an extension beyond spec §5.9's literal table, same
  "every failure surface earns its own code" precedent `3`/`4` already set), same honest-partial-
  state posture. The plan/`--json` output carries `isMonorepoTarget` (top-level, spec §11.4) plus a
  `monorepo` detail object (`isMonorepoRoot`, `signals`, `isNestedPath`, `infoLine`), `skillsInjected`
  (top-level, spec §11.4) plus a `skills` detail object mirroring `architecture`'s own
  plan/attempted/real-outcome branching (see `skillsStatusJson()`), and now (Milestone 7) `metadata`
  carrying the REAL repo-profile plan/outcome ("planned" under dry run — path + field preview;
  "written" — real path + object; "failed"; "not-attempted") plus a top-level `projectDir` and
  `warnings` (spec §11.4, deferred by Milestone 6, real now) and a `result` key holding the FORMAL,
  literal `CreateNocktaRepoResult` assembly (`buildCreateNocktaRepoResult()`) alongside the richer
  per-status fields. `resolveCreatePlan()` (Milestone 7, EXPORTED, extracted from what used to be
  the first half of `runCreateCommand()` itself) is the pure, side-effect-free resolution half —
  steps 2-5 (repo type, architecture preset, adapters, target path, scaffolder command) — reused
  directly by `wizard/steps/preview-plan.ts`'s preview step, so the wizard's dry-run preview and the
  non-interactive path's own dry-run branch can never diverge (one resolution function, not two).
  The "not enough to run non-interactively" check (`!projectNameOrPath || !cliOptions.type`) still
  falls through to `runCreateWizard()` directly as a safety net, but real CLI entry points never hit
  that branch anymore — `commands/create-entry.ts` (Milestone 7, new) intercepts BEFORE
  `runCreateCommand()` is ever called, adding the TTY-aware routing spec §4 requires (see that
  file's own header comment and `wizard/CONTEXT.md`). See `core/CONTEXT.md` for the
  runner/validator/monorepo/skills-injector/profile modules, and `architecture/CONTEXT.md` for the
  overlay system and the exit-code split (spec §5.9) in full.
- **`--also <type>[,<type>...]` (decisions.md D22, spec §5.2's own `--also` documentation,
  worker pass) — a validated/deduped UNION forwarded to `inject-nockta-skills`, never a second
  scaffolder or overlay.** `resolveCreatePlan()`'s `parseAlsoTypes()` validates each requested
  type against `REPO_TYPES` (an unknown value is a hard exit-2 `invalid-also` error — same
  bucket as unknown `--type`/`--arch`/`--adapters`) and silently dedups a type equal to the
  PRIMARY `--type`, or repeated within `--also` itself, with a non-fatal WARNING instead
  (`CreatePlan.inputWarnings` — surfaced in both human dry-run/create output, right after the
  Target block, and the `--json` envelope's top-level `warnings`, independent of and merged
  with the skills step's own warnings). The resolved union (`CreatePlan.repoTypes`, primary
  first) flows into `core/run-inject-skills.ts::buildInjectSkillsCommand()`'s NEW
  `repoTypes?: readonly string[]` option (wins over the legacy singular `repoType` when
  non-empty — every pre-`--also` caller/test keeps working unchanged) — see that module's own
  D22 entry in `core/CONTEXT.md` for the "`,`-joined `--type` (standalone) vs. `+`-joined
  inside the colon `--target` form (monorepo-target)" separator split, verified against
  inject's own real parser, never guessed. Dry-run and the real run resolve the SAME
  `plan.skills.repoTypes` array, so they can never diverge on which types get forwarded.
  Architecture overlay stays PRIMARY-type only (D22 is explicit: composing overlays is a
  deliberate non-goal) — `--also` types never touch `architecturePlan`/`officialScaffolder`.
  The repo profile (`types/profile.ts::NocktaRepoProfile.repoTypes`, see the `types/` bullet
  above) records the full union, primary first, same shape as inject's own D22
  `repoTypes: string[]`. The wizard's own secondary-skill-domains step
  (`wizard/steps/select-also-types.ts`) is WIRED into `run-create-wizard.ts`'s step sequence
  as step 3b, right after the primary type is chosen (a follow-up worker pass — see
  `wizard/CONTEXT.md`'s own entry for the full detail). Selecting none is a byte-identical
  no-op (`--also` never set); selecting some feeds `cliOptions.also`, forwarded unchanged
  into the exact union-forwarding logic described above — no new logic on the `create.ts`
  side, this was wiring only. Step 9's preview also received `alsoTypes` so the fetched
  inject dry-run plan reflects the FULL union. A `--also` value given alongside an
  otherwise-insufficient non-interactive invocation still short-circuits step 3b unprompted
  (`presetAlso`), never silently dropped.
- **`commands/create-entry.ts` (Milestone 7, new) is the routing layer in front of `create.ts` and
  the `wizard` subcommand.** Mirrors `inject-nockta-skills`' `commands/install-entry.ts` exactly:
  `hasSufficientCreateFlags()` was, through Milestone 7, `projectNameOrPath` AND `--type` only —
  deliberately NOT widened to also require `--yes`, since this package's non-interactive path had
  never required it and widening would have been an unrelated, out-of-scope behavior change at the
  time. **Milestone 8 / decisions.md D20 changes this**: non-interactive create EXECUTION now
  requires `--yes` too (`--dry-run` exempt) — `hasSufficientCreateFlags()` is now `projectNameOrPath`
  AND `--type` AND (`--yes` OR `--dry-run`), the exact shape `inject-nockta-skills`' own
  `hasSufficientInstallFlags()` has always had. Sufficient -> `runCreateCommand()` unchanged;
  insufficient + a real TTY -> `runCreateWizard()`, with whatever partial flags WERE given threaded
  through as step presets (this NOW also covers "path + `--type` given, `--yes` missing, real TTY" —
  a deliberate D20 consequence, not incidental: the `--yes` requirement lives at this ROUTING layer,
  not inside `runCreateCommand()`/`resolveCreatePlan()` themselves, specifically because
  `wizard/run-create-wizard.ts::runCreateWizard()` calls `runCreateCommand()` directly for its own
  step 11 without ever setting `cliOptions.yes` — confirmation there is the interactive step-10
  prompt, not the flag; putting the gate anywhere else would have broken the wizard's own real
  execution path); insufficient + non-TTY -> a structured, NEVER-HANGING error (reuses `create.ts`'s
  own now-EXPORTED `emitError()`, one JSON line under `--json`, exit code 2 — the same bucket
  unknown-`--type`/unknown-`--arch`/invalid-`--adapters` already use; `details.missing` now names
  `--yes` specifically when path+type are both present but confirmation/dry-run is not).
  `runWizardEntry()` applies the identical TTY gate to the standalone `wizard` subcommand
  (pre-existing since Milestone 1) — now that the wizard is REAL, running it from a non-TTY process
  would otherwise hang forever on a real `@inquirer/prompts` call.
- **The wizard was REBUILT to inject's MVC (decisions.md D28) and made GENESIS-ONLY (D29).** See
  `wizard/CONTEXT.md` for the full design. In one paragraph: the old flat `WizardPrompts` steps
  (incl. an adapters step, an advanced-options passthrough, and an `install --dry-run --json` skills
  PREVIEW) were REMOVED; the wizard is now a strict Model (`wizard/core/build-schema.ts`, friendly
  repo-type titles) / View (`wizard/view/*` — the two-pane paginated master–detail prompt copied
  verbatim from inject + a `single` radio mode) / Controller (`wizard/controller.ts`, back-aware,
  clean-view between steps) split. It collects ONLY genesis inputs — name/path, primary type,
  secondary (`--also`) types, package manager, architecture, inject version — then confirms with a
  GENESIS-plan preview (scaffolder + architecture; the final skill list is NOT previewed). Adapters,
  skills, and Razor are inject's now (D29): once confirmed, step 11 calls the SAME EXPORTED
  `runCreateCommand()`, which — because the wizard passes NO `--yes` — takes the INTERACTIVE inject
  handoff (`core/run-inject-skills.ts::runInjectSkillsInteractive`, spawns inject's own wizard with
  the type pre-filled and inherited stdio). The non-interactive (`--yes`) path is unchanged (headless
  inject, `--yes --json`, captured).

## Directory Layout

```
src/
  cli.ts                 commander program, argv routing, entrypoint guard, passthrough-arg extraction
  index.ts               programmatic entrypoint — types + scaffolder registry + repo-profile re-exports
  commands/
    create.ts             registry-runner-overlay-monorepo-skills-AND-profile-wired create command
                            (Milestones 4-7); resolveCreatePlan()/EXIT_CODE/emitError() now exported
                            for wizard/create-entry reuse
    create-entry.ts        (Milestone 7, new) TTY-aware routing in front of create.ts + the wizard
                            subcommand — mirrors inject-nockta-skills' install-entry.ts
    list.ts                registry-wired: real repo types + upstream commands (Milestone 2)
  core/                   see core/CONTEXT.md — upstream runner + target-dir safety (Milestone 3),
                            monorepo detection + nested target resolution (Milestone 5),
                            inject-nockta-skills CLI spawn incl. dry-run mode (Milestone 6-7),
                            repo-profile write/read + running-package-version (Milestone 7)
    run-upstream.ts
    validate-target-dir.ts
    detect-monorepo-root.ts
    resolve-target-path.ts
    run-inject-skills.ts
    read-package-version.ts   (Milestone 7, new)
    write-repo-profile.ts      (Milestone 7, new)
    read-repo-profile.ts       (Milestone 7, new)
  architecture/            see architecture/CONTEXT.md — overlay system (Milestone 4)
    get-architecture-path.ts
    read-architecture-manifest.ts
    apply-architecture-manifest.ts
  wizard/                 see wizard/CONTEXT.md — the interactive wizard, REBUILT to inject's MVC
                            (decisions.md D28) and made GENESIS-ONLY (D29). The old flat steps/ +
                            prompts.ts (adapters step, advanced-options, skills-preview) were REMOVED.
    run-create-wizard.ts   runWizardFlow() (drives the Controller with a Presenter) + runCreateWizard()
    controller.ts           back-aware indexed genesis step loop (D28)
    core/
      types.ts               StepModel/answer vocabulary (genesis-only subset of inject's)
      build-schema.ts         pure StepModel builders (friendly repo-type titles) — no adapters/skills
    view/
      width.ts                ANSI width primitives — copied verbatim from inject
      theme.ts                picocolors theme + KEY_HINTS footer — verbatim
      paginated-frame.ts      pure two-pane master–detail frame renderer — verbatim
      paginated-multiselect.ts @inquirer/core prompt — ported + a `single` radio mode (D29)
      presenter.ts            the Presenter View seam
      cli-presenter.ts        CLI presenter (paginated / project-path / skills-version / confirm)
  scaffolders/             see scaffolders/CONTEXT.md — registry.ts + one module per RepoType
    registry.ts
    next.ts
    vite-react-ts.ts
    nest.ts
    shopify-app.ts
    shopify-theme.ts
    shopify-headless.ts
  types/
    repo-type.ts            RepoType union + REPO_TYPES + isRepoType() (spec §11.1; isRepoType()
                              Milestone 7, mirrors inject-nockta-skills' own exported guard)
    adapter.ts               AdapterType union + ADAPTER_TYPES + isAdapterType() (spec §11.2)
    create-options.ts        CreateNocktaRepoOptions (spec §11.3)
    create-result.ts          CreateNocktaRepoResult (Milestone 5, spec §11.4, incl. isMonorepoTarget;
                              formally assembled for real as of Milestone 7)
    profile.ts                NocktaRepoProfile (Milestone 7, spec §9.2)
    scaffold.ts               ScaffolderDefinition/ScaffolderCommand/ScaffolderArgsBuilder (Milestone 2)
    architecture.ts           ArchitectureManifest/ArchitectureFileEntry/ArchitectureMoveEntry (Milestone 4, spec §7.2)
    index.ts                 barrel re-export

fixtures/
  scaffolders/            see core/CONTEXT.md "Testing note" — fake-next/, fake-vite-react-ts/,
                            fake-failing/, spec §16.2, used by test/create-command.integration.test.ts,
                            test/create-architecture.integration.test.ts, and (paired with a
                            hand-written pnpm-workspace.yaml) test/create-monorepo.integration.test.ts,
                            test/create-skills.integration.test.ts, test/wizard-flow.test.ts, and
                            test/create-entry-process.test.ts
  inject/                 fake-inject-failing/ (Milestone 6) — exits 3, prints nothing to stdout;
                            simulates an inject-nockta-skills render failure for
                            test/create-skills.integration.test.ts's exit-code-4 case. See
                            core/CONTEXT.md "Testing note — the skills-injector bin-override env var".
                            test/wizard-flow.test.ts writes its OWN tiny local fixture inject scripts
                            (success + always-fail, incl. --dry-run handling) inline in its own
                            beforeAll, mirroring test/run-inject-skills.test.ts's convention, rather
                            than adding new files here.

packs/
  <repoType>/architecture/standard/  arch.json + files/ — see architecture/CONTEXT.md's
                                      "Standard overlays" section for all six types' design
```

Not yet present: `core/create-repo.ts` (orchestration stays inline in `commands/create.ts` — see
that file's own header comment for why), `utils/` (spec §10's `fs-utils.ts`/`json-utils.ts`/
`path-utils.ts`/`logger.ts`/`run-command.ts` — every module built so far has used plain `node:fs`/
`node:path`/`console`/`node:child_process` directly, with no shared abstraction layer needed yet;
flagged as a standing gap against the spec §10 tree, not a regression). Every other spec §10 file
under `src/` now exists — `wizard/steps/`, `core/write-repo-profile.ts`/`read-repo-profile.ts`, and
`types/profile.ts` all landed this pass (Milestone 7).
