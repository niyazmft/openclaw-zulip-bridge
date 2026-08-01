import { jsonResult, readStringParam } from "openclaw/plugin-sdk/channel-core";
import { parseSendTarget, readSendMessageContent } from "./actions-utils.js";
import { sendZulipStreamMessage, sendZulipPrivateMessage } from "./zulip/client.js";
import type { ZulipClient } from "./zulip/client.js";

export async function handleSendAction(
  client: ZulipClient,
  params: Record<string, unknown>,
) {
  const to = readStringParam(params, "to", { required: true });
  const content = readSendMessageContent(params);
  const target = parseSendTarget(to);

  if (target.kind === "stream") {
    const result = await sendZulipStreamMessage(client, {
      stream: target.stream,
      topic: target.topic,
      content,
    });
    return jsonResult({ success: true, messageId: result.id });
  }

  const result = await sendZulipPrivateMessage(client, {
    to: [target.email],
    content,
  });
  return jsonResult({ success: true, messageId: result.id });
}
