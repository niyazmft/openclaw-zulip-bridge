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

declare module "openclaw/plugin-sdk/channel-core" {
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
  export const createChannelPluginBase: any;
  export const defineChannelPluginEntry: any;
  export const definePluginEntry: any;
  export const defineSetupPluginEntry: any;
  export const formatPairingApproveHint: any;
  export const jsonResult: any;
  export const readNumberParam: any;
  export const readStringParam: any;
}

declare module "openclaw/plugin-sdk/config-types" {
  export type OpenClawConfig = any;
}

declare module "openclaw/plugin-sdk/account-core" {
  export const applyAccountNameToChannelSection: any;
  export const deleteAccountFromConfigSection: any;
  export const migrateBaseNameToDefaultAccount: any;
  export const setAccountEnabledInConfigSection: any;
}

declare module "openclaw/plugin-sdk/command-auth" {
  export const resolveControlCommandGate: any;
}

declare module "openclaw/plugin-sdk/channel-inbound" {
  export const logInboundDrop: any;
}

declare module "openclaw/plugin-sdk/channel-reply-options-runtime" {
  export const createReplyPrefixOptions: any;
  export const createTypingCallbacks: any;
}

declare module "openclaw/plugin-sdk/channel-contract" {
  export type ChannelMessageActionAdapter = any;
}

declare module "openclaw/plugin-sdk/channel-feedback" {
  export const logTypingFailure: any;
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
