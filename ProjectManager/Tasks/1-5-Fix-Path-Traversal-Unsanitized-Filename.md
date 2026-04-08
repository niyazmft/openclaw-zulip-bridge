---
type: task
task_id: "1-5"
gh_issue: "https://github.com/niyazmft/openclaw-zulip-bridge/issues/45"
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

# Fix Path Traversal: Unsanitized Filename from Zulip API

## 👤 User Story

> As a Developer, I want to sanitize filenames extracted from API headers so that malicious file paths cannot be used to write data to unintended locations.

## 🎯 Objective

Address the medium-severity path traversal vulnerability where filenames for downloaded uploads are used without sufficient sanitization.

## ✅ Acceptance Criteria

- [ ] Sanitize the filename using `path.basename()` before joining it with a directory path in `saveZulipMediaBuffer`.
- [ ] Ensure any relative path components (e.g., `..`, `/`) provided in the `Content-Disposition` header are stripped.
- [ ] Verify that files are correctly saved to the intended temporary directory only.

## 🛠 Technical Implementation Notes

- **Files to Modify:** `src/zulip/monitor.ts`
- **Key APIs:** `path.basename()`

## 🧪 Verification Plan

1. Simulate a Zulip API response with a malicious `Content-Disposition` filename (e.g., `../../etc/passwd`).
2. Verify that the file is saved as `passwd` (or a safe alternative) within the unique temporary directory created by `mkdtemp`.

## 🔗 References

- [GitHub Issue #45](https://github.com/niyazmft/openclaw-zulip-bridge/issues/45)
- [Internal Security Audit Report]
