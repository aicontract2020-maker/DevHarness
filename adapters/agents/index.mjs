import { createCodexAdapter } from "./codex/index.mjs";

export function registerBuiltinAgentAdapters(registry, options = {}) {
  registry.register("codex", createCodexAdapter(options.codex));
  return registry;
}

export { createCodexAdapter };
