# Releasing

## One-time setup

1. **Register on npm** — https://www.npmjs.com/signup
2. **Create an Automation access token** — https://www.npmjs.com/settings/<user>/tokens (type: **Automation**; no 2FA for CI tokens, or **Granular** with read-write on this package)
3. **Add the token to GitHub Secrets** — repo → Settings → Secrets and variables → Actions → New repository secret:
   - Name: `NPM_REGISTRY_TOKEN`
   - Value: the token from step 2

## Every release

```bash
# bump the version in package.json, commit, tag, push
npm version patch   # or minor, or major, or 0.1.1
git push --follow-tags
```

CI picks up the `v*` tag, runs `npm publish --provenance`, and the package lands on https://www.npmjs.com/package/@syncended/dsh-codex.

After publish, users install with:

```bash
dsh plugin --profile web add @syncended/dsh-codex
```