import type { ChannelGroupContext } from "openclaw/plugin-sdk";
import { resolveZulipAccount } from "./zulip/accounts.js";

export function resolveZulipGroupRequireMention(params: ChannelGroupContext): boolean | undefined {
  const account = resolveZulipAccount({
    cfg: params.cfg,
    accountId: params.accountId,
  });
  return account.requireMention;
}
