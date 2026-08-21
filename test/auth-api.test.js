import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTH_API_PATH,
  createAuthApiHandler,
  extractAccountId,
  normalizeCodexLimits,
} from "../lib/index.js";

function responseRecorder() {
  return {
    status: undefined,
    headers: undefined,
    body: undefined,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = JSON.parse(body);
    },
  };
}

async function invoke(
  handler,
  { method = "GET", path = AUTH_API_PATH, contentType, host = "127.0.0.1:3080", origin } = {},
) {
  const res = responseRecorder();
  const headers = { host };
  if (contentType) headers["content-type"] = contentType;
  if (origin) headers.origin = origin;
  await handler({ method, url: path, headers }, res);
  return res;
}

test("GET returns token-free auth status with no-store headers", async () => {
  const status = {
    authenticated: false,
    expiresAt: null,
    login: { status: "pending", userCode: "ABCD-EFGH" },
  };
  const handler = createAuthApiHandler({
    getStatus: async () => status,
    login: async () => assert.fail("login must not run"),
    logout: async () => assert.fail("logout must not run"),
  });

  const res = await invoke(handler);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, status);
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.equal(res.headers["X-Content-Type-Options"], "nosniff");
});

test("POST login executes only for JSON requests", async () => {
  let calls = 0;
  const handler = createAuthApiHandler({
    getStatus: async () => ({}),
    login: async () => {
      calls += 1;
      return { authenticated: false, login: { status: "pending" } };
    },
    logout: async () => ({}),
  });

  const rejected = await invoke(handler, {
    method: "POST",
    path: `${AUTH_API_PATH}/login`,
  });
  assert.equal(rejected.status, 415);
  assert.equal(calls, 0);

  const accepted = await invoke(handler, {
    method: "POST",
    path: `${AUTH_API_PATH}/login`,
    contentType: "application/json; charset=utf-8",
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.login.status, "pending");
  assert.equal(calls, 1);
});

test("API rejects unknown paths and wrong methods", async () => {
  const handler = createAuthApiHandler({
    getStatus: async () => ({}),
    login: async () => ({}),
    logout: async () => ({}),
  });

  const missing = await invoke(handler, { path: `${AUTH_API_PATH}/missing` });
  assert.equal(missing.status, 404);

  const wrongMethod = await invoke(handler, {
    method: "GET",
    path: `${AUTH_API_PATH}/logout`,
  });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.Allow, "POST");
});

test("API rejects non-loopback and cross-origin browser requests", async () => {
  const handler = createAuthApiHandler({
    getStatus: async () => ({}),
    login: async () => ({}),
    logout: async () => ({}),
  });

  const rebound = await invoke(handler, { host: "attacker.example" });
  assert.equal(rebound.status, 403);

  const crossOrigin = await invoke(handler, {
    origin: "http://attacker.example",
  });
  assert.equal(crossOrigin.status, 403);

  const sameOrigin = await invoke(handler, {
    origin: "http://127.0.0.1:3080",
  });
  assert.equal(sameOrigin.status, 200);
});

test("API contains operation failures in a JSON 500 response", async () => {
  const handler = createAuthApiHandler({
    getStatus: async () => {
      throw new Error("status unavailable");
    },
    login: async () => ({}),
    logout: async () => ({}),
  });

  const res = await invoke(handler);
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: "status unavailable" });
});

test("GET limits returns the token-free usage contract", async () => {
  const limits = { planType: "plus", primary: { usedPercent: 12 } };
  const handler = createAuthApiHandler({
    getStatus: async () => ({}),
    getLimits: async () => limits,
    login: async () => ({}),
    logout: async () => ({}),
  });
  const res = await invoke(handler, { path: `${AUTH_API_PATH}/limits` });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, limits);
});

test("normalizes Codex usage and extracts the account id", () => {
  const limits = normalizeCodexLimits({
    plan_type: "pro",
    rate_limit: {
      primary_window: { used_percent: 17.5, reset_at: 1_740_000_000, limit_window_seconds: 18_000 },
      secondary_window: { used_percent: 41, reset_at: 1_740_500_000, limit_window_seconds: 604_800 },
    },
    additional_rate_limits: [{
      limit_name: "GPT-5.3-Codex-Spark",
      rate_limit: {
        primary_window: { used_percent: 7, reset_at: 1_740_010_000, limit_window_seconds: 18_000 },
        secondary_window: { used_percent: 9, reset_at: 1_740_510_000, limit_window_seconds: 604_800 },
      },
    }],
    credits: { has_credits: true, unlimited: false, balance: 12.75 },
  });
  assert.equal(limits.primary.usedPercent, 17.5);
  assert.equal(limits.primary.resetAt, 1_740_000_000_000);
  assert.deepEqual(limits.additional.map(({ name, window, windowSeconds }) => ({ name, window, windowSeconds })), [
    { name: "GPT-5.3-Codex-Spark", window: "primary", windowSeconds: 18_000 },
    { name: "GPT-5.3-Codex-Spark", window: "secondary", windowSeconds: 604_800 },
  ]);
  assert.equal(limits.credits.balance, 12.75);

  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${encode({ alg: "none" })}.${encode({
    "https://api.openai.com/auth": { chatgpt_account_id: "account-123" },
  })}.signature`;
  assert.equal(extractAccountId(token), "account-123");
});
