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
import { normalizeZulipBaseUrl } from "./zulip/client.js";
import { isZulipConfigured, zulipSetupAdapter } from "./setup-core.js";

const channel = "zulip" as const;
export { zulipSetupAdapter } from "./setup-core.js";

export const ZULIP_SETUP_HELP_LINES = [
  "1) In Zulip: Settings -> Bots -> Add a new bot",
  "2) Bot type: 'Generic bot' is recommended",
  "3) Copy the bot's Email and API Key from 'Active bots'",
  "4) Site URL: the base URL (e.g., https://chat.example.com)",
  "",
  "Important: Enable streaming mode so the bot can receive messages.",
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
  textInputs: [
    {
      inputKey: "apiKey",
      message: "Enter Zulip API key",
      confirmCurrentValue: false,
      currentValue: ({ cfg, accountId }) =>
        resolveZulipAccount({ cfg, accountId: resolveSetupAccountId(cfg, accountId) }).apiKey ??
        (resolveSetupAccountId(cfg, accountId) === DEFAULT_ACCOUNT_ID
          ? process.env.ZULIP_API_KEY?.trim()
          : undefined),
      initialValue: ({ cfg, accountId }) =>
        resolveZulipAccount({ cfg, accountId: resolveSetupAccountId(cfg, accountId) }).apiKey ??
        (resolveSetupAccountId(cfg, accountId) === DEFAULT_ACCOUNT_ID
          ? process.env.ZULIP_API_KEY?.trim()
          : undefined),
      validate: ({ value }) => (value?.trim() ? undefined : "Zulip API key is required."),
      normalizeValue: ({ value }) => value.trim(),
    },
    {
      inputKey: "email",
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
      message: "Enter Zulip site URL",
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
      validate: ({ value }) => {
        const trimmed = value?.trim();
        if (!trimmed) {
          return "Zulip site URL is required.";
        }
        return normalizeZulipBaseUrl(trimmed)
          ? undefined
          : "Enter a valid URL including protocol, for example: https://chat.example.com";
      },
      normalizeValue: ({ value }) => normalizeZulipBaseUrl(value) ?? value.trim(),
    },
  ],
  selects: [
    {
      inputKey: "dmPolicy",
      message: "Who can DM the bot?",
      options: [
        { value: "pairing", label: "Pairing (users must be approved via command)" },
        { value: "open", label: "Open (anyone can DM)" },
        { value: "allowlist", label: "Allowlist (only specific users)" },
        { value: "disabled", label: "Disabled (no DMs)" },
      ],
      initialValue: ({ cfg, accountId }) => {
        const resolved = resolveZulipAccount({ cfg, accountId: resolveSetupAccountId(cfg, accountId) });
        return resolved.config.dmPolicy ?? "pairing";
      },
      currentValue: ({ cfg, accountId }) => {
        const resolved = resolveZulipAccount({ cfg, accountId: resolveSetupAccountId(cfg, accountId) });
        return resolved.config.dmPolicy ?? "pairing";
      },
    },
    {
      inputKey: "streaming",
      message: "Enable message receiving?",
      options: [
        { value: "true", label: "Yes (recommended - bot receives DMs and stream mentions)" },
        { value: "false", label: "No (bot can only send, not receive)" },
      ],
      initialValue: ({ cfg, accountId }) => {
        const resolved = resolveZulipAccount({ cfg, accountId: resolveSetupAccountId(cfg, accountId) });
        return String(resolved.config.streaming ?? true);
      },
      currentValue: ({ cfg, accountId }) => {
        const resolved = resolveZulipAccount({ cfg, accountId: resolveSetupAccountId(cfg, accountId) });
        return String(resolved.config.streaming ?? true);
      },
      hint: "Requires streaming mode for the bot to receive messages. Disable only to troubleshoot issues.",
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
