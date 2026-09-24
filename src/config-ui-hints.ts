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
  allowInsecureHttp: {
    label: "Allow Insecure HTTP (trusted network only)",
    help: "Allow a plain http:// Zulip server and private/internal addresses. Credentials are sent unencrypted — leave off unless you control the network.",
  },
  sessionArchiveRepair: {
    label: "Session Archive Repair (hard-link workaround)",
    help: "Hosts where hard links are unavailable (Android/Termux) cannot publish deleted-session transcript archives, which wedges every session operation. Unset = automatic (only when the hard-link probe fails); true = always; false = never.",
  },
  blockSecretLeaks: {
    label: "Block Credential Leaks (recommended)",
    help: "Refuse to send a Zulip message containing a credential value from the host config, so an agent cannot paste secrets into chat. Names only where the credential came from, never its value. Default: enabled.",
  },
  activityTrace: {
    label: "Activity trace (progressive status message)",
    help: "Post one dedicated bot-owned status message per work item and edit it in place as the agent works, so the topic shows progress instead of only the final reply. Status detail edits the trace; actionable results stay separate messages. Adds outbound writes (~600ms per Zulip edit). Default: disabled.",
  },
  traceCoalesceMs: {
    label: "Trace coalescing window (ms)",
    help: "Bursty trace updates inside this window collapse into a single message edit. Zulip edits are ~600ms round-trips. Clamped to 0-60000. Default: 400.",
  },
  traceMaxRate: {
    label: "Trace max edits per second",
    help: "Hard ceiling on trace edits per second, in addition to the coalescing window, so no configuration can flood the Zulip API. Clamped to 0.1-50. Default: 2.",
  },
  historyContext: {
    label: "History-aware context",
    help: 'Harvest bounded past stream/topic history into the agent\'s context so it can answer "have we seen this before?" with real evidence. "off" (default), "on-demand" (only when the message looks like such a question), or "always" (every stream message). Each harvest costs one Zulip round-trip and context budget.',
  },
  historyMaxMessages: {
    label: "History max messages",
    help: "Maximum number of earlier messages injected as history context. Clamped to 1-50. Default: 8.",
  },
  historyWindowHours: {
    label: "History window (hours)",
    help: "Only messages newer than this are considered for history context. Clamped to 1-8760. Default: 72.",
  },
  historyMaxChars: {
    label: "History max characters",
    help: "Hard cap on the rendered history block, in characters, so a busy topic cannot blow up the context window. Clamped to 200-20000. Default: 4000.",
  },
  renderRefs: {
    label: "Actionable refs (validated links)",
    help: "Let the agent emit [[zulip_ref: <github url> | <label>]] markers; the plugin validates each ref against the GitHub API and renders it as a clickable link. Unconfirmed refs render as plain text and the reply still sends. Validation is unauthenticated (public refs only, GitHub's 60 req/hour/IP limit) and sends no credentials. Default: disabled.",
  },
  reactionTriggers: {
    label: "Reaction triggers (emoji → instruction)",
    help: 'Map a reaction emoji to an instruction, e.g. {"+1": "Proceed with the proposed step."}. When an authorised user reacts with that emoji on the bot\'s own message in a monitored stream, the instruction is dispatched as a turn for the same stream/topic session, so someone can say "go" from inside the room. A reaction is only a trigger — the reacting user is still subject to the allowlists, policies and rate limit. Absent: disabled.',
  },
  reactionTriggerAnyMessage: {
    label: "Reaction triggers on any message",
    help: "Allow reaction triggers on messages the bot did not author. Default: disabled, because a reaction is an approval of the agent's proposal — reacting to someone else's message should not make the agent act on it.",
  },
  queueMode: {
    label: "Queue mode (per-session)",
    help: '"off" (default): a message arriving mid-run is handed to the host, which steers it into the running turn. "followup": the plugin holds it until the active run for that stream/topic (or DM) finishes, so a second person cannot redirect the first person\'s work. The waiting message is marked with reactions.onQueued (default hourglass). Zulip-only; other channels are unaffected.',
  },
  queueCap: {
    label: "Queue capacity (messages)",
    help: "Max messages waiting behind an active run for one session. Past it a message is dispatched immediately rather than dropped. Clamped 1-500. Default: 20.",
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
  showThinkingPlaceholder: {
    label: "Show thinking placeholder",
    help: "Post a \"Thinking...\" placeholder message while generating a response. Disabled by default because it adds one Zulip API round-trip; typing indicators are shown either way.",
  },
  dmSessionTurnLimit: {
    label: "DM session turn limit",
    help: "Maximum inbound conversation turns in a single Zulip DM session before starting a fresh session. Prevents one long/broken conversation from bloating context for all future replies. 0 disables rotation.",
  },
  enableSessionRecovery: {
    label: "Enable session recovery",
    help: "When enabled, the bot scans recent DMs on startup for messages interrupted by a gateway restart and re-dispatches them. Default: disabled (opt-in).",
  },
  maxMessageLength: {
    label: "Max message length",
    help: "Maximum total length of a single outbound message in characters. Messages exceeding this limit are truncated before delivery. Prevents downstream plugins from failing on excessively long content. Default: 20000. Use 0 to disable.",
  },
} satisfies Record<string, ZulipChannelConfigUiHint>;
