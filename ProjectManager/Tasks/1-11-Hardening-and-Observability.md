---
type: task
task_id: "1-11"
gh_issue: "https://github.com/niyazmft/openclaw-zulip-bridge/issues/51"
status: ✅ Done
priority: 🔵 Low
effort: 3
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
  - observability
---

# Hardening and Observability Improvements

## 👤 User Story

> As a Developer, I want to harden the bridge's regex patterns and improve error visibility so that the system is more robust and easier to debug.

## 🎯 Objective

Address several "Nice-to-fix" findings from the developer audit related to regex broadness, error swallowing, and temporary file storage.

## ✅ Acceptance Criteria

- [ ] Tighten the upload URL extraction regex in `src/zulip/uploads.ts` to be more specific.
- [ ] Stop silently swallowing attachment download errors in `src/zulip/monitor.ts`. Log them at the `warn` or `error` level with context.
- [ ] Investigate moving queue metadata and dedupe state from `os.tmpdir()` to a more persistent and intentional plugin data directory provided by the OpenClaw SDK.
- [ ] Ensure all log messages for errors contain the account ID and relevant message identifiers.

## 🛠 Technical Implementation Notes

- **Files to Modify:** `src/zulip/uploads.ts`, `src/zulip/monitor.ts`
- **Key Areas:** `extractZulipUploadUrls`, `handleMessage` error blocks.

## 🧪 Verification Plan

1. Check logs after a failed attachment download to ensure the error is now visible.
2. Verify that upload URL extraction still works for legitimate Zulip uploads.

## 🔗 References

- [GitHub Issue #51](https://github.com/niyazmft/openclaw-zulip-bridge/issues/51)
- [Developer Audit Report] Findings #3, #5, #6
