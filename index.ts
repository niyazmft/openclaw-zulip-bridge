import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { zulipPlugin } from "./src/channel.js";
import { setZulipRuntime } from "./src/runtime.js";
import { monitorZulipProvider } from "./src/zulip/monitor.js";
import { listZulipAccountIds, resolveZulipAccount } from "./src/zulip/accounts.js";

setTimeout(async () => {
  const accountIds = listZulipAccountIds({});
  const accountId = accountIds[0] || "default";
  const account = resolveZulipAccount({ cfg: {}, accountId });

  if (!account?.apiKey || !account?.email || !account?.baseUrl) {
    return;
  }

  const statusSink = (patch: any) => {
    // For external plugins, we log status updates but don't have access
    // to OpenClaw's internal statusSink - the health-monitor relies on
    // the channel's probeAccount responding to determine running state
  };

  await monitorZulipProvider({
    apiKey: account.apiKey,
    email: account.email,
    baseUrl: account.baseUrl,
    accountId,
    config: {},
    abortSignal: new AbortController().signal,
    statusSink,
  });
}, 2000);

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
    setZulipRuntime(api.runtime);
    api.registerChannel({ plugin: zulipPlugin });
  },
});