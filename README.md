# DeepSeek Harness — OpenAI Codex Plugin

Use your **ChatGPT Plus/Pro** subscription as an LLM provider in the
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

This plugin adds **device-code OAuth login** through both the Web settings UI
and `/codex` CLI command — no browser callback server or localhost listener.
After login, Codex models appear alongside your other providers in the DSH
model selector, the access token refreshes automatically without a restart,
and a **Codex limits** popup above Settings shows the 5-hour and weekly balance.

## How it works

1. In the Web app, open **Settings → OpenAI Codex → Sign in**. The page opens
   OpenAI, shows the one-time code, and updates automatically after approval.
   Headless/TUI users can run **`/codex login`** for the same device-code flow.
2. The plugin stores the token triple `{access, refresh, expires}` in
   `$DSH_HOME/openai-codex.json` and publishes only the live `access` token to
   the DSH credential seam under `OPENAI_CODEX_TOKEN`.
3. Your `settings.yaml` maps that credential to the `openai-codex` route, and
   `dsh-llm-pi-ai` uses the built-in `openai-codex-responses` API to serve all
   Codex models.
4. The plugin refreshes the token automatically ~5 minutes before expiry.
5. In Web, **Codex limits** calls OpenAI from the server and returns only
   normalized usage percentages, reset times, and optional credit balances;
   OAuth tokens never cross into the browser.

> The limits view uses OpenAI's undocumented Codex usage endpoint, so its
> response shape may change without notice.

## Install

```bash
# Add the plugin to your profile (web, tui, headless, …)
dsh plugin --profile web add @syncended/dsh-codex

# Restart dsh
```

> **Note:** the profile is a pnpm workspace root, so on some `dsh` versions the
> `add` command needs `-w`: `dsh plugin --profile web add -w @syncended/dsh-codex`.

The plugin registers the `openai-codex` route defaults automatically, so no
`dsh settings set` is needed. In Web, use **Settings → OpenAI Codex**. The
`/codex login | status | logout` commands remain available in every profile.

Like DSH's other credential settings, Web login is restricted to a loopback
Web session. For a remote deployment, run `/codex login` on the host-facing
profile instead.

## Commands

| Command           | Description                        |
| ----------------- | ---------------------------------- |
| `/codex login`    | Start device-code OAuth login      |
| `/codex status`   | Show token status and expiry       |
| `/codex logout`   | Clear the stored token             |

## Configuration

The plugin accepts these optional config values (rarely needed):

| Key                      | Default                  | Description                         |
| ------------------------ | ------------------------ | ----------------------------------- |
| `clientId`               | `app_EMoamEEZ…hrann`     | OpenAI OAuth client id              |
| `credentialRef`          | `OPENAI_CODEX_TOKEN`     | Credential seam ref                 |
| `deviceCodeTimeoutSeconds` | `900` (15 min)         | How long the user has to approve    |
| `refreshWindowMs`        | `300_000` (5 min)        | Refresh this far before expiry      |
| `tokenFile`              | `$DSH_HOME/openai-codex.json` | Override token persistence path |

## Requirements

- **ChatGPT Plus** or **Pro** subscription
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) ≥ 0.1.0-rc.6
- Node.js ≥ 18

## License

MIT — see [LICENSE](./LICENSE).