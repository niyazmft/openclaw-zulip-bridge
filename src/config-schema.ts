import {
  BlockStreamingCoalesceSchema,
  buildCatchallMultiAccountChannelSchema,
  buildChannelConfigSchema,
  DmPolicySchema,
  GroupPolicySchema,
  MarkdownConfigSchema,
  requireOpenAllowFrom,
} from "openclaw/plugin-sdk/channel-config-schema";
import { z } from "zod";
import { zulipChannelConfigUiHints } from "./config-ui-hints.js";

const ZulipAccountSchema = z.object({
  name: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  markdown: MarkdownConfigSchema.optional(),
  enabled: z.boolean().optional(),
  configWrites: z.boolean().optional(),
  url: z.string().optional(),
  site: z.string().optional(),
  realm: z.string().optional(),
  email: z.string().optional(),
  apiKey: z.string().optional(),
  streams: z.array(z.string()).optional(),
  streaming: z.boolean().optional(),
  chatmode: z.enum(["oncall", "onmessage", "onchar"]).optional(),
  oncharPrefixes: z.array(z.string()).optional(),
  requireMention: z.boolean().optional(),
  dmPolicy: DmPolicySchema.optional(),
  allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
  groupAllowFrom: z.array(z.union([z.string(), z.number()])).optional(),
  groupPolicy: GroupPolicySchema.optional(),
  mediaMaxMb: z.number().int().positive().optional(),
  reactions: z
    .object({
      enabled: z.boolean().optional(),
      clearOnFinish: z.boolean().optional(),
      onStart: z.string().optional(),
      onSuccess: z.string().optional(),
      onError: z.string().optional(),
      onQueued: z.string().optional(),
    })
    .optional(),
  textChunkLimit: z.number().int().positive().optional(),
  chunkMode: z.enum(["length", "newline"]).optional(),
  blockStreaming: z.boolean().optional(),
  blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
  responsePrefix: z.string().optional(),
  enableAdminActions: z.boolean().default(false),
  autoSendOnMissingTool: z.boolean().optional(),
  showThinkingPlaceholder: z.boolean().optional(),
  dmSessionTurnLimit: z.number().int().min(0).optional(),
  enableSessionRecovery: z.boolean().optional(),
  maxMessagesPerMinute: z.number().int().min(0).optional(),
  maxMessageLength: z.number().int().min(0).optional(),
  allowInsecureHttp: z.boolean().optional(),
  sessionArchiveRepair: z.boolean().optional(),
  blockSecretLeaks: z.boolean().optional(),
  activityTrace: z.boolean().optional(),
  traceCoalesceMs: z.number().int().min(0).max(60_000).optional(),
  traceMaxRate: z.number().min(0.1).max(50).optional(),
  historyContext: z.enum(["off", "on-demand", "always"]).optional(),
  historyMaxMessages: z.number().int().min(1).max(50).optional(),
  historyWindowHours: z.number().int().min(1).max(8760).optional(),
  historyMaxChars: z.number().int().min(200).max(20_000).optional(),
  renderRefs: z.boolean().optional(),
  reactionTriggers: z.record(z.string(), z.string().max(500)).optional(),
  reactionTriggerAnyMessage: z.boolean().optional(),
  queueMode: z.enum(["off", "followup"]).optional(),
  queueCap: z.number().int().min(1).max(500).optional(),
});

const ZulipConfigSchema = buildCatchallMultiAccountChannelSchema(
  ZulipAccountSchema,
).extend({
  streaming: z.boolean().optional(),
}).superRefine((value, ctx) => {
  requireOpenAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message: 'channels.zulip.dmPolicy="open" requires channels.zulip.allowFrom to include "*"',
  });
});

export const ZulipChannelConfigSchema = buildChannelConfigSchema(ZulipConfigSchema, {
  uiHints: zulipChannelConfigUiHints,
});
