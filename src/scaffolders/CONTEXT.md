# CONTEXT.md — src/scaffolders/

## Purpose

The scaffolder registry (spec §10, §19 Milestone 2). Static, typed data + pure resolution only —
**no child-process execution**. Given a repo type, resolves what upstream command *would* run;
actually running it is Milestone 3 (Upstream Runner, `core/run-upstream.ts`, not yet built).

## Dependents

- `commands/list.ts` — sources `list` / `list --json` output from `listScaffolders()`.
- `src/index.ts` — re-exports the registry accessors and `ScaffolderDefinition`/`ScaffolderCommand`
  types for programmatic consumers.
- Not yet consumed by `commands/create.ts` — that wiring (resolving + actually spawning the
  scaffolder) is Milestone 3.

## Key Concepts

- **One module per repo type.** `next.ts`, `vite-react-ts.ts`, `nest.ts`, `shopify-app.ts`,
  `shopify-theme.ts`, `shopify-headless.ts`, `react-native.ts`, `expo.ts` each export a single
  `ScaffolderDefinition` (spec `types/scaffold.ts`). Isolation is deliberate (spec §18.1 "isolate
  scaffolder configs", §18.5 "isolate Shopify app/theme/headless scaffolders") — a flag/command
  change in one upstream tool never touches another module.
- **`buildCommand(targetPath, passthroughArgs?, upstreamAnswers?)` is pure.** Returns
  `{ name, command, args }` — the same shape the repo profile records (spec §9.2) and
  `CreateNocktaRepoResult.officialScaffolder` uses (spec §11.4). No `spawn`, no filesystem access,
  anywhere in this directory.
- **Upstream options schema (D36).** Each definition may declare `upstreamOptions: UpstreamOption[]`
  (`{ key, label, description, kind: boolean|choice|text, choices?, default, flag, negatedFlag? }`) —
  the interactive choices the upstream tool would prompt for, surfaced as web form fields
  (`web/project-schema.ts` embeds them per type) and mapped to non-interactive flags.
  `buildCommand`'s 3rd arg is an answers object keyed by `key`; the shared pure
  `upstream-options.ts::buildUpstreamOptionArgs()` translates it to argv (present-keys-only, so a bare
  `buildCommand(path)` is unchanged — the wizard/interactive path keeps upstream prompts). Each type
  splices the option args into its own correct slot (after the target path for most; inside the `--`
  forwarded segment, after `--path`, for the `npm create` types). `upstreamOptionDefaults()` is the
  SINGLE source of defaults, shared by the CLI `--yes` path (`commands/create.ts::resolveCreatePlan`)
  and the web page's pre-fill — they can't drift. Surfaced counts (verified against official docs
  2026-07-13): next 7, nest 3, shopify-headless 3 (provisional), react-native 1;
  vite-react-ts/expo/shopify-theme/shopify-app 0 (template pinned / clone-only / needs a terminal).
- **`requiresTerminal` (D36 / PART A).** `shopify-app` sets `requiresTerminal: { reason }` — its
  upstream (`shopify app init`) can't run headless (browser login to a Partner org; no flag bypass).
  The web flow warns up front and hands back to the terminal instead of spawning a doomed run.
  Independent of `interactiveStdio` ("may prompt") — `requiresTerminal` means "cannot proceed without
  a human at a terminal". Only `shopify-app` carries it (theme just clones; hydrogen scaffolds with
  flags).
- **Passthrough args (spec §5.4) append after each definition's base args** — with one nuance:
  `vite-react-ts` bakes its own `--` separator into the base args (`npm create` requires it to
  forward flags to `create-vite`), so passthrough args land *inside* that already-open forwarded
  segment (after `--template react-ts`), not behind a second `--`. Every other type has no
  separator and appends passthrough args straight after its base args. Covered by
  `test/scaffolder-registry.test.ts`'s "passthrough argument composition" block, including an
  explicit assertion that vite's arg list contains exactly one `--`.
- **`registry.ts` completeness is typechecked, not just tested.** `SCAFFOLDER_REGISTRY` is typed
  `Readonly<Record<RepoType, ScaffolderDefinition>>` — adding a `RepoType` without a matching entry
  fails `tsc`, before any test runs. `resolveScaffolder(repoType: string)` still narrows at runtime
  (callers are usually parsing untrusted `--type` CLI input) and throws the structured
  `UnknownRepoTypeError` (`.repoType`, `.knownRepoTypes`) rather than a bare string — set up for
  later `--json` error envelopes without message-parsing.
- **Shopify entries: `interactiveStdio: true`.** Per spec §18.5 ("allow interactive stdio"), all
  three Shopify definitions set this flag so Milestone 3's runner knows to inherit stdio rather than
  run fully non-interactively. `shopify-app`'s `buildCommand` routes the target path through a
  `--path` flag (the spec's own conceptual command, §3.5, is bare `shopify app init` with no
  positional path) — this is this registry's own isolation choice, called out in the module's
  header comment and its `notes` field, not something the spec states directly. Verify against the
  installed Shopify CLI before Milestone 3 wires real execution (spec §18.1 command-drift risk).
- **`shopify-headless.ts` is explicitly provisional.** Spec §3.7 states the upstream command is
  preset-dependent and unsettled. The module sets `provisional: true`, and both
  `conceptualCommand` and the header comment say so in plain text — `list --json` surfaces
  `provisional` per entry so downstream consumers (and `list`'s human output, which appends a
  `[..., provisional]` tag) don't mistake it for a stable contract.
- **`shopify-headless.ts` command shape corrected in Milestone 3 (defect fix F2).** The original
  Milestone 2 entry encoded `npx @shopify/create-hydrogen@latest <project-path>` — a positional
  target path. Verified against two live sources (2026-07-10): shopify.dev's own getting-started
  page documents `npm create @shopify/hydrogen@latest -- --quickstart`, and
  `@shopify/create-hydrogen`'s own source (`packages/cli/src/commands/hydrogen/init.ts`) defines
  `path` as a *named* oclif flag with no positional path argument at all. Corrected to
  `npm create @shopify/hydrogen@latest -- --path <target>` — `command: "npm"`,
  `args: ["create", "@shopify/hydrogen@latest", "--", "--path", targetPath, ...passthroughArgs]`.
  The `--` separator is required, not stylistic — verified against npm's own docs
  (`npm init foo -- --hello` is documented as equivalent to `npm exec -- create-foo --hello`;
  flags before `--` are npm's own, flags after are forwarded verbatim). Full citations live in the
  module's own header comment. Still `provisional: true` — this fixes a wrong command shape, it
  doesn't promote the entry to stable.
- **`list --json`'s `exampleCommand` field is real, not invented.** It's each definition's actual
  `buildCommand("<project-path>")` output — demonstrates the args-composition logic (incl. the vite
  separator) to machine consumers without fabricating architecture-preset or skill-pack data, which
  spec §5.8 assigns to later milestones and which this package explicitly must not invent.
- **`react-native.ts` / `expo.ts` (decisions.md D25, new).** Both verified against primary sources
  (CLI source, real template tarball/repo tree — see each module's header comment and
  `scratchpad/react-native-tooling-research.md`), NOT provisional (`provisional` omitted/false —
  unlike `shopify-headless`, these command shapes are settled). `expo.ts`'s `--no-agents-md` flag
  (decisions.md D24) suppresses `create-expo-app`'s own stub AI files so Nockta's `agent`-adapter
  `AGENTS.md` + curated expo pack skills own that space instead — the one place this package's
  scaffolder layer directly references an inject-nockta-skills decision. `react-native.ts`'s
  `buildCommand` DERIVES the RN CLI's required positional `Name` argument from the target path's
  basename via the module's own exported `deriveReactNativeAppName()` (PascalCased,
  letters/digits only, `"App"` fallback/prefix for edge cases) — the real resolved target path
  itself still passes through verbatim via `--directory`, unlike every other scaffolder here where
  the target path IS the positional/named arg. This is the one scaffolder in the registry whose
  `buildCommand` output depends on more than a straight pass-through of `targetPath` + static
  args — covered explicitly in `test/scaffolder-registry.test.ts`'s "derives the positional Name"
  case (basename with dashes/underscores, a leading-digit basename, an all-punctuation basename).

## Directory Layout

```
src/scaffolders/
  registry.ts          SCAFFOLDER_REGISTRY, resolveScaffolder(), listScaffolders(), UnknownRepoTypeError
  upstream-options.ts   D36 — buildUpstreamOptionArgs()/upstreamOptionDefaults() (pure answers->argv + default source)
  next.ts               npx create-next-app@latest <path>
  vite-react-ts.ts       npm create vite@latest <path> -- --template react-ts
  nest.ts                npx @nestjs/cli new <path>
  shopify-app.ts         shopify app init --path <path>  (isolation choice — see notes above)
  shopify-theme.ts       shopify theme init <path>
  shopify-headless.ts    PROVISIONAL — npm create @shopify/hydrogen@latest -- --path <path>,
                          spec §3.7, command shape corrected in Milestone 3 (F2, see above)
  react-native.ts        D25, new — npx @react-native-community/cli@latest init <Name>
                          --directory <path> --skip-install --skip-git-init true. Exports
                          deriveReactNativeAppName() (basename -> PascalCased identifier) alongside
                          the ScaffolderDefinition.
  expo.ts                 D25, new — npx create-expo-app@latest <path> --yes --no-install
                          --template default@sdk-57 --no-agents-md
```

## Tests

`test/scaffolder-registry.test.ts` — registry completeness (all eight `RepoType`s resolve),
`UnknownRepoTypeError` structure, per-type `buildCommand` snapshots, passthrough-arg composition
(incl. the vite `--` separator case and the react-native Name-derivation cases), `interactiveStdio`/
`provisional` flags, plus (D36) upstream-option schema validation, `requiresTerminal` gating, and
per-type option->args (defaults, overrides, the `--`-segment placement for hydrogen, before-passthrough
ordering).
`test/upstream-options.test.ts` — the pure `buildUpstreamOptionArgs()`/`upstreamOptionDefaults()`
helper units (D36).
`test/list-command.test.ts` — `list --json` shape (single parseable JSON object, `repoTypes` array,
per-entry field types, no invented preset/pack keys) and human-output smoke coverage.
