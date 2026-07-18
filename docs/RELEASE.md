# Releasing Gosh

Public installs use a GitHub Pages **update manifest** plus a signed Web Bundle on the matching GitHub Release.

| Piece | URL |
|-------|-----|
| Install / update manifest | `https://esko.github.io/gosh/update.json` |
| Landing page | `https://esko.github.io/gosh/` |
| Signed bundle (per version) | `https://github.com/esko/gosh/releases/download/vX.Y.Z/gosh.swbn` |
| Web Bundle ID | `mqkgfdwpsmx3j3mdhqsojvxti4osvhhmda6hkmqrato64atz4nnaaaic` (from `iwa/webbundle.config.ts`) |

Users paste the update-manifest URL into **Install IWA from Update Manifest** on `chrome://web-app-internals`. See the root [README](../README.md).

## One-time repository setup

### 1. Signing secrets

The release workflow signs with the **same Ed25519 key** that produced the committed `webBundleId`. Add two Actions secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
|--------|--------|
| `WEB_BUNDLE_SIGNING_KEY` | Full PEM body of `iwa/keys/encrypted_key.pem` (including `BEGIN` / `END` lines) |
| `WEB_BUNDLE_SIGNING_PASSPHRASE` | Passphrase used when the PEM was encrypted |

Never commit the private key. Local builds continue to use `iwa/keys/encrypted_key.pem` + `WEB_BUNDLE_SIGNING_PASSPHRASE` from your environment (see [IWA_DEV_SETUP.md](IWA_DEV_SETUP.md)).

### 2. GitHub Pages

1. Settings → Pages → **Build and deployment** → Source: **GitHub Actions**
2. The first successful `Release` workflow creates the `github-pages` environment and publishes `https://esko.github.io/gosh/`

### 3. Permissions

The `Release` workflow needs `contents: write`, `pages: write`, and `id-token: write` (already set in `.github/workflows/release.yml`). Ensure Actions are allowed to create/update release assets.

## Cut a release

1. Land the changes you want on `main` (CI green).
2. Bump the IWA version if you have not already:

   ```bash
   npm run bump-version
   ```

   Commit the version bump (`package.json`, lockfile, both web manifests).
3. Tag and publish a GitHub Release whose tag matches the package version:

   ```bash
   git tag v0.1.168
   git push origin v0.1.168
   gh release create v0.1.168 --generate-notes
   ```

   The tag **must** be `v` + `package.json` version (e.g. `v0.1.168`). The workflow refuses to publish if they differ.
4. Watch the **Release** workflow. It will:
   - run typecheck / test / build
   - sign `dist/gosh.swbn`
   - upload `gosh.swbn` to the release
   - deploy `pages/update.json` and `pages/index.html` to GitHub Pages
5. Install or Force-update from `https://esko.github.io/gosh/update.json`.

### Manual re-deploy

`workflow_dispatch` on the Release workflow rebuilds and redeploys Pages for the current `package.json` version. It does **not** create a GitHub Release or upload assets unless you triggered via `release: published`. Prefer publishing a real release for new versions.

## Local dry-run of the Pages site

```bash
node scripts/build-pages-site.mjs
# → pages/update.json, pages/index.html
```

Optional: `PREVIOUS_UPDATE_JSON_URL=…` merges prior versions into the new manifest (the release workflow uses the live Pages URL).

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Release job fails on “Missing signing secrets” | Add both secrets; PEM must be the encrypted key matching `webBundleId` |
| Install fails / wrong app identity | Signing key must match `iwa/webbundle.config.ts` `webBundleId` |
| Force update does nothing | Manifest `version` inside the new `.swbn` must increase; bump with `npm run bump-version` before tagging |
| Pages 404 | Pages source must be **GitHub Actions**; wait for the deploy job to finish |
| Bundle download 404 | Release asset name must be `gosh.swbn` on tag `vX.Y.Z` |
