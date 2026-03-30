import {
  createStandardChannelSetupStatus,
  formatDocsLink,
  type ChannelSetupWizard,
} from "openclaw/plugin-sdk/setup";
import {
  DEFAULT_ACCOUNT_ID,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/core";
import {
  listZulipAccountIds,
  resolveZulipAccount,
  resolveDefaultZulipAccountId,
} from "./zulip/accounts.js";
import { isZulipConfigured, zulipSetupAdapter } from "./setup-core.js";

const channel = "zulip" as const;
export { zulipSetupAdapter } from "./setup-core.js";

export const ZULIP_SETUP_HELP_LINES = [
  "1) In Zulip: Settings -> Bots -> Add a new bot",
  "2) Bot type: 'Generic bot' is recommended",
  "3) Copy the bot's Email and API Key from 'Active bots'",
  "4) Server URL: the base URL (e.g., https://chat.example.com)",
  "Tip: the bot must be a member of any stream you want it to monitor.",
  `Docs: ${formatDocsLink("/channels/zulip", "channels/zulip")}`,
];

function resolveSetupAccountId(cfg: OpenClawConfig, accountId: string): string {
  return accountId || resolveDefaultZulipAccountId(cfg) || DEFAULT_ACCOUNT_ID;
}

export const zulipSetupWizard: ChannelSetupWizard = {
  channel,
  status: createStandardChannelSetupStatus({
    channelLabel: "Zulip",
    configuredLabel: "configured",
    unconfiguredLabel: "needs api key + email + url",
    configuredHint: "configured",
    unconfiguredHint: "needs setup",
    configuredScore: 2,
    unconfiguredScore: 1,
    resolveConfigured: ({ cfg }) =>
      listZulipAccountIds(cfg).some((accountId) =>
        isZulipConfigured(resolveZulipAccount({ cfg, accountId })),
      ),
  }),
  introNote: {
    title: "Zulip bot setup",
    lines: ZULIP_SETUP_HELP_LINES,
    shouldShow: ({ cfg, accountId }) =>
      !isZulipConfigured(
        resolveZulipAccount({ cfg, accountId: resolveSetupAccountId(cfg, accountId) }),
      ),
  },
  envShortcut: {
    prompt: "ZULIP_API_KEY + ZULIP_EMAIL + ZULIP_URL detected. Use env vars?",
    preferredEnvVar: "ZULIP_API_KEY",
    isAvailable: ({ cfg, accountId }) => {
      const resolvedAccountId = resolveSetupAccountId(cfg, accountId);
      if (resolvedAccountId !== DEFAULT_ACCOUNT_ID) {
        return false;
      }
      const resolved = resolveZulipAccount({ cfg, accountId: resolvedAccountId });
      const hasConfigValues = Boolean(
        resolved.config.apiKey?.trim() ||
          resolved.config.email?.trim() ||
          resolved.config.url?.trim() ||
          resolved.config.site?.trim() ||
          resolved.config.realm?.trim(),
      );
      return Boolean(
        process.env.ZULIP_API_KEY?.trim() &&
          process.env.ZULIP_EMAIL?.trim() &&
          process.env.ZULIP_URL?.trim() &&
          !hasConfigValues,
      );
    },
    apply: ({ cfg }) => cfg,
  },
  credentials: [
    {
      inputKey: "token",
      providerHint: channel,
      credentialLabel: "api key",
      preferredEnvVar: "ZULIP_API_KEY",
      envPrompt: "ZULIP_API_KEY + ZULIP_EMAIL + ZULIP_URL detected. Use env vars?",
      keepPrompt: "Zulip API key already configured. Keep it?",
      inputPrompt: "Enter Zulip API key",
      allowEnv: ({ accountId, cfg }) => resolveSetupAccountId(cfg, accountId) === DEFAULT_ACCOUNT_ID,
      inspect: ({ cfg, accountId }) => {
        const resolved = resolveZulipAccount({
          cfg,
          accountId: resolveSetupAccountId(cfg, accountId),
        });
        return {
          accountConfigured: isZulipConfigured(resolved),
          hasConfiguredValue: Boolean(resolved.config.apiKey?.trim()),
          resolvedValue: resolved.apiKey?.trim() || undefined,
          envValue:
            resolveSetupAccountId(cfg, accountId) === DEFAULT_ACCOUNT_ID
              ? process.env.ZULIP_API_KEY?.trim() || undefined
              : undefined,
        };
      },
    },
  ],
  textInputs: [
    {
      inputKey: "tokenFile",
      message: "Enter Zulip bot email",
      confirmCurrentValue: false,
      currentValue: ({ cfg, accountId }) =>
        resolveZulipAccount({ cfg, accountId: resolveSetupAccountId(cfg, accountId) }).email ??
        (resolveSetupAccountId(cfg, accountId) === DEFAULT_ACCOUNT_ID
          ? process.env.ZULIP_EMAIL?.trim()
          : undefined),
      initialValue: ({ cfg, accountId }) =>
        resolveZulipAccount({ cfg, accountId: resolveSetupAccountId(cfg, accountId) }).email ??
        (resolveSetupAccountId(cfg, accountId) === DEFAULT_ACCOUNT_ID
          ? process.env.ZULIP_EMAIL?.trim()
          : undefined),
      validate: ({ value }) => (value?.trim() ? undefined : "Zulip bot email is required."),
      normalizeValue: ({ value }) => value.trim(),
    },
    {
      inputKey: "httpUrl",
      message: "Enter Zulip base URL",
      confirmCurrentValue: false,
      currentValue: ({ cfg, accountId }) =>
        resolveZulipAccount({ cfg, accountId: resolveSetupAccountId(cfg, accountId) }).baseUrl ??
        (resolveSetupAccountId(cfg, accountId) === DEFAULT_ACCOUNT_ID
          ? process.env.ZULIP_URL?.trim()
          : undefined),
      initialValue: ({ cfg, accountId }) =>
        resolveZulipAccount({ cfg, accountId: resolveSetupAccountId(cfg, accountId) }).baseUrl ??
        (resolveSetupAccountId(cfg, accountId) === DEFAULT_ACCOUNT_ID
          ? process.env.ZULIP_URL?.trim()
          : undefined),
      validate: ({ value }) =>
        value?.trim() ? undefined : "Zulip base URL is required.",
      normalizeValue: ({ value }) => value.trim(),
    },
  ],
  disable: (cfg: OpenClawConfig) => ({
    ...cfg,
    channels: {
      ...cfg.channels,
      zulip: {
        ...cfg.channels?.zulip,
        enabled: false,
      },
    },
  }),
};
