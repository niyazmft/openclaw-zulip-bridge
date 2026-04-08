import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/core";
import type { ZulipAccountConfig, ZulipChatMode, ZulipConfig } from "../types.js";
import { normalizeZulipBaseUrl } from "./client.js";

export type ZulipTokenSource = "env" | "config" | "none";
export type ZulipEmailSource = "env" | "config" | "none";
export type ZulipBaseUrlSource = "env" | "config" | "none";

export type ResolvedZulipAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  apiKey?: string;
  email?: string;
  baseUrl?: string;
  apiKeySource: ZulipTokenSource;
  emailSource: ZulipEmailSource;
  baseUrlSource: ZulipBaseUrlSource;
  config: ZulipAccountConfig;
  enableAdminActions?: boolean;
  chatmode?: ZulipChatMode;
  oncharPrefixes?: string[];
  requireMention?: boolean;
  textChunkLimit?: number;
  blockStreaming?: boolean;
  blockStreamingCoalesce?: ZulipAccountConfig["blockStreamingCoalesce"];
  streaming?: boolean;
  streams?: string[];
};

function resolveZulipSection(cfg: OpenClawConfig): ZulipConfig | undefined {
  return cfg.channels?.zulip as ZulipConfig | undefined;
}

function listConfiguredAccountIds(cfg: OpenClawConfig): string[] {
  const accounts = resolveZulipSection(cfg)?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return [];
  }
  return Object.keys(accounts).filter(Boolean);
}

export function listZulipAccountIds(cfg: OpenClawConfig): string[] {
  const ids = listConfiguredAccountIds(cfg);
  if (ids.length === 0) {
    return [DEFAULT_ACCOUNT_ID];
  }
  return ids.toSorted((a, b) => a.localeCompare(b));
}

export function resolveDefaultZulipAccountId(cfg: OpenClawConfig): string {
  const ids = listZulipAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) {
    return DEFAULT_ACCOUNT_ID;
  }
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

function resolveAccountConfig(
  cfg: OpenClawConfig,
  accountId: string,
): ZulipAccountConfig | undefined {
  const accounts = resolveZulipSection(cfg)?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return undefined;
  }
  return accounts[accountId] as ZulipAccountConfig | undefined;
}

function resolveZulipRequireMention(config: ZulipAccountConfig): boolean | undefined {
  if (config.chatmode === "oncall") {
    return true;
  }
  if (config.chatmode === "onmessage") {
    return false;
  }
  if (config.chatmode === "onchar") {
    return true;
  }
  return config.requireMention;
}

export function getZulipEnvSecret(name: string): string | undefined {
  return process.env[name]?.trim();
}

export function hasZulipEnvSecrets(): boolean {
  return (
    Boolean(getZulipEnvSecret("ZULIP_API_KEY")) &&
    Boolean(getZulipEnvSecret("ZULIP_EMAIL")) &&
    Boolean(getZulipEnvSecret("ZULIP_URL"))
  );
}

export function resolveZulipAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedZulipAccount {
  const accountId = normalizeAccountId(params.accountId);
  const zulipSection = resolveZulipSection(params.cfg);
  const baseEnabled = zulipSection?.enabled !== false;
  const { accounts: _ignored, ...baseConfig } = (zulipSection ?? {}) as ZulipConfig;
  const accountConfig = resolveAccountConfig(params.cfg, accountId) ?? {};
  const merged = { ...baseConfig, ...accountConfig };
  const accountEnabled = merged.enabled !== false;
  const enabled = baseEnabled && accountEnabled;

  const allowEnv = accountId === DEFAULT_ACCOUNT_ID;
  const envApiKey = allowEnv ? getZulipEnvSecret("ZULIP_API_KEY") : undefined;
  const envEmail = allowEnv ? getZulipEnvSecret("ZULIP_EMAIL") : undefined;
  const envUrl = allowEnv ? getZulipEnvSecret("ZULIP_URL") : undefined;
  const envSite = allowEnv ? getZulipEnvSecret("ZULIP_SITE") : undefined;
  const envRealm = allowEnv ? getZulipEnvSecret("ZULIP_REALM") : undefined;
  const configApiKey = merged.apiKey?.trim();
  const configEmail = merged.email?.trim();
  const configUrl =
    accountConfig.url ??
    accountConfig.site ??
    accountConfig.realm ??
    baseConfig.url ??
    baseConfig.site ??
    baseConfig.realm;
  const configUrlTrimmed = configUrl?.trim();

  let apiKey: string | undefined;
  let email: string | undefined;
  let baseUrl: string | undefined;
  let apiKeySource: ZulipTokenSource = "none";
  let emailSource: ZulipEmailSource = "none";
  let baseUrlSource: ZulipBaseUrlSource = "none";

  const envUrlAny = envUrl || envSite || envRealm;

  if (allowEnv) {
    // Default account: Env-first, then config.
    apiKey = envApiKey || configApiKey;
    email = envEmail || configEmail;
    baseUrl = normalizeZulipBaseUrl(envUrlAny || configUrlTrimmed);

    apiKeySource = envApiKey ? "env" : configApiKey ? "config" : "none";
    emailSource = envEmail ? "env" : configEmail ? "config" : "none";
    baseUrlSource = envUrlAny ? "env" : configUrlTrimmed ? "config" : "none";
  } else {
    // Non-default accounts: Config-only. No magic env discovery.
    apiKey = configApiKey;
    email = configEmail;
    baseUrl = normalizeZulipBaseUrl(configUrlTrimmed);

    apiKeySource = configApiKey ? "config" : "none";
    emailSource = configEmail ? "config" : "none";
    baseUrlSource = configUrlTrimmed ? "config" : "none";
  }

  const requireMention = resolveZulipRequireMention(merged);

  return {
    accountId,
    enabled,
    name: merged.name?.trim() || undefined,
    apiKey,
    email,
    baseUrl,
    apiKeySource,
    emailSource,
    baseUrlSource,
    config: merged,
    enableAdminActions: merged.enableAdminActions,
    chatmode: merged.chatmode,
    oncharPrefixes: merged.oncharPrefixes,
    requireMention,
    textChunkLimit: merged.textChunkLimit,
    blockStreaming: merged.blockStreaming,
    blockStreamingCoalesce: merged.blockStreamingCoalesce,
    streaming: merged.streaming,
    streams: merged.streams,
  };
}

export function listEnabledZulipAccounts(cfg: OpenClawConfig): ResolvedZulipAccount[] {
  return listZulipAccountIds(cfg)
    .map((accountId) => resolveZulipAccount({ cfg, accountId }))
    .filter((account) => account.enabled);
}
