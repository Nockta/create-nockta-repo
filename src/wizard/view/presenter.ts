import type { StepModel } from "../core/types.js";

/**
 * The View seam (decisions.md D28 seam #1), ported from `inject-nockta-skills`' own
 * `src/wizard/view/presenter.ts`. The Controller depends ONLY on this abstract `Presenter` — never on
 * `@inquirer/*`, picocolors, or any terminal API. The ported CLI two-pane prompts are ONE
 * implementation (`cli-presenter.ts`); a scripted fake (tests) is another. A step's current state
 * (selected rows, confirm default) is carried on the `StepModel` itself, so back-nav re-entry is just
 * a fresh `renderStep` call with an updated model.
 */

/** A step's outcome: either the user's answer, or a request to go back one step. */
export type PresenterResult =
  | { kind: "back" }
  /** `value` shape depends on the step: `string[]` (paginated), `string` (project-path), `string | undefined` (skills-version), `boolean` (confirm). */
  | { kind: "answer"; value: unknown };

export const BACK: PresenterResult = { kind: "back" };

export interface Presenter {
  /** Clean-view: clear the viewport before a step renders, so each step is a fresh screen (D28). */
  clear(): void;
  /** Render one step; resolve with the user's answer or a BACK signal. `prefill` carries any non-choice prior answer (project-path's prior string). */
  renderStep(step: StepModel, prefill?: unknown): Promise<PresenterResult>;
  /** Release any terminal resources. */
  close(): void;
}
