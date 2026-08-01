import type { ChannelMessageActionAdapter } from "openclaw/plugin-sdk/channel-contract";
import {
  type ChannelMessageActionName,
} from "openclaw/plugin-sdk/channel-core";
import { resolveZulipAccount } from "./zulip/accounts.js";
import { zulipChannelMeta } from "./channel.js";
import { resolveZulipClient, providerId } from "./actions-utils.js";
import { handleSendAction } from "./actions-send.js";
import {
  handleReadAction,
  handleEditAction,
  handleDeleteAction,
  handleReactAction,
  handlePinAction,
  handleSearchAction,
} from "./actions-messages.js";
import {
  handleChannelListAction,
  handleChannelCreateAction,
  handleChannelEditAction,
  handleChannelDeleteAction,
  handleMemberInfoAction,
} from "./actions-admin.js";

export const zulipMessageActions: ChannelMessageActionAdapter = {
  describeMessageTool: () => {
    return zulipChannelMeta;
  },
  listActions: ({ cfg }) => {
    const accounts = [resolveZulipAccount({ cfg })].filter((account) =>
      Boolean(account.apiKey && account.email && account.baseUrl),
    );
    if (accounts.length === 0) {
      return [];
    }
    const actions = new Set<ChannelMessageActionName>([
      "send",
      "read",
      "channel-list",
      "channel-create",
      "channel-edit",
      "channel-delete",
      "react",
      "edit",
      "delete",
      "search",
      "member-info",
      "pin",
      "unpin",
    ]);
    return Array.from(actions);
  },
  extractToolSend: ({ args }) => {
    const action = typeof args.action === "string" ? args.action.trim() : "";
    if (action !== "send") {
      return null;
    }
    const to = typeof args.to === "string" ? args.to : undefined;
    if (!to) {
      return null;
    }
    const accountId = typeof args.accountId === "string" ? args.accountId.trim() : undefined;
    return { to, accountId };
  },
  handleAction: async ({ action, params, cfg, accountId }) => {
    const { client, account } = resolveZulipClient(cfg, accountId ?? undefined);

    if (action === "send") {
      return handleSendAction(client, params);
    }

    if (action === "channel-list") {
      return handleChannelListAction(client, params);
    }

    if (action === "channel-create") {
      return handleChannelCreateAction(client, params, account);
    }

    if (action === "channel-edit") {
      return handleChannelEditAction(client, params, account);
    }

    if (action === "channel-delete") {
      return handleChannelDeleteAction(client, params, account);
    }

    if (action === "member-info") {
      return handleMemberInfoAction(client, params);
    }

    if (action === "read") {
      return handleReadAction(client, params);
    }

    if (action === "react") {
      return handleReactAction(client, params);
    }

    if (action === "edit") {
      return handleEditAction(client, params);
    }

    if (action === "delete") {
      return handleDeleteAction(client, params);
    }

    if (action === "pin" || action === "unpin") {
      return handlePinAction(client, params, action);
    }

    if (action === "search") {
      return handleSearchAction(client, params);
    }

    throw new Error(`Action ${action} is not supported for provider ${providerId}.`);
  },
};
