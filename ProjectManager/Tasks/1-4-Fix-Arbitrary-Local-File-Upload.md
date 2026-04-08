---
type: task
task_id: "1-4"
gh_issue: "https://github.com/niyazmft/openclaw-zulip-bridge/issues/44"
status: ✅ Done
priority: 🔴 High
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
---

# Fix Arbitrary Local File Upload via mediaUrl

## 👤 User Story

> As a Developer, I want to restrict the media upload source to valid remote URLs so that local system files cannot be exfiltrated via the messaging bridge.

## 🎯 Objective

Prevent the bridge from being tricked into uploading arbitrary local files by providing a local filesystem path as a `mediaUrl`.

## ✅ Acceptance Criteria

- [ ] Modify `sendMessageZulip` in `src/zulip/send.ts` to reject non-HTTP `mediaUrl` values.
- [ ] Explicitly disable the `file://` protocol and direct local paths for the `mediaUrl` parameter unless explicitly allowed by a new configuration flag.
- [ ] Ensure that remote media fetching still works correctly for standard `http://` and `https://` URLs.
- [ ] Add a warning log if a local path is provided and rejected.

## 🛠 Technical Implementation Notes

- **Files to Modify:** `src/zulip/send.ts`
- **Key Functions:** `sendMessageZulip`, `resolveZulipLocalPath`

## 🧪 Verification Plan

1. Attempt to send a message with `mediaUrl` set to a local path (e.g., `/etc/passwd` or `file:///etc/hosts`).
2. Verify that the upload is rejected and the file is NOT sent to Zulip.
3. Verify that a remote image URL still uploads and sends correctly.

## 🔗 References

- [GitHub Issue #44](https://github.com/niyazmft/openclaw-zulip-bridge/issues/44)
- [Developer Audit Report] Finding #4
---
