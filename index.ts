import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { zulipPlugin } from "./src/channel.js";
import { setZulipRuntime } from "./src/runtime.js";
import { registerToolCallTraceHooks } from "./src/zulip/tool-trace.js";
import { registerZulipProgressTool } from "./src/zulip/progress-tool.js";
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

    // Mode A (#302): `after_tool_call` checkpoints for the activity trace.
    // Idempotent and feature-detected — the host calls registerFull twice and
    // also in tool-discovery mode, and older/other runtimes may not expose the
    // hook surface at all. Failure degrades to the #301 run-boundary trace.
    registerToolCallTraceHooks(api, {
      log: {
        info: (message, meta) => logger.info?.(message, meta),
        warn: (message, meta) => logger.warn?.(message, meta),
      },
    });

    // Mode B (#303): the agent-facing `zulip_progress` narration tool. The
    // message tool's action vocabulary is closed and core-owned, so a
    // plugin-owned verb requires `api.registerTool` (declared via
    // `contracts.tools` in openclaw.plugin.json).
    registerZulipProgressTool(api, {
      log: {
        info: (message, meta) => logger.info?.(message, meta),
        warn: (message, meta) => logger.warn?.(message, meta),
      },
    });

    logger.info("[zulip] Plugin registration complete.");
  },
});
