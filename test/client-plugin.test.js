import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadClientPlugin() {
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
  };
  vm.runInNewContext(source, { window, document }, { filename: "lib/client.js" });
  assert.equal(handoff.id, "@syncended/dsh-codex");

  const plugin = handoff.factory((id) => {
    if (id === "react") return {};
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
