import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import { getZulipRuntime } from "../runtime.js";
import { resolveZulipAccount } from "./accounts.js";
import {
  createZulipClient,
  fetchZulipMe,
  normalizeZulipBaseUrl,
} from "./client.js";
import { formatZulipLog, maskPII } from "./monitor-helpers.js";
import type { MonitorZulipOpts } from "./monitor.js";

/**
 * Resolves the runtime environment for the Zulip monitor.
 */
export function resolveRuntime(opts: MonitorZulipOpts): RuntimeEnv {
  return (
    opts.runtime ?? {
      log: console.log,
      error: console.error,
      exit: (code: number): never => {
        throw new Error(`exit ${code}`);
      },
    }
  );
}

/**
 * Initializes the Zulip monitor by resolving the account, creating a client,
 * and fetching bot information.
 */
export async function initializeZulipMonitor(params: {
  opts: MonitorZulipOpts;
  core: ReturnType<typeof getZulipRuntime>;
}) {
  const { opts, core } = params;
  const cfg = opts.config ?? core.config.loadConfig();
  const runtime = resolveRuntime(opts);
  const account = resolveZulipAccount({
    cfg,
    accountId: opts.accountId,
  });

  const apiKey = opts.apiKey?.trim() || account.apiKey?.trim();
  const email = opts.email?.trim() || account.email?.trim();
  if (!apiKey || !email) {
    throw new Error(
      `Zulip apiKey/email missing for account "${account.accountId}" (set channels.zulip.accounts.${account.accountId}.apiKey/email or ZULIP_API_KEY/ZULIP_EMAIL for default).`,
    );
  }
  const baseUrl = normalizeZulipBaseUrl(opts.baseUrl ?? account.baseUrl);
  if (!baseUrl) {
    throw new Error(
      `Zulip url missing for account "${account.accountId}" (set channels.zulip.accounts.${account.accountId}.url or ZULIP_URL for default).`,
    );
  }

  const client = createZulipClient({ baseUrl, email, apiKey });
  const botUser = await fetchZulipMe(client);
  const botUserId = botUser.id;
  const botEmail = botUser.email ?? "";
  const botUsername = botUser.full_name ?? "";

  core.log?.(
    formatZulipLog("zulip connected", {
      accountId: account.accountId,
      botUsername,
      botUserId,
      botEmail: maskPII(botEmail),
    }),
  );

  if (account.enableAdminActions) {
    core.log?.(
      formatZulipLog("zulip admin actions enabled", {
        accountId: account.accountId,
      }),
    );
  }

  return {
    cfg,
    runtime,
    account,
    client,
    botUser,
    botUserId,
    botEmail,
    botUsername,
    baseUrl,
  };
}
