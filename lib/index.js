/**
 * OpenAI Codex (ChatGPT Plus/Pro) provider for the DeepSeek Harness.
 *
 * Owns the OAuth **device-code** login flow (headless — no browser, no
 * localhost callback server), persists the token triple
 * `{access, refresh, expires}` to `$DSH_HOME/openai-codex.json`, and
 * publishes only the live access token to the harness credential seam under
 * a configurable ref. The settings profile for `llm-pi-ai` points its
 * `apiKeyEnv` at that ref, so every request resolves the freshest token
 * without a restart.
 *
 * @module @syncended/dsh-codex
 */
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// DSH home resolution (inlined — zero npm dependency)
// ---------------------------------------------------------------------------

/** Expand `~` and `~/` prefixes against the OS home. */
function expandHomePath(path) {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
  return path;
}

/**
 * Resolve the DeepSeek Harness home directory.
 *
 * Precedence, highest first: explicit configured path, `$DSH_HOME`, `~/.dsh`.
 * An empty or whitespace-only `$DSH_HOME` is treated as unset.
 */
function resolveDshHome(configured, env = process.env) {
  const fromEnv = env["DSH_HOME"];
  return resolve(
    expandHomePath(
      configured ?? (fromEnv !== void 0 && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), ".dsh")),
    ),
  );
}

// ---------------------------------------------------------------------------
// Plugin metadata
// ---------------------------------------------------------------------------

export const name = "openai-codex";

/** @type {import("cordis").Plugin.Inject} */
export const inject = ["commands", "credentials"];

// ---------------------------------------------------------------------------
// OAuth constants (mirrors pi-ai's openai-codex OAuth module)
// ---------------------------------------------------------------------------

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_BASE_URL = "https://auth.openai.com";
const TOKEN_URL = `${AUTH_BASE_URL}/oauth/token`;
const DEVICE_USER_CODE_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/usercode`;
const DEVICE_TOKEN_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/token`;
const DEVICE_VERIFICATION_URI = `${AUTH_BASE_URL}/codex/device`;
const DEVICE_REDIRECT_URI = `${AUTH_BASE_URL}/deviceauth/callback`;

const DEFAULTS = {
  clientId: CLIENT_ID,
  credentialRef: "OPENAI_CODEX_TOKEN",
  deviceCodeTimeoutSeconds: 15 * 60,
  refreshWindowMs: 5 * 60 * 1000,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/** Parse the RFC 8628 / OpenAI token response into a stored triple. */
async function readTokenResponse(response, operation) {
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Codex token ${operation} failed (${response.status}): ${text || response.statusText}`,
    );
  }
  const json = await response.json();
  if (
    !json?.access_token ||
    !json.refresh_token ||
    typeof json.expires_in !== "number"
  ) {
    throw new Error(
      `Codex token ${operation} response missing fields: ${JSON.stringify(json)}`,
    );
  }
  return {
    access: json.access_token,
    refresh: json.refresh_token,
    expires: Date.now() + json.expires_in * 1000,
  };
}

// ---------------------------------------------------------------------------
// Device-code flow
// ---------------------------------------------------------------------------

/** POST the device usercode request. */
async function startDeviceAuth(clientId, signal) {
  const response = await fetch(DEVICE_USER_CODE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId }),
    signal,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Codex device code request failed (${response.status}): ${body}`);
  }
  const json = await response.json();
  const intervalSeconds =
    typeof json?.interval === "string" ? Number(json.interval.trim()) : json?.interval;
  if (
    !json?.device_auth_id ||
    !json.user_code ||
    typeof intervalSeconds !== "number" ||
    !Number.isFinite(intervalSeconds) ||
    intervalSeconds < 0
  ) {
    throw new Error(`Invalid Codex device code response: ${JSON.stringify(json)}`);
  }
  return {
    deviceAuthId: json.device_auth_id,
    userCode: json.user_code,
    intervalSeconds,
  };
}

/** Poll the device token endpoint until the user approves, times out, or fails. */
async function pollDeviceAuth(device, timeoutSeconds, signal) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let intervalSeconds = device.intervalSeconds || 5;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("Login cancelled");
    const response = await fetch(DEVICE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_auth_id: device.deviceAuthId,
        user_code: device.userCode,
      }),
      signal,
    });
    if (response.ok) {
      const json = await response.json();
      if (!json?.authorization_code || !json.code_verifier) {
        return {
          status: "failed",
          message: `Invalid Codex device token response: ${JSON.stringify(json)}`,
        };
      }
      return {
        status: "complete",
        value: {
          authorizationCode: json.authorization_code,
          codeVerifier: json.code_verifier,
        },
      };
    }
    const body = await response.text().catch(() => "");
    let errorCode;
    try {
      const parsed = JSON.parse(body);
      const error = parsed?.error;
      errorCode = typeof error === "object" ? error?.code : error;
    } catch {
      /* non-JSON error body */
    }
    if (
      response.status === 403 ||
      response.status === 404 ||
      errorCode === "deviceauth_authorization_pending"
    ) {
      /* still pending — keep polling */
    } else if (errorCode === "slow_down") {
      intervalSeconds += 5;
    } else {
      return {
        status: "failed",
        message: `Codex device auth failed (${response.status}): ${body}`,
      };
    }
    await sleep(intervalSeconds * 1000);
  }
  return {
    status: "failed",
    message: "Codex device code expired before authorization",
  };
}

/** Exchange the device authorization code for the token triple. */
async function exchangeAuthorizationCode(code, verifier, clientId, signal) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: DEVICE_REDIRECT_URI,
    }),
    signal,
  });
  return readTokenResponse(response, "exchange");
}

/** Refresh the access token from a stored refresh token. */
async function refreshAccessToken(refreshToken, clientId) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    }),
  });
  return readTokenResponse(response, "refresh");
}

// ---------------------------------------------------------------------------
// Plugin apply
// ---------------------------------------------------------------------------

/**
 * @param {import("cordis").Context} ctx
 * @param {object} [rawConfig]
 */
function apply(ctx, rawConfig) {
  const config = { ...DEFAULTS, ...(rawConfig ?? {}) };
  const ref = config.credentialRef;
  const credentials = ctx.credentials;
  const tokenFile = resolve(
    config.tokenFile ?? join(resolveDshHome(config.dshHome), "openai-codex.json"),
  );

  // -- token persistence ---------------------------------------------------

  /** Load the persisted triple, or `undefined` when absent. */
  async function loadTokens() {
    try {
      const raw = await readFile(tokenFile, "utf8");
      const parsed = JSON.parse(raw);
      if (
        typeof parsed?.access === "string" &&
        typeof parsed?.refresh === "string" &&
        typeof parsed?.expires === "number"
      ) {
        return parsed;
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        ctx.logger.warn("openai-codex: could not read token file %s", tokenFile);
        ctx.logger.warn(error);
      }
    }
    return undefined;
  }

  /** Persist the triple at 0600. */
  async function saveTokens(tokens) {
    await mkdir(dirname(tokenFile), { recursive: true, mode: 0o700 });
    const payload = JSON.stringify(tokens, null, 2) + "\n";
    await writeFile(tokenFile, payload, { mode: 0o600 });
  }

  /** Clear persisted tokens and the published credential. */
  async function clearTokens() {
    try {
      await rm(tokenFile, { force: true });
    } catch (error) {
      ctx.logger.warn("openai-codex: could not remove token file %s", tokenFile);
      ctx.logger.warn(error);
    }
    await credentials.unset(ref);
  }

  // -- credential seam -----------------------------------------------------

  /** Publish the live access token through the credential seam. */
  async function publish(tokens) {
    await credentials.set(ref, tokens.access);
  }

  /** Ensure a valid token: refresh when possible, otherwise clear. */
  async function ensureFresh(tokens) {
    const now = Date.now();
    if (tokens.expires > now + 30 * 1000) return tokens;
    try {
      const next = await refreshAccessToken(tokens.refresh, config.clientId);
      await saveTokens(next);
      await publish(next);
      ctx.logger.info("openai-codex: access token refreshed");
      return next;
    } catch (error) {
      ctx.logger.warn("openai-codex: refresh failed; clearing stale token");
      ctx.logger.warn(error);
      await clearTokens();
      return undefined;
    }
  }

  // -- refresh timer -------------------------------------------------------

  let refreshTimer = null;

  /** Abort controller for the in-flight device-code login poll, if any. */
  let loginAbort = null;

  /** (Re)schedule the refresh just before expiry. */
  function scheduleRefresh(tokens) {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    if (!tokens) return;
    const delay = Math.max(
      1000,
      tokens.expires - Date.now() - config.refreshWindowMs,
    );
    refreshTimer = setTimeout(async () => {
      refreshTimer = null;
      const loaded = await loadTokens();
      if (!loaded) return;
      const fresh = await ensureFresh(loaded);
      scheduleRefresh(fresh);
    }, delay);
    refreshTimer.unref?.();
  }

  // -- /codex command ------------------------------------------------------

  ctx.commands.register({
    name: "codex",
    description:
      "OpenAI Codex (ChatGPT) login, status, or logout via device code",
    input: { hint: "login | status | logout" },
    handler: async (invocation) => {
      const input = invocation.rawInput.trim().toLowerCase();
      if (input === "login") {
        // Own the poll with a login-scoped controller: invocation.signal is
        // the UI request's signal and dies with the HTTP round, which would
        // kill the background poll before the user approves in the browser.
        if (loginAbort !== null) loginAbort.abort();
        loginAbort = new AbortController();
        const loginSignal = loginAbort.signal;
        try {
          const device = await startDeviceAuth(config.clientId, loginSignal);
          const instructions = [
            "OpenAI Codex login",
            "",
            `1. Open ${DEVICE_VERIFICATION_URI}`,
            `2. Enter code: ${device.userCode}`,
            "",
            "Waiting for approval (run /codex status to check)…",
          ].join("\n");
          // Poll in the background so the slash-command round can return now.
          void (async () => {
            try {
              const poll = await pollDeviceAuth(
                device,
                config.deviceCodeTimeoutSeconds,
                loginSignal,
              );
              if (poll.status !== "complete") {
                ctx.logger.warn("openai-codex: %s", poll.message);
                return;
              }
              const tokens = await exchangeAuthorizationCode(
                poll.value.authorizationCode,
                poll.value.codeVerifier,
                config.clientId,
                loginSignal,
              );
              await saveTokens(tokens);
              await publish(tokens);
              scheduleRefresh(tokens);
              ctx.logger.info(
                "openai-codex: logged in; token expires %s",
                new Date(tokens.expires).toISOString(),
              );
            } catch (error) {
              if (loginSignal.aborted) return;
              ctx.logger.warn("openai-codex: login failed");
              ctx.logger.warn(error);
            } finally {
              if (loginAbort?.signal === loginSignal) loginAbort = null;
            }
          })();
          return { kind: "success", text: instructions };
        } catch (error) {
          return {
            kind: "error",
            text: `Codex login error: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }
      if (input === "status") {
        const tokens = await loadTokens();
        if (!tokens) {
          return {
            kind: "success",
            text: "OpenAI Codex: not logged in. Run /codex login.",
          };
        }
        const valid = tokens.expires > Date.now();
        return {
          kind: "success",
          text: [
            "OpenAI Codex: logged in",
            `Access token: ${valid ? "valid" : "expired (will refresh on next use)"}`,
            `Expires: ${new Date(tokens.expires).toISOString()}`,
          ].join("\n"),
        };
      }
      if (input === "logout") {
        if (loginAbort !== null) loginAbort.abort();
        loginAbort = null;
        await clearTokens();
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = null;
        return { kind: "success", text: "OpenAI Codex: logged out." };
      }
      return {
        kind: "error",
        text: "Usage: /codex login | status | logout",
      };
    },
  });

  // -- lifecycle -----------------------------------------------------------

  ctx.effect(
    function* () {
      yield async () => {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = null;
      };
    },
    "openai-codex lifecycle",
  );

  // Startup: restore a stored session, refreshing if the access token lapsed.
  void (async () => {
    const tokens = await loadTokens();
    if (!tokens) return;
    const fresh = await ensureFresh(tokens);
    if (fresh) {
      await publish(fresh);
      scheduleRefresh(fresh);
    }
  })();
}

// The Cordis loader unwraps an ESM module to its default export before handing
// it to the registry. Attach the dependency metadata to that function as well
// as exporting it above, otherwise `ctx.credentials`/`ctx.commands` access is
// rejected before the plugin can start.
apply.inject = inject;

export default apply;
