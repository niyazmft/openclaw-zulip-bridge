import { defineSetupPluginEntry } from "openclaw/plugin-sdk/core";
import { zulipPlugin } from "./src/channel.js";

export default defineSetupPluginEntry(zulipPlugin);
