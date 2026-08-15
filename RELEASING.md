# Releasing

## One-time setup

1. **Register on npm** — https://www.npmjs.com/signup
2. **Create a Granular Access Token that bypasses 2FA** — https://www.npmjs.com/settings/<user>/tokens → Generate New Token → **Granular Access Token**:
   - Permissions: **Packages and scopes** → **Read and write**, scope `@<user>` (or this package)
   - **Two-factor authentication: Bypass two-factor authentication** ← required for CI, since the account has 2FA enabled and CI cannot enter an OTP
   - (A classic **Automation** token also works, but granular + bypass is the current recommended setup.)
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