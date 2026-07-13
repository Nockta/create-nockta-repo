# CONTEXT.md — src/architecture/

## Purpose

The architecture overlay system (spec §7, §10 `src/architecture/`, §19 Milestone 4): reads a
declarative `arch.json` manifest (spec §7.2) for a given repo type + preset and applies it —
creating directories, copying placeholder/README files, and performing explicitly-listed file
moves — on top of whatever the upstream scaffolder just generated. Never runs arbitrary scripts,
never deletes, never touches a file the manifest doesn't name (spec §7.3, §13).

## Modules

- **`get-architecture-path.ts`** — dist-safe resolution of
  `packs/<repoType>/architecture/<preset>/`, mirroring `inject-nockta-skills`'
  `src/packs/get-pack-path.ts` pattern exactly (same two runtime shapes — built `dist/cli.js` one
  directory below the package root, unbuilt `src/architecture/*.ts` two directories below — same
  `realpathSync` reasoning for symlinked bins/npx caches). `getArchitecturePackageRoot()` caches
  the resolved root per process. `listArchitecturePresets(repoType)` is a helper for error
  messages only (never used for control flow) — returns preset directory names, `[]` if the repo
  type has no `architecture/` dir at all.
- **`read-architecture-manifest.ts`** — parses and validates one `arch.json`. Two entry points:
  `readArchitectureManifestFromDir(manifestDir)` is the low-level primitive (what tests use
  directly, against hand-built temp dirs) and `readArchitectureManifestForPreset(repoType, preset)`
  wraps it with `get-architecture-path.ts` resolution, enriching an unresolvable preset's error
  with `knownPresets`. Throws the structured `ArchitectureManifestError` (`.code`, `.details` — same
  convention as `UnknownRepoTypeError`/`InvalidTargetDirError`) for:
  - `"preset-not-found"` — the preset directory itself doesn't exist (unknown `--arch` value);
  - `"manifest-not-found"` — the preset dir exists but has no `arch.json`;
  - `"malformed-json"` — `arch.json` doesn't parse;
  - `"invalid-schema"` — parses, but violates the spec §7.2 shape (wrong types, unsafe paths —
    every path-shaped field is checked for absolute paths and `..` traversal segments, the same
    safety bar `core/validate-target-dir.ts` applies to the top-level target path);
  - `"deletes-disabled"` — schema is otherwise valid but `deletes` is non-empty. Spec §13:
    "Deletes should be disabled by default." `deletes: string[]` exists in
    `types/architecture.ts` because the schema documents it, but this reader refuses to load any
    manifest that actually uses it — there is no code path anywhere in this package that deletes a
    file from a target project;
  - `"disallowed-field"` — an extra top-level key beyond `name`/`directories`/`files`/`moves`/`deletes`.
    This is this module's own defense-in-depth reading of spec §7.3's "must not run arbitrary
    scripts in MVP": the schema has no scripts/hooks/command field at all, so any manifest
    carrying one (`scripts`, `run`, `postInstall`, …) is rejected outright rather than silently
    ignored. Not a literal spec line item — flagged as a deliberate design choice.
- **`apply-architecture-manifest.ts`** — `applyArchitectureManifest({manifest, manifestDir, targetDir})`
  executes an already-validated manifest, in manifest field order (directories, then files, then
  moves — mirroring §7.2's own key order, dirs/files exist before a move might want to land inside
  them). Returns the spec §11.4 `ArchitectureChanges` shape (`{created, updated, moved, skipped}`)
  exactly. `updated` stays empty in Milestone 4 by design — there is no code path that overwrites
  an existing destination yet, so nothing is ever recorded there; the field exists because the
  spec type declares it. Safety rules enforced here (spec §7.3, §13):
  - only the directories/files/moves *explicitly listed* in the manifest are ever touched — no
    other filesystem operation happens, so unlisted files are provably never touched (see the
    "sentinel file" test in `test/apply-architecture-manifest.test.ts`);
  - **never overwrites an existing destination** — an existing directory, an existing destination
    file, or an existing move destination are all recorded `skipped`, never clobbered;
  - a `moves[]` entry only runs when explicitly listed; a missing source is tolerated only when
    `optional: true` (recorded `skipped`); a non-optional missing source throws
    `ArchitectureApplyError` (`.code`, `.changes` — the partial `ArchitectureChanges` accumulated
    up to that point) and stops the whole apply. **No rollback in Milestone 4** — whatever ran
    before the failing step stays on disk, and the caller (`commands/create.ts`) reports it
    honestly rather than pretending nothing happened.

## Dependents

- `commands/create.ts` is the only real consumer: resolves the architecture preset (read-only,
  spec §12.1 step 3, before the target directory is even validated) *before* running upstream, then
  — only after upstream has actually succeeded — applies it (spec §12.1 step 9). See that file's
  own header comment for the full step-by-step flow and the exit-code mapping (spec §5.9): an
  unknown preset is exit 2 (bad flag value, same bucket as unknown `--type`); every other manifest
  or apply-time failure is exit 3 (architecture overlay failure) — including a broken manifest
  detected before upstream ever runs, since that's the overlay *pack's* own content being broken,
  not the user's input.
- `src/index.ts` does not yet re-export this module's functions (programmatic consumers aren't a
  stated Milestone 4 requirement); revisit if that changes.

## Testing note — the architecture fixture-override env var

Mirrors `commands/create.ts`'s existing `CREATE_NOCKTA_REPO_TEST_FIXTURE_BIN` (Milestone 3, for the
upstream command). `CREATE_NOCKTA_REPO_TEST_ARCH_DIR`, when set, makes the architecture step read
its manifest from that literal directory instead of resolving
`packs/<repoType>/architecture/<preset>/` — this is how
`test/create-architecture.integration.test.ts` engineers a deterministic apply-time overlay failure
(a non-optional `moves[]` entry whose source the fixture scaffolder never creates) without adding a
test-only preset to the real, published `packs/` content. Not part of the public CLI surface; not
documented in README/help text; not read anywhere else in this package.

## Standard overlays — per-type design (spec §18.2 "keep overlays lightweight")

All eight live at `packs/<repoType>/architecture/standard/` (`arch.json` + `files/`) — the original
six plus `react-native`/`expo` (decisions.md D25, added this pass). Every `moves[]` entry across all
eight is `optional: true` — a standard overlay must apply cleanly even against an empty target
directory (proven directly in `test/standard-overlays.test.ts`), because it can never assume what
the upstream scaffolder actually produced.

- **`next`** — spec §7.2's own worked example, used verbatim: `src/components/`, `src/features/_template/`,
  `src/lib/{env,http}`, `src/types`, `src/config`, a features-template README, a `.gitkeep`, and the
  optional `src/app/page.tsx` → `src/app/(public)/page.tsx` move.
- **`vite-react-ts`** — same frontend shape as `next` (components/features/lib/types/config) minus
  the move: Vite has no `app/` router convention to relocate a page into, so this overlay performs
  zero moves rather than inventing one.
- **`nest`** — Nest-idiomatic instead of frontend-idiomatic: `src/modules/_template/` (copy-and-rename
  template for a new feature module) plus `src/common/{decorators,filters,guards,interceptors,pipes}/`
  for cross-cutting concerns, and `src/config/`.
- **`shopify-app` / `shopify-theme` / `shopify-headless`** — deliberately minimal, identical shape
  across all three: one `docs/nockta/` directory holding a single `ARCHITECTURE.md` (type-specific
  wording explaining *why* it's minimal). No directories or moves that could collide with the
  scaffolder's own layout — `shopify app init`'s extensions/web structure, `shopify theme init`'s
  fixed `sections/`/`snippets/`/`templates/` contract, and the still-provisional headless/Hydrogen
  layout (spec §3.7) are all entirely upstream-owned. See each `files/architecture-readme.md` for
  the type-specific rationale.
- **`react-native` / `expo`** (decisions.md D25, new) — same minimal shape as the three Shopify
  types above: one `docs/nockta/ARCHITECTURE.md`, zero directories/moves that could collide with
  the scaffolder's own layout (`android/`/`ios/`/`App.tsx` for bare RN; expo-router's `src/app/`
  file-based routes for Expo — the overlay deliberately does NOT create an `app/` directory of its
  own, since the current SDK 57 default template nests routes under `src/app/`, not a bare
  top-level `app/`). Each `files/architecture-readme.md` states the type-specific structure notes
  (RN's native dirs; Expo's `src/app/`+`@/*` path-alias convention) so a reader doesn't need to
  cross-reference the scaffolder research separately.
