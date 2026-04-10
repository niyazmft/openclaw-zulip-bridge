import { createTypingCallbacks } from "openclaw/plugin-sdk/channel-runtime";
import { logTypingFailure } from "openclaw/plugin-sdk/channel-feedback";
import { sendZulipTyping } from "./client.js";
import { sendMessageZulip } from "./send.js";
import { formatZulipLog, maskPII } from "./monitor-helpers.js";
import { extractZulipTopicDirective } from "./text-utils.js";
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

  const { dispatcher, replyOptions, markDispatchIdle } =
    core.channel.reply.createReplyDispatcherWithTyping({
      ...prefixOptions,
      humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, route.agentId),
      onReplyStart: typingCallbacks.onReplyStart,
      deliver: async (payload: ReplyPayload) => {
        const mediaUrls = payload.mediaUrls ?? (payload.mediaUrl ? [payload.mediaUrl] : []);
        const rawText = core.channel.text.convertMarkdownTables(payload.text ?? "", tableMode);
        const { text, topic: topicOverride } = extractZulipTopicDirective(rawText);
        const resolvedTopic = topicOverride ? topicOverride.slice(0, 60) : topic;
        if (mediaUrls.length === 0) {
          const chunkMode = core.channel.text.resolveChunkMode(cfg, "zulip", account.accountId);
          const chunks = core.channel.text.chunkMarkdownTextWithMode(text, textLimit, chunkMode);
          for (const chunk of chunks.length > 0 ? chunks : [text]) {
            if (!chunk) {
              continue;
            }
            await sendMessageZulip(to, chunk, {
              accountId: account.accountId,
              topic: resolvedTopic,
            });
          }
        } else {
          let first = true;
          for (const mediaUrl of mediaUrls) {
            const caption = first ? text : "";
            first = false;
            await sendMessageZulip(to, caption, {
              accountId: account.accountId,
              mediaUrl,
              topic: resolvedTopic,
            });
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
    markDispatchIdle();
  }

  return dispatchError;
}
