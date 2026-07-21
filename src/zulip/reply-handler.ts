import { createTypingCallbacks } from "openclaw/plugin-sdk/channel-reply-options-runtime";
import { logTypingFailure } from "openclaw/plugin-sdk/channel-feedback";
import { sendZulipTyping, editZulipMessage } from "./client.js";
import { sendMessageZulip } from "./send.js";
import { addReactionSafe } from "./reactions.js";
import { formatZulipLog, maskPII } from "./monitor-helpers.js";
import { extractZulipTopicDirective } from "./text-utils.js";
import { readLatestAssistantTexts } from "./fallback-reader.js";
import type { ReplyPayload } from "openclaw/plugin-sdk/reply-payload";

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
  placeholderMessageId?: string;
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
    placeholderMessageId,
  } = params;

  const typingParams = isDM
    ? { op: "start" as const, type: "direct" as const, to: [senderNumericId] }
    : streamId
      ? { op: "start" as const, type: "stream" as const, streamId: Number(streamId), topic }
      : null;

  const typingCallbacks = createTypingCallbacks({
    start: async () => {
      if (typingParams) {
        await sendZulipTyping(client, typingParams);
      }
    },
    stop: async () => {
      if (typingParams) {
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
  let placeholderConsumed = false;

  const { dispatcher, replyOptions, markDispatchIdle } =
    core.channel.reply.createReplyDispatcherWithTyping({
      ...prefixOptions,
      humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, route.agentId),
      onReplyStart: typingCallbacks.onReplyStart,
      deliver: async (payload: ReplyPayload) => {
        deliveredAny = true;
        const mediaUrls = payload.mediaUrls ?? (payload.mediaUrl ? [payload.mediaUrl] : []);
        const rawText = core.channel.text.convertMarkdownTables(payload.text ?? "", tableMode);
        const { text, topic: topicOverride } = extractZulipTopicDirective(rawText);
        const resolvedTopic = topicOverride ? topicOverride.slice(0, 60) : topic;
        if (mediaUrls.length === 0) {
          const chunkMode = core.channel.text.resolveChunkMode(cfg, "zulip", account.accountId);
          const chunks = core.channel.text.chunkMarkdownTextWithMode(text, textLimit, chunkMode);
          const nonEmptyChunks = (chunks.length > 0 ? chunks : [text]).filter(Boolean);
          for (let idx = 0; idx < nonEmptyChunks.length; idx++) {
            const chunk = nonEmptyChunks[idx];
            // UX: Edit the placeholder message for the first chunk, then send new messages for the rest.
            if (!placeholderConsumed && placeholderMessageId) {
              placeholderConsumed = true;
              try {
                await editZulipMessage(client, {
                  messageId: placeholderMessageId,
                  content: chunk,
                });
              } catch (err) {
                logVerboseMessage(
                  `zulip placeholder edit failed: ${String(err)}; falling back to new message`,
                );
                await sendMessageZulip(to, chunk, {
                  accountId: account.accountId,
                  topic: resolvedTopic,
                });
              }
            } else {
              await sendMessageZulip(to, chunk, {
                accountId: account.accountId,
                topic: resolvedTopic,
              });
            }
          }
        } else {
          let first = true;
          for (const mediaUrl of mediaUrls) {
            const caption = first ? text : "";
            first = false;
            if (!placeholderConsumed && placeholderMessageId) {
              placeholderConsumed = true;
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
      },
      onError: (err: unknown) => {
        core.error?.(`zulip reply failed: ${String(err)}`);
      },
    });

  let dispatchError: unknown;
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
            const texts = await readLatestAssistantTexts({
              dataDir,
              agentId: route.agentId,
              sessionKey,
            });
            if (texts && texts.length > 0) {
              const text = texts.join("\n\n");
              core.log?.(
                formatZulipLog("zulip auto-send fallback engaged", {
                  accountId: account.accountId,
                  sessionKey,
                  textLen: text.length,
                }),
              );
              const { text: cleanText, topic: topicOverride } =
                extractZulipTopicDirective(text);
              const resolvedTopic = topicOverride
                ? topicOverride.slice(0, 60)
                : topic;
              const chunkMode = core.channel.text.resolveChunkMode(
                cfg,
                "zulip",
                account.accountId,
              );
              const chunks = core.channel.text.chunkMarkdownTextWithMode(
                cleanText,
                textLimit,
                chunkMode,
              );
              for (const chunk of chunks.length > 0 ? chunks : [cleanText]) {
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
