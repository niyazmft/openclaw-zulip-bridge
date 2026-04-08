<%\*
/\*\*

- Gold Standard Task Template - Zulip
- Features: Auto-renaming, Phase Suggester, Fibonacci Effort, Safe Frontmatter
  \*/
  const title = await tp.system.prompt("Task Title", "New Task");
  const phaseList = ['Phase 0', 'Phase 1', 'Phase 2', 'Phase 3', 'Phase 4', 'Phase 5'];
  const phase = await tp.system.suggester(phaseList, phaseList, true, "Select Project Phase");
  const task_id = await tp.system.prompt("Task ID (e.g., 1-1)");
  const effort = await tp.system.suggester(["1", "2", "3", "5", "8", "13", "21"], ["1", "2", "3", "5", "8", "13", "21"], true, "Select Effort (Fibonacci)");

// Auto-move to Tasks folder and rename
await tp.file.rename(`Tasks/${title.replace(/\s+/g, '-')}`);

// Process metadata safely
setTimeout(async () => {
const file = tp.config.target_file;
await app.fileManager.processFrontMatter(file, (fm) => {
fm["task_id"] = task_id;
fm["phase"] = phase;
fm["parent"] = `[[${phase.replace(' ', '-')}]]`;
fm["effort"] = parseInt(effort);
fm["tags"] = ["task", phase.toLowerCase().replace(' ', '-')];
});
}, 200);
%>

---

type: task
task_id: "X-X"
gh_issue: ""
status: ⏳ Pending
priority: 🟡 Medium
effort: 0
due_date: <% tp.date.now("YYYY-MM-DD", 7) %>
phase: "Phase X"
parent: "[[Phase-X]]"
assignee: "Developer"
created: <% tp.date.now("YYYY-MM-DD") %>
project: "Zulip"
tags:

- task

---

# <% title %>

## 👤 User Story

> As a [User/Developer], I want to [action] so that [benefit].

## 🎯 Objective

<!-- Describe the high-level goal of this task. -->

## ✅ Acceptance Criteria

<!-- Specific, testable conditions that must be met to mark this task as done. -->

- [ ]
- [ ]
- [ ]

## 🛠 Technical Implementation Notes

<!-- Implementation details, specific libraries, function signatures, or architectural patterns to follow. -->

- **Files to Modify:** `path/to/file`
- **Key APIs:** `FunctionA()`, `ClassB`

## 🧪 Verification Plan

<!-- How should the AI or developer verify this change? -->

1. Run test command: `...`
2. Manual verification step: ...

## 🔗 References

- [Documentation Link](...)
- [[Related-Task-File]]
