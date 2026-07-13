export const DEFAULT_ACCOUNT_ID = 'default';

export function normalizeAccountId(value) {
  if (typeof value !== 'string') {
    return DEFAULT_ACCOUNT_ID;
  }
  const trimmed = value.trim();
  return trimmed || DEFAULT_ACCOUNT_ID;
}

export function jsonResult(payload) {
  return payload;
}

export function readNumberParam() {
  return undefined;
}

export function readStringParam() {
  return undefined;
}

const noOp = () => undefined;

export const emptyPluginConfigSchema = () => ({});
export const definePluginEntry = (entry) => entry;
export const defineSetupPluginEntry = (entry) => entry;
export const defineChannelPluginEntry = (entry) => entry;
export const createChatChannelPlugin = (entry) => entry;
export const defineChannelTargetParser = (parser) => parser;
export const defineOnboardingProvider = (provider) => provider;
export const defineOnboardingStepResolver = (resolver) => resolver;
export const getChatChannelMeta = () => ({ accountId: DEFAULT_ACCOUNT_ID });
export const applyAccountNameToChannelSection = noOp;
export const deleteAccountFromConfigSection = noOp;
export const migrateBaseNameToDefaultAccount = noOp;
export const setAccountEnabledInConfigSection = noOp;

export const logInboundDrop = noOp;
export const logTypingFailure = noOp;
export const buildPendingHistoryContextFromMap = () => [];
export const DEFAULT_GROUP_HISTORY_LIMIT = 20;
export const recordPendingHistoryEntryIfEnabled = noOp;
export const resolveControlCommandGate = () => ({ allow: true });
export const requireOpenAllowFrom = noOp;
export const buildChannelConfigSchema = () => zodMock;
export const buildCatchallMultiAccountChannelSchema = () => zodMock;
export const buildDefaultChannelConfigSchemaOptions = () => ({});
export const createChannelConfigSectionSchema = () => zodMock;
export const markLegacyAlias = (v) => v;

export const createReplyPrefixOptions = () => ({});
export const createTypingCallbacks = () => ({ onStart: noOp, onStop: noOp });
export const resolveChannelMediaMaxBytes = () => 5 * 1024 * 1024;

export const createPatchedAccountSetupAdapter = (adapter) => adapter;
export const defineChannelSetupFlow = (flow) => flow;
export const resolveSetupFieldValue = () => undefined;
export const createSetupInputPresenceValidator = () => () => true;
export const createStandardChannelSetupStatus = () => ({ ok: true });
export const formatDocsLink = (label, url) => `${label}: ${url}`;
export const formatPairingApproveHint = () => '';

const zodMock = new Proxy(
  () => zodMock,
  {
    get: () => zodMock,
  },
);

export const z = zodMock;
export const MarkdownConfigSchema = zodMock;
export const DmPolicySchema = zodMock;
export const GroupPolicySchema = zodMock;
export const BlockStreamingCoalesceSchema = zodMock;
