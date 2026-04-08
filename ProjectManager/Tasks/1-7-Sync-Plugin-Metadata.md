---
type: task
task_id: "1-7"
gh_issue: "https://github.com/niyazmft/openclaw-zulip-bridge/issues/47"
status: ⏳ Pending
priority: 🟡 Medium
effort: 1
due_date: 2026-04-06
phase: "Phase 1"
parent: "[[Phase-1]]"
assignee: "Developer"
created: 2026-03-30
project: "Zulip"
tags:
  - task
  - phase-1
  - documentation
---

# Synchronize Plugin Metadata with Requirements

## 👤 User Story

> As a Developer, I want the plugin metadata to correctly reflect the required environment variables so that users are accurately informed before installation.

## 🎯 Objective

Fix the "Metadata Mismatch" flagged by ClawHub, where the registry claims no environment variables are needed despite the code requiring `ZULIP_API_KEY`, etc.

## ✅ Acceptance Criteria

- [ ] Update `openclaw.plugin.json` to include the required environment variables in its metadata.
- [ ] Ensure `ZULIP_API_KEY`, `ZULIP_EMAIL`, and `ZULIP_URL` (or aliases) are listed as optional but recommended secrets.
- [ ] Align any other metadata fields (description, version) with the current state of the repo.

## 🛠 Technical Implementation Notes

- **Files to Modify:** `openclaw.plugin.json`

## 🧪 Verification Plan

1. Inspect `openclaw.plugin.json` and verify the `env` or `secrets` section correctly lists the variables.

## 🔗 References

- [GitHub Issue #47](https://github.com/niyazmft/openclaw-zulip-bridge/issues/47)
- [ClawHub Security Scan] "Metadata Mismatch" note.
