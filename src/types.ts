import type { BlockStreamingCoalesceConfig, DmPolicy, GroupPolicy } from "openclaw/plugin-sdk/channel-config-schema";

export type ZulipChatMode = "oncall" | "onmessage" | "onchar";

export type ZulipAccountConfig = {
  /** Optional display name for this account (used in CLI/UI lists). */
  name?: string;
  /** Optional provider capability tags used for agent/runtime guidance. */
  capabilities?: string[];
  /** Allow channel-initiated config writes (default: true). */
  configWrites?: boolean;
  /** Require explicit opt-in for admin-only actions (default: false). */
  enableAdminActions?: boolean;
  /** If false, do not start this Zulip account. Default: true. */
  enabled?: boolean;
  /** Base URL for the Zulip server (e.g., https://chat.example.com). */
  url?: string;
  /** Alias for base URL (site). */
  site?: string;
  /** Alias for base URL (realm). */
  realm?: string;
  /** Zulip bot email address. */
  email?: string;
  /** Zulip API key for the bot. */
  apiKey?: string;
  /** Restrict monitored streams ("*" = all streams). */
  streams?: string[];
  /**
   * Controls when channel messages trigger replies.
   * - "oncall": only respond when mentioned
   * - "onmessage": respond to every channel message
   * - "onchar": respond when a trigger character prefixes the message
   */
  chatmode?: ZulipChatMode;
  /** Prefix characters that trigger onchar mode (default: [">", "!"]). */
  oncharPrefixes?: string[];
  /** Require @mention to respond in channels. Default: true. */
  requireMention?: boolean;
  /** Direct message policy (pairing/allowlist/open/disabled). */
  dmPolicy?: DmPolicy;
  /** Allowlist for direct messages (user ids or @usernames). */
  allowFrom?: Array<string | number>;
  /** Allowlist for group messages (user ids or @usernames). */
  groupAllowFrom?: Array<string | number>;
  /** Group message policy (allowlist/open/disabled). */
  groupPolicy?: GroupPolicy;
  /** Inbound media max size (MB). Default: 5. */
  mediaMaxMb?: number;
  /** Reaction indicators. */
  reactions?: {
    enabled?: boolean;
    clearOnFinish?: boolean;
    onStart?: string;
    onSuccess?: string;
    onError?: string;
  };
  /** Outbound text chunk size (chars). Default: 4000. */
  textChunkLimit?: number;
  /** Chunking mode: "length" (default) splits by size; "newline" splits on every newline. */
  chunkMode?: "length" | "newline";
  /** Disable block streaming for this account. */
  blockStreaming?: boolean;
  /** Merge streamed block replies before sending. */
  blockStreamingCoalesce?: BlockStreamingCoalesceConfig;
  /** Explicitly enable/disable message receiving (streaming mode). */
  streaming?: boolean;
  /** Outbound response prefix override for this channel/account. */
  responsePrefix?: string;
  /**
   * If the agent ends a turn with assistant text but never invokes the
   * messaging tool (a common failure mode for local OSS models with weaker
   * structured-tool-call training), the plugin will, after the run, read
   * the latest assistantTexts from the session trajectory and dispatch
   * them through the channel anyway.
   *
   * Default: true. Set to false to enforce strict tool-call semantics.
   */
  autoSendOnMissingTool?: boolean;
  /**
   * Show a "Thinking..." placeholder message while the model is generating
   * a response. When true the bot posts a message that is edited in-place
   * once the response is ready; when false it only shows a typing indicator.
   * Disabling the placeholder reduces Zulip API overhead and improves
   * response latency.
   *
   * Default: false.
   */
  showThinkingPlaceholder?: boolean;
  /**
   * Maximum number of inbound conversation turns in a single Zulip DM session
   * before starting a fresh session key. Rotating DM sessions prevents a single
   * long-running or broken conversation from accumulating unbounded context
   * that slows every future reply. Stream/topic sessions are not rotated.
   *
   * Use `0` or `undefined` to disable rotation.
   *
   * Default: 20.
   */
  dmSessionTurnLimit?: number;
  /**
   * Enable recovery of interrupted messages after a gateway restart.
   * When true, the bot scans recent DMs for messages with a 👀 reaction
   * but no ✅/⚠️ reaction and no bot response, then re-dispatches them
   * with a fresh session key.
   *
   * Default: false (opt-in).
   */
  enableSessionRecovery?: boolean;
  /**
   * Maximum number of inbound messages per minute from a single sender.
   * Prevents a single user from flooding the bot with messages.
   * Use 0 to disable rate limiting.
   *
   * Default: 60.
   */
  maxMessagesPerMinute?: number;
  /**
   * Maximum total length of a single outbound message in characters.
   * Messages exceeding this limit are truncated before delivery.
   * This prevents downstream plugins (e.g., Honcho memory) from failing
   * on excessively long content, and keeps Zulip replies readable.
   *
   * Default: 20000. Use 0 to disable truncation.
   */
  maxMessageLength?: number;
  /**
   * Operator opt-in for plaintext HTTP and private/internal host addresses.
   *
   * Off by default. Zulip authenticates with HTTP Basic on every request, so an
   * `http://` realm exposes the bot's email and API key in cleartext. Enabling
   * this also relaxes the private-IP (SSRF) ban, because a self-hosted Zulip on
   * a LAN usually is a private address. Only enable it on a trusted network.
   *
   * Default: false. Can also be set for the default account with
   * `ZULIP_ALLOW_INSECURE_HTTP=1`.
   */
  allowInsecureHttp?: boolean;
  /**
   * Work around hosts where hard links are unavailable (Android/Termux).
   *
   * OpenClaw publishes a deleted session's transcript archive with an atomic
   * `fs.link()`. Where hard links are blocked that publish can never succeed,
   * and the host then fails every session operation — so the bot cannot reply
   * on any channel. The plugin can publish those archives itself instead.
   *
   * - unset (default): automatic — active only when a one-time probe shows hard
   *   links are unavailable in the data dir, so healthy hosts are never touched
   * - `true`: always run the repair loop
   * - `false`: never run it
   */
  sessionArchiveRepair?: boolean;
  /**
   * Refuse to send a Zulip message that contains a credential value from the
   * host config (default: true).
   *
   * An agent that can read the config can simply *type* a secret into chat; an
   * allowlist on file uploads does not cover that. This guard inspects outbound
   * text and blocks it, naming only *where* the credential came from — never
   * echoing its value. It cannot stop the file from being read (that is the
   * host's tool policy); it stops the plugin from transmitting it.
   */
  blockSecretLeaks?: boolean;
  /**
   * Progressive activity trace (epic #293).
   *
   * When enabled, the plugin posts **one** dedicated bot-owned status message
   * per work item and edits it in place as steps resolve, so the topic shows
   * what the agent is doing instead of only the final reply. Status detail
   * edits the trace; actionable results remain separate messages.
   *
   * Off by default: the feature adds outbound writes (~600ms Zulip round-trips).
   */
  activityTrace?: boolean;
  /**
   * Coalescing window in milliseconds for trace edits.
   *
   * Bursty updates within this window collapse into a single PATCH. Zulip
   * round-trips are ~600ms, so editing per step would make the topic a
   * metronome. Clamped to 0–60000.
   *
   * Default: 400.
   */
  traceCoalesceMs?: number;
  /**
   * Hard ceiling on trace edits per second.
   *
   * Enforced in addition to the coalescing window, so no configuration can
   * flood the Zulip API. Clamped to 0.1–50.
   *
   * Default: 2.
   */
  traceMaxRate?: number;
  /**
   * History-aware context (#294).
   *
   * `"off"` (default) — never harvest. `"on-demand"` — only when the inbound
   * text looks like a "do we know this?" question. `"always"` — every inbound
   * stream message carries the bounded history block.
   *
   * Each harvest is one extra Zulip round-trip (~600ms) on the reply path and
   * consumes context budget, which is why on-demand is the recommended mode.
   * Streams/topics only; DMs keep their own session continuity.
   */
  historyContext?: "off" | "on-demand" | "always";
  /** Max earlier messages injected as history context (default 8, clamp 1–50). */
  historyMaxMessages?: number;
  /** How far back history is considered (default 72 hours, clamp 1–8760). */
  historyWindowHours?: number;
  /** Hard cap on the rendered history block in characters (default 4000, clamp 200–20000). */
  historyMaxChars?: number;
  /**
   * Actionable refs in replies (#295).
   *
   * When enabled, the agent can emit `[[zulip_ref: <github url> | <label>]]`
   * markers and the plugin validates each ref against the GitHub API and
   * renders it as a clickable link. A ref that cannot be confirmed — wrong
   * shape, 404, rate limit, timeout — renders as plain text instead, and the
   * reply still sends.
   *
   * Validation is unauthenticated (public refs only, GitHub's 60 req/hour/IP
   * limit) and never sends host credentials. Default: false.
   */
  renderRefs?: boolean;
  /**
   * In-channel action triggers (#297).
   *
   * Maps a reaction emoji (normalised name, e.g. `+1` or `check`) to an
   * instruction. When an authorised user reacts with that emoji on the bot's
   * own message in a monitored stream, the instruction is dispatched as an
   * explicit turn for the same stream/topic session — so the team can say "go"
   * from inside the room and the work stays with the discussion.
   *
   * Absent (default) disables the feature: no trigger emoji is recognised and
   * the `reaction` event type is not even requested from Zulip. A reaction is
   * only a trigger, never an authorisation bypass — the reacting user is still
   * subject to the allowlists, policies and rate limit.
   */
  reactionTriggers?: Record<string, string>;
  /**
   * Allow reaction triggers on messages the bot did not author.
   *
   * Default `false`: a reaction is an approval of the *agent's* proposal, so
   * reacting to someone else's message must not be a way to make the agent act
   * on it. Only enable this deliberately.
   */
  reactionTriggerAnyMessage?: boolean;
};

export type ZulipConfig = {
  /** Optional per-account Zulip configuration (multi-account). */
  accounts?: Record<string, ZulipAccountConfig>;
} & ZulipAccountConfig;
