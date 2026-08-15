window.__ModuleLoader__.load({
  id: "@syncended/dsh-codex",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const { Button, StateDot, Tooltip, IconDataOutline16, IconRefreshOutline14 } = require("@deepseek-ai/dsh-client-ui-primitives");

    const API_PATH = "/api/openai-codex/auth";
    const VERIFY_URI = "https://auth.openai.com/codex/device";
    const NS = "settings.openaiCodex";

    const css = `
.dshCodexRoot{width:100%;max-width:620px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:18px}
.dshCodexHeading{display:flex;flex-direction:column;gap:4px}
.dshCodexHeading h2,.dshCodexHeading p,.dshCodexStatus p{margin:0}
.dshCodexHeading h2{font-size:18px;line-height:26px;font-weight:600}
.dshCodexHeading p,.dshCodexHint,.dshCodexExpiry{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.dshCodexCard{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;padding:18px;display:flex;flex-direction:column;gap:16px}
.dshCodexStatus{display:flex;align-items:center;gap:9px;font-size:14px;font-weight:500}
.dshCodexCodeWrap{display:flex;flex-direction:column;gap:8px}
.dshCodexCodeLabel{color:var(--dsw-alias-label-secondary);font-size:13px}
.dshCodexCode{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:12px 14px;font:600 22px/28px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;text-align:center;cursor:pointer}
.dshCodexActions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dshCodexLink{color:var(--dsw-alias-state-business-primary);font-size:13px;text-decoration:none}
.dshCodexLink:hover{text-decoration:underline}
.dshCodexError{color:var(--dsw-alias-state-error-primary);font-size:13px;line-height:20px}
.dshCodexLimits{width:100%;height:49px;margin-top:8px;display:flex;align-items:center}.dshCodexLimits.rail{width:36px;height:36px;margin:0}
.dshCodexLimitsButton{width:100%;height:49px;border:0;border-radius:12px;padding:0 8px 0 6px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;display:flex;align-items:center;gap:8px;font:inherit}.dshCodexLimitsButton:hover,.dshCodexLimitsButton[data-open=true]{background:var(--dsw-alias-interactive-bg-hover)}
.rail .dshCodexLimitsButton{width:36px;height:36px;padding:0;border-radius:50%;justify-content:center}.dshCodexLimitsSummary{margin-left:auto;color:var(--dsw-alias-label-tertiary);font-size:12px}
.dshCodexLimitsPanel{position:fixed;z-index:40;left:12px;bottom:118px;box-sizing:border-box;width:360px;max-width:calc(100vw - 24px);max-height:60vh;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-base);box-shadow:var(--dsw-shadow-lv2);color:var(--dsw-alias-label-primary)}
.dshCodexLimitsHeader{height:44px;padding:0 12px;border-bottom:1px solid var(--dsw-alias-border-l2);display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600}.dshCodexLimitsPlan{margin-left:auto;color:var(--dsw-alias-label-tertiary);font-size:11px;text-transform:uppercase}.dshCodexLimitsRefresh{width:28px;height:28px;border:0;border-radius:50%;background:transparent;color:inherit;cursor:pointer}.dshCodexLimitsRefresh:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshCodexLimitsBody{padding:12px;display:flex;flex-direction:column;gap:14px}.dshCodexLimitsNote,.dshCodexLimitsError{margin:0;font-size:12px;line-height:18px}.dshCodexLimitsNote{color:var(--dsw-alias-label-tertiary)}.dshCodexLimitsError{color:var(--dsw-alias-state-error-primary)}
.dshCodexLimit{display:flex;flex-direction:column;gap:7px}.dshCodexLimitHead{display:flex;justify-content:space-between;font-size:12px}.dshCodexLimitName{color:var(--dsw-alias-label-secondary)}.dshCodexLimitValue{font-weight:600}.dshCodexLimitTrack{height:7px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);overflow:hidden}.dshCodexLimitBar{height:100%;border-radius:inherit;background:var(--dsw-alias-state-business-primary)}.dshCodexLimitReset,.dshCodexLimitsMeta{color:var(--dsw-alias-label-tertiary);font-size:11px}.dshCodexLimitsMeta{border-top:1px solid var(--dsw-alias-border-l2);padding-top:10px;display:flex;gap:10px;flex-wrap:wrap}
`;
    const tagId = "@syncended/dsh-codex/client.css";
    if (document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) === null) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "@syncended/dsh-codex";
      tag.dataset.pluginCss = tagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    const dictionaries = {
      zh: {
        nav: "OpenAI Codex",
        title: "OpenAI Codex",
        description: "使用 ChatGPT Plus 或 Pro 订阅连接 Codex 模型。",
        loading: "正在检查登录状态…",
        connected: "已连接",
        disconnected: "未连接",
        starting: "正在创建登录代码…",
        pending: "等待 OpenAI 授权…",
        failed: "登录失败",
        expires: "访问令牌到期时间：{value}",
        codeLabel: "在 OpenAI 页面输入此代码",
        copy: "复制代码",
        open: "打开 OpenAI 并登录",
        login: "登录",
        logout: "退出登录",
        retry: "重试",
        hint: "登录在 OpenAI 页面完成。密码不会传给 DeepSeek Harness。",
        "limits.trigger": "Codex 限额", "limits.title": "Codex 限额", "limits.loading": "正在加载订阅用量…",
        "limits.primary": "5 小时限额", "limits.secondary": "每周限额", "limits.codeReview": "代码审查限额",
        "limits.left": "剩余 {value}%", "limits.reset": "重置时间：{value}", "limits.refresh": "刷新限额",
        "limits.credits": "余额：{value}", "limits.unlimited": "无限余额", "limits.resets": "可用重置次数：{value}", "limits.updated": "更新于 {value}",
      },
      en: {
        nav: "OpenAI Codex",
        title: "OpenAI Codex",
        description: "Connect Codex models with a ChatGPT Plus or Pro subscription.",
        loading: "Checking login status…",
        connected: "Connected",
        disconnected: "Not connected",
        starting: "Creating a login code…",
        pending: "Waiting for approval at OpenAI…",
        failed: "Login failed",
        expires: "Access token expires: {value}",
        codeLabel: "Enter this code on the OpenAI page",
        copy: "Copy code",
        open: "Open OpenAI and sign in",
        login: "Sign in",
        logout: "Sign out",
        retry: "Retry",
        hint: "Sign-in is completed on OpenAI. Your password is never sent to DeepSeek Harness.",
        "limits.trigger": "Codex limits", "limits.title": "Codex limits", "limits.loading": "Loading subscription usage…",
        "limits.primary": "5-hour limit", "limits.secondary": "Weekly limit", "limits.codeReview": "Code review limit",
        "limits.left": "{value}% left", "limits.reset": "Resets {value}", "limits.refresh": "Refresh limits",
        "limits.credits": "Credits: {value}", "limits.unlimited": "Unlimited credits", "limits.resets": "Resets available: {value}", "limits.updated": "Updated {value}",
      },
    };

    async function request(path = "", method = "GET") {
      const response = await fetch(`${API_PATH}${path}`, {
        method,
        headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
        body: method === "POST" ? "{}" : undefined,
        cache: "no-store",
      });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(value.error || `Request failed (${response.status})`);
      return value;
    }

    function format(t, key, values) {
      let text = t(key);
      for (const [name, value] of Object.entries(values || {})) {
        text = text.replace(`{${name}}`, String(value));
      }
      return text;
    }

    const remaining = (windowValue) => Math.max(0, Math.min(100, 100 - windowValue.usedPercent));

    function LimitRow({ label, value, t }) {
      if (!value) return null;
      const left = Math.round(remaining(value) * 10) / 10;
      return React.createElement(
        "div",
        { className: "dshCodexLimit" },
        React.createElement(
          "div",
          { className: "dshCodexLimitHead" },
          React.createElement("span", { className: "dshCodexLimitName" }, label),
          React.createElement("span", { className: "dshCodexLimitValue" }, format(t, "limits.left", { value: left })),
        ),
        React.createElement(
          "div",
          { className: "dshCodexLimitTrack", role: "progressbar", "aria-valuenow": left, "aria-valuemin": 0, "aria-valuemax": 100 },
          React.createElement("div", { className: "dshCodexLimitBar", style: { width: `${left}%` } }),
        ),
        value.resetAt
          ? React.createElement("span", { className: "dshCodexLimitReset" }, format(t, "limits.reset", { value: new Date(value.resetAt).toLocaleString() }))
          : null,
      );
    }

    function CodexLimits({ wide, t }) {
      const [open, setOpen] = React.useState(false);
      const [state, setState] = React.useState({ status: "idle" });
      const root = React.useRef(null);
      const refresh = React.useCallback(async () => {
        setState({ status: "loading" });
        try {
          setState({ status: "ready", value: await request("/limits") });
        } catch (error) {
          setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
        }
      }, []);
      React.useEffect(() => {
        if (!open) return undefined;
        void refresh();
        const timer = window.setInterval(() => void refresh(), 60000);
        return () => window.clearInterval(timer);
      }, [open, refresh]);
      React.useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = (event) => { if (event.key === "Escape") setOpen(false); };
        const onPointerDown = (event) => {
          if (root.current && !root.current.contains(event.target)) setOpen(false);
        };
        document.addEventListener("keydown", onKeyDown);
        document.addEventListener("pointerdown", onPointerDown);
        return () => {
          document.removeEventListener("keydown", onKeyDown);
          document.removeEventListener("pointerdown", onPointerDown);
        };
      }, [open]);

      const value = state.status === "ready" ? state.value : undefined;
      const baseWindows = value ? [value.primary, value.secondary].filter(Boolean) : [];
      const summary = baseWindows.length ? Math.round(Math.min(...baseWindows.map(remaining))) : undefined;
      const meta = [];
      if (value?.credits?.unlimited) meta.push(t("limits.unlimited"));
      else if (value?.credits?.balance != null) meta.push(format(t, "limits.credits", { value: Math.floor(value.credits.balance * 100) / 100 }));
      if (value?.resetCredits != null) meta.push(format(t, "limits.resets", { value: value.resetCredits }));
      if (value?.fetchedAt) meta.push(format(t, "limits.updated", { value: new Date(value.fetchedAt).toLocaleTimeString() }));

      const button = React.createElement(
        "button",
        { type: "button", className: "dshCodexLimitsButton", "data-open": open, "aria-expanded": open, "aria-label": t("limits.trigger"), onClick: () => setOpen((current) => !current) },
        React.createElement(IconDataOutline16, { size: wide ? 14 : 18 }),
        wide ? React.createElement("span", null, t("limits.trigger")) : null,
        wide && summary != null ? React.createElement("span", { className: "dshCodexLimitsSummary" }, format(t, "limits.left", { value: summary })) : null,
      );

      return React.createElement(
        "div",
        { ref: root, className: wide ? "dshCodexLimits" : "dshCodexLimits rail" },
        open
          ? React.createElement(
              "section",
              { className: "dshCodexLimitsPanel", "aria-label": t("limits.title"), "aria-live": "polite" },
              React.createElement(
                "header",
                { className: "dshCodexLimitsHeader" },
                React.createElement("span", null, t("limits.title")),
                value?.planType ? React.createElement("span", { className: "dshCodexLimitsPlan" }, value.planType) : null,
                React.createElement(
                  Tooltip,
                  { label: t("limits.refresh"), side: "bottom" },
                  React.createElement("button", { type: "button", className: "dshCodexLimitsRefresh", "aria-label": t("limits.refresh"), disabled: state.status === "loading", onClick: () => void refresh() }, React.createElement(IconRefreshOutline14, {})),
                ),
              ),
              React.createElement(
                "div",
                { className: "dshCodexLimitsBody" },
                state.status === "idle" || state.status === "loading" ? React.createElement("p", { className: "dshCodexLimitsNote" }, t("limits.loading")) : null,
                state.status === "error" ? React.createElement("p", { className: "dshCodexLimitsError", role: "alert" }, state.message) : null,
                value ? React.createElement(LimitRow, { label: t("limits.primary"), value: value.primary, t }) : null,
                value ? React.createElement(LimitRow, { label: t("limits.secondary"), value: value.secondary, t }) : null,
                value ? React.createElement(LimitRow, { label: t("limits.codeReview"), value: value.codeReview, t }) : null,
                value?.additional?.map((item, index) => React.createElement(LimitRow, { key: `${item.name}-${index}`, label: item.name, value: item, t })) ?? null,
                meta.length ? React.createElement("div", { className: "dshCodexLimitsMeta" }, meta.map((item) => React.createElement("span", { key: item }, item))) : null,
              ),
            )
          : null,
        wide ? button : React.createElement(Tooltip, { label: t("limits.trigger"), delayMs: 500 }, button),
      );
    }

    function CodexSettings({ t }) {
      const [state, setState] = React.useState({ status: "loading" });
      const [busy, setBusy] = React.useState(false);

      const refresh = React.useCallback(async () => {
        try {
          setState({ status: "ready", value: await request() });
        } catch (error) {
          setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
        }
      }, []);

      React.useEffect(() => {
        void refresh();
      }, [refresh]);

      const phase = state.status === "ready" ? state.value.login?.status : undefined;
      React.useEffect(() => {
        if (phase !== "pending" && phase !== "starting") return undefined;
        const timer = window.setInterval(() => void refresh(), 1500);
        return () => window.clearInterval(timer);
      }, [phase, refresh]);

      const mutate = async (path, openLoginPage) => {
        if (openLoginPage) window.open(VERIFY_URI, "_blank", "noopener,noreferrer");
        setBusy(true);
        try {
          setState({ status: "ready", value: await request(path, "POST") });
        } catch (error) {
          setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
        } finally {
          setBusy(false);
        }
      };

      let statusText = t("loading");
      let dot = "ongoing";
      if (state.status === "error") {
        statusText = t("failed");
        dot = "error";
      } else if (state.status === "ready") {
        if (state.value.authenticated) {
          statusText = t("connected");
          dot = "done";
        } else if (phase === "starting") {
          statusText = t("starting");
          dot = "ongoing";
        } else if (phase === "pending") {
          statusText = t("pending");
          dot = "ongoing";
        } else if (phase === "failed") {
          statusText = t("failed");
          dot = "error";
        } else {
          statusText = t("disconnected");
          dot = "warning";
        }
      }

      const value = state.status === "ready" ? state.value : undefined;
      const login = value?.login;
      const pending = login?.status === "pending";
      const errorMessage = state.status === "error" ? state.message : login?.status === "failed" ? login.message : undefined;

      return React.createElement(
        "section",
        { className: "dshCodexRoot" },
        React.createElement(
          "div",
          { className: "dshCodexHeading" },
          React.createElement("h2", null, t("title")),
          React.createElement("p", null, t("description")),
        ),
        React.createElement(
          "div",
          { className: "dshCodexCard", "aria-busy": state.status === "loading" || busy },
          React.createElement(
            "div",
            { className: "dshCodexStatus" },
            React.createElement(StateDot, { state: dot }),
            React.createElement("p", null, statusText),
          ),
          value?.authenticated && value.expiresAt
            ? React.createElement("p", { className: "dshCodexExpiry" }, format(t, "expires", { value: new Date(value.expiresAt).toLocaleString() }))
            : null,
          pending
            ? React.createElement(
                "div",
                { className: "dshCodexCodeWrap" },
                React.createElement("span", { className: "dshCodexCodeLabel" }, t("codeLabel")),
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "dshCodexCode",
                    title: t("copy"),
                    onClick: () => void navigator.clipboard?.writeText(login.userCode),
                  },
                  login.userCode,
                ),
                React.createElement("a", { className: "dshCodexLink", href: login.verificationUri, target: "_blank", rel: "noreferrer" }, t("open")),
              )
            : null,
          errorMessage ? React.createElement("p", { className: "dshCodexError", role: "alert" }, errorMessage) : null,
          React.createElement(
            "div",
            { className: "dshCodexActions" },
            value?.authenticated
              ? React.createElement(Button, { variant: "outline", disabled: busy, onClick: () => void mutate("/logout", false) }, t("logout"))
              : React.createElement(Button, { variant: "primary", disabled: busy || pending, onClick: () => void mutate("/login", true) }, phase === "failed" ? t("retry") : t("login")),
          ),
          React.createElement("p", { className: "dshCodexHint" }, t("hint")),
        ),
      );
    }

    const inject = ["slots", "locale"];
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, dictionaries), "openai-codex: Web login dictionaries");
      const t = ctx.locale.bind(NS);
      ctx.slots.inject("settings.section", () =>
        ctx.slots.register(
          {
            name: "settings.section",
            id: "openai-codex",
            order: 15,
            label: () => t("nav"),
            locale: NS,
            inject: () => ({ t }),
          },
          CodexSettings,
        ),
      );
      ctx.slots.inject("sidebar.footer.action", () =>
        ctx.slots.register(
          {
            name: "sidebar.footer.action",
            id: "openai-codex-limits",
            order: 10,
            label: () => t("limits.trigger"),
            locale: NS,
            inject: () => ({ t }),
          },
          CodexLimits,
        ),
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
