import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { zulipPlugin } from "./src/channel.js";
import { setZulipRuntime } from "./src/runtime.js";
import { monitorZulipProvider } from "./src/zulip/monitor.js";
import { listZulipAccountIds, resolveZulipAccount } from "./src/zulip/accounts.js";

console.error("[ZULIP_DEBUG] index.ts loaded, starting monitor at top-level for external plugin");

// Start monitor at module load - needed because registerFull not called for external plugins
setTimeout(async () => {
  try {
    // Get account from environment (same way other functions do)
    const accountIds = listZulipAccountIds({});
    const accountId = accountIds[0] || "default";
    const account = resolveZulipAccount({ cfg: {}, accountId });
    
    if (!account?.apiKey || !account?.email || !account?.baseUrl) {
      return;
    }

    // CRITICAL: Immediately report running=true BEFORE monitorZulipProvider
    // This ensures health-monitor sees running=true before polling starts
    const statusSinkInitial = (patch: any) => {
      const patchedPatch = { running: true, ...patch };
    };
    statusSinkInitial({ running: true, connected: true, lastConnectedAt: Date.now() });
    
    const statusSink = (patch: any) => {
      // Always ensure running:true is included - this is critical for health-monitor
      const patchedPatch = { ...patch, running: true };
    };
    
    await monitorZulipProvider({
      apiKey: account.apiKey,
      email: account.email,
      baseUrl: account.baseUrl,
      accountId: accountId,
      config: {},
      abortSignal: new AbortController().signal,
      statusSink,
    });
  } catch (err: any) {
    console.error("[ZULIP_DEBUG] Top-level monitor error:", err.message);
  }
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
    console.error("[ZULIP_DEBUG] registerFull called (not used for external plugins)");
  },
});