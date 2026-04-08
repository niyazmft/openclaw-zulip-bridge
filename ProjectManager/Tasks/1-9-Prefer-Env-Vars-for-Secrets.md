---
type: task
task_id: "1-9"
gh_issue: "https://github.com/niyazmft/openclaw-zulip-bridge/issues/49"
status: ⏳ Pending
priority: 🟡 Medium
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

# Prefer Env Vars for Secrets in Onboarding

## 👤 User Story

> As a Developer, I want the onboarding flow to prioritize environment variables for secrets so that I don't accidentally commit plaintext credentials to my configuration file.

## 🎯 Objective

Improve the security of the setup process by discouraging the storage of `apiKey` and `email` in the `openclaw.json` configuration file.

## ✅ Acceptance Criteria

- [ ] Update `src/onboarding.ts` to explicitly warn the user before writing the `apiKey` to the configuration file.
- [ ] Add an option in the prompter to skip writing to config and instead instruct the user on which environment variables to set (`ZULIP_API_KEY`, `ZULIP_EMAIL`, etc.).
- [ ] Update documentation (`README.md` and `docs/config.md`) to emphasize environment variables as the preferred method for secret storage.
- [ ] For the default account, make env-var usage the primary recommendation during setup.

## 🛠 Technical Implementation Notes

- **Files to Modify:** `src/onboarding.ts`, `README.md`, `docs/config.md`
- **Key Functions:** `zulipOnboardingAdapter.configure`

## 🧪 Verification Plan

1. Run the onboarding wizard (`openclaw setup`).
2. Verify that the flow prompts for environment variables or provides a warning before saving the API key to the config.

## 🔗 References

- [GitHub Issue #49](https://github.com/niyazmft/openclaw-zulip-bridge/issues/49)
- [Developer Audit Report] Finding #2
