import { emptyPluginConfigSchema, definePluginEntry } from "openclaw/plugin-sdk/core";
import { zulipPlugin } from "./src/channel.js";
import { setZulipRuntime } from "./src/runtime.js";

export { zulipPlugin } from "./src/channel.js";
export { setZulipRuntime } from "./src/runtime.js";

export default definePluginEntry({
  id: "zulip",
  name: "Zulip",
  description: "Zulip channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api) {
    setZulipRuntime(api.runtime);
    api.registerChannel({ plugin: zulipPlugin });
  },
});
