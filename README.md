# DeepSeek Harness — OpenAI Codex Plugin

Use your **ChatGPT Plus/Pro** subscription as an LLM provider in the
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

This plugin adds headless **device-code OAuth login** — no browser callback
server, no localhost listener.  After `/codex login`, Codex models appear
alongside your other providers in the DSH model selector, and the access token
refreshes automatically without a restart.

## How it works

1. **`/codex login`** — starts the device-code flow.  You get a URL and a
   one-time code; open the URL in any browser, enter the code, and approve.
2. The plugin stores the token triple `{access, refresh, expires}` in
   `$DSH_HOME/openai-codex.json` and publishes only the live `access` token to
   the DSH credential seam under `OPENAI_CODEX_TOKEN`.
3. Your `settings.yaml` maps that credential to the `openai-codex` route, and
   `dsh-llm-pi-ai` uses the built-in `openai-codex-responses` API to serve all
   Codex models.
4. The plugin refreshes the token automatically ~5 minutes before expiry.

## Install

```bash
# Add the plugin to your profile (web, tui, headless, …)
dsh plugin --profile web add @syncended/dsh-codex

# Restart dsh
```

The plugin registers the `openai-codex` route defaults automatically, so no
`dsh settings set` is needed. Then run **`/codex login`** in the DSH chat input
and follow the instructions.

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