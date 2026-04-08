---
type: task
task_id: "1-2"
gh_issue: "https://github.com/niyazmft/openclaw-zulip-bridge/issues/42"
status: ✅ Done
priority: 🔴 High
effort: 2
due_date: 2026-04-06
phase: "Phase 1"
parent: "[[Phase-1]]"
assignee: "Developer"
created: 2026-03-30
project: "Zulip"
tags:
  - task
  - phase-1
  - security
---

# Remove API Key from Status Snapshots

## 👤 User Story

> As a Security Engineer, I want to ensure that bot API keys are never exposed in status snapshots or logs so that credentials remain protected even if snapshots are leaked.

## 🎯 Objective

Address the high-severity finding where the Zulip API key is exposed in account snapshots and aliased to a `token` field.

## ✅ Acceptance Criteria

- [ ] Remove `token: account.apiKey` from `buildAccountSnapshot` in `src/channel.ts`.
- [ ] Remove `token: apiKey` alias from the return object in `resolveZulipAccount` within `src/zulip/accounts.ts`.
- [ ] Remove `token` and `tokenSource` from the `ResolvedZulipAccount` type definition if no longer used.
- [ ] Ensure `configured: true/false` and `apiKeySource` are still exposed to indicate setup status without revealing the secret.
- [ ] Verify that OpenClaw status displays still show whether the channel is "configured" without showing the key.

## 🛠 Technical Implementation Notes

- **Files to Modify:** `src/channel.ts`, `src/zulip/accounts.ts`
- **Key Symbols:** `buildAccountSnapshot`, `resolveZulipAccount`, `ResolvedZulipAccount`

## 🧪 Verification Plan

1. Run the bot and inspect the account snapshot (e.g., via a status command if available in OpenClaw).
2. Confirm the `token` field is absent or does not contain the raw API key.

## 🔗 References

- [GitHub Issue #42](https://github.com/niyazmft/openclaw-zulip-bridge/issues/42)
- [Developer Audit Report] Finding #1
