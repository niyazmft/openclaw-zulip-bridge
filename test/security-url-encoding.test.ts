import { test, describe } from "node:test";
import assert from "node:assert";
import {
  createZulipClient,
  fetchZulipUser,
  fetchZulipStream,
  deleteZulipQueue,
  deactivateZulipUser,
  reactivateZulipUser,
  addZulipReaction,
  removeZulipReaction,
  editZulipMessage,
  deleteZulipMessage,
  updateZulipMessageTopic,
  fetchZulipUserPresence
} from "../src/zulip/client.ts";

describe("Zulip Client URL Encoding Security", () => {
  let capturedUrl = "";

  const mockClient = createZulipClient({
    baseUrl: "https://zulip.example.com",
    email: "bot@example.com",
    apiKey: "secret",
    fetchImpl: async (url) => {
      capturedUrl = url.toString();
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          result: "success",
          user: { user_id: 123 },
          stream: { stream_id: 456 },
          presence: {}
        }),
      } as any;
    }
  });

  test("fetchZulipUser should encode userId", async () => {
    const userId = "user/../me";
    await fetchZulipUser(mockClient, userId);
    assert.ok(capturedUrl.includes("/users/user%2F..%2Fme"), `URL was not encoded: ${capturedUrl}`);
  });

  test("fetchZulipStream should encode streamId", async () => {
    const streamId = "Engineering/Alerts";
    await fetchZulipStream(mockClient, streamId);
    assert.ok(capturedUrl.includes("/streams/Engineering%2FAlerts"), `URL was not encoded: ${capturedUrl}`);
  });

  test("deleteZulipQueue should encode queueId", async () => {
    const queueId = "123&other=param";
    await deleteZulipQueue(mockClient, queueId);
    assert.ok(capturedUrl.includes("queue_id=123%26other%3Dparam"), `URL was not encoded: ${capturedUrl}`);
  });

  test("deactivateZulipUser should encode userId", async () => {
    const userId = "bad/user";
    await deactivateZulipUser(mockClient, userId);
    assert.ok(capturedUrl.includes("/users/bad%2Fuser"), `URL was not encoded: ${capturedUrl}`);
  });

  test("reactivateZulipUser should encode userId", async () => {
    const userId = "bad/user";
    await reactivateZulipUser(mockClient, userId);
    assert.ok(capturedUrl.includes("/users/bad%2Fuser/reactivate"), `URL was not encoded: ${capturedUrl}`);
  });

  test("addZulipReaction should encode messageId", async () => {
    await addZulipReaction(mockClient, { messageId: "123/456", emojiName: "thumbs_up" });
    assert.ok(capturedUrl.includes("/messages/123%2F456/reactions"), `URL was not encoded: ${capturedUrl}`);
  });

  test("removeZulipReaction should encode messageId", async () => {
    await removeZulipReaction(mockClient, { messageId: "123/456", emojiName: "thumbs_up" });
    assert.ok(capturedUrl.includes("/messages/123%2F456/reactions"), `URL was not encoded: ${capturedUrl}`);
  });

  test("editZulipMessage should encode messageId", async () => {
    await editZulipMessage(mockClient, { messageId: "123/456", content: "new content" });
    assert.ok(capturedUrl.includes("/messages/123%2F456"), `URL was not encoded: ${capturedUrl}`);
  });

  test("deleteZulipMessage should encode messageId", async () => {
    await deleteZulipMessage(mockClient, { messageId: "123/456" });
    assert.ok(capturedUrl.includes("/messages/123%2F456"), `URL was not encoded: ${capturedUrl}`);
  });

  test("updateZulipMessageTopic should encode messageId", async () => {
    await updateZulipMessageTopic(mockClient, { messageId: "123/456", topic: "new topic" });
    assert.ok(capturedUrl.includes("/messages/123%2F456"), `URL was not encoded: ${capturedUrl}`);
  });

  test("fetchZulipUserPresence should encode userIdOrEmail", async () => {
    // This one is already encoded in the source, verifying it stays that way
    await fetchZulipUserPresence(mockClient, "user@example.com");
    assert.ok(capturedUrl.includes("/users/user%40example.com/presence"), `URL was not encoded: ${capturedUrl}`);
  });
});
