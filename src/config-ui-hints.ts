type ZulipChannelConfigUiHint = { label?: string; help?: string };

export const zulipChannelConfigUiHints = {
  "": {
    label: "Zulip",
    help: "Zulip channel provider configuration for bot auth, DM/group access policy, stream monitoring, and reply behavior.",
  },
  apiKey: {
    label: "Zulip API Key",
    help: "Bot API key used to authenticate Zulip API requests for this account. Keep it secret and rotate it if exposed.",
  },
  email: {
    label: "Zulip Bot Email",
    help: "Bot email address shown under Active bots in Zulip.",
  },
  url: {
    label: "Zulip Base URL",
    help: "Base URL for the Zulip server, for example https://chat.example.com.",
  },
  site: {
    label: "Zulip Site URL",
    help: "Alias for the Zulip base URL.",
  },
  realm: {
    label: "Zulip Realm URL",
    help: "Alias for the Zulip base URL / realm.",
  },
  streams: {
    label: "Zulip Streams",
    help: "Optional list of stream names the bot should monitor. Use [\"*\"] or omit depending on your routing design.",
  },
  chatmode: {
    label: "Zulip Chat Mode",
    help: 'Controls when the bot responds in streams: "oncall", "onmessage", or "onchar".',
  },
  oncharPrefixes: {
    label: "Zulip On-Char Prefixes",
    help: "Prefix characters that trigger replies when chatmode is onchar.",
  },
  requireMention: {
    label: "Zulip Require Mention",
    help: "Require an explicit mention before responding in streams/groups.",
  },
  dmPolicy: {
    label: "Zulip DM Policy",
    help: 'Direct message access control ("pairing" or "allowlist" recommended). "open" requires allowFrom to include "*".',
  },
  allowFrom: {
    label: "Zulip DM Allowlist",
    help: "Allowed Zulip users for direct messages when using allowlist/open DM policies.",
  },
  groupAllowFrom: {
    label: "Zulip Group Allowlist",
    help: "Allowed Zulip users for group/stream-triggered interactions when using allowlist-based group policy.",
  },
  groupPolicy: {
    label: "Zulip Group Policy",
    help: 'Controls who can trigger the bot in streams/groups ("allowlist", "open", or "disabled").',
  },
  configWrites: {
    label: "Zulip Config Writes",
    help: "Allow Zulip-originated config changes from supported commands/events.",
  },
  responsePrefix: {
    label: "Zulip Response Prefix",
    help: "Optional prefix added before outbound Zulip responses.",
  },
} satisfies Record<string, ZulipChannelConfigUiHint>;
