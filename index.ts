import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { zulipPlugin } from "./src/channel.js";
import { setZulipRuntime } from "./src/runtime.js";
import { zulipOnboardingAdapter } from "./src/onboarding.js";

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
    if (api.registerOnboarding) {
      api.registerOnboarding(zulipOnboardingAdapter);
    }
  },
});
