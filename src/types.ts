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
};

export type ZulipConfig = {
  /** Optional per-account Zulip configuration (multi-account). */
  accounts?: Record<string, ZulipAccountConfig>;
} & ZulipAccountConfig;
