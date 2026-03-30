import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { applyAccountNameToChannelSection } from "openclaw/plugin-sdk/core";
import { type ChannelSetupAdapter, createPatchedAccountSetupAdapter } from "openclaw/plugin-sdk/setup";
import { createSetupInputPresenceValidator } from "openclaw/plugin-sdk/setup-runtime";
import { resolveZulipAccount, type ResolvedZulipAccount } from "./zulip/accounts.js";
import { normalizeZulipBaseUrl } from "./zulip/client.js";

const channel = "zulip" as const;

export function isZulipConfigured(account: ResolvedZulipAccount): boolean {
  return Boolean(account.apiKey?.trim() && account.email?.trim() && account.baseUrl?.trim());
}

export function resolveZulipAccountWithSecrets(cfg: OpenClawConfig, accountId: string) {
  return resolveZulipAccount({ cfg, accountId });
}

export const zulipSetupAdapter: ChannelSetupAdapter = createPatchedAccountSetupAdapter({
  channelKey: channel,
  validateInput: createSetupInputPresenceValidator({
    defaultAccountOnlyEnvError:
      "ZULIP_API_KEY/ZULIP_EMAIL/ZULIP_URL can only be used for the default account.",
    whenNotUseEnv: [
      {
        someOf: ["token", "botToken"],
        message: "Zulip requires --token (or --bot-token), --token-file for email, and --http-url (or --use-env).",
      },
      {
        someOf: ["tokenFile"],
        message: "Zulip requires --token (or --bot-token), --token-file for email, and --http-url (or --use-env).",
      },
      {
        someOf: ["httpUrl"],
        message: "Zulip requires --token (or --bot-token), --token-file for email, and --http-url (or --use-env).",
      },
    ],
    validate: ({ input }) => {
      const apiKey = input.token ?? input.botToken;
      const email = input.tokenFile;
      const baseUrl = normalizeZulipBaseUrl(input.httpUrl);
      if (!input.useEnv && (!apiKey || !email || !baseUrl)) {
        return "Zulip requires --token (or --bot-token), --token-file for email, and --http-url (or --use-env).";
      }
      if (input.httpUrl && !baseUrl) {
        return "Zulip --http-url must include a valid base URL.";
      }
      return null;
    },
  }),
  buildPatch: (input) => {
    const apiKey = input.token ?? input.botToken;
    const email = input.tokenFile?.trim();
    const baseUrl = normalizeZulipBaseUrl(input.httpUrl);
    return input.useEnv
      ? {}
      : {
          ...(apiKey ? { apiKey } : {}),
          ...(email ? { email } : {}),
          ...(baseUrl ? { url: baseUrl } : {}),
        };
  },
});
