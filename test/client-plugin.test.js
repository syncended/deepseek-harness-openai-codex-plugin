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
  assert.ok(dictionaries.en["limits.primary"]);
  assert.ok(dictionaries.zh["limits.primary"]);
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
