---
type: task
task_id: "1-3"
gh_issue: "https://github.com/niyazmft/openclaw-zulip-bridge/issues/43"
status: ✅ Done
priority: 🔴 High
effort: 5
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
  - maintenance
---

# Audit and Prune Unnecessary Dependencies

## 👤 User Story

> As a Developer, I want to keep the dependency graph as small as possible so that the supply-chain risk is minimized and the package remains lightweight.

## 🎯 Objective

Address the security concern regarding a "disproportionately large dependency graph" flagged by the ClawHub scan, specifically looking for and removing unused packages like `@aws-sdk` and `@anthropic-ai`.

## ✅ Acceptance Criteria

- [ ] Audit `package.json` and `package-lock.json` for unused or high-risk transitive dependencies.
- [ ] Remove any direct dependencies that are not strictly required for the Zulip Bridge functionality.
- [ ] Investigate why `@aws-sdk` or LLM-related packages are present and attempt to eliminate them.
- [ ] Verify that the bridge still functions correctly after pruning.
- [ ] Reduce the total package size and dependency count.

## 🛠 Technical Implementation Notes

- **Files to Modify:** `package.json`, `package-lock.json`
- **Tools:** `npm prune`, `depcheck` (if available), manual audit of imports.

## 🧪 Verification Plan

1. Run `npm install` and check the resulting `node_modules` size and `package-lock.json` content.
2. Run the full check suite: `npm run check`.

## 🔗 References

- [GitHub Issue #43](https://github.com/niyazmft/openclaw-zulip-bridge/issues/43)
- [ClawHub Security Scan] "Dependency Surface" note.
