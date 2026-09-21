import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { zulipPlugin } from "./src/channel.js";
import { setZulipRuntime } from "./src/runtime.js";
export { zulipPlugin } from "./src/channel.js";
export { setZulipRuntime } from "./src/runtime.js";

export default defineChannelPluginEntry({
  id: "zulip",
  name: "Zulip",
  description: "Zulip channel plugin",
  plugin: zulipPlugin,
  registerCliMetadata(api) {
    api.registerCli(
      ({ program }) => {
        program.command("zulip").description("Zulip channel management");
      },
      {
        descriptors: [
          {
            name: "zulip",
            description: "Zulip channel management",
            hasSubcommands: false,
          },
        ],
      },
    );
  },
  registerFull(api) {
    const { logger, runtime } = api;
    // NOTE: `api.registerChannel({ plugin })` is already called by the
    // `defineChannelPluginEntry` SDK wrapper before dispatching to registerFull.
    // Calling it here would double-register the channel (see #293 Tier 1 check).
    setZulipRuntime(runtime);
    logger.info("[zulip] Plugin registration complete.");
  },
});
