/**
 * MVP project types supported by create-nockta-repo.
 *
 * This union is deliberately duplicated (not imported) from
 * inject-nockta-skills — see decisions.md D7 / spec §10.1. inject-nockta-skills
 * is the canonical semantic owner; this is a local mirror guarded by a
 * contract test against `inject-nockta-skills list --json` (spec §16.1/§16.2).
 */
export type RepoType =
  | "next"
  | "vite-react-ts"
  | "nest"
  | "shopify-app"
  | "shopify-theme"
  | "shopify-headless"
  | "react-native"
  | "expo";

export const REPO_TYPES: readonly RepoType[] = [
  "next",
  "vite-react-ts",
  "nest",
  "shopify-app",
  "shopify-theme",
  "shopify-headless",
  "react-native",
  "expo",
] as const;

/**
 * Milestone 7 addition — mirrors `inject-nockta-skills`' own
 * `types/repo-type.ts::isRepoType()` export exactly (same name, same shape).
 * `scaffolders/registry.ts` had a local, unexported copy of this same guard
 * since Milestone 2; it now imports this one instead of duplicating it a
 * second time within this package — `wizard/steps/select-repo-type.ts` is
 * the other consumer (an explicit, valid `--type` preset short-circuits its
 * step without prompting).
 */
export function isRepoType(value: string): value is RepoType {
  return (REPO_TYPES as readonly string[]).includes(value);
}

/**
 * Friendly display titles for the wizard's repo-type choices (D28/D29 wizard rebuild). MIRRORS
 * `inject-nockta-skills`' own `types/repo-type.ts::REPO_TYPE_TITLES` verbatim (copied, not imported
 * — decisions.md D7's "duplicate the contract" posture) so create's genesis wizard and inject's own
 * wizard render the SAME friendly name for a given type. The raw `RepoType` enum value never changes
 * — it's still what routing/scaffolder-resolve/`--type`/the create→inject handoff all key off — this
 * map ONLY changes what a View renders. Consumed by `wizard/core/build-schema.ts`'s repo-type +
 * also-types steps.
 */
export const REPO_TYPE_TITLES: Record<RepoType, string> = {
  next: "Next.js",
  "vite-react-ts": "Vite + React + TS",
  nest: "NestJS",
  "shopify-app": "Shopify App",
  "shopify-theme": "Shopify Theme",
  "shopify-headless": "Shopify Headless (Hydrogen)",
  "react-native": "React Native",
  expo: "Expo",
};

/**
 * Consumer-facing, one-line descriptions for the wizard's repo-type choices (D28/D29). Shown in the
 * CLI two-pane detail pane — no dev-speak, no spec/decision refs. Mirrors inject's own
 * `REPO_TYPE_DESCRIPTIONS`.
 */
export const REPO_TYPE_DESCRIPTIONS: Record<RepoType, string> = {
  next: "React framework with file-based routing, SSR/SSG, and API routes.",
  "vite-react-ts": "Vite-powered React app with TypeScript — fast dev server and builds.",
  nest: "NestJS backend framework — structured, TypeScript-first Node.js APIs.",
  "shopify-app": "Embedded Shopify app built with the Shopify App CLI and Admin APIs.",
  "shopify-theme": "Shopify Liquid theme — sections, blocks, and the Online Store 2.0 editor.",
  "shopify-headless": "Headless Shopify storefront built with Hydrogen and the Storefront API.",
  "react-native": "Cross-platform mobile app built with React Native.",
  expo: "Managed React Native app built with Expo's tooling and native APIs.",
};
