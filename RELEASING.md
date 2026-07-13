# Releasing `create-nockta-repo`

## Model

Pushing a `v*` tag to `main` **is** the release: `.github/workflows/release.yml` triggers on tag
push, checks out that commit, and runs `npm publish --provenance --access public` authenticated via
GitHub Actions OIDC ("trusted publishing") — there is no long-lived npm token anywhere in this repo
once the [first-release bootstrap](#first-release-bootstrap-read-this-before-v010) is done.
`prepublishOnly` (`pnpm build && pnpm typecheck && pnpm test`) runs automatically as part of
`npm publish` and gates the publish — if it fails, nothing reaches the registry. Every published
version therefore ships with an npm **provenance attestation** proving it was built by this exact
GitHub Actions workflow from this exact commit, and — because trusted publishing is configured — no
npm token secret ever needs to exist in this repo's Actions secrets after the bootstrap step.

## Order of operations: `inject-nockta-skills` must go first

**`create-nockta-repo` spawns `npx inject-nockta-skills@latest install ...` as a child process at
runtime** (never a package dependency — see the "Relationship to inject-nockta-skills" section of
`README.md`). That means:

- `inject-nockta-skills` must already have a real published version on the npm registry before
  this package's own release is meaningful — otherwise every real `create` run's skill-injection
  step spawns `npx` against a name npm has never heard of and fails.
- Publish `inject-nockta-skills` first (see its own `RELEASING.md`), *then* come back and release
  this package.
- This only affects the *runtime* dependency — `create-nockta-repo`'s own CI/build/test don't need
  `inject-nockta-skills` published (fixtures fake it out; see `fixtures/inject/`), but a real
  post-publish smoke test of `create` does.

## Release steps (after the first release is bootstrapped)

1. **Version bump.** From a clean `main`:
   ```bash
   npm version patch   # or: minor | major
   ```
   This edits `package.json`'s `version`, commits it (`vX.Y.Z`), and creates the matching
   annotated tag in one step — that's why there's no separate "bump commit" instruction here.
2. **Push the commit and the tag:**
   ```bash
   git push origin main
   git push origin vX.Y.Z
   ```
   (`npm version` does not push by itself.) The tag push is what triggers `release.yml`.
3. **Watch the run:**
   ```bash
   gh run watch --repo Nockta/create-nockta-repo
   ```
   or check the Actions tab. If `prepublishOnly` (build/typecheck/test) fails, the job stops before
   `npm publish` runs — see [Troubleshooting](#troubleshooting).
4. **Verify provenance on npmjs.com:** open
   `https://www.npmjs.com/package/create-nockta-repo/v/X.Y.Z` and confirm the **"Provenance"**
   badge / "Published via GitHub Actions" panel is present, linking back to this repo and the
   triggering workflow run. Also:
   ```bash
   npm view create-nockta-repo@X.Y.Z dist.attestations
   ```
5. **Post-publish smoke test.** A *minimal* smoke test that only needs this package published:
   ```bash
   npx create-nockta-repo@latest --version
   ```
   confirms the registry serves the new version with no local cache involved. The **full** smoke
   test — actually scaffolding a project, which exercises the spawn-`inject-nockta-skills` handoff —
   additionally requires `inject-nockta-skills` to already be published (see
   [Order of operations](#order-of-operations-inject-nockta-skills-must-go-first) above):
   ```bash
   npx create-nockta-repo@latest my-smoke-app --type vite-react-ts --yes
   # then inspect my-smoke-app/.nockta/repo-profile.json for "skillsInjected": true
   ```

## First-release bootstrap (read this before v0.1.0)

**npm does not support configuring a Trusted Publisher for a package name that has never been
published.** The Trusted Publisher UI lives at the package's own Settings page on npmjs.com, and
that page — and the package record itself — only exists after at least one version has been
published under the name. There is no "pending publisher" / pre-registration mechanism for
brand-new names (verified against npm's official trusted-publishing docs, mid-2026 — see
[Research verdict](#research-verdict-for-the-record) below). Concretely: `release.yml`'s
OIDC-authenticated `npm publish` will 404/403 on a name npm has never seen, because there is nothing
yet to attach the trusted-publisher configuration to.

So the very first version (`v0.1.0`) has to reach the registry by some other authenticated path,
after which every subsequent release is the pure tokenless flow above. Two ways to do that; **we
recommend the local-publish path**:

### Recommended: local `npm publish` for v0.1.0 only (no provenance on that one version)

1. On a clean checkout, at the tagged commit:
   ```bash
   pnpm install --frozen-lockfile
   pnpm build && pnpm typecheck && pnpm test
   npm publish --access public
   ```
   (No `--provenance` — provenance from a local machine isn't meaningful/supported the way CI
   provenance is; this bootstrap publish just claims the name. Requires the owner's own
   authenticated npm login + 2FA/OTP. Also confirm `package.json`'s `"private"` field, if any, is
   removed before this — a `private: true` package.json will refuse to publish at all.)
2. Immediately after, go to `npmjs.com` → the package → **Settings → Trusted Publisher** and
   configure it (see table in `release.yml`'s header comment: provider GitHub Actions, repo
   `Nockta/create-nockta-repo`, workflow `release.yml`, environment blank).
3. All releases from `v0.1.1` onward go through the normal tag-push flow above and get full CI
   provenance.

Why we recommend this over the token route: it never puts an npm token in this repo's GitHub Actions
secrets, even temporarily — nothing to create, store, or remember to delete. A local publish needs
only the owner's already-authenticated npm session and normal 2FA, which is the same trust level a
maintainer already has.

### Alternative: bootstrap via a short-lived scoped token in CI

If you'd rather do the very first publish through CI too (e.g. to exercise `release.yml` end to
end before switching to OIDC):

1. On npmjs.com, create a **granular access token** scoped to *only* `create-nockta-repo`,
   read+write, shortest available expiry (7 days is plenty).
2. Add it as a GitHub Actions repo secret (e.g. `NPM_TOKEN_BOOTSTRAP`).
3. Run a one-off manual variant of the publish job (e.g. a `workflow_dispatch`-triggered copy of
   `release.yml` that sets `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN_BOOTSTRAP }}` instead of relying
   on OIDC) to publish `v0.1.0`.
4. **Delete the secret from the repo immediately** after the publish succeeds, and revoke/delete
   the token on npmjs.com too — don't wait for it to expire on its own.
5. Configure the Trusted Publisher as in step 2 above, then delete the one-off workflow variant so
   `release.yml` is the only publish path going forward.

This works but leaves more to clean up correctly (a secret to remember to delete, a scoped token to
revoke, a throwaway workflow file) for no benefit over the local path — use it only if there's a
concrete reason the very first publish must originate from CI.

### Research verdict (for the record)

Checked mid-2026 against npm's official docs (`docs.npmjs.com/trusted-publishers`, via the
`npm/documentation` GitHub source) and corroborating community write-ups: the Trusted Publisher
configuration step happens on **"your package settings on npmjs.com"**, reached via
`npmjs.com → Packages → YOUR_PACKAGE → Settings → Trusted publishing` — a page that requires the
package to already exist. No "reserve a name" or "pending publisher for first publish" mechanism is
documented anywhere in the current docs, and independent guides explicitly confirm it ("to configure
[trusted publishing] you need to publish the package in the first place"). This governs the flow
above: **bootstrap once, then tokenless forever after.**

## Troubleshooting

- **"Unable to authenticate" / OIDC failures at publish time.** Trusted publishing requires npm CLI
  ≥ 11.5.1; `actions/setup-node` with `node-version: 20` installs Node 20's bundled npm (10.x), which
  is why `release.yml` has an explicit `npm install -g npm@latest` step before `npm publish`. If that
  step is ever removed or fails, publish will fail with an auth error even though OIDC permissions
  (`id-token: write`) are correctly set.
- **Provenance / repository-URL mismatch.** If npm publishes but provenance is missing or the
  provenance panel points at the wrong repo, check `package.json`'s `repository.url` — it must
  exactly match this GitHub repo (`git+https://github.com/Nockta/create-nockta-repo.git`,
  matching casing). A forked or renamed repo whose `package.json` wasn't updated is the usual cause.
- **`prepublishOnly` fails.** Nothing gets published — `npm publish` aborts before touching the
  registry if `pnpm build`, `pnpm typecheck`, or `pnpm test` fails. Re-run `pnpm build && pnpm
  typecheck && pnpm test` locally to reproduce and fix, then re-tag (a failed run does not consume
  the version — delete the bad tag with `git tag -d vX.Y.Z && git push --delete origin vX.Y.Z` if it
  was already pushed, fix, and re-tag once `main` is green).
- **Workflow filename mismatch.** The Trusted Publisher config's "Workflow filename" field must be
  exactly `release.yml` (no path, case-sensitive) — a typo here causes a publish-time auth failure
  that looks identical to a missing configuration.
- **`create` smoke test's skill-injection step fails post-publish.** If `npx create-nockta-repo@latest
  ... --yes` scaffolds fine but skill injection fails, check that `inject-nockta-skills` was actually
  published first (see [Order of operations](#order-of-operations-inject-nockta-skills-must-go-first)
  above) — this is the single most likely cause, not a bug in this package's spawn logic.

## Who does what

**Owner-only (npm account, one-time or judgment calls):**
- The [first-release bootstrap](#first-release-bootstrap-read-this-before-v010) publish itself
  (needs the owner's authenticated npm login + 2FA).
- Configuring the Trusted Publisher on npmjs.com (needs npm account access to the package).
- Deciding *when* to cut a release and what kind (patch/minor/major), and confirming
  `inject-nockta-skills` is already published before this package's first release.

**Automatable via Fable (the owner can just ask):**
- Version bump + tag (`npm version ...`), pushing `main` and the tag, watching the Actions run, and
  running the post-publish smoke test are all ordinary git/gh/npm commands with no special
  privilege beyond normal repo write access — hand these to Fable once the bootstrap above is done.
