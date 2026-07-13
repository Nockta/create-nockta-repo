/**
 * AI adapter targets create-nockta-repo can request from inject-nockta-skills.
 *
 * Duplicated locally, not imported — see decisions.md D7 / spec §10.1.
 *
 * `agent` (decisions.md D24, inject-nockta-skills) — generic root `AGENTS.md` adapter.
 * `antigravity` (decisions.md D35, inject-nockta-skills) — full per-skill injection into
 * `.agents/skills/` for Google Antigravity (IDE + agy CLI). create does not render adapters itself
 * (it only validates/forwards `--adapters` to inject), so these are one-line enum-parity mirrors,
 * nothing more — the CI-enforced `test/enum-parity.contract.test.ts` proves they haven't drifted.
 */
export type AdapterType = "claude" | "cursor" | "copilot" | "agent" | "antigravity";

export const ADAPTER_TYPES: readonly AdapterType[] = [
  "claude",
  "cursor",
  "copilot",
  "agent",
  "antigravity",
] as const;

/** Milestone 7 addition — same shape as `types/repo-type.ts::isRepoType()`; used by `wizard/steps/select-adapters.ts`. */
export function isAdapterType(value: string): value is AdapterType {
  return (ADAPTER_TYPES as readonly string[]).includes(value);
}
