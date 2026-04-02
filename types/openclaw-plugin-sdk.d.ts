declare module "openclaw/plugin-sdk" {
  export type PluginRuntime = any;
  export type OpenClawConfig = any;
  export type ChannelTarget = any;
  export type ChannelTargetParseResult = any;
  export type ChannelGroupContext = any;
  export type WizardPrompter = any;
  export type ChannelOnboardingAdapter = any;
  export type BlockStreamingCoalesceConfig = any;
  export type DmPolicy = any;
  export type GroupPolicy = any;
  export const DEFAULT_ACCOUNT_ID: string;
  export const normalizeAccountId: any;
  export const defineChannelTargetParser: any;
  export const defineOnboardingProvider: any;
  export const defineOnboardingStepResolver: any;
}

declare module "openclaw/plugin-sdk/core" {
  export type OpenClawPluginApi = any;
  export type OpenClawConfig = any;
  export type OpenClawChannelPlugin = any;
  export type ChannelSetupResult = any;
  export const DEFAULT_ACCOUNT_ID: string;
  export const normalizeAccountId: any;
  export const getChatChannelMeta: any;
  export const applyAccountNameToChannelSection: any;
  export const deleteAccountFromConfigSection: any;
  export const migrateBaseNameToDefaultAccount: any;
  export const setAccountEnabledInConfigSection: any;
  export const emptyPluginConfigSchema: any;
  export const createChatChannelPlugin: <T = any>(params: any) => any;
  export const defineChannelPluginEntry: any;
  export const definePluginEntry: any;
}

declare module "openclaw/plugin-sdk/irc" {
  export type ChannelAccountSnapshot = any;
  export type ChannelPlugin<T = any> = any;
  export type ChannelMessageActionAdapter = any;
  export type ChannelMessageActionName = any;
  export type HistoryEntry = any;
  export const logInboundDrop: any;
  export const logTypingFailure: any;
  export const buildPendingHistoryContextFromMap: any;
  export const DEFAULT_GROUP_HISTORY_LIMIT: number;
  export const recordPendingHistoryEntryIfEnabled: any;
  export const resolveControlCommandGate: any;
  export const BlockStreamingCoalesceSchema: any;
  export const DmPolicySchema: any;
  export const GroupPolicySchema: any;
  export const MarkdownConfigSchema: any;
  export const requireOpenAllowFrom: any;
  export const buildChannelConfigSchema: any;
  export const formatPairingApproveHint: any;
  export const jsonResult: any;
  export const readNumberParam: any;
  export const readStringParam: any;
  export const createChannelPluginScaffold: any;
  export const defineChannelAction: any;
  export const defineChannelConfigNormalizer: any;
  export const defineChannelStatusProvider: any;
}

declare module "openclaw/plugin-sdk/channel-runtime" {
  export const createReplyPrefixOptions: any;
  export const createTypingCallbacks: any;
}

declare module "openclaw/plugin-sdk/media-runtime" {
  export const resolveChannelMediaMaxBytes: any;
}

declare module "openclaw/plugin-sdk/reply-payload" {
  export type ReplyPayload = any;
}

declare module "openclaw/plugin-sdk/runtime-env" {
  export type RuntimeEnv = any;
}
