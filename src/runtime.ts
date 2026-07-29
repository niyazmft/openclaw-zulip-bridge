import type { PluginRuntime } from "openclaw/plugin-sdk/channel-core";

const RUNTIME_KEY = "__openclaw_zulip_runtime__";

export function setZulipRuntime(next: PluginRuntime) {
  (globalThis as any)[RUNTIME_KEY] = next;
}

export function getZulipRuntime(): PluginRuntime {
  const runtime = (globalThis as any)[RUNTIME_KEY];
  if (!runtime) {
    throw new Error("Zulip runtime not initialized");
  }
  return runtime;
}
