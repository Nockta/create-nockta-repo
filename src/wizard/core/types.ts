import type { RepoType } from "../../types/repo-type.js";
import type { PackageManagerChoice } from "./build-schema.js";

/**
 * The create-wizard-core Model's vocabulary (decisions.md D28's MVC boundary, D29's genesis-only
 * rebuild). MIRRORS `inject-nockta-skills`' own `src/wizard/core/types.ts` shape (`ChoiceModel`/
 * `SectionModel`/`StepModel`) — copied, not imported (packages independent; D7 duplicate-the-contract
 * posture) — so the SAME ported two-pane View (`view/paginated-frame.ts`, verbatim from inject) draws
 * create's steps. Create's wizard is GENESIS-ONLY (D29): adapters + skills + razor are inject's now,
 * so create has NO skill/razor/tier/lock/clash vocabulary — those `ChoiceModel` fields inject carries
 * are simply omitted here.
 */

/** Stable step identifiers — the ordered spine of the create genesis wizard (D29). */
export type StepId =
  | "project-path"
  | "repo-type"
  | "also-types"
  | "package-manager"
  | "architecture"
  | "skills-version"
  | "confirm";

/**
 * How a step is presented. `paginated-multiselect` is the ported two-pane master–detail prompt
 * (single- OR multi-select per `StepModel.single`); `project-path` the validated text-input sub-flow;
 * `skills-version` the latest/custom select + optional follow-up input; `confirm` the final
 * Yes/No/Back select.
 */
export type StepKind = "paginated-multiselect" | "project-path" | "skills-version" | "confirm";

/**
 * One selectable row. User-facing `label`/`description` carry NO dev-speak (D28). Deliberately a
 * SUBSET of inject's `ChoiceModel` (create has no skill tiers/locks/clashes) — but the same field
 * NAMES/shapes for the fields it does use, so the ported `paginated-frame.ts` renders it unchanged.
 */
export interface ChoiceModel {
  value: string;
  /** Clean, user-facing name (friendly title for repo-types — see `REPO_TYPE_TITLES`). */
  label: string;
  /** Friendly display title, distinct from the raw enum `value`; equals `label` for repo-type/also-types rows. */
  title?: string;
  description?: string;
  /** The grouping key a presenter matches against `SectionModel.key` (falls back to `pack`). Unused by create's flat steps. */
  section?: string;
  /** Kept only for `paginated-frame.ts` compatibility (its `buildRows` falls back to `pack`); create never sections, so always unset. */
  pack?: string;
  /** Default checked state when the step is first entered (before any user toggle / for back re-entry). */
  checked: boolean;
  /** A locked row: cannot be toggled. Create has none today, but the field is kept for View compatibility. */
  disabled: boolean;
  disabledReason?: string;
  /** Advisory overlap note (unused by create; kept for View compatibility). */
  clashesWith?: string[];
}

/** A non-selectable section header. Create's genesis steps are flat (no sections), but the type is kept for View compatibility. */
export interface SectionModel {
  pack: string;
  key?: string;
  label: string;
}

/** One fully-resolved step the presenter renders. */
export interface StepModel {
  id: StepId;
  kind: StepKind;
  /** User-facing prompt title. */
  title: string;
  /** Selectable rows. Present for `paginated-multiselect` (and reused by `skills-version`'s select). */
  choices?: ChoiceModel[];
  /** Ordered sections for paginated steps — create leaves this unset (flat lists). */
  sections?: SectionModel[];
  /** Items per page for the paginated prompt (finite, no wrap). */
  pageSize?: number;
  /** Radio (single-select) mode — the primary repo-type, package-manager, and architecture steps set this (D29). */
  single?: boolean;
  /** Default answer for a `confirm` step. */
  confirmDefault?: boolean;
  /** Optional pre-rendered text shown above the step (the genesis preview above `confirm`). */
  preamble?: string;
}

/**
 * The accumulating answer object the Controller threads through the genesis step loop. GENESIS-ONLY
 * (D29): name/path, primary type, secondary (also) types, package manager, architecture, and the
 * inject VERSION to spawn — NO adapters, NO skills/razor selection (inject owns those, chosen after
 * the handoff). `resolveCreateWizardAnswers()` turns this into `CreateCommandCliOptions`.
 */
export interface CreateWizardAnswers {
  /** Accepted (validated) project name/path — the `projectNameOrPath` handed to `runCreateCommand()`. */
  projectPath?: string;
  /** The chosen PRIMARY repo type (single) — sole genesis-scaffolder + architecture-overlay owner (D22). */
  repoType?: RepoType;
  /** Optional SECONDARY skill-domain types (`--also`, D22) — never includes the primary. */
  alsoTypes?: RepoType[];
  /** Recorded package manager (record-only — never wired into the scaffolder invocation, spec §5.1 step 4). `null` when the type doesn't ask. */
  packageManager?: PackageManagerChoice | null;
  /** Architecture preset name, or `false` for `--no-arch`. */
  architecture?: string | false;
  /** The inject-nockta-skills version/dist-tag to spawn; `undefined` = latest (D14). */
  skillsVersion?: string;
  confirmed?: boolean;
}
