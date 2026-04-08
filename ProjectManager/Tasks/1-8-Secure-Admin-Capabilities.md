---
type: task
task_id: "1-8"
gh_issue: "https://github.com/niyazmft/openclaw-zulip-bridge/issues/48"
status: ⏳ Pending
priority: 🟡 Medium
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
  - documentation
---

# Secure and Document Administrative Capabilities

## 👤 User Story

> As a Developer, I want administrative capabilities to be explicitly opt-in and well-documented so that users are aware of the risks before enabling them.

## 🎯 Objective

Address the ClawHub audit note regarding administrative actions (e.g., deactivating users) by ensuring they are disabled by default and their presence is transparent.

## ✅ Acceptance Criteria

- [ ] Ensure `enableAdminActions` defaults to `false` in the configuration schema and runtime logic.
- [ ] Add explicit warnings in `docs/config.md` about the high-privilege nature of administrative actions.
- [ ] Log a high-visibility warning at startup if `enableAdminActions` is set to `true`.
- [ ] Verify that admin-only API calls (in `src/zulip/client.ts`) are only reachable if the flag is enabled.

## 🛠 Technical Implementation Notes

- **Files to Modify:** `src/config-schema.ts`, `src/zulip/monitor.ts`, `docs/config.md`
- **Key Fields:** `enableAdminActions`

## 🧪 Verification Plan

1. Check `src/config-schema.ts` for default values.
2. Start the bot with `enableAdminActions: true` and verify the startup warning in the logs.

## 🔗 References

- [GitHub Issue #48](https://github.com/niyazmft/openclaw-zulip-bridge/issues/48)
- [ClawHub Security Scan] "Privileges" note.
