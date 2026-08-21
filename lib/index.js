/**
 * OpenAI Codex (ChatGPT Plus/Pro) provider for the DeepSeek Harness.
 *
 * Owns the OAuth **device-code** login flow (no localhost callback server),
 * exposes it through both `/codex` and a loopback-only Web API, persists the
 * token triple `{access, refresh, expires}` to `$DSH_HOME/openai-codex.json`,
 * and publishes only the live access token to the harness credential seam
 * under a configurable ref. The settings profile for `llm-pi-ai` points its
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
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const OPENAI_AUTH_CLAIM = "https://api.openai.com/auth";

/** Same-origin Web API exposed only when the host has a webServer service. */
export const AUTH_API_PATH = "/api/openai-codex/auth";

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

/** Read the account identifier embedded by OpenAI in the access-token JWT. */
export function extractAccountId(accessToken) {
  try {
    const parts = accessToken.split(".");
    if (parts.length !== 3) return undefined;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const accountId = payload?.[OPENAI_AUTH_CLAIM]?.chatgpt_account_id;
    return typeof accountId === "string" && accountId.length > 0 ? accountId : undefined;
  } catch {
    return undefined;
  }
}

function normalizeLimitWindow(value) {
  if (value === null || typeof value !== "object") return undefined;
  const usedPercent = Number(value.used_percent);
  if (!Number.isFinite(usedPercent)) return undefined;
  const resetAt = Number(value.reset_at);
  const windowSeconds = Number(value.limit_window_seconds);
  return {
    usedPercent: Math.max(0, Math.min(100, usedPercent)),
    resetAt: Number.isFinite(resetAt) ? resetAt * 1000 : null,
    windowSeconds: Number.isFinite(windowSeconds) ? windowSeconds : null,
  };
}

/** Reduce the undocumented OpenAI response to a token-free UI contract. */
export function normalizeCodexLimits(value) {
  if (value === null || typeof value !== "object") {
    throw new Error("Invalid Codex limits response");
  }
  const primary = normalizeLimitWindow(value.rate_limit?.primary_window);
  const secondary = normalizeLimitWindow(value.rate_limit?.secondary_window);
  if (primary === undefined && secondary === undefined) {
    throw new Error("Codex limits response contains no usage windows");
  }
  const codeReview = normalizeLimitWindow(value.code_review_rate_limit?.primary_window);
  const additional = Array.isArray(value.additional_rate_limits)
    ? value.additional_rate_limits.flatMap((entry) => {
        const rawName = entry.limit_name ?? entry.metered_feature;
        const name = typeof rawName === "string" && rawName.length > 0 ? rawName : "Additional limit";
        return [
          ["primary", normalizeLimitWindow(entry?.rate_limit?.primary_window)],
          ["secondary", normalizeLimitWindow(entry?.rate_limit?.secondary_window)],
        ].flatMap(([window, normalized]) => normalized === undefined ? [] : [{ name, window, ...normalized }]);
      })
    : [];
  const balance = value.credits?.balance == null ? NaN : Number(value.credits.balance);
  const resetCredits = value.rate_limit_reset_credits?.available_count == null
    ? NaN
    : Number(value.rate_limit_reset_credits.available_count);
  return {
    planType: typeof value.plan_type === "string" ? value.plan_type : null,
    allowed: typeof value.rate_limit?.allowed === "boolean" ? value.rate_limit.allowed : null,
    limitReached: typeof value.rate_limit?.limit_reached === "boolean" ? value.rate_limit.limit_reached : null,
    primary: primary ?? null,
    secondary: secondary ?? null,
    codeReview: codeReview ?? null,
    additional,
    credits: value.credits && typeof value.credits === "object"
      ? {
          hasCredits: value.credits.has_credits === true,
          unlimited: value.credits.unlimited === true,
          balance: Number.isFinite(balance) ? balance : null,
        }
      : null,
    resetCredits: Number.isFinite(resetCredits) ? resetCredits : null,
    fetchedAt: Date.now(),
  };
}

/** Parse the RFC 8628 / OpenAI token response into a stored triple. */
async function readTokenResponse(response, operation) {
  if (!response.ok) {
    throw new Error(
      `Codex token ${operation} failed (${response.status}): ${response.statusText}`,
    );
  }
  const json = await response.json();
  if (
    !json?.access_token ||
    !json.refresh_token ||
    typeof json.expires_in !== "number"
  ) {
    throw new Error(`Codex token ${operation} response missing required fields`);
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
    throw new Error(`Codex device code request failed (${response.status})`);
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
    throw new Error("Invalid Codex device code response");
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
          message: "Invalid Codex device token response",
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
        message: `Codex device auth failed (${response.status})`,
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
// Optional Web API
// ---------------------------------------------------------------------------

function sendJson(res, status, value, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  res.end(JSON.stringify(value));
}

/** Match DSH's privileged-API posture: loopback Host plus same-origin markers. */
function isTrustedWebRequest(req) {
  const host = req.headers.host;
  if (typeof host !== "string") return false;
  let authority;
  try {
    authority = new URL(`http://${host}`);
  } catch {
    return false;
  }
  const hostname = authority.hostname;
  const ipv4 = hostname.split(".");
  const loopback =
    hostname === "localhost" ||
    hostname === "[::1]" ||
    (ipv4.length === 4 &&
      ipv4[0] === "127" &&
      ipv4.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255));
  if (!loopback || req.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  if (typeof origin !== "string") return false;
  try {
    return new URL(origin).host === authority.host;
  } catch {
    return false;
  }
}

/**
 * Build the small same-origin API used by the browser client plugin.
 *
 * Mutations require an application/json content type. That keeps the endpoint
 * outside the browser's cross-origin "simple request" set without adding CORS.
 * Tokens never cross this boundary: only state, expiry, URI, and user code do.
 */
export function createAuthApiHandler({ getStatus, getLimits, login, logout }) {
  return async (req, res) => {
    if (!isTrustedWebRequest(req)) {
      sendJson(res, 403, { error: "Forbidden" });
      return;
    }
    const pathname = new URL(req.url ?? AUTH_API_PATH, "http://localhost").pathname;
    try {
      if (pathname === AUTH_API_PATH && req.method === "GET") {
        sendJson(res, 200, await getStatus());
        return;
      }
      if (pathname === `${AUTH_API_PATH}/limits` && req.method === "GET") {
        sendJson(res, 200, await getLimits());
        return;
      }
      const action =
        pathname === `${AUTH_API_PATH}/login`
          ? login
          : pathname === `${AUTH_API_PATH}/logout`
            ? logout
            : undefined;
      if (action === undefined) {
        sendJson(res, 404, { error: "Not found" });
        return;
      }
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "Method not allowed" }, { Allow: "POST" });
        return;
      }
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? "")) {
        sendJson(res, 415, { error: "Content-Type must be application/json" });
        return;
      }
      sendJson(res, 200, await action());
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
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
  let loginGeneration = 0;
  let loginState = { status: "idle" };

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

  /** Public, token-free state shared by the CLI command and Web UI. */
  async function getAuthStatus() {
    const tokens = await loadTokens();
    return {
      authenticated: tokens !== undefined && tokens.expires > Date.now(),
      expiresAt: tokens?.expires ?? null,
      login: loginState.status === "idle" ? null : { ...loginState },
    };
  }

  async function requestCodexLimits(tokens) {
    const headers = {
      Authorization: `Bearer ${tokens.access}`,
      Accept: "application/json",
      "User-Agent": "dsh-codex",
    };
    const accountId = extractAccountId(tokens.access);
    if (accountId !== undefined) headers["ChatGPT-Account-Id"] = accountId;
    return fetch(CODEX_USAGE_URL, { headers });
  }

  /** Fetch subscription usage without exposing OAuth credentials to the client. */
  async function getCodexLimits() {
    const loaded = await loadTokens();
    if (loaded === undefined) throw new Error("Sign in to OpenAI Codex to view limits");
    let tokens = await ensureFresh(loaded);
    if (tokens === undefined) throw new Error("OpenAI Codex session expired; sign in again");
    let response = await requestCodexLimits(tokens);
    if (response.status === 401 || response.status === 403) {
      tokens = await refreshAccessToken(tokens.refresh, config.clientId);
      await saveTokens(tokens);
      await publish(tokens);
      scheduleRefresh(tokens);
      response = await requestCodexLimits(tokens);
    }
    if (!response.ok) throw new Error(`Could not load Codex limits (${response.status})`);
    return normalizeCodexLimits(await response.json());
  }

  /** Start one device-code login and let its poll continue after this call. */
  async function beginLogin() {
    loginGeneration += 1;
    const generation = loginGeneration;
    if (loginAbort !== null) loginAbort.abort();
    loginAbort = new AbortController();
    const loginSignal = loginAbort.signal;
    loginState = { status: "starting" };

    try {
      const device = await startDeviceAuth(config.clientId, loginSignal);
      if (generation !== loginGeneration) throw new Error("Login cancelled");
      loginState = {
        status: "pending",
        verificationUri: DEVICE_VERIFICATION_URI,
        userCode: device.userCode,
        expiresAt: Date.now() + config.deviceCodeTimeoutSeconds * 1000,
      };

      // Poll in the background so both HTTP and slash-command rounds return now.
      void (async () => {
        try {
          const poll = await pollDeviceAuth(
            device,
            config.deviceCodeTimeoutSeconds,
            loginSignal,
          );
          if (generation !== loginGeneration) return;
          if (poll.status !== "complete") {
            loginState = { status: "failed", message: poll.message };
            ctx.logger.warn("openai-codex: %s", poll.message);
            return;
          }
          const tokens = await exchangeAuthorizationCode(
            poll.value.authorizationCode,
            poll.value.codeVerifier,
            config.clientId,
            loginSignal,
          );
          if (generation !== loginGeneration) return;
          await saveTokens(tokens);
          await publish(tokens);
          scheduleRefresh(tokens);
          loginState = { status: "complete", expiresAt: tokens.expires };
          ctx.logger.info(
            "openai-codex: logged in; token expires %s",
            new Date(tokens.expires).toISOString(),
          );
        } catch (error) {
          if (loginSignal.aborted || generation !== loginGeneration) return;
          const message = error instanceof Error ? error.message : String(error);
          loginState = { status: "failed", message };
          ctx.logger.warn("openai-codex: login failed");
          ctx.logger.warn(error);
        } finally {
          if (loginAbort?.signal === loginSignal) loginAbort = null;
        }
      })();

      return { ...loginState };
    } catch (error) {
      if (generation === loginGeneration) {
        loginAbort = null;
        loginState = {
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
        };
      }
      throw error;
    }
  }

  async function logout() {
    loginGeneration += 1;
    if (loginAbort !== null) loginAbort.abort();
    loginAbort = null;
    loginState = { status: "idle" };
    await clearTokens();
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
    return getAuthStatus();
  }

  // Register Web routes only in Web compositions; CLI/headless profiles keep
  // working because this optional injection never blocks plugin activation.
  ctx.inject(["webServer"], (httpCtx) => {
    httpCtx.effect(
      () =>
        httpCtx.webServer.register({
          kind: "prefix",
          path: AUTH_API_PATH,
          handler: createAuthApiHandler({
            getStatus: getAuthStatus,
            getLimits: getCodexLimits,
            login: async () => {
              await beginLogin();
              return getAuthStatus();
            },
            logout,
          }),
        }),
      "openai-codex: Web login API",
    );
  });

  // -- /codex command ------------------------------------------------------

  ctx.commands.register({
    name: "codex",
    description:
      "OpenAI Codex (ChatGPT) login, status, or logout via device code",
    input: { hint: "login | status | logout" },
    handler: async (invocation) => {
      const input = invocation.rawInput.trim().toLowerCase();
      if (input === "login") {
        try {
          const login = await beginLogin();
          return {
            kind: "success",
            text: [
              "OpenAI Codex login",
              "",
              `1. Open ${login.verificationUri}`,
              `2. Enter code: ${login.userCode}`,
              "",
              "Waiting for approval (run /codex status to check)…",
            ].join("\n"),
          };
        } catch (error) {
          return {
            kind: "error",
            text: `Codex login error: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }
      if (input === "status") {
        const status = await getAuthStatus();
        if (!status.authenticated) {
          const pending = status.login?.status === "pending";
          return {
            kind: "success",
            text: pending
              ? `OpenAI Codex: waiting for approval. Open ${status.login.verificationUri} and enter ${status.login.userCode}.`
              : "OpenAI Codex: not logged in. Run /codex login.",
          };
        }
        return {
          kind: "success",
          text: [
            "OpenAI Codex: logged in",
            "Access token: valid",
            `Expires: ${new Date(status.expiresAt).toISOString()}`,
          ].join("\n"),
        };
      }
      if (input === "logout") {
        await logout();
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
        loginGeneration += 1;
        if (loginAbort !== null) loginAbort.abort();
        loginAbort = null;
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
