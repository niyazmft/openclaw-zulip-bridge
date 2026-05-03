import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { zulipPlugin } from "./src/channel.js";

export default defineSetupPluginEntry(zulipPlugin);
