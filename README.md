# create-nockta-repo

**Scaffold a new project the Nockta way — one command that runs the *official* framework
scaffolder, lays down Nockta's architecture conventions on top, and wires in your AI-tooling skill
packs.**

`create-nockta-repo` is a thin, deterministic orchestrator. It does **not** reimplement
`create-next-app`, `create-vite`, the Nest CLI, the Shopify CLI, or the Expo/React Native CLIs — it
*drives* them, then applies two Nockta-specific post-processing steps: an **architecture overlay**
(convention directories, template READMEs, a couple of curated file moves) and a hand-off to
[`inject-nockta-skills`](#relationship-to-inject-nockta-skills), which installs the AI-adapter skill
content (`.claude/`, `AGENTS.md`, etc.).

It is **wizard-first** (run it bare and it interviews you), **monorepo-aware** (drop a target into an
existing workspace and it does the right thing), and **multi-type aware** (a Shopify theme that also
ships a Vite/React frontend can pull *both* skill domains).

**Who it's for:** teams standing up new repos or new targets inside a monorepo who want every project
to start from the same architecture baseline and the same AI-agent skill set, without hand-copying
boilerplate or memorizing each upstream scaffolder's flags.

---

## What it does

For a single invocation, in order (spec §12.1 / §12.2):

1. **Resolve** the project path and repo type, read + validate the architecture preset, validate the
   `--adapters` list, and detect whether the target lands inside a monorepo.
2. **Run the official scaffolder** for the chosen type (e.g. `npx create-next-app@latest`) into the
   resolved target directory. On failure it stops immediately — nothing downstream runs.
3. **Apply the architecture overlay** — create convention directories, copy in template files, and
   perform only the explicitly-declared file moves. Never overwrites an existing file; no rollback in
   the MVP (a failure reports exactly what was created before it stopped).
4. **Invoke `inject-nockta-skills`** by spawning its CLI (`npx inject-nockta-skills@latest ...`) to
   render the AI adapters and skill packs. Never an npm dependency — see
   [How skill installation works](#how-skill-installation-works).
5. **Write the repo profile** — `<target>/.nockta/repo-profile.json`, recording what was created.

Everything is deterministic (bundled overlay content, pinned upstream invocations) and every step has
a dedicated exit code so a failure is never ambiguous.

**No git commits, ever (decisions.md D11).** `create-nockta-repo` never runs `git commit` — not even
when the upstream scaffolder initializes a git repo itself (`create-next-app` and `create-expo-app`
both do; there's no flag to suppress the latter). The architecture overlay and adapter outputs are
left uncommitted for you to review before committing. This is a hard rule, not a default you can
override with a flag.

---

## Install & quick start

> **Status — not published yet.** `package.json` carries `"private": true` as a safety default; the
> owner removes it immediately before the first real `npm publish`. The published invocation will be
> `npx create-nockta-repo` (the package `bin` is `create-nockta-repo`). Until then, run it from a
> local build:
>
> ```bash
> cd create-nockta-repo
> pnpm install && pnpm build
> node dist/cli.js --help
> ```

Once published, the intended entry points:

```bash
# Interactive — the wizard interviews you (requires a real terminal)
npx create-nockta-repo

# Non-interactive — everything on the command line (requires --yes)
npx create-nockta-repo my-project --type next --yes
```

Running it bare (no project path or no `--type`) drops you into the **wizard**. Supplying a path
**and** `--type` **and** `--yes` (or `--dry-run`) runs straight through non-interactively. Anything in
between, on a real terminal, still opens the wizard with your partial flags pre-filled.

> **Requires Node ≥ 20** (`package.json` `engines`).

<!-- VERIFIED-EXAMPLE: real captured local run (`node dist/cli.js`, pre-publish), exit 0 -->

```
$ create-nockta-repo create my-vite-app --type vite-react-ts --adapters claude --dry-run
# prints plan incl. spawn: npx inject-nockta-skills@latest install --type vite-react-ts --adapters claude --yes --json ; writes nothing

$ create-nockta-repo create my-vite-app --type vite-react-ts --adapters claude,cursor --yes
# runs real `npm create vite@latest`, applies architecture overlay (10 paths), then invokes inject:
#   "AI skill injection succeeded (standalone): installed 130 files across 3 packs (common, razor, vite-react-ts) for adapters: claude, cursor"
# result: real Vite scaffold + .claude/skills (16) + .cursor/rules/* + .nockta/{repo-profile,skills-profile,generated-manifest}.json
#   repo-profile.json: "skillsInjected": true, "skillsVersion": "0.1.0"

$ create-nockta-repo create my-app --type vite-react-ts --no-skills --dry-run
# "AI skill injection: --no-skills flag: inject-nockta-skills invocation skipped (spec §5.6)."
```

---

## Supported project types

Eight repo types (`src/types/repo-type.ts` — the `RepoType` union, mirrored from
`inject-nockta-skills` and guarded by a [parity contract test](#enum-parity-contract)). Each wraps one
official scaffolder and applies one Nockta overlay. Run `create-nockta-repo list` for this table live.

| `--type` | Wraps (official scaffolder) | Upstream invocation (conceptual) | Overlay adds |
|---|---|---|---|
| `next` | `create-next-app` | `npx create-next-app@latest <path>` | `src/components/{ui,layout}`, `src/features/_template/{components,hooks}` + README, `src/lib/{env,http}`, `src/{types,config}`; moves `src/app/page.tsx` → `src/app/(public)/page.tsx` (optional) |
| `vite-react-ts` | `create-vite` | `npm create vite@latest <path> -- --template react-ts` | Feature/components/lib convention dirs + `_template` README (frontend-shaped, minus the app-router move) |
| `nest` | `@nestjs/cli` | `npx @nestjs/cli new <path>` | `src/modules/_template` + README, `src/common/{decorators,filters,guards,interceptors,pipes}`, `src/config` |
| `shopify-app` | Shopify CLI (app) — *interactive* | `shopify app init --path <path>` | `docs/nockta/ARCHITECTURE.md` (structure is upstream-owned) |
| `shopify-theme` | Shopify CLI (theme) — *interactive* | `shopify theme init <path>` | `docs/nockta/ARCHITECTURE.md` |
| `shopify-headless` | `@shopify/create-hydrogen` — *interactive, **provisional*** | `npm create @shopify/hydrogen@latest -- --path <path>` | `docs/nockta/ARCHITECTURE.md` |
| `react-native` | `@react-native-community/cli` | `npx @react-native-community/cli@latest init <Name> --directory <path> --skip-install --skip-git-init true` | `docs/nockta/ARCHITECTURE.md` |
| `expo` | `create-expo-app` | `npx create-expo-app@latest <path> --yes --no-install --template default@sdk-57 --no-agents-md` | `docs/nockta/ARCHITECTURE.md` |

Notes traced to source (`src/scaffolders/*.ts`):

- **`vite-react-ts`** bakes the `--` separator into its base args — `npm create` needs it to forward
  flags to `create-vite`. Your [passthrough args](#passthrough-args) land *after* `--template
  react-ts` inside that same forwarded segment (don't add a second `--`).
- **`shopify-app`** routes the target path through the CLI's own `--path` flag (an isolation choice in
  the registry, not the bare `shopify app init` the spec shows). The three Shopify types and
  `shopify-headless` require **interactive stdio** — the Shopify CLI prompts unless you supply enough
  flags via passthrough.
- **`shopify-headless` is `provisional: true`** — the exact upstream tooling (Hydrogen / Remix /
  custom) depends on the chosen preset and is not fixed. The current command shape targets
  `@shopify/create-hydrogen` (`--path` is a named flag there, not positional). `list --json` marks it
  `provisional`. Do not treat its command shape as stable.
- **`react-native`** derives the CLI's required positional `<Name>` (a bare identifier) from the
  target path's basename via `deriveReactNativeAppName()` (PascalCased, letters/digits only, never
  starts with a digit — e.g. `my-cool-app` → `MyCoolApp`), while `--directory <path>` decouples the
  on-disk folder. `npx react-native init` is deprecated; this uses the community CLI.
- **`expo`** pins `--template default@sdk-57` (bare `create-expo-app@latest` currently scaffolds SDK
  54 during the SDK-57 transition window) and passes `--no-agents-md` so Nockta's own `AGENTS.md`
  (the `agent` adapter) owns that space instead of Expo's thin stubs (decisions.md D24). Expo always
  `git init`s the new dir — there is no suppressing flag.

---

## The wizard

Run `create-nockta-repo` bare (or `create-nockta-repo wizard`) on a real terminal. **The wizard is
genesis-only** (decisions.md D28/D29): it decides *what gets scaffolded*, not *which AI skills get
installed*. Steps, in order (`src/wizard/`):

1. **Project path** — where to create the project. Validated with the *same* machinery as the
   non-interactive path (rejects an existing target, an absolute path, or a `..` escape), and loops on
   a bad path instead of aborting.
2. **Standalone vs. monorepo target** — **auto-detected and narrated**, not a real question. There is
   no `--monorepo-target` flag anywhere; the filesystem decides (see [Multi-type &
   monorepo](#multi-type--monorepo)).
3. **Project type** — the primary type, single-select, listed live from the scaffolder registry with
   friendly titles.
4. **Secondary skill domains (`--also`)** — an *optional* multi-select of every **other** repo type.
   Selecting none is a full no-op; selecting some unions extra `inject-nockta-skills` packs (never a
   second scaffolder or overlay — decisions.md D22).
5. **Package manager** — asked only for `next` / `vite-react-ts` / `nest` (recorded only, default
   `npm`) — not currently wired into any scaffolder invocation or the repo profile.
6. **Architecture preset** — enumerated from the presets actually bundled under
   `packs/<type>/architecture/`; `standard` is the default. A `none` choice maps to `--no-arch`.
7. **`inject-nockta-skills` version** — `latest` (default), or a custom-entry option to type a
   specific version or dist-tag (decisions.md D14).
8. **Confirm** — a *genesis-plan* preview only: upstream scaffolder command, target path/monorepo
   classification, secondary skill domains (if any), and the architecture summary — **not** the
   resolved skill/adapter list. Instead it prints a note that adapters, skills, and Razor doctrine are
   chosen next, in `inject-nockta-skills`' *own* wizard. Decline here and nothing is created.
9. On confirm, the wizard hands off to the **exact same** `runCreateCommand()` the flag-driven path
   uses — identical exit codes, `--json` shape, and safety guarantees. There is no second write path.

**The create → inject interactive handoff (decisions.md D29).** Because the wizard never collects
`--yes`, once the upstream scaffolder and architecture overlay succeed, `create-nockta-repo` launches
`inject-nockta-skills`'s **own interactive wizard** as a child process, with the resolved repo type(s)
pre-filled and inherited stdio — `npx inject-nockta-skills@<version> install --type <types>` (or the
monorepo-target `--target` form), deliberately with **no** `--adapters`, `--yes`, or `--json`. You land
straight in inject's adapter → skill → Razor selection steps (see the sibling package's own README) with
the type step already answered; declining inject's own confirm just means skills weren't injected — it
does not undo the scaffold or the overlay. This replaced an earlier design (decisions.md D18) where
create's wizard fetched and displayed inject's resolved plan via `install --dry-run --json` instead of
handing over the terminal — that dry-run-preview approach is what `--web` mode below uses instead (a
non-interactive plan-fetch is exactly what a hosted page needs; a real terminal instead gets the fuller,
truly interactive inject wizard).

Non-interactive (`--yes`) runs never see any of this — they call inject **headless**
(`--type <types> --adapters <list> --yes --json`), exactly as documented under [How skill installation
works](#how-skill-installation-works).

Every partial flag you passed on the command line pre-fills its step and skips the prompt.

### Web wizard mode (`--web`)

`create-nockta-repo create --web` (decisions.md D30) starts a local, token-secured HTTP server on
`127.0.0.1` (random port) and serves a **single self-contained page** with two sections — "Project"
(create's own genesis fields: path, primary/secondary type, package manager, architecture, skills
version) and "Skills" below it (inject's adapter/skill/razor catalog, fetched reactively via a plain
CLI spawn — `inject wizard --emit-schema --type <types>` — never an npm dependency, same D4 boundary).
On submit, the page POSTs back once; the server runs the real create pipeline (scaffolder + overlay)
then inject **headless** (`--yes --json`), forwarding your web-collected skill choices as
`--include-skills`/`--exclude-skills`. Falls back to the terminal wizard (or `--yes` headless) when no
display is available; `--cli` forces the terminal path even if `--web` is also given; `--no-open`
serves and prints the URL without auto-launching a browser. Monorepo-target selection and the
Extras/claude-mem step are not yet wired into the web page (falls through to the existing create
pipeline / is simply unavailable there) — use the terminal wizard or flags for those.

> **Flags after `--web` need the `--` separator.** `npm create nockta-repo` forwards flags to the CLI
> only after a literal `--`, so combine `--web` with flags like this:
> `npm create nockta-repo@latest -- --web --type next`. Without the separator, npm swallows the flags
> and you get the bare wizard. (A globally installed `create-nockta-repo --web --type next` needs no
> separator — this only applies to the `npm create` / `npm init` launcher.)

#### Upstream scaffolder options in the browser (D36)

When you pick a project type, the Project section also shows an **"Upstream scaffolder options"** card
surfacing the choices the official scaffolder would otherwise prompt for — create-next-app's
TypeScript / Tailwind / ESLint / App Router / `src/` / Turbopack / import-alias, `nest new`'s package
manager / language / strict, Hydrogen's language / styling / markets, and the React Native package
manager. Defaults are pre-filled from the same schema the CLI `--yes` path uses, so the two can never
drift. Your answers flow into the submit payload and become explicit non-interactive flags — the web
submit spawns the upstream scaffolder **with stdin detached**, so it never prompts (or hangs) in the
launching terminal. Types whose contract pins every choice (Vite `--template react-ts`, Expo
`--template default@sdk-57`, the two option-less Shopify types) show no options card.

**Types that can't run headless.** `shopify-app` needs a browser login to your Shopify Partner
organization, which the wizard can't drive. Selecting it shows a **"Finish in your terminal"** warning
up front, and on submit the page hands you the exact command to run in your terminal rather than
hanging or pretending success.

<!-- VERIFIED-EXAMPLE SLOT: a real captured wizard session transcript belongs here — being produced
     separately. -->

---

## Multi-type & monorepo

### Multi-type (`--also`)

Scaffolding identity is singular — exactly one official scaffolder can own project genesis — but skill
needs are a *set*. A Liquid theme that also uses Vite/React genuinely wants both domains' skills
(decisions.md D22).

- `--type <primary>` chooses the **one** genesis scaffolder **and** the **one** architecture overlay.
- `--also <a,b>` names **secondary skill-domain types**. They are validated, deduped against the
  primary (a duplicate is a warning, not an error), and **forwarded to `inject-nockta-skills` as a
  union** — never a second scaffolder, never a second overlay.

```bash
npx create-nockta-repo store --type shopify-theme --also vite-react-ts --yes
```

The union `[shopify-theme, vite-react-ts]` (primary first) is what reaches inject: `--type
shopify-theme,vite-react-ts` for a standalone install, or `--target <path>:shopify-theme+vite-react-ts`
for a monorepo target (the two separators are inject's own — comma for `--type`, `+` inside the colon
form).

### Monorepo targets

Monorepo detection runs **at the current working directory only** (no upward walk — the spec's own
example has you `cd` into the workspace root first). Signals (`src/core/detect-monorepo-root.ts`):
`pnpm-workspace.yaml`, `turbo.json`, `nx.json`, `lerna.json`, `rush.json`, or a `package.json`
`workspaces` field.

```bash
cd existing-monorepo
npx create-nockta-repo apps/web --type next --yes
npx create-nockta-repo apps/api --type nest --yes
```

When the cwd is a monorepo root, the given path is created as a **monorepo target**. The difference
from a standalone create is *where inject runs*: for a monorepo target it spawns **at the monorepo
root** (so root adapters + `.nockta/targets.json` land there — inject-owned, decisions.md D5), while
`create-nockta-repo`'s own `<target>/.nockta/repo-profile.json` still goes in the target's root, never
the monorepo root.

> **Not in the MVP:** creating the monorepo *root itself* (`--monorepo` / `init-monorepo`, mentioned in
> the spec) is deferred (decisions.md D12) and is **not** a flag on the current CLI. `create-nockta-repo`
> attaches targets to a monorepo that already exists.

---

## CLI reference

Every command and flag below is defined in `src/cli.ts`, `src/commands/create.ts`, and
`src/commands/list.ts`. `create` is the **default command** — `create-nockta-repo my-project ...` is
rewritten to `create-nockta-repo create my-project ...` before parsing.

### Global options (accepted before or on any subcommand)

| Flag | Meaning |
|---|---|
| `--json` | Emit one compact machine-readable JSON line instead of human text (spec §5.9, decisions.md D13). |
| `--skills-version <version\|dist-tag>` | Pin the `inject-nockta-skills` version/dist-tag to spawn; defaults to `@latest`. |
| `-V`, `--version` | Print the CLI version (`0.1.0`). |
| `-h`, `--help` | Print help. |

### `create [projectNameOrPath]` (default)

| Flag | Meaning |
|---|---|
| `[projectNameOrPath]` | Positional. Project name or path to create. Omit to trigger the wizard. |
| `--type <repoType>` | The primary repo type. One of the eight in [Supported types](#supported-project-types). Required for a non-interactive run. |
| `--also <types>` | Comma-separated **secondary skill-domain** types, unioned with `--type` and forwarded to inject (decisions.md D22). Never a second scaffolder/overlay. |
| `--arch <preset>` | Architecture preset (default: `standard`). |
| `--no-arch` | Skip the architecture overlay entirely (spec §5.5). |
| `--adapters <list>` | Comma-separated AI adapters. One or more of `claude`, `cursor`, `copilot`, `agent`, `antigravity`. **Default: `claude`.** |
| `--no-skills` | Skip the `inject-nockta-skills` step entirely (spec §5.6). |
| `--skills-version <v>` | (Global, honored here too.) Pin the inject version/dist-tag. |
| `--web` | Open a local browser page (Project + Skills sections) to set up the project (decisions.md D30). Falls back to the terminal wizard (or `--yes` headless) when no display is available. |
| `--cli` | Force the terminal path even if `--web` is also given (decisions.md D30). |
| `--no-open` | With `--web`: serve and print the URL but do not auto-launch a browser (decisions.md D30). |
| `--dry-run` | Print the full plan and stop. Writes nothing, runs no scaffolder. Exempt from the `--yes` requirement. |
| `--yes` | **Required for non-interactive execution** (spec §5.2, decisions.md D20). Without it (and without a TTY) the command exits invalid-input. |
| `--force` | Parsed and accepted, but **currently a no-op** — it is not read anywhere in the create flow. Documented here rather than describing behavior it doesn't have. |
| `-- <args...>` | Everything after a literal `--` is forwarded verbatim to the upstream scaffolder. See below. |

<a id="passthrough-args"></a>**Passthrough args.** Flags after `--` go straight to the official
scaffolder, appended after that scaffolder's base args:

```bash
npx create-nockta-repo apps/web --type next --yes -- --tailwind --eslint --src-dir --app
```

becomes trailing args on `npx create-next-app@latest apps/web --tailwind --eslint --src-dir --app`.
(For `vite-react-ts`, they land after `--template react-ts` inside the already-present `--` segment —
don't add a second `--`.) Split is on whitespace; no shell-style quoting.

### `list`

Lists the supported repo types and their upstream scaffolder commands, sourced from the registry.

| Flag | Meaning |
|---|---|
| `--details` | Reserved — **not yet implemented** (prints a notice). |
| `--json` | (Global.) One compact JSON object: `{ repoTypes: [...] }`, each entry carrying `repoType`, `displayName`, `upstreamTool`, `conceptualCommand`, `interactiveStdio`, `provisional`, `minNodeVersion`, and an `exampleCommand`. |

### `wizard`

Runs the interactive create wizard directly. **Requires a real TTY** — from a non-interactive process
it exits with a structured error rather than hanging on a prompt.

### Non-interactive routing (`src/commands/create-entry.ts`)

- **Sufficient** = path **and** `--type` **and** (`--yes` **or** `--dry-run`) → runs straight through.
- **Insufficient + real TTY** → the wizard, with whatever flags you gave pre-filled.
- **Insufficient + no TTY** → a structured, non-hanging invalid-input error (exit 2; one JSON line
  under `--json`).

### Exit codes (`src/commands/create.ts` `EXIT_CODE`)

| Code | Name | When |
|---|---|---|
| `0` | success | Everything completed. |
| `1` | upstream failure | The official scaffolder failed — nothing downstream ran. |
| `2` | invalid target/input | Unknown `--type`/`--arch`/`--adapters`/`--also`, bad target dir (exists / absolute / `..` escape), or insufficient flags with no TTY. |
| `3` | architecture failure | The overlay's manifest or apply step failed (reports what was already created; no rollback). |
| `4` | skills failure | `inject-nockta-skills` failed — project + overlay already exist, only skills failed. |
| `5` | profile failure | Writing `.nockta/repo-profile.json` failed — everything before it succeeded. |

> Codes `3`/`4`/`5` extend the spec §5.9 table (which stops at 4); each post-upstream step earns its
> own code rather than a catch-all, so callers can distinguish failure modes. Flagged in-source as a
> deliberate extension, not a spec-stated mapping.

<!-- VERIFIED-EXAMPLE SLOT: a real captured `--json` envelope and a `list --json` output belong here —
     being produced separately. -->

---

## How skill installation works

`create-nockta-repo` never imports `inject-nockta-skills` as a library and never lists it as an npm
dependency. It **shells out to inject's own CLI** as a child process (decisions.md D4, spec §8.1;
`src/core/run-inject-skills.ts`). This keeps the two packages independently publishable and versionable.

Default binary resolution:

```bash
npx inject-nockta-skills@latest install ...
```

`--skills-version <v>` switches it to `npx inject-nockta-skills@<v> install ...`. `--no-skills` skips
the step entirely.

Two invocation shapes:

```bash
# standalone — spawned INSIDE the created project directory
inject-nockta-skills install --type <type[,type...]> --adapters <list> --yes --json

# monorepo target — spawned AT the monorepo ROOT
inject-nockta-skills install --target <path>:<type[+type...]> --adapters <list> --yes --json
```

inject's single-line `--json` result is parsed for the installed/skipped packs, rendered file count,
warnings, and profile paths. A nonzero exit, a signal, or unparseable output is a typed failure
carrying inject's exit code and a bounded stderr tail → **exit code 4**, with the honest partial state
reported (no rollback). The resolved inject version actually used is read back (from inject's own
`--json` `data.version` when present, else from the `.nockta/skills-profile.json` it wrote) and
recorded on the repo profile as `skillsVersion` — *not* the `--skills-version` flag echoed back.

<a id="enum-parity-contract"></a>**Enum parity contract.** The `RepoType` and `AdapterType` unions
are duplicated locally (not imported) from `inject-nockta-skills` (decisions.md D7). To stop them
drifting, `test/enum-parity.contract.test.ts` spawns the **real** built `inject-nockta-skills list
--json` and asserts its reported `repoTypes`/`adapterTypes` exactly match this package's local
`REPO_TYPES`/`ADAPTER_TYPES`. Adding a type to one package without the other breaks this test.

---

## Architecture overlays

An overlay is a small, versioned pack of Nockta conventions applied *after* the official scaffolder
runs. Each lives at `packs/<repo-type>/architecture/<preset>/` and is a declarative manifest
(`arch.json`) plus a `files/` folder of template content (`src/types/architecture.ts`,
`src/architecture/`).

A manifest declares four things (only the first three are active):

- **`directories`** — convention folders to create (e.g. `src/features/_template/components`).
- **`files`** — template files to copy from the pack's `files/` into the project (e.g. a
  `_template/README.md` explaining the feature-folder convention).
- **`moves`** — relocate an upstream-generated file (e.g. `src/app/page.tsx` →
  `src/app/(public)/page.tsx`). A `move` may be `optional` (a missing source is recorded as skipped,
  not an error); a missing **non-optional** source stops the apply with exit 3.
- **`deletes`** — present in the schema but **disabled at read time** (spec §13): a manifest with a
  non-empty `deletes` array is rejected.

The applier never overwrites an existing destination and never touches an unlisted file. Example — the
real `packs/next/architecture/standard/arch.json` creates eight convention directories, copies a
feature-template README and a `.gitkeep`, and optionally moves the App Router entry page into a
`(public)` route group. The three Shopify types plus `react-native`/`expo` ship deliberately minimal
overlays (a single `docs/nockta/ARCHITECTURE.md`) because their real structure is entirely
scaffolder-owned — Nockta doesn't fight it.

`--arch <preset>` selects a preset (`standard` is the only bundled preset today); `--no-arch` skips
overlays entirely and records `architecture: null` on the profile.

### The repo profile

The final step writes `<target>/.nockta/repo-profile.json` (`src/types/profile.ts`) — always the
target's own root, never a monorepo root. Fields: `tool`, `version` (this CLI's own version),
`repoTypes[]` (primary first, then `--also` types), `architecture`, `projectPath` (as given),
`isMonorepoTarget`, `officialScaffolder` (name/command/args of the primary scaffolder only),
`skillsInjected`, `skillsVersion`, `adapters`, `createdAt`.

---

## Relationship to inject-nockta-skills

Two **separate, independently publishable** packages with a clean boundary:

| | `create-nockta-repo` | `inject-nockta-skills` |
|---|---|---|
| Owns | **Project genesis** — running the official scaffolder + applying the architecture overlay | **Skills** — rendering AI adapters (`.claude/`, `AGENTS.md`, …) from skill packs |
| Writes | `<target>/.nockta/repo-profile.json` | `.nockta/{skills-profile,targets,generated-manifest}.json`, adapter outputs |
| Relationship | *Spawns* inject's CLI as a child process (never a dep) | Runs standalone too; `create` is just one caller |

`inject-nockta-skills` is the canonical semantic owner of the `RepoType`/`AdapterType` vocabulary;
`create-nockta-repo` mirrors it locally and is kept honest by the [parity contract
test](#enum-parity-contract). You can run `inject-nockta-skills install` on an *existing* project at
any time — `create-nockta-repo` is only for standing up a *new* one.

---

## Attribution & license

**License.** This package is Apache-2.0-licensed (see `package.json` `"license"` field, the root
`LICENSE` file, and the root `NOTICE` file).

Wraps and defers to these upstream tools, each under its own license: `create-next-app`,
`create-vite`, `@nestjs/cli`, the Shopify CLI, `@shopify/create-hydrogen`,
`@react-native-community/cli`, and `create-expo-app`.

---

## Releasing

Maintainer-facing release process (tag push → CI publishes to npm with provenance, no tokens after
first release; note `inject-nockta-skills` must be published first) is documented in
[`RELEASING.md`](./RELEASING.md).

---

## Contributing

### Adding a new repo type

It is a **cross-package** change — both `create-nockta-repo` and `inject-nockta-skills` must gain the
type in the same pass (the parity contract test enforces it):

1. Add the value to the `RepoType` union **and** `REPO_TYPES` array in `src/types/repo-type.ts`
   (same value, same position, in *both* packages — decisions.md D7).
2. Add a scaffolder module under `src/scaffolders/<type>.ts` and register it in
   `src/scaffolders/registry.ts`. The `Record<RepoType, ScaffolderDefinition>` annotation is itself
   the completeness check — the file won't typecheck until every type has an entry. Verify the real
   upstream command against primary sources before wiring execution.
3. Add an overlay pack: `packs/<type>/architecture/standard/arch.json` + a `files/` folder.
4. On the `inject-nockta-skills` side, add the matching skill pack(s) and detection signals.
5. Run `pnpm test` — `enum-parity.contract.test.ts` and `standard-overlays.test.ts` (data-driven off
   `REPO_TYPES`) both need to stay green.

### Local development

```bash
pnpm install        # esbuild is allowlisted for postinstall (see package.json pnpm.onlyBuiltDependencies)
pnpm build          # tsup
pnpm test           # vitest — offline by default
pnpm typecheck      # tsc --noEmit (pinned to TS 5.9.x — TS 7 breaks tsup's .d.ts bundling)
# prepublishOnly runs build && typecheck && test automatically on `npm publish`
```

The network-touching real-scaffolder acceptance test is gated behind `RUN_REAL_SCAFFOLDER_TESTS=1`
and skipped by default.

### Testing the create → inject handoff locally

This package always spawns `inject-nockta-skills` via `npx inject-nockta-skills@latest` (or
`@<version>` under `--skills-version`) — it **never** imports it as a dependency, so a plain
`npm link inject-nockta-skills` in this repo has no effect on what gets spawned; `npx ...@latest`
still resolves from the registry regardless. To exercise the real create→inject handoff against your
own local `inject-nockta-skills` build (e.g. before either package is published), point the
`CREATE_NOCKTA_REPO_TEST_INJECT_BIN` env var at its built `dist/cli.js` — `run-inject-skills.ts` spawns
`node <that path> install ...` instead of `npx` when it's set:

```bash
export CREATE_NOCKTA_REPO_TEST_INJECT_BIN=/path/to/inject-nockta-skills/dist/cli.js
node dist/cli.js create my-vite-app --type vite-react-ts --adapters claude --yes
```

This is also how `test/create-skills.integration.test.ts` and the real-scaffolder acceptance test
prove the full chain without a published `inject-nockta-skills`. (For testing `inject-nockta-skills`
*standalone*, its own README documents a separate `npm link` workflow — that one works because its CLI
is invoked directly, not spawned through a hardcoded `@latest`/`@<version>` npx call.)
