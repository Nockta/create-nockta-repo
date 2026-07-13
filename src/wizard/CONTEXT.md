# CONTEXT.md — src/wizard/

## Purpose

The interactive create wizard, REBUILT (decisions.md D28) to `inject-nockta-skills`' Model–View–
Controller shape and made GENESIS-ONLY (decisions.md D29). It no longer prompts for adapters or
skills — inject owns those now, chosen in inject's OWN wizard after the create→inject handoff (see
`../core/CONTEXT.md`'s interactive-handoff entry and `../CONTEXT.md`'s D29 bullet).

Prior to this rebuild the wizard was a flat sequence of `steps/*.ts` functions behind an injectable
`WizardPrompts` interface (10 steps incl. an adapters step, an advanced-options passthrough step, and
a `install --dry-run --json` skills PREVIEW). That whole `steps/` directory and `prompts.ts` were
REMOVED. The new wizard is a strict MVC split copied (not imported) from inject's `src/wizard/*`
(packages independent; D7 duplicate-the-contract posture):

- **Model** — `core/build-schema.ts` (pure `StepModel` builders; FRIENDLY repo-type titles +
  descriptions from `../../types/repo-type.ts`'s `REPO_TYPE_TITLES`/`REPO_TYPE_DESCRIPTIONS`,
  mirrored from inject) and `core/types.ts` (the serializable step/answer vocabulary — a genuine
  SUBSET of inject's: create has no skill tiers/locks/clashes).
- **View** — `view/*`: the two-pane paginated master–detail prompt (`paginated-frame.ts` +
  `width.ts` + `theme.ts` copied VERBATIM from inject; `paginated-multiselect.ts` ported + a
  `single`/radio mode for create's single-choice steps), the `Presenter` seam, and the CLI presenter.
- **Controller** — `controller.ts`: the back-aware indexed step loop (clean-view between steps,
  back-nav preserving already-entered state, a conditional skip for the package-manager step).

Genesis steps (D29): project name/path → PRIMARY repo type → SECONDARY (`--also`) skill domains →
package manager (record-only, only for types that ask) → architecture preset → inject version →
confirm (with a GENESIS-plan preview: scaffolder + architecture + a note that adapters/skills/razor
are chosen next in inject's own wizard — the final skill list is NOT previewed). Step 11 (actually
creating) is still the SAME `commands/create.ts::runCreateCommand()` the non-interactive path uses —
and because the wizard calls it WITHOUT `--yes`, that command takes D29's INTERACTIVE inject handoff.

## Dependencies

- `../commands/create.ts` — the confirm-step preview and the final validation both call the EXPORTED
  `resolveCreatePlan()` (dry-run, side-effect free); step 11 calls the EXPORTED `runCreateCommand()`
  with the wizard's collected `CreateCommandCliOptions` (NO `adapters`, NO `yes` — genesis-only +
  interactive handoff). Circular-in-spirit but safe under ESM (cross-references used only inside
  function bodies).
- `../core/detect-monorepo-root.ts`, `../core/resolve-target-path.ts`,
  `../core/validate-target-dir.ts` — `view/cli-presenter.ts`'s `project-path` sub-flow reuses these
  UNCHANGED (monorepo detection narration + the bounded path-validation retry loop). The SAME
  validation `commands/create.ts` re-runs, so a wizard-collected path can never diverge.
- `../scaffolders/registry.ts` (`listScaffolders()`), `../architecture/get-architecture-path.ts`
  (`listArchitecturePresets()`) — `core/build-schema.ts` lists real repo types + real bundled
  architecture presets, never a hand-written list.
- `@inquirer/core` (NEW dependency this pass) — `view/paginated-multiselect.ts` builds the custom
  two-pane prompt on its `createPrompt`/`useState`/`useKeypress`/`useMemo` primitives (same as
  inject). `@inquirer/prompts` — the CLI presenter lazily imports `input`/`select` for the
  project-path/skills-version sub-flows and the confirm step.
- `../types/repo-type.ts` — `REPO_TYPES`/`REPO_TYPE_TITLES`/`REPO_TYPE_DESCRIPTIONS`/`isRepoType()`.

## Dependents

- `../commands/create-entry.ts` — the only real-CLI caller of `runCreateWizard()` (TTY-aware
  routing) and `runWizardEntry()`. Now injects an optional `wizardPresenter` (was `wizardPrompts`).
- `test/wizard-view.test.ts` — the ported PURE render layer (frame/width) against create's repo-type
  step (friendly titles in the list + detail pane, two-pane divider, footer, narrow fallback).
- `test/wizard-steps.test.ts` — the Model builders: genesis-only (asserts NO `buildAdapterStep`/
  `buildSkillsStep`/`buildRazorStep` exist), friendly titles, also-types-excludes-primary,
  package-manager conditional, architecture presets + none, skills-version latest/custom.
- `test/wizard-controller.test.ts` — the Controller via a FAKE Presenter: genesis-only spine,
  back-nav preserving state, preset skips, the package-manager conditional skip, cancellation.
- `test/wizard-flow.test.ts` — full `runWizardFlow()`/`runCreateWizard()` via a scripted Presenter
  against real `mkdtemp` dirs: genesis happy path (adapters-free cliOptions), the real create run
  proving the D29 INTERACTIVE handoff argv (`install --type <types>`, NO `--yes`/`--json`/
  `--adapters`, captured from a local fixture inject bin via the
  `CREATE_NOCKTA_REPO_TEST_INJECT_BIN` override), the `--also` union on the handoff, a monorepo
  target (root `--target <path>:<type>` form, profile at the target not the root — D5), and a
  declined confirm.

## Directory Layout

```
src/wizard/
  run-create-wizard.ts   runWizardFlow() (pure-ish: drives the Controller with a Presenter, returns
                          a decision — no process.exit) + runCreateWizard() (impure wrapper: on
                          would-create calls commands/create.ts::runCreateCommand(); else emits the
                          cancellation/plan-error). Builds CreateCommandCliOptions from the answers
                          (NO adapters/yes) and the genesis-plan confirm preview.
  controller.ts           runCreateController() — the back-aware indexed step loop over the genesis
                          spine; package-manager skipped for types that don't ask; presets skip
                          their step; back preserves state.
  core/
    types.ts               StepId/StepKind/ChoiceModel/SectionModel/StepModel (+ single) +
                            CreateWizardAnswers — genesis-only, a subset of inject's vocabulary.
    build-schema.ts         pure StepModel builders (friendly repo-type titles/descriptions),
                            shouldAskPackageManager(), the architecture/skills-version sentinels.
  view/
    width.ts                ANSI-aware width primitives — COPIED VERBATIM from inject.
    theme.ts                picocolors theming + markers + the shared KEY_HINTS footer — VERBATIM.
    paginated-frame.ts      the PURE two-pane master–detail frame renderer — VERBATIM (snapshot-
                            tested headlessly).
    paginated-multiselect.ts the @inquirer/core prompt — ported + a `single`/radio mode (D29) for
                            create's single-choice steps (primary type, package-manager, architecture).
    presenter.ts            the Presenter View seam (clear/renderStep/close).
    cli-presenter.ts        the CLI Presenter: paginated-multiselect -> the two-pane prompt;
                            project-path -> validated input sub-flow; skills-version -> select +
                            custom input; confirm -> Yes/No/Back select with the preview preamble.
```

## Key Concepts

- **Genesis-only (D29).** create's wizard chooses only what a genesis scaffolder + architecture
  overlay need, plus which inject VERSION to spawn. Adapters, skills, and Razor are inject's — the
  wizard never renders them; `CreateCommandCliOptions` produced here carries no `adapters` and no
  `yes`. `core/build-schema.ts` exports NO `buildAdapterStep`/`buildSkillsStep`/`buildRazorStep`
  (guarded by `test/wizard-steps.test.ts`).
- **The interactive handoff is triggered by the ABSENCE of `--yes`.** The wizard calls
  `runCreateCommand()` without `cliOptions.yes`; per D20, `--yes` is the marker of a truly
  non-interactive invocation, so `commands/create.ts` reads "no `--yes`" as "wizard-driven" and takes
  D29's interactive branch (spawn inject's own wizard with inherited stdio, type pre-filled). The
  headless (`--yes`) path is unchanged (inject headless, `--yes --json`, captured).
- **The two-pane component is COPIED, not shared.** `width.ts`/`theme.ts`/`paginated-frame.ts` are
  byte-for-byte inject's; `paginated-multiselect.ts` differs only by the added `single` radio mode.
  Packages stay independent (no cross-package import) — the D7 "copied not imported" convention.
- **The `single` (radio) mode** makes the primary-type, package-manager, and architecture steps
  single-choice while keeping the identical two-pane rendering + footer. space selects one row
  (deselecting others); ↵ confirms the selection (or, if nothing was toggled, the hovered row).
- **Selection logic lives in the Model/Controller, never the prompt (D28).** "primary is single",
  "also-types excludes the primary", "package-manager only for some types", "architecture `none` →
  `false`" are all in `core/build-schema.ts` / `controller.ts` — the prompt (`view/`) only renders +
  reads keystrokes.
- **Known boundary — the real interactive TTY session can't be tested headlessly.** Same boundary
  inject's own wizard has. The scripted-Presenter tests exercise the FULL orchestration + the D29
  handoff argv/outcome; they do NOT prove `@inquirer/core`'s terminal rendering. The two-pane frame
  gets headless snapshot coverage (`test/wizard-view.test.ts`) via the pure `renderPaginatedFrame()`,
  but the live keystroke session and the inherited-stdio handoff's visuals are owner-verified.
```
