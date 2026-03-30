import { defineChannelPluginEntry, emptyPluginConfigSchema } from "openclaw/plugin-sdk/core";
import { zulipPlugin } from "./src/channel.js";
import { setZulipRuntime } from "./src/runtime.js";

export { zulipPlugin } from "./src/channel.js";
export { setZulipRuntime } from "./src/runtime.js";

export default defineChannelPluginEntry({
  id: "zulip",
  name: "Zulip",
  description: "Zulip channel plugin",
  configSchema: emptyPluginConfigSchema(),
  plugin: zulipPlugin,
  registerFull(api) {
    setZulipRuntime(api.runtime);
  },
});
