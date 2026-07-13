# CONTEXT.md — src/web/

## Purpose

create's opt-in `--web` mode (decisions.md D30, the create half — the LAST web milestone). One
self-contained browser page with TWO stacked sections, the owner's RESOLVED layout: **"Project"
first, then "Skills"** (two labelled section bands, Project on top; NOT one undifferentiated scroll,
NOT tabs). On Confirm, create scaffolds + applies its architecture overlay, then runs
`inject-nockta-skills` HEADLESS with the collected selections.

Single source of truth: create **hosts** inject's schema; it does NOT reimplement inject's
skill/adapter/razor selection. The Skills section is fetched via the D30 composition contract
`inject wizard --emit-schema --type <types> [--adapters <csv>]` — a pure CLI spawn (D4 intact: no npm
dependency, no programmatic import), the same integration seam `core/run-inject-skills.ts` uses for
the real install.

This layer mirrors inject's own `src/web/*` structure closely (server security posture, reactive
schema endpoint, curation-board page styling, precedence resolver, browser opener).

## Files

- **`precedence.ts`, `display.ts`, `open-browser.ts`** — copied VERBATIM from inject's `src/web/`
  (D7 "duplicate the contract" posture; the packages are independent). Precedence: `--web` (if a
  display is available) > interactive CLI (if a TTY) > `--yes` headless > clean error. `--web` beats
  `--yes` (page authoritative; `--yes`/flags only pre-seed). Wired in `commands/create-entry.ts`.
- **`inject-schema.ts`** — the create-side host for inject's schema. A STRUCTURAL MIRROR of inject's
  `WizardSchema` (only the fields the page reads), plus `fetchInjectSchema()` which spawns
  `inject wizard --emit-schema …` (honoring `CREATE_NOCKTA_REPO_TEST_INJECT_BIN` and the
  `@latest`/`@<skills-version>` pkgSpec — the SAME logic as `buildInjectSkillsCommand`) and parses
  its single stdout JSON line. Empty `types` → `emptyInjectSchema()` marker WITHOUT spawning.
- **`project-schema.ts`** — `buildWebProjectSchema()`: create's OWN genesis Model for the Project
  section, assembled from the D28/D29 `build-schema.ts` StepModels (project-path, repo-type,
  also-types, package-manager, architecture, skills-version). Embeds `archPresetsByType` (per-type
  architecture presets), plus (D36) `upstreamOptionsByType` (each type's surfaced upstream-scaffolder
  options from the registry) and `requiresTerminalByType` (the Shopify-app terminal-only reason), so
  the page can rebuild the "Upstream scaffolder options" card / warning client-side on a type change.
- **`page.ts`** — `renderCreateWebPage(project, skills, token)`: the self-contained HTML string
  (inline CSS + JS, NO external CDN/font/network). Two section bands. Project section renders create's
  genesis steps (text inputs for path + custom version; radio single-selects for repo-type/pm/arch;
  multi for also-types). Skills section renders inject's schema REUSING inject's exact card-per-domain
  + razor-category-divider structure. Reactive: repo-type/also-types/adapter changes debounce-fetch
  `/inject-schema` and re-render ONLY the Skills section (stale-guarded by a seq counter; selections
  preserved across a refetch via a seen/checked snapshot).
- **`server.ts`** — `startCreateWebServer()`: 127.0.0.1 only, `listen(0)` random port, one-time crypto
  token (403 on missing/wrong token on EVERY endpoint), POST body cap. `GET /` → the page;
  `GET /inject-schema` → the reactive Skills source (spawns emit-schema); `POST /submit` → validate
  token, run the pipeline, return the result. One submit only (409 after).
- **`run-create-web.ts`** — orchestration (mirrors inject's `run-web-install.ts`): build first-paint
  schemas → serve → open browser → await the submit → exit with the pipeline's code. `answersToCliOptions`
  maps the web answers to the SAME `CreateCommandCliOptions` a `create <name> --type … --yes` would,
  PLUS the skill deltas as `--include-skills`/`--exclude-skills`. `runCreateWebSubmit` runs
  `runCreateCommand` verbatim (no pipeline duplication) and reads back `process.exitCode`.

## Key decisions / behaviors

- **No pipeline duplication (brief item 4).** The submit path calls `runCreateCommand` — the exact
  scaffold + overlay + headless-inject code the non-interactive CLI uses. `run-inject-skills.ts` was
  extended to accept `includeSkills`/`excludeSkills` and emit inject's `--include-skills`/
  `--exclude-skills` (D19); empty deltas emit NO flag, so every pre-web caller/test is unaffected.
- **Upstream options + terminal independence (D36).** The Project section renders an "Upstream
  scaffolder options" card (per-type, reactive on type change) whose answers ride in the submit
  payload (`CreateWebAnswers.upstreamOptions`) → `answersToCliOptions` → `buildCommand`. The submit
  ALSO sets `nonInteractiveUpstream: true`, so `commands/create.ts::upstreamStdio()` spawns the
  upstream scaffolder with stdin detached (`["ignore","inherit","inherit"]`) — a browser-driven run
  never depends on, or hangs on, the launching terminal (PART A). A `requiresTerminal` type
  (shopify-app — Partner login) short-circuits in `runCreateWebSubmit` BEFORE any spawn and returns a
  terminal-handoff result (`requiresTerminal.command`), which the page renders as a "Finish in your
  terminal" state and `runCreateWeb` echoes to the terminal. Never a hang, never a false success.
- **Empty-types = empty-skills marker, no spawn (documented decision).** A no-`--type` emit-schema
  spawn would make inject DETECT the server's own cwd (create's repo). So the endpoint short-circuits
  empty `types` to `emptyInjectSchema()`; the page shows a "pick a project type to see skills"
  placeholder.
- **`--skills-version` pins BOTH spawns** (emit-schema + install); `CREATE_NOCKTA_REPO_TEST_INJECT_BIN`
  overrides BOTH.

## Known limitations / deferred (not regressions)

- **Monorepo-target selection.** The Project section collects a single project path. A nested path
  still routes to inject's monorepo-target install through the existing create pipeline, but there is
  no multi-target UI (parallels inject's own deferred `targets` step).
- **Extras/claude-mem step** — not part of the web flow (CLI-only), same as inject.
- **Browser VISUAL not human-verified in this pass** (proof-of-done: subjective surface). Programmatic
  endpoint/e2e proof + a regenerated static preview stand in; owner eyeball is still owed. This is a
  FIRST-DRAFT aesthetic reusing inject's tokens.

## Proof

- `test/web-precedence.test.ts` — precedence resolver + display heuristic + browser-command mapping.
- `test/web-create-e2e.test.ts` — `GET /inject-schema` (spawns REAL built inject, next pack + razor
  categories), 403s, `GET /`, and `POST /submit` running the REAL pipeline (scaffolder fixture +
  overlay + real headless inject install with a forwarded razor delta) into a temp target.
- `test/web-upstream-options.test.ts` (D36) — `answersToCliOptions` forwards `upstreamOptions` +
  `nonInteractiveUpstream`; `upstreamStdio` semantics; real-registry argv via `resolveCreatePlan`
  (override / `--yes` defaults / bare wizard); the `requiresTerminal` handoff (shopify-app, no spawn,
  nothing created); `buildWebProjectSchema` maps; page renders the options card + warning literals.
