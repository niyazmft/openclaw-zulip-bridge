# Task for worker

In the project at /Volumes/external-hd/workspace/openclaw-zulip-bridge, I need to split `src/actions.ts` (901 lines) into multiple files.

The file is at src/actions.ts. Read it first to understand the structure.

The plan is to create these files:

### 1. `src/actions-utils.ts` - Shared helper functions
Move these functions from actions.ts:
- `resolveZulipClient`
- `splitStreamTarget`
- `parseSendTarget`
- `assertStringLength`
- `readMessageId`
- `readMessageContent`
- `readSendMessageContent`
- `resolveTopicName`
- `parseBooleanValue`
- `readBooleanParam`
- `parseStringArrayParam`
- `readStreamId`
- `readUserIdParam`
- `readUserIdOrEmailParam`
- `readRealmUpdateParams`
- `requireAdminActionsEnabled`
- `requireZulipAdmin`
- Constants: `providerId`, `MAX_STRING_LENGTH`, `SAFE_REALM_SETTINGS`, `resolvedTopicPrefixes`
- Types: `StreamTarget`, `SendTarget`

Imports needed: `resolveZulipAccount` from `./zulip/accounts.js`, client functions from `./zulip/client.js`, SDK types from `openclaw/plugin-sdk/channel-core`

### 2. `src/actions-send.ts` - Send action handler
Export a function `handleSendAction` that takes `(client, params)` and handles the "send" action.
Import `parseSendTarget`, `readSendMessageContent`, `readStringParam` from utils.
Import `sendZulipStreamMessage`, `sendZulipPrivateMessage` from client.
Return `jsonResult(...)`.

### 3. `src/actions-messages.ts` - Message actions
Export functions:
- `handleReadAction(client, params)`
- `handleEditAction(client, params)`
- `handleDeleteAction(client, params)`
- `handleReactAction(client, params)`
- `handlePinAction(client, params, action)`
- `handleSearchAction(client, params)`

Import helpers from utils and client functions.

### 4. `src/actions-admin.ts` - Admin actions
Export functions:
- `handleChannelListAction(client, params)`
- `handleChannelSubscribeAction(client, params)`
- `handleChannelCreateAction(client, params, account)`
- `handleChannelEditAction(client, params, account)`
- `handleChannelDeleteAction(client, params, account)`
- `handleMemberInfoAction(client, params)`
- `handleUserPresenceAction(client, params)`
- `handleUserDeactivateAction(client, params, account)`
- `handleUserReactivateAction(client, params, account)`
- `handleOrgSettingsAction(client, params)`
- `handleOrgSettingsEditAction(client, params, account)`
- `handleInviteAction(client, params)`
- `handleResolveTopicAction(client, params)`

Import helpers from utils and client functions.

### 5. `src/actions.ts` - Main adapter (rewrite)
Keep only:
- Import `zulipChannelMeta` from `./channel.js`
- Import `resolveZulipClient` from `./actions-utils.js`
- Import all action handlers from the new files
- The `zulipMessageActions` adapter with `describeMessageTool`, `listActions`, `extractToolSend`, and `handleAction` that routes to the appropriate handler

IMPORTANT RULES:
1. All files use ESM with `.js` extensions (NodeNext resolution)
2. Use `import type` for type-only imports
3. The `jsonResult`, `readStringParam`, `readNumberParam`, `OpenClawConfig`, `ChannelMessageActionName` types come from `openclaw/plugin-sdk/channel-core`
4. The `ChannelMessageActionAdapter` type comes from `openclaw/plugin-sdk/channel-contract`
5. Client functions come from `./zulip/client.js`
6. After creating all files, run `npm run typecheck` to verify

Do NOT change any logic - only move code between files. Each action handler should work exactly as before.

## Acceptance Contract
Acceptance level: checked
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Implement the requested change without widening scope

Required evidence: changed-files, tests-added, commands-run, residual-risks, no-staged-files

Finish with a fenced JSON block tagged `acceptance-report` in this shape:
Use empty arrays when no items apply; array fields contain strings unless object entries are shown.
`criteriaSatisfied[].status` must be exactly one of: satisfied, not-satisfied, not-applicable.
`commandsRun[].result` must be exactly one of: passed, failed, not-run.
`manualNotes` and `notes` are optional strings; an empty string means no note and does not satisfy `manual-notes` evidence.
```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "specific proof"
    }
  ],
  "changedFiles": [
    "src/file.ts"
  ],
  "testsAddedOrUpdated": [
    "test/file.test.ts"
  ],
  "commandsRun": [
    {
      "command": "command",
      "result": "passed",
      "summary": "short result"
    }
  ],
  "validationOutput": [
    "validation output or concise summary"
  ],
  "residualRisks": [
    "none"
  ],
  "noStagedFiles": true,
  "diffSummary": "short description of the diff",
  "reviewFindings": [
    "blocker: file.ts:12 - issue found, or no blockers"
  ],
  "manualNotes": "anything else the parent should know"
}
```