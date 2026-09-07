import { createTypingCallbacks } from "openclaw/plugin-sdk/channel-reply-pipeline";
import { logTypingFailure } from "openclaw/plugin-sdk/channel-feedback";
import { sendZulipTyping, editZulipMessage } from "./client.js";
import { sendMessageZulip } from "./send.js";
import { addReactionSafe } from "./reactions.js";
import { formatZulipLog, maskPII } from "./monitor-helpers.js";
import { extractZulipTopicDirective } from "./text-utils.js";
import { readLatestAssistantTexts } from "./fallback-reader.js";
import {
  isReplyPayloadNonTerminalToolErrorWarning,
  type ReplyPayload,
} from "openclaw/plugin-sdk/reply-payload";

/** Truncates text to a maximum length, appending an ellipsis if truncated. */
function truncateText(text: string, maxLength: number): string {
  if (maxLength <= 0 || text.length <= maxLength) return text;
  const ellipsis = "\n\n[...message truncated]";
  const maxContentLength = maxLength - ellipsis.length;
  if (maxContentLength <= 0) return text.slice(0, maxLength);
  return text.slice(0, maxContentLength) + ellipsis;
}

/**
 * Handles the reply dispatching logic for a Zulip message.
 */
export async function dispatchZulipReply(params: {
  core: any;
  cfg: any;
  account: any;
  route: any;
  client: any;
  ctxPayload: any;
  isDM: boolean;
  senderId: string;
  senderNumericId: number;
  streamId: string;
  topic: string | undefined;
  messageId: string;
  botUsername: string;
  onModelSelected: any;
  prefixOptions: any;
  tableMode: any;
  textLimit: number;
  to: string;
  statusSink?: (patch: any) => void;
  logVerboseMessage: (msg: string) => void;
  placeholderMessageIdPromise?: Promise<string | undefined>;
  maxMessageLength?: number;
}): Promise<unknown> {
  const {
    core,
    cfg,
    account,
    route,
    client,
    ctxPayload,
    isDM,
    senderId,
    senderNumericId,
    streamId,
    topic,
    messageId,
    onModelSelected,
    prefixOptions,
    tableMode,
    textLimit,
    to,
    statusSink,
    logVerboseMessage,
    placeholderMessageIdPromise,
    maxMessageLength,
  } = params;

  const typingParams = isDM
    ? { op: "start" as const, type: "direct" as const, to: [senderNumericId] }
    : streamId
      ? { op: "start" as const, type: "stream" as const, streamId: Number(streamId), topic }
      : null;

  const typingCallbacks = createTypingCallbacks({
    start: async () => {
      if (typingParams) {
        core.logging?.getChildLogger?.({ module: "zulip" })?.info?.("zulip typing start", {
          accountId: account.accountId,
          messageId,
          target: maskPII(isDM ? String(senderNumericId) : `stream:${streamId}:${topic}`),
        });
        await sendZulipTyping(client, typingParams);
      }
    },
    stop: async () => {
      if (typingParams) {
        core.logging?.getChildLogger?.({ module: "zulip" })?.info?.("zulip typing stop", {
          accountId: account.accountId,
          messageId,
          target: maskPII(isDM ? String(senderNumericId) : `stream:${streamId}:${topic}`),
        });
        await sendZulipTyping(client, { ...typingParams, op: "stop" });
      }
    },
    onStartError: (err) => {
      logTypingFailure({
        log: logVerboseMessage,
        channel: "zulip",
        target: maskPII(isDM ? senderId : `stream:${streamId}:${topic}`),
        error: err,
      });
    },
    onStopError: (err) => {
      logTypingFailure({
        log: logVerboseMessage,
        channel: "zulip",
        target: maskPII(isDM ? senderId : `stream:${streamId}:${topic}`),
        error: err,
      });
    },
  });

  let deliveredAny = false;
  let placeholderMessageId: string | undefined;
  let placeholderConsumed = false;
  let typingStopped = false;

  const { dispatcher, replyOptions, markDispatchIdle } =
    core.channel.reply.createReplyDispatcherWithTyping({
      ...prefixOptions,
      humanDelay: 0,
      typingCallbacks,
      deliver: async (payload: ReplyPayload) => {
        const zLogger = core.logging?.getChildLogger?.({ module: "zulip" });

        // Suppress host-generated transient notices so they do not leak into
        // Zulip as plain chat messages (#273, #247):
        // - Non-terminal tool-error warnings (e.g. "Exec failed: ..." chains)
        //   are marked by the SDK; the final reply always follows.
        // - Compaction / fallback / status notices are runtime-internal and
        //   rendered as transient indicators on native channels. Zulip has
        //   no transient surface, so they would only be noise.
        // Agent-run failure messages (payload.isError) are deliberately
        // user-facing and are still delivered.
        if (isReplyPayloadNonTerminalToolErrorWarning(payload)) {
          zLogger?.info?.("zulip deliver skipped: non-terminal tool error warning", {
            accountId: account.accountId,
            messageId,
            textLen: (payload.text ?? "").length,
          });
          return;
        }
        if (
          payload.isCompactionNotice === true ||
          payload.isFallbackNotice === true ||
          payload.isStatusNotice === true
        ) {
          zLogger?.info?.("zulip deliver skipped: status notice", {
            accountId: account.accountId,
            messageId,
            kind: payload.isCompactionNotice
              ? "compaction"
              : payload.isFallbackNotice
                ? "fallback"
                : "status",
            textLen: (payload.text ?? "").length,
          });
          return;
        }

        deliveredAny = true;
        zLogger?.info?.("zulip deliver callback fired", {
          accountId: account.accountId,
          messageId,
          textLen: (payload.text ?? "").length,
          hasMedia: Boolean(payload.mediaUrl || payload.mediaUrls?.length),
        });
        try {
          // delivered so the user does not see "bot is typing" after the reply
          // is already visible. This is best-effort and idempotent.
          if (!typingStopped) {
            typingStopped = true;
            // onIdle() is synchronous (returns void) in the 2026.9.1 SDK
            typingCallbacks.onIdle?.();
          }
          if (!placeholderConsumed) {
            placeholderConsumed = true;
            if (placeholderMessageIdPromise) {
              try {
                placeholderMessageId = await placeholderMessageIdPromise;
              } catch (err) {
                logVerboseMessage(
                  `zulip placeholder promise rejected: ${String(err)}; falling back to new message`,
                );
              }
            }
          }
          const mediaUrls = payload.mediaUrls ?? (payload.mediaUrl ? [payload.mediaUrl] : []);
          const rawText = core.channel.text.convertMarkdownTables(payload.text ?? "", tableMode);
          const { text: extractedText, topic: topicOverride } = extractZulipTopicDirective(rawText);
          const text =
            maxMessageLength != null && maxMessageLength > 0
              ? truncateText(extractedText, maxMessageLength)
              : extractedText;
          const resolvedTopic = topicOverride ? topicOverride.slice(0, 60) : topic;
          zLogger?.info?.("zulip deliver before send", {
            accountId: account.accountId,
            messageId,
            textLen: text?.length ?? 0,
            rawTextLen: rawText?.length ?? 0,
            mediaUrlsCount: mediaUrls.length,
          });
          if (mediaUrls.length === 0) {
            const chunkMode = core.channel.text.resolveChunkMode(cfg, "zulip", account.accountId);
            const chunks = core.channel.text.chunkMarkdownTextWithMode(text, textLimit, chunkMode);
            const nonEmptyChunks = (chunks.length > 0 ? chunks : [text]).filter(Boolean);
            zLogger?.info?.("zulip deliver chunks ready", {
              accountId: account.accountId,
              messageId,
              chunksCount: chunks.length,
              nonEmptyCount: nonEmptyChunks.length,
              textLen: text?.length ?? 0,
            });
            for (let idx = 0; idx < nonEmptyChunks.length; idx++) {
              const chunk = nonEmptyChunks[idx];
              zLogger?.info?.("zulip deliver sending chunk", {
                accountId: account.accountId,
                messageId,
                chunkIdx: idx,
                chunkLen: chunk?.length ?? 0,
                totalChunks: nonEmptyChunks.length,
                usePlaceholder: Boolean(placeholderMessageId),
                target: maskPII(to),
              });
              // UX: Edit the placeholder message for the first chunk, then send new messages for the rest.
              if (placeholderMessageId) {
                try {
                  await editZulipMessage(client, {
                    messageId: placeholderMessageId,
                    content: chunk,
                  });
                  zLogger?.info?.("zulip deliver placeholder edit ok", {
                    accountId: account.accountId,
                    messageId,
                    chunkIdx: idx,
                  });
                } catch (err) {
                  logVerboseMessage(
                    `zulip placeholder edit failed: ${String(err)}; falling back to new message`,
                  );
                  await sendMessageZulip(to, chunk, {
                    accountId: account.accountId,
                    topic: resolvedTopic,
                  });
                  zLogger?.info?.("zulip deliver fallback send ok", {
                    accountId: account.accountId,
                    messageId,
                    chunkIdx: idx,
                  });
                }
              } else {
                await sendMessageZulip(to, chunk, {
                  accountId: account.accountId,
                  topic: resolvedTopic,
                });
                zLogger?.info?.("zulip deliver send ok", {
                  accountId: account.accountId,
                  messageId,
                  chunkIdx: idx,
                });
              }
            }
          } else {
            let first = true;
            for (const mediaUrl of mediaUrls) {
              const caption = first ? text : "";
              first = false;
            if (placeholderMessageId) {
              try {
                await editZulipMessage(client, {
                  messageId: placeholderMessageId,
                  content: caption,
                });
              } catch (err) {
                logVerboseMessage(
                  `zulip placeholder edit failed: ${String(err)}; falling back to new message`,
                );
                await sendMessageZulip(to, caption, {
                  accountId: account.accountId,
                  mediaUrl,
                  topic: resolvedTopic,
                });
              }
            } else {
              await sendMessageZulip(to, caption, {
                accountId: account.accountId,
                mediaUrl,
                topic: resolvedTopic,
              });
            }
          }
        }
        statusSink?.({ lastOutboundAt: Date.now() });
      } catch (deliverErr) {
        zLogger?.error?.("zulip deliver error", {
          accountId: account.accountId,
          messageId,
          error: String(deliverErr),
        });
      }
    },
      onError: (err: unknown) => {
        core.error?.(`zulip reply failed: ${String(err)}`);
        if (!typingStopped) {
          typingStopped = true;
          // onIdle() is synchronous (returns void) in the 2026.9.1 SDK
          typingCallbacks.onIdle?.();
        }
      },
    });

  let dispatchError: unknown;
  const dispatchStartTime = new Date().toISOString();
  const dispatchStartMs = Date.now();
  const zLogger = core.logging?.getChildLogger?.({ module: "zulip" });
  zLogger?.info?.("zulip dispatch start", {
    accountId: account.accountId,
    messageId,
    sessionKey: route?.sessionKey ?? route?.mainSessionKey,
    bodyLen: ctxPayload?.Body?.length ?? 0,
    rawBodyLen: ctxPayload?.RawBody?.length ?? 0,
  });
  try {
    await core.channel.reply.dispatchReplyFromConfig({
      ctx: ctxPayload,
      cfg,
      dispatcher,
      replyOptions: {
        ...replyOptions,
        disableBlockStreaming:
          typeof account.blockStreaming === "boolean" ? !account.blockStreaming : undefined,
        onModelSelected,
      },
    });
    const elapsedMs = Date.now() - dispatchStartMs;
    zLogger?.info?.("zulip dispatch completed", {
      accountId: account.accountId,
      messageId,
      elapsedMs,
      deliveredAny,
    });
  } catch (err) {
    dispatchError = err;
    core.error?.(
      formatZulipLog("zulip reply failed", {
        accountId: account.accountId,
        messageId,
        senderId: maskPII(senderId),
        error: String(err),
      }),
    );
  } finally {
    if (!deliveredAny && !dispatchError) {
      // Fallback path: the agent ended its turn with assistant text but
      // never invoked the messaging tool. This is a common failure mode
      // for local OSS models without strong structured-tool-call training.
      // Pull the assistantTexts off the just-flushed trajectory and send
      // them through the channel so the user gets a reply.
      const autoSend = account.autoSendOnMissingTool ?? true;
      if (autoSend) {
        try {
          const dataDir = (core as any).paths?.dataDir as string | undefined;
          const sessionKey: string | undefined = route?.sessionKey ?? route?.mainSessionKey;
          if (sessionKey && route?.agentId) {
            logVerboseMessage(
              `[zulip-fallback] triggering fallback reader startTime=${dispatchStartTime} sessionKey=${sessionKey}`,
            );
            const texts = await readLatestAssistantTexts({
              dataDir,
              agentId: route.agentId,
              sessionKey,
              startTime: dispatchStartTime,
              log: logVerboseMessage,
            });
            if (texts && texts.length > 0) {
              const text = texts.join("\n\n");
              zLogger?.info?.("zulip auto-send fallback engaged", {
                accountId: account.accountId,
                sessionKey,
                textLen: text.length,
              });
              const { text: cleanText, topic: topicOverride } =
                extractZulipTopicDirective(text);
              const resolvedTopic = topicOverride
                ? topicOverride.slice(0, 60)
                : topic;
              const truncatedText =
                maxMessageLength != null && maxMessageLength > 0
                  ? truncateText(cleanText, maxMessageLength)
                  : cleanText;
              const chunkMode = core.channel.text.resolveChunkMode(
                cfg,
                "zulip",
                account.accountId,
              );
              const chunks = core.channel.text.chunkMarkdownTextWithMode(
                truncatedText,
                textLimit,
                chunkMode,
              );
              for (const chunk of chunks.length > 0 ? chunks : [truncatedText]) {
                if (!chunk) continue;
                await sendMessageZulip(to, chunk, {
                  accountId: account.accountId,
                  topic: resolvedTopic,
                });
              }
              deliveredAny = true;
              statusSink?.({ lastOutboundAt: Date.now() });
              // UX: Signal that the reply was auto-sent via fallback
              await addReactionSafe({
                client,
                messageId,
                emojiName: "robot",
                reactionsEnabled: account.config.reactions?.enabled !== false,
                logVerbose: logVerboseMessage,
              });
            }
          }
        } catch (fbErr) {
          core.error?.(
            formatZulipLog("zulip auto-send fallback failed", {
              accountId: account.accountId,
              error: String(fbErr),
            }),
          );
        }
      }
    }
    markDispatchIdle();
  }

  return dispatchError;
}
