import type { ChannelMessageActionAdapter } from "openclaw/plugin-sdk/channel-contract";
import {
  type ChannelMessageActionName,
  readStringParam,
  jsonResult,
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
  handleChannelSubscribeAction,
  handleChannelCreateAction,
  handleChannelEditAction,
  handleChannelDeleteAction,
  handleMemberInfoAction,
  handleUserPresenceAction,
  handleUserDeactivateAction,
  handleUserReactivateAction,
  handleOrgSettingsAction,
  handleOrgSettingsEditAction,
  handleInviteAction,
  handleResolveTopicAction,
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
    // TODO: These actions require core SDK changes to MESSAGE_ACTION_TARGET_MODE.
    // Re-enable once the SDK supports plugin-registered action target modes.
    // See: https://github.com/openclaw/openclaw/issues/TBD
    // actions.add("channel-subscribe" as ChannelMessageActionName);
    // actions.add("invite" as ChannelMessageActionName);
    // actions.add("resolve-topic" as ChannelMessageActionName);
    // actions.add("user-presence" as ChannelMessageActionName);
    // actions.add("user-deactivate" as ChannelMessageActionName);
    // actions.add("user-reactivate" as ChannelMessageActionName);
    // actions.add("org-settings" as ChannelMessageActionName);
    // actions.add("org-settings-edit" as ChannelMessageActionName);
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

    if ((action as string) === "channel-subscribe") {
      return handleChannelSubscribeAction(client, params);
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

    if ((action as string) === "user-presence") {
      return handleUserPresenceAction(client, params);
    }

    if ((action as string) === "user-deactivate") {
      return handleUserDeactivateAction(client, params, account);
    }

    if ((action as string) === "user-reactivate") {
      return handleUserReactivateAction(client, params, account);
    }

    if ((action as string) === "org-settings") {
      return handleOrgSettingsAction(client, params);
    }

    if ((action as string) === "org-settings-edit") {
      return handleOrgSettingsEditAction(client, params, account);
    }

    if ((action as string) === "invite") {
      return handleInviteAction(client, params);
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

    if ((action as string) === "resolve-topic") {
      return handleResolveTopicAction(client, params);
    }

    if (action === "search") {
      return handleSearchAction(client, params);
    }

    throw new Error(`Action ${action} is not supported for provider ${providerId}.`);
  },
};
