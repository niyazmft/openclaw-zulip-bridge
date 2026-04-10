import {
  applyAccountNameToChannelSection,
  DEFAULT_ACCOUNT_ID,
  deleteAccountFromConfigSection,
  migrateBaseNameToDefaultAccount,
  normalizeAccountId,
  setAccountEnabledInConfigSection,
  createChatChannelPlugin,
  formatPairingApproveHint,
  type ChannelAccountSnapshot,
} from "openclaw/plugin-sdk/core";
import type { ZulipConfig } from "./types.js";
import { zulipMessageActions } from "./actions.js";
import { ZulipChannelConfigSchema } from "./config-schema.js";
import { resolveZulipGroupRequireMention } from "./group-mentions.js";
import { looksLikeZulipTargetId, normalizeZulipMessagingTarget } from "./normalize.js";
import { getZulipRuntime } from "./runtime.js";
import { zulipSetupAdapter } from "./setup-core.js";
import { zulipSetupWizard } from "./setup-surface.js";
import {
  listZulipAccountIds,
  resolveDefaultZulipAccountId,
  resolveZulipAccount,
  type ResolvedZulipAccount,
} from "./zulip/accounts.js";
import { normalizeZulipBaseUrl } from "./zulip/client.js";
import { maskPII, formatZulipLog } from "./zulip/monitor-helpers.js";
import { monitorZulipProvider } from "./zulip/monitor.js";
import { probeZulip } from "./zulip/probe.js";
import { sendMessageZulip } from "./zulip/send.js";

const meta = {
  id: "zulip",
  label: "Zulip",
  selectionLabel: "Zulip (plugin)",
  detailLabel: "Zulip Bot",
  docsPath: "/channels/zulip",
  docsLabel: "zulip",
  blurb: "self-hosted Slack-style chat; install the plugin to enable.",
  systemImage: "bubble.left.and.bubble.right",
  order: 65,
  quickstartAllowFrom: true,
} as const;

function normalizeAllowEntry(entry: string): string {
  return entry
    .trim()
    .replace(/^(zulip|user):/i, "")
    .replace(/^@/, "")
    .toLowerCase();
}

function formatAllowEntry(entry: string): string {
  const trimmed = entry.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("@")) {
    const username = trimmed.slice(1).trim();
    return username ? `@${username.toLowerCase()}` : "";
  }
  return trimmed.replace(/^(zulip|user):/i, "").toLowerCase();
}

export const zulipPlugin = createChatChannelPlugin<ResolvedZulipAccount>({
  base: {
    id: "zulip",
    meta: {
      ...meta,
    },
    setup: zulipSetupAdapter,
    setupWizard: zulipSetupWizard,
    capabilities: {
      chatTypes: ["direct", "channel", "group", "thread"],
      threads: true,
      media: true,
    },
    streaming: {
      blockStreamingCoalesceDefaults: { minChars: 1500, idleMs: 1000 },
    },
    reload: { configPrefixes: ["channels.zulip"] },
    configSchema: ZulipChannelConfigSchema,
    config: {
      listAccountIds: (cfg) => listZulipAccountIds(cfg),
      resolveAccount: (cfg, accountId) => resolveZulipAccount({ cfg, accountId }),
      defaultAccountId: (cfg) => resolveDefaultZulipAccountId(cfg),
      setAccountEnabled: ({ cfg, accountId, enabled }) =>
        setAccountEnabledInConfigSection({
          cfg,
          sectionKey: "zulip",
          accountId,
          enabled,
          allowTopLevel: true,
        }),
      deleteAccount: ({ cfg, accountId }) =>
        deleteAccountFromConfigSection({
          cfg,
          sectionKey: "zulip",
          accountId,
          clearBaseFields: ["apiKey", "email", "url", "name"] as const,
        }),
      isConfigured: (account) => Boolean(account.apiKey && account.email && account.baseUrl),
      describeAccount: (account) => ({
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: Boolean(account.apiKey && account.email && account.baseUrl),
        apiKeySource: account.apiKeySource,
        emailSource: account.emailSource,
        baseUrl: account.baseUrl,
      }),
      resolveAllowFrom: ({ cfg, accountId }) =>
        (resolveZulipAccount({ cfg, accountId }).config.allowFrom ?? []).map((entry) =>
          String(entry),
        ),
      formatAllowFrom: ({ allowFrom }) =>
        allowFrom.map((entry) => formatAllowEntry(String(entry))).filter(Boolean),
    },
    groups: {
      resolveRequireMention: resolveZulipGroupRequireMention,
    },
    actions: zulipMessageActions,
    messaging: {
      normalizeTarget: normalizeZulipMessagingTarget,
      targetResolver: {
        looksLikeId: looksLikeZulipTargetId,
        hint: "<stream:NAME[:topic]|user:email|#stream[:topic]|@email>",
      },
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      connected: false,
      lastConnectedAt: null,
      lastDisconnect: null,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    buildChannelSummary: ({ snapshot }) => {
      const zulipSnapshot = snapshot as ChannelAccountSnapshot & {
        apiKeySource?: string;
        emailSource?: string;
        baseUrl?: string | null;
      };
      return {
        configured: zulipSnapshot.configured ?? false,
        apiKeySource: zulipSnapshot.apiKeySource ?? "none",
        emailSource: zulipSnapshot.emailSource ?? "none",
        running: zulipSnapshot.running ?? false,
        connected: zulipSnapshot.connected ?? false,
        lastStartAt: zulipSnapshot.lastStartAt ?? null,
        lastStopAt: zulipSnapshot.lastStopAt ?? null,
        lastError: zulipSnapshot.lastError ?? null,
        baseUrl: zulipSnapshot.baseUrl ?? null,
        probe: zulipSnapshot.probe,
        lastProbeAt: zulipSnapshot.lastProbeAt ?? null,
      };
    },
    probeAccount: async ({ account, timeoutMs }) => {
      const apiKey = account.apiKey?.trim();
      const email = account.email?.trim();
      const baseUrl = account.baseUrl?.trim();
      if (!apiKey || !email || !baseUrl) {
        return { ok: false, error: "apiKey, email, or url missing" };
      }
      return await probeZulip(baseUrl, email, apiKey, timeoutMs);
    },
    buildAccountSnapshot: ({ account, runtime, probe }) => {
      const snapshot: ChannelAccountSnapshot = {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: Boolean(account.apiKey && account.email && account.baseUrl),
        apiKeySource: account.apiKeySource,
        emailSource: account.emailSource,
        baseUrl: account.baseUrl,
        running: runtime?.running ?? false,
        connected: runtime?.connected ?? false,
        lastConnectedAt: runtime?.lastConnectedAt ?? null,
        lastDisconnect: runtime?.lastDisconnect ?? null,
        lastStartAt: runtime?.lastStartAt ?? null,
        lastStopAt: runtime?.lastStopAt ?? null,
        lastError: runtime?.lastError ?? null,
        probe: probe
          ? {
              ...probe,
              email: probe.email ? maskPII(probe.email) : undefined,
            }
          : undefined,
        lastInboundAt: runtime?.lastInboundAt ?? null,
        lastOutboundAt: runtime?.lastOutboundAt ?? null,
      };
      return snapshot;
    },
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      ctx.setStatus({
        accountId: account.accountId,
        baseUrl: account.baseUrl,
        apiKeySource: account.apiKeySource,
        emailSource: account.emailSource,
      } as ChannelAccountSnapshot);
      ctx.log?.info(formatZulipLog("zulip channel starting", { accountId: account.accountId }));
      try {
        await monitorZulipProvider({
          apiKey: account.apiKey ?? undefined,
          email: account.email ?? undefined,
          baseUrl: account.baseUrl ?? undefined,
          accountId: account.accountId,
          config: ctx.cfg,
          runtime: ctx.runtime,
          abortSignal: ctx.abortSignal,
          statusSink: (patch) => ctx.setStatus({ accountId: ctx.accountId, ...patch }),
        });
        ctx.log?.info(
          formatZulipLog("zulip channel monitor finished normally", {
            accountId: account.accountId,
          }),
        );
      } catch (err) {
        ctx.log?.error(
          formatZulipLog("zulip channel monitor failed", {
            accountId: account.accountId,
            error: String(err),
          }),
        );
        throw err;
      }
    },
  },
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      const zulipSection = cfg.channels?.zulip as ZulipConfig | undefined;
      const useAccountPath = Boolean(zulipSection?.accounts?.[resolvedAccountId]);
      const basePath = useAccountPath
        ? `channels.zulip.accounts.${resolvedAccountId}.`
        : "channels.zulip.";
      return {
        policy: account.config.dmPolicy ?? "pairing",
        allowFrom: account.config.allowFrom ?? [],
        policyPath: `${basePath}dmPolicy`,
        allowFromPath: basePath,
        approveHint: formatPairingApproveHint("zulip"),
        normalizeEntry: (raw) => normalizeAllowEntry(raw),
      };
    },
    collectWarnings: ({ account, cfg }) => {
      const defaultGroupPolicy = cfg.channels?.defaults?.groupPolicy;
      const groupPolicy = account.config.groupPolicy ?? defaultGroupPolicy ?? "allowlist";
      if (groupPolicy !== "open") {
        return [];
      }
      return [
        `- Zulip streams: groupPolicy="open" allows any member to trigger (mention-gated). Set channels.zulip.groupPolicy="allowlist" + channels.zulip.groupAllowFrom to restrict senders.`,
      ];
    },
  },
  pairing: {
    idLabel: "zulipUserId",
    normalizeAllowEntry: (entry) => normalizeAllowEntry(entry),
    notifyApproval: async ({ id, env }) => {
      env.logger.info(`[zulip] User ${maskPII(id)} approved for pairing`);
    },
  },
  outbound: {
    deliveryMode: "direct",
    chunker: (text, limit) => getZulipRuntime().channel.text.chunkMarkdownText(text, limit),
    chunkerMode: "markdown",
    textChunkLimit: 4000,
    resolveTarget: ({ to }) => {
      const trimmed = to?.trim();
      if (!trimmed) {
        return {
          ok: false,
          error: new Error(
            "Delivering to Zulip requires --to <stream:NAME[:topic]|user:email|#stream[:topic]|@email>",
          ),
        };
      }
      return { ok: true, to: trimmed };
    },
    sendText: async ({ to, text, accountId }) => {
      const result = await sendMessageZulip(to, text, {
        accountId: accountId ?? undefined,
      });
      return { channel: "zulip", ...result };
    },
    sendMedia: async ({ to, text, mediaUrl, accountId }) => {
      const result = await sendMessageZulip(to, text, {
        accountId: accountId ?? undefined,
        mediaUrl,
      });
      return { channel: "zulip", ...result };
    },
  },
  threading: {},
});
