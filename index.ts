import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { zulipPlugin } from "./src/channel.js";
import { setZulipRuntime } from "./src/runtime.js";
import { monitorZulipProvider } from "./src/zulip/monitor.js";
import { listZulipAccountIds, resolveZulipAccount } from "./src/zulip/accounts.js";
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
    const { logger, runtime, config: cfg } = api;

    api.registerChannel({ plugin: zulipPlugin });
    setZulipRuntime(runtime);

    const accountIds = listZulipAccountIds(cfg);

    if (accountIds.length === 0) {
      logger.warn("[zulip] No accounts detected.");
      return;
    }

    logger.info(`[zulip] Initializing ${accountIds.length} account(s): ${accountIds.join(", ")}`);

    for (const accountId of accountIds) {
      const account = resolveZulipAccount({ cfg, accountId });
      const isConfigured = account?.apiKey && account?.email && account?.baseUrl;

      if (isConfigured && account.enabled) {
        logger.info(`[zulip] [${accountId}] Starting monitor for ${account.email}`);

        const controller = new AbortController();
        monitorZulipProvider({
          apiKey: account.apiKey,
          email: account.email,
          baseUrl: account.baseUrl,
          accountId,
          config: cfg,
          abortSignal: controller.signal,
          statusSink: (patch) => {
            // For external plugins, we log status updates but don't have access
            // to OpenClaw's internal statusSink - the health-monitor relies on
            // the channel's probeAccount responding to determine running state
          },
        }).catch((err) => {
          logger.error(`[zulip] [${accountId}] Fatal:`, err);
        });
      } else {
        logger.warn(`[zulip] [${accountId}] Missing credentials. Check apiKey, email, and baseUrl.`);
      }
    }
    logger.info("[zulip] Plugin registration complete.");
  },
});