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

declare module "openclaw/plugin-sdk/channel-core" {
  export type PluginRuntime = any;
  export type OpenClawPluginApi = any;
  export type OpenClawConfig = any;
  export type OpenClawChannelPlugin = any;
  export type ChannelSetupResult = any;
  export type ChannelAccountSnapshot = any;
  export type ChannelMessageActionName = any;
  export type ChannelGroupContext = any;
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

declare module "openclaw/plugin-sdk/config-contracts" {
  export type OpenClawConfig = any;
}

declare module "openclaw/plugin-sdk/account-core" {
  export const applyAccountNameToChannelSection: any;
  export const deleteAccountFromConfigSection: any;
  export const migrateBaseNameToDefaultAccount: any;
  export const setAccountEnabledInConfigSection: any;
}

// `command-auth` was removed from the host's exports map in 2026.10.6 (it still
// exists on 2026.7.1-2026.9.x, so importing it only failed on newer hosts).
// `command-auth-native` is present across the whole supported range. See #324.
declare module "openclaw/plugin-sdk/command-auth-native" {
  export const resolveControlCommandGate: any;
}

declare module "openclaw/plugin-sdk/channel-inbound" {
  export const logInboundDrop: any;
  export const formatInboundEnvelope: any;
}

// `channel-reply-options-runtime` (2026.7.x) and `channel-reply-pipeline`
// (2026.8.x-2026.9.x) were both retired; `channel-reply-pipeline` is absent from
// the host's exports map in 2026.10.6, which made the plugin fail to load
// entirely. `channel-outbound` is present across 2026.7.1, 2026.9.1 and
// 2026.10.6, so it is the durable subpath for these two helpers. See #324.
declare module "openclaw/plugin-sdk/channel-outbound" {
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
  export function isReplyPayloadNonTerminalToolErrorWarning(
    payload: any,
  ): boolean;
}

declare module "openclaw/plugin-sdk/runtime-env" {
  export type RuntimeEnv = any;
}

declare module "openclaw/plugin-sdk/channel-config-schema" {
  export type BlockStreamingCoalesceConfig = any;
  export type DmPolicy = any;
  export type GroupPolicy = any;
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

declare module "openclaw/plugin-sdk/hook-runtime" {
  export const deriveInboundMessageHookContext: any;
  export const fireAndForgetBoundedHook: any;
  export const createInternalHookEvent: any;
  export const toInternalMessageReceivedContext: any;
  export const toPluginMessageContext: any;
  export const toPluginMessageReceivedEvent: any;
  export const triggerInternalHook: any;
}

declare module "openclaw/plugin-sdk/plugin-runtime" {
  export const getGlobalHookRunner: any;
}

declare module "openclaw/plugin-sdk/zod" {
  export const z: any;
}

declare module "ws" {
  class WebSocket {}

  namespace WebSocket {
    type RawData = any;
  }

  export default WebSocket;
}
