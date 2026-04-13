import type { OpenClawConfig, ChannelAccountSnapshot } from "openclaw/plugin-sdk/core";
import { logInboundDrop, resolveControlCommandGate } from "openclaw/plugin-sdk/irc";
import { createReplyPrefixOptions } from "openclaw/plugin-sdk/channel-runtime";
import { resolveChannelMediaMaxBytes } from "openclaw/plugin-sdk/media-runtime";
import { getZulipRuntime } from "../runtime.js";
import {
  deleteZulipQueue,
  registerZulipQueue,
  type ZulipMessage,
} from "./client.js";
import {
  formatInboundFromLabel,
  resolveThreadSessionKeys,
  formatZulipLog,
  maskPII,
  delay,
} from "./monitor-helpers.js";
import { ZulipDedupeStore } from "./dedupe-store.js";
import { sendMessageZulip } from "./send.js";
import { decidePolicy } from "./policy.js";
import { ZulipQueueManager } from "./queue-manager.js";
import { extractZulipUploadUrls, normalizeZulipEmojiName } from "./uploads.js";
import {
  stripHtmlToText,
  normalizeMention,
  resolveOncharPrefixes,
  stripOncharPrefix,
} from "./text-utils.js";
import {
  isSenderAllowed,
  normalizeAllowList,
} from "./auth.js";
import { downloadAttachments } from "./media-utils.js";
import { addReactionSafe, removeReactionSafe } from "./reactions.js";
import { initializeZulipMonitor } from "./bootstrap.js";
import { pollOnce } from "./polling.js";
import { dispatchZulipReply } from "./reply-handler.js";

export type MonitorZulipOpts = {
  apiKey?: string;
  email?: string;
  baseUrl?: string;
  accountId?: string;
  config?: OpenClawConfig;
  runtime?: any;
  abortSignal?: AbortSignal;
  statusSink?: (patch: Partial<ChannelAccountSnapshot>) => void;
};

const RECENT_MESSAGE_TTL_MS = 5 * 60_000;
const RECENT_MESSAGE_MAX = 2000;
const DEFAULT_TOPIC = "general";

export async function monitorZulipProvider(opts: MonitorZulipOpts = {}): Promise<void> {
  const core = getZulipRuntime();
  core.log?.(formatZulipLog("zulip monitor starting", { accountId: opts.accountId }));

  try {
    const {
      cfg,
      account,
      client,
      botUserId,
      botEmail,
      botUsername,
      baseUrl,
    } = await initializeZulipMonitor({ opts, core });

    const logger = core.logging.getChildLogger({ module: "zulip" });
    const logVerboseMessage = core.logging.shouldLogVerbose()
      ? (message: string) => logger.debug?.(message)
      : () => {};

    const oncharPrefixes = resolveOncharPrefixes(account.oncharPrefixes);
    const oncharEnabled = account.chatmode === "onchar";

    const mediaMaxBytes =
      resolveChannelMediaMaxBytes({
        cfg,
        accountId: account.accountId,
        resolveChannelLimitMb: ({ cfg, accountId }) =>
          (
            cfg.channels?.zulip as {
              mediaMaxMb?: number;
              accounts?: Record<string, { mediaMaxMb?: number }>;
            }
          )?.accounts?.[accountId]?.mediaMaxMb ??
          (cfg.channels?.zulip as { mediaMaxMb?: number })?.mediaMaxMb,
      }) ?? 5 * 1024 * 1024;

    const reactionConfig = account.config.reactions ?? {};
    const reactionsEnabled = reactionConfig.enabled !== false;
    const reactionClearOnFinish = reactionConfig.clearOnFinish !== false;
    const reactionStart = normalizeZulipEmojiName(reactionConfig.onStart ?? "eyes");
    const reactionSuccess = normalizeZulipEmojiName(reactionConfig.onSuccess ?? "check_mark");
    const reactionError = normalizeZulipEmojiName(reactionConfig.onError ?? "warning");

    const dedupeStore = new ZulipDedupeStore({
      accountId: account.accountId,
      runtime: core,
      ttlMs: RECENT_MESSAGE_TTL_MS,
      maxSize: RECENT_MESSAGE_MAX,
    });
    await dedupeStore.load();

    // ⚡ Bolt Performance Optimization:
    // Hoist static configurations and expensive regex/object compilations outside the tight message loop
    // to prevent CPU overhead and redundant garbage collection on every single incoming event.
    const mentionRegexes = core.channel.mentions.buildMentionRegexes(cfg, "main");
    const dmPolicy = account.config.dmPolicy ?? "pairing";
    const defaultGroupPolicy = cfg.channels?.defaults?.groupPolicy;
    const groupPolicy = account.config.groupPolicy ?? defaultGroupPolicy ?? "allowlist";
    const configAllowFrom = normalizeAllowList(account.config.allowFrom ?? []);
    const configGroupAllowFrom = normalizeAllowList(account.config.groupAllowFrom ?? []);

    const allowTextCommands = core.channel.commands.shouldHandleTextCommands({
      cfg,
      surface: "zulip",
    });
    const useAccessGroups = cfg.commands?.useAccessGroups !== false;
    const canDetectMention = Boolean(botUsername) || mentionRegexes.length > 0;

    const textLimit = core.channel.text.resolveTextChunkLimit(cfg, "zulip", account.accountId, {
      fallbackLimit: account.textChunkLimit ?? 4000,
    });
    const tableMode = core.channel.text.resolveMarkdownTableMode({
      cfg,
      channel: "zulip",
      accountId: account.accountId,
    });

    const handleMessage = async (message: ZulipMessage) => {
      const messageId = String(message.id ?? "");
      if (!messageId) {
        return;
      }

      const senderId = message.sender_email || String(message.sender_id ?? "");
      if (!senderId) {
        return;
      }
      if (senderId === botEmail || String(message.sender_id) === botUserId) {
        return;
      }

      const isDM = message.type === "private";
      const kind = isDM ? "dm" : "channel";
      let streamId = "";
      let streamName = "";
      let topic = isDM ? undefined : (message.subject?.trim() || DEFAULT_TOPIC);
      if (!isDM) {
        streamId = String(message.stream_id ?? "");
        if (typeof message.display_recipient === "string") {
          streamName = message.display_recipient;
        }
      }

      core.log?.(
        formatZulipLog("zulip inbound arrival", {
          accountId: account.accountId,
          messageId,
          senderId: maskPII(senderId),
          kind,
          stream: maskPII(streamName || streamId),
          topic: topic ? maskPII(topic) : undefined,
        }),
      );

      const dedupeKey = `${account.accountId}:${messageId}`;
      if (await dedupeStore.check(dedupeKey)) {
        core.log?.(
          formatZulipLog("zulip inbound dedupe hit", {
            accountId: account.accountId,
            messageId,
          }),
        );
        return;
      }

      const senderName = message.sender_full_name?.trim() || senderId;
      const chatType = isDM ? "direct" : "channel";

      let channelId = isDM ? senderId : streamId;

      const rawText = stripHtmlToText(message.content ?? "");
      const oncharResult = stripOncharPrefix(rawText, oncharPrefixes);

      const uploadUrls = extractZulipUploadUrls(message.content ?? "", baseUrl);
      const { mediaPaths, mediaTypes, mediaUrls } = await downloadAttachments({
        core,
        uploadUrls,
        baseUrl,
        authHeader: client.authHeader,
        mediaMaxBytes,
        accountId: account.accountId,
        messageId,
      });

      const oncharTriggered = oncharEnabled && oncharResult.triggered;

      const wasMentioned =
        !isDM &&
        (rawText.toLowerCase().includes(`@${botUsername.toLowerCase()}`) ||
          core.channel.mentions.matchesMentionPatterns(rawText, mentionRegexes));

      const storeAllowFrom = normalizeAllowList(
        await core.channel.pairing.readAllowFromStore("zulip").catch(() => []),
      );
      const effectiveAllowFrom = Array.from(new Set([...configAllowFrom, ...storeAllowFrom]));
      const effectiveGroupAllowFrom = Array.from(
        new Set([
          ...(configGroupAllowFrom.length > 0 ? configGroupAllowFrom : configAllowFrom),
          ...storeAllowFrom,
        ]),
      );

      const hasControlCommand = core.channel.text.hasControlCommand(rawText, cfg);
      const isControlCommand = allowTextCommands && hasControlCommand;
      const senderAllowedForCommands = isSenderAllowed({
        senderId,
        senderName,
        allowFrom: effectiveAllowFrom,
      });
      const groupAllowedForCommands = isSenderAllowed({
        senderId,
        senderName,
        allowFrom: effectiveGroupAllowFrom,
      });
      const commandGate = resolveControlCommandGate({
        useAccessGroups,
        authorizers: [
          { configured: effectiveAllowFrom.length > 0, allowed: senderAllowedForCommands },
          {
            configured: effectiveGroupAllowFrom.length > 0,
            allowed: groupAllowedForCommands,
          },
        ],
        allowTextCommands,
        hasControlCommand,
      });
      const commandAuthorized =
        kind === "dm"
          ? dmPolicy === "open" || senderAllowedForCommands
          : commandGate.commandAuthorized;

      const shouldRequireMention =
        kind !== "dm" &&
        core.channel.groups.resolveRequireMention({
          cfg,
          channel: "zulip",
          accountId: account.accountId,
          groupId: channelId,
          requireMentionOverride: account.config.requireMention,
        });

      const policyResult = decidePolicy({
        kind,
        senderId,
        senderName,
        dmPolicy,
        groupPolicy,
        senderAllowedForCommands,
        groupAllowedForCommands,
        effectiveGroupAllowFromLength: effectiveGroupAllowFrom.length,
        shouldRequireMention,
        wasMentioned,
        isControlCommand,
        commandAuthorized,
        oncharTriggered,
        canDetectMention,
      });

      if (policyResult.shouldDrop) {
        if (policyResult.shouldPair) {
          const { code, created } = await core.channel.pairing.upsertPairingRequest({
            channel: "zulip",
            id: senderId,
            meta: { name: senderName },
          });
          core.log?.(
            formatZulipLog("zulip pairing request", {
              accountId: account.accountId,
              senderId: maskPII(senderId),
              created,
            }),
          );
          if (created) {
            try {
              await sendMessageZulip(
                `user:${senderId}`,
                core.channel.pairing.buildPairingReply({
                  channel: "zulip",
                  idLine: `Your Zulip email: ${senderId}`,
                  code,
                }),
                {
                  accountId: account.accountId,
                  sessionKey: `zulip:${account.accountId}:pairing`,
                  kind: "dm",
                },
              );
              opts.statusSink?.({ lastOutboundAt: Date.now() });
            } catch (err) {
              core.error?.(
                formatZulipLog("zulip pairing reply failed", {
                  accountId: account.accountId,
                  senderId: maskPII(senderId),
                  error: String(err),
                }),
              );
            }
          }
        } else {
          logInboundDrop({
            log: (msg: string) =>
              core.log?.(
                formatZulipLog(msg, {
                  accountId: account.accountId,
                  messageId,
                  senderId: maskPII(senderId),
                  reason: policyResult.reason,
                }),
              ),
            channel: "zulip",
            reason: policyResult.reason ?? "policy drop",
            target: senderId,
          });
        }
        return;
      }

      if (oncharEnabled && !oncharTriggered && !wasMentioned && !isControlCommand) {
        return;
      }

      const effectiveWasMentioned =
        wasMentioned || (isControlCommand && commandAuthorized) || oncharTriggered;

      const bodySource = oncharTriggered ? oncharResult.stripped : rawText;
      const bodyText = normalizeMention(bodySource, botUsername);
      if (!bodyText) {
        return;
      }

      core.channel.activity.record({
        channel: "zulip",
        accountId: account.accountId,
        direction: "inbound",
      });

      const roomLabel = streamName ? `#${streamName}` : `stream:${streamId}`;
      const fromLabel = formatInboundFromLabel({
        isGroup: kind !== "dm",
        groupLabel: roomLabel,
        groupId: channelId,
        groupFallback: "Stream",
        directLabel: senderName,
        directId: senderId,
      });

      const route = core.channel.routing.resolveAgentRoute({
        cfg,
        channel: "zulip",
        accountId: account.accountId,
        teamId: undefined,
        peer: {
          kind,
          id: kind === "dm" ? senderId : channelId,
        },
      });

      const baseSessionKey = route.sessionKey ?? `zulip:${account.accountId}:${channelId}`;
      const threadKeys = resolveThreadSessionKeys({
        baseSessionKey,
        threadId: topic !== DEFAULT_TOPIC ? topic : undefined,
      });
      const sessionKey = threadKeys.sessionKey;

      const preview = bodyText.replace(/\s+/g, " ").slice(0, 160);
      const inboundLabel =
        kind === "dm"
          ? `Zulip DM from ${senderName}`
          : `Zulip message in ${roomLabel} from ${senderName}`;
      core.system.enqueueSystemEvent(`${inboundLabel}: ${preview}`, {
        sessionKey,
        contextKey: `zulip:message:${messageId}`,
      });

      const timestamp = message.timestamp ? message.timestamp * 1000 : undefined;
      const textWithId = `${bodyText}\n[zulip message id: ${messageId}]`;
      const body = core.channel.reply.formatInboundEnvelope({
        channel: "Zulip",
        from: fromLabel,
        timestamp,
        body: textWithId,
        chatType,
        sender: { name: senderName, id: senderId },
      });

      const to = kind === "dm" ? `user:${senderId}` : `stream:${streamName || streamId}:${topic}`;
      const ctxPayload = core.channel.reply.finalizeInboundContext({
        Body: body,
        RawBody: bodyText,
        CommandBody: bodyText,
        From: kind === "dm" ? `zulip:${senderId}` : `zulip:channel:${channelId}`,
        To: to,
        SessionKey: sessionKey,
        ParentSessionKey: threadKeys.parentSessionKey,
        AccountId: route.accountId,
        ChatType: chatType,
        ConversationLabel: fromLabel,
        GroupSubject: kind !== "dm" ? roomLabel : undefined,
        GroupChannel: streamName ? `#${streamName}` : undefined,
        SenderName: senderName,
        SenderId: senderId,
        Provider: "zulip" as const,
        Surface: "zulip" as const,
        MessageSid: messageId,
        ReplyToId: topic !== DEFAULT_TOPIC ? topic : undefined,
        MessageThreadId: topic !== DEFAULT_TOPIC ? topic : undefined,
        Timestamp: timestamp,
        WasMentioned: kind !== "dm" ? effectiveWasMentioned : undefined,
        CommandAuthorized: commandAuthorized,
        OriginatingChannel: "zulip" as const,
        OriginatingTo: to,
        MediaPath: mediaPaths[0],
        MediaPaths: mediaPaths.length > 0 ? mediaPaths : undefined,
        MediaUrl: mediaUrls[0],
        MediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
        MediaType: mediaTypes[0],
        MediaTypes: mediaTypes.length > 0 ? mediaTypes : undefined,
      });

      if (kind === "dm") {
        const sessionCfg = cfg.session;
        const storePath = core.channel.session.resolveStorePath(sessionCfg?.store, {
          agentId: route.agentId,
        });
        await core.channel.session.updateLastRoute({
          storePath,
          sessionKey: route.mainSessionKey,
          deliveryContext: {
            channel: "zulip",
            to,
            accountId: route.accountId,
          },
        });
      }

      const previewLine = bodyText.slice(0, 200).replace(/\n/g, "\\n");
      core.log?.(
        formatZulipLog("zulip inbound dispatch", {
          accountId: account.accountId,
          messageId,
          senderId: maskPII(senderId),
          from: maskPII(ctxPayload.From),
          to: maskPII(ctxPayload.To),
          sessionKey: maskPII(sessionKey),
          len: bodyText.length,
          preview: maskPII(previewLine),
        }),
      );

      await addReactionSafe({
        client,
        messageId,
        emojiName: reactionStart,
        reactionsEnabled,
        logVerbose: logVerboseMessage,
      });

      const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
        cfg,
        agentId: route.agentId,
        channel: "zulip",
        accountId: account.accountId,
      });

      const dispatchError = await dispatchZulipReply({
        core,
        cfg,
        account,
        route,
        client,
        ctxPayload,
        isDM,
        senderId,
        senderNumericId: Number(message.sender_id),
        streamId,
        topic,
        messageId,
        botUsername,
        onModelSelected,
        prefixOptions,
        tableMode,
        textLimit,
        to,
        statusSink: opts.statusSink,
        logVerboseMessage,
      });

      if (reactionsEnabled) {
        if (reactionClearOnFinish) {
          await removeReactionSafe({
            client,
            messageId,
            emojiName: reactionStart,
            reactionsEnabled,
            logVerbose: logVerboseMessage,
          });
        }
        if (dispatchError) {
          await addReactionSafe({
            client,
            messageId,
            emojiName: reactionError,
            reactionsEnabled,
            logVerbose: logVerboseMessage,
          });
        } else {
          await addReactionSafe({
            client,
            messageId,
            emojiName: reactionSuccess,
            reactionsEnabled,
            logVerbose: logVerboseMessage,
          });
        }
      }

      opts.statusSink?.({ lastInboundAt: Date.now() });
    };

    const streams = account.streams ?? ["*"];
    const queueManager = new ZulipQueueManager({
      accountId: account.accountId,
      runtime: core,
      registerFn: async () => {
        return await registerZulipQueue(client, {
          eventTypes: ["message"],
          streams,
        });
      },
    });

    let pollBackoffMs = 0;

    const resetPollBackoff = () => {
      pollBackoffMs = 0;
    };

    const processMessage = async (message: ZulipMessage): Promise<void> => {
      try {
        await handleMessage(message);
      } catch (err) {
        core.error?.(
          formatZulipLog("zulip message handler failed", {
            accountId: account.accountId,
            messageId: message.id,
            error: String(err),
          }),
        );
      }
    };

    if (account.streaming === false) {
      core.log?.(
        formatZulipLog("zulip monitoring disabled by configuration", {
          accountId: account.accountId,
        }),
      );
      return;
    }

    core.log?.(formatZulipLog("zulip monitor loop entering", { accountId: account.accountId }));
    while (!opts.abortSignal?.aborted) {
      const result = await pollOnce({
        client,
        queueManager,
        core,
        accountId: account.accountId,
        opts,
        pollBackoffMs,
        resetPollBackoff,
        processMessage,
      });
      pollBackoffMs = result.pollBackoffMs;
      if (!result.shouldContinue) {
        break;
      }
    }
    core.log?.(
      formatZulipLog("zulip monitor loop exited", {
        accountId: account.accountId,
        aborted: opts.abortSignal?.aborted,
      }),
    );

    if (queueManager) {
      const queue = queueManager.getQueue();
      if (queue) {
        core.log?.(
          formatZulipLog("zulip monitor cleaning up queue", {
            accountId: account.accountId,
            queueId: maskPII(queue.queueId),
          }),
        );
        await deleteZulipQueue(client, queue.queueId);
      }
    }
  } catch (err) {
    core.error?.(
      formatZulipLog("zulip monitor fatal error", {
        accountId: opts.accountId,
        error: String(err),
        stack: (err as Error)?.stack,
      }),
    );
    throw err;
  } finally {
    core.log?.(
      formatZulipLog("zulip monitor stopped", {
        accountId: opts.accountId,
        reason: opts.abortSignal?.aborted ? "aborted" : "finished",
      }),
    );
  }
}
