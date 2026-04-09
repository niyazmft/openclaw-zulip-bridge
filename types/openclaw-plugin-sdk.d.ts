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
  export type ChannelAccountSnapshot = any;
  export type ChannelMessageActionName = any;
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
  export const defineSetupPluginEntry: any;
  export const formatPairingApproveHint: any;
  export const jsonResult: any;
  export const readNumberParam: any;
  export const readStringParam: any;
}

declare module "openclaw/plugin-sdk/irc" {
  export type ChannelPlugin<T = any> = any;
  export const logInboundDrop: any;
  export const resolveControlCommandGate: any;
  export const BlockStreamingCoalesceSchema: any;
  export const DmPolicySchema: any;
  export const GroupPolicySchema: any;
  export const MarkdownConfigSchema: any;
  export const requireOpenAllowFrom: any;
  export const buildChannelConfigSchema: any;
  export const createChannelPluginScaffold: any;
  export const defineChannelAction: any;
  export const defineChannelConfigNormalizer: any;
  export const defineChannelStatusProvider: any;
}

declare module "openclaw/plugin-sdk/channel-contract" {
  export type ChannelMessageActionAdapter = any;
}

declare module "openclaw/plugin-sdk/channel-feedback" {
  export const logTypingFailure: any;
}

declare module "openclaw/plugin-sdk/reply-history" {
  export type HistoryEntry = any;
  export const buildPendingHistoryContextFromMap: any;
  export const DEFAULT_GROUP_HISTORY_LIMIT: number;
  export const recordPendingHistoryEntryIfEnabled: any;
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

declare module "openclaw/plugin-sdk/channel-config-schema" {
  export const BlockStreamingCoalesceSchema: any;
  export const DmPolicySchema: any;
  export const GroupPolicySchema: any;
  export const MarkdownConfigSchema: any;
  export const requireOpenAllowFrom: any;
  export const buildChannelConfigSchema: any;
  export const buildCatchallMultiAccountChannelSchema: any;
  export const buildDefaultChannelConfigSchemaOptions: any;
  export const createChannelConfigSectionSchema: any;
  export const markLegacyAlias: any;
}

declare module "openclaw/plugin-sdk/zod" {
  export const z: any;
}

declare module "openclaw/plugin-sdk/setup" {
  export type ChannelSetupAdapter = any;
  export type ChannelSetupField = any;
  export type ChannelSetupFieldResolver = any;
  export type ChannelSetupFlowDefinition = any;
  export type ChannelSetupWizard = any;
  export const createPatchedAccountSetupAdapter: any;
  export const createStandardChannelSetupStatus: any;
  export const defineChannelSetupFlow: any;
  export const formatDocsLink: any;
  export const resolveSetupFieldValue: any;
}

declare module "openclaw/plugin-sdk/setup-runtime" {
  export const createSetupInputPresenceValidator: any;
}

declare module "ws" {
  class WebSocket {}

  namespace WebSocket {
    type RawData = any;
  }

  export default WebSocket;
}
