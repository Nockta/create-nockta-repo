import type { UpstreamOption } from "../types/scaffold.js";

/**
 * Shared, pure translation of surfaced upstream-option answers → argv tokens
 * (D36). Every scaffolder's `buildCommand` calls this and splices the result
 * into the right slot for its command shape (after the target path for most,
 * inside the `--` forwarded segment for the `npm create` types). Kept in one
 * module so the flag-mapping semantics (boolean negation, choice/text value
 * pairs, present-keys-only emission) are identical across all eight types.
 *
 * Emission rules:
 * - Only keys actually present in `answers` emit anything — a bare
 *   `buildCommand(path)` (no answers) adds NO option flags, so the wizard /
 *   interactive-genesis path is unchanged.
 * - `kind: "boolean"`: a true answer emits `flag`; a false answer emits
 *   `negatedFlag` if the option declares one, else nothing.
 * - `kind: "choice"`/`"text"`: a non-empty value emits `[flag, value]` (two
 *   tokens); an empty/undefined value emits nothing.
 */
export function buildUpstreamOptionArgs(
  options: readonly UpstreamOption[] | undefined,
  answers: Record<string, unknown> | undefined,
): string[] {
  if (!options || !answers) return [];
  const args: string[] = [];
  for (const opt of options) {
    if (!Object.prototype.hasOwnProperty.call(answers, opt.key)) continue;
    const value = answers[opt.key];
    if (opt.kind === "boolean") {
      const on = value === true || value === "true";
      if (on) args.push(opt.flag);
      else if (opt.negatedFlag) args.push(opt.negatedFlag);
      continue;
    }
    // choice | text
    if (value === undefined || value === null) continue;
    const str = String(value);
    if (str.length === 0) continue;
    args.push(opt.flag, str);
  }
  return args;
}

/**
 * The schema's own defaults as a plain answers object (D36) — the SINGLE
 * source of truth shared by the CLI `--yes` path (`commands/create.ts`) and
 * the web page's pre-fill (`web/project-schema.ts`), so the two can never
 * drift. Missing/empty option list → `{}`.
 */
export function upstreamOptionDefaults(
  options: readonly UpstreamOption[] | undefined,
): Record<string, boolean | string> {
  const out: Record<string, boolean | string> = {};
  for (const opt of options ?? []) out[opt.key] = opt.default;
  return out;
}
