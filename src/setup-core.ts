import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { applyAccountNameToChannelSection } from "openclaw/plugin-sdk/account-core";
import { type ChannelSetupAdapter, createPatchedAccountSetupAdapter } from "openclaw/plugin-sdk/setup";
import { createSetupInputPresenceValidator } from "openclaw/plugin-sdk/setup-runtime";
import { resolveZulipAccount, type ResolvedZulipAccount } from "./zulip/accounts.js";
import { normalizeZulipBaseUrl, zulipBaseUrlError } from "./zulip/client.js";

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
    validate: ({ input }) => {
      if (input.httpUrl) {
        const problem = zulipBaseUrlError(input.httpUrl);
        if (problem) {
          return problem;
        }
      }
      return null;
    },
  }),
  buildPatch: (input) => {
    const apiKey = input.apiKey ?? input.token ?? input.botToken;
    const email = (input.email ?? input.tokenFile)?.trim();
    const baseUrl = normalizeZulipBaseUrl(input.httpUrl);
    const dmPolicy = input.dmPolicy ?? "pairing";
    const streaming = input.streaming !== "false";
    return {
      enabled: true,
      dmPolicy,
      streaming,
      ...(input.useEnv
        ? {}
        : {
            ...(apiKey ? { apiKey } : {}),
            ...(email ? { email } : {}),
            ...(baseUrl ? { url: baseUrl, site: baseUrl } : {}),
          }),
    };
  },
});
