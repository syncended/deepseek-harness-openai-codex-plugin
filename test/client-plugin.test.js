import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadClientPlugin({ react = {}, fetch, window: windowOverrides = {} } = {}) {
  const source = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");
  let handoff;
  const document = {
    head: { appendChild() {} },
    querySelector() {
      return null;
    },
    createElement() {
      return { dataset: {}, textContent: "" };
    },
  };
  const window = {
    __ModuleLoader__: {
      load(value) {
        handoff = value;
      },
    },
    ...windowOverrides,
  };
  vm.runInNewContext(source, { window, document, fetch }, { filename: "lib/client.js" });
  assert.equal(handoff.id, "@syncended/dsh-codex");

  const plugin = handoff.factory((id) => {
    if (id === "react") return react;
    if (id === "@deepseek-ai/dsh-client-ui-primitives") {
      return { Button() {}, StateDot() {} };
    }
    throw new Error(`Unexpected browser dependency: ${id}`);
  });
  return plugin;
}

test("client plugin registers settings and a Codex limits footer action", async () => {
  const plugin = await loadClientPlugin();
  assert.deepEqual(Array.from(plugin.inject), ["slots", "locale"]);

  let dictionaries;
  const registrations = new Map();
  const injected = [];
  const t = (key) => (key === "nav" ? "OpenAI Codex" : key);
  const ctx = {
    effect(factory) {
      return factory();
    },
    locale: {
      register(namespace, value) {
        assert.equal(namespace, "settings.openaiCodex");
        dictionaries = value;
        return () => {};
      },
      bind(namespace) {
        assert.equal(namespace, "settings.openaiCodex");
        return t;
      },
    },
    slots: {
      inject(name, factory) {
        injected.push(name);
        factory();
      },
      register(options, component) {
        registrations.set(options.id, { options, component });
        return () => {};
      },
    },
  };

  plugin.apply(ctx);
  assert.equal(dictionaries.en["limits.primary"], "5-hour limit");
  assert.equal(dictionaries.en["limits.secondary"], "7-day limit");
  assert.equal(dictionaries.zh["limits.primary"], "5 小时限额");
  assert.equal(dictionaries.zh["limits.secondary"], "7 天限额");
  assert.deepEqual(injected, ["settings.section", "sidebar.footer.action"]);
  assert.equal(registrations.get("openai-codex").options.label(), "OpenAI Codex");
  assert.equal(typeof registrations.get("openai-codex").component, "function");
  assert.equal(registrations.get("openai-codex-limits").options.name, "sidebar.footer.action");
  assert.equal(typeof registrations.get("openai-codex-limits").component, "function");
});

test("Codex limits load on mount without opening the popup", async () => {
  const effects = [];
  const requests = [];
  const intervals = [];
  const react = {
    createElement(type, props, ...children) {
      return { type, props, children };
    },
    useCallback(callback) {
      return callback;
    },
    useEffect(effect) {
      effects.push(effect);
    },
    useRef(value) {
      return { current: value };
    },
    useState(value) {
      return [value, () => {}];
    },
  };
  const plugin = await loadClientPlugin({
    react,
    fetch: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        async json() {
          return { primary: { usedPercent: 25 } };
        },
      };
    },
    window: {
      setInterval(callback, delay) {
        intervals.push({ callback, delay });
        return 7;
      },
      clearInterval() {},
    },
  });

  let component;
  const t = (key) => key;
  plugin.apply({
    effect(factory) {
      return factory();
    },
    locale: {
      register() {
        return () => {};
      },
      bind() {
        return t;
      },
    },
    slots: {
      inject(name, factory) {
        if (name === "sidebar.footer.action") factory();
      },
      register(options, value) {
        if (options.id === "openai-codex-limits") component = value;
        return () => {};
      },
    },
  });

  component({ wide: true, t });
  assert.equal(requests.length, 0);
  const cleanup = effects[0]();
  await Promise.resolve();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/openai-codex/auth/limits");
  assert.equal(requests[0].options.cache, "no-store");
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].delay, 60000);
  cleanup();
});

test("Codex limits keep primary windows above model-specific limits", async () => {
  let stateCall = 0;
  const react = {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children };
    },
    useCallback(callback) {
      return callback;
    },
    useEffect() {},
    useRef(value) {
      return { current: value };
    },
    useState(initial) {
      stateCall += 1;
      if (stateCall === 1) return [true, () => {}];
      if (stateCall === 2) {
        return [{
          status: "ready",
          value: {
            primary: { usedPercent: 10, windowSeconds: 604_800 },
            secondary: null,
            additional: [
              { name: "GPT-5.3-Codex-Spark", window: "primary", usedPercent: 20, windowSeconds: 18_000 },
              { name: "GPT-5.3-Codex-Spark", window: "secondary", usedPercent: 30, windowSeconds: 604_800 },
            ],
          },
        }, () => {}];
      }
      return [initial, () => {}];
    },
  };
  const plugin = await loadClientPlugin({ react, fetch: async () => ({ ok: true, json: async () => ({}) }) });
  const translations = {
    "limits.primary": "5-hour limit",
    "limits.secondary": "7-day limit",
    "limits.named": "{name} · {window}",
    "limits.modelSpecific": "Model-specific limits",
  };
  const t = (key) => translations[key] ?? key;
  let component;
  plugin.apply({
    effect(factory) {
      return factory();
    },
    locale: {
      register() {
        return () => {};
      },
      bind() {
        return t;
      },
    },
    slots: {
      inject(name, factory) {
        if (name === "sidebar.footer.action") factory();
      },
      register(options, value) {
        if (options.id === "openai-codex-limits") component = value;
        return () => {};
      },
    },
  });

  const tree = component({ wide: true, t });
  const labels = [];
  const sectionTitles = [];
  const visit = (node) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    if (node.type?.name === "LimitRow" && node.props.value) labels.push(node.props.label);
    if (node.props.className === "dshCodexLimitsSectionTitle") sectionTitles.push(node.children[0]);
    visit(node.children);
  };
  visit(tree);
  assert.deepEqual(labels, [
    "7-day limit",
    "GPT-5.3-Codex-Spark · 5-hour limit",
    "GPT-5.3-Codex-Spark · 7-day limit",
  ]);
  assert.deepEqual(sectionTitles, ["Model-specific limits"]);
});
