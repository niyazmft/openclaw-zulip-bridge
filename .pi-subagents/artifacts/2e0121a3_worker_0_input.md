# Task for worker

In the project at /Volumes/external-hd/workspace/openclaw-zulip-bridge, I need to migrate `core.log` calls to the proper logger in `src/zulip/monitor.ts`.

The file is at src/zulip/monitor.ts (868 lines). There are 15 `core.log` calls that need to be replaced with `core.logging?.getChildLogger`.

The pattern to follow:
- A `logger` variable already exists at line 81-82: `const logger = core.logging?.getChildLogger ? core.logging.getChildLogger({ module: "zulip" }) : null;`
- A `logVerboseMessage` function already exists at line 84
- Replace `core.log?.(formatZulipLog("...", {...}))` with `logger?.info?.("...", {...})` using the same data object
- Replace `core.error?.(formatZulipLog("...", {...}))` with `logger?.error?.("...", {...})`

Example:
```typescript
// OLD:
core.log?.(formatZulipLog("zulip monitor starting", { accountId: opts.accountId }));
// NEW:
logger?.info?.("zulip monitor starting", { accountId: opts.accountId });
```

IMPORTANT: Do NOT change the `core.log` calls that are inside the `logInboundDrop` callback at line 375-382. That one uses `core.log` as a function parameter passed to `logInboundDrop`, not as a direct call.

Also, the `formatZulipLog` import is used in many places beyond just `core.log` calls (e.g., `core.error`, `logVerboseMessage`). Do NOT remove the import.

Read the file first, find all 15 `core.log` calls, and replace them. Then verify with `npm run typecheck`.

## Acceptance Contract
Acceptance level: checked
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Implement the requested change without widening scope
- criterion-2: Return evidence sufficient for an independent acceptance review

Required evidence: changed-files, tests-added, commands-run, residual-risks, no-staged-files

Review gate: required by reviewer.

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
    },
    {
      "id": "criterion-2",
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