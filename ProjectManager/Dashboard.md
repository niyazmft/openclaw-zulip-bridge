# 🚀 OpenClaw Zulip Bridge - Dashboard

## Project Overview

High-performance channel plugin for **OpenClaw** enabling interaction with Zulip streams and private messages. This project is dual-published and must be kept in sync between GitHub and ClawHub.

- **GitHub:** [niyazmft/openclaw-zulip-bridge](https://github.com/niyazmft/openclaw-zulip-bridge)
- **ClawHub:** [niyazmft/zulip-bridge](https://clawhub.ai/niyazmft/zulip-bridge)
- **Status:** Hardening & Security Audit Remediation (Phase 1)

---

```dataviewjs
// --- CONFIGURATION ---
const taskFolder = '"Tasks"';
const phaseIntros = {};

// Parse Roadmap for Phase Intros dynamically
const roadmapPage = dv.page("Roadmap.md");
if (roadmapPage) {
    const roadmapContent = await dv.io.load(roadmapPage.file.path);
    // Robust regex to match Phase X, Intro, and Goal with flexible whitespace/newlines
    const phaseRegex = /## .*?(Phase \d+):[\s\S]*?\*\*Intro:\*\*\s*(.*?)\n\*\*Goal:\*\*\s*(.*)/g;
    let match;
    while ((match = phaseRegex.exec(roadmapContent)) !== null) {
        phaseIntros[match[1]] = `${match[2]} ${match[3]}`;
    }
}

// --- UTILITY: Create Progress Bar ---
const createBar = (percent) => {
    const color = percent === 100 ? "#4caf50" : "#2196f3";
    return `<div style="width:100%; background-color: #333; border-radius: 12px; margin: 8px 0; overflow: hidden; border: 1px solid #444;">
      <div style="width:${percent}%; background-color: ${color}; height: 14px; text-align: center; color: white; font-size: 10px; line-height: 14px; font-weight: bold;">
        ${percent > 10 ? percent + '%' : ''}
      </div>
    </div>`;
};

// --- 1. OVERALL PROJECT SUMMARY ---
const allTasks = dv.pages(taskFolder).where(p => p.type === "task" && !p.file.path.includes("Archive") && p.status !== "❌ Cancelled");
const totalDone = allTasks.where(p => p.status === "✅ Done" || p.status === "Completed").length;
const totalPercent = allTasks.length > 0 ? Math.round((totalDone / allTasks.length) * 100) : 0;

dv.header(2, "🏗️ Overall Project Progress");
dv.paragraph(createBar(totalPercent));
dv.paragraph(`**Total Completion:** ${totalDone} / ${allTasks.length} active tasks finished.`);
dv.el("hr", "");

// --- 2. DETAILED PHASE BREAKDOWN ---
// Group tasks by their Phase field
const groups = dv.pages(taskFolder)
    .where(p => p.type === "task" && !p.file.path.includes("Archive") && p.status !== "❌ Cancelled")
    .groupBy(p => p.phase);

for (let group of groups) {
    const phaseName = group.key || "Unassigned Phase";

    // Calculate progress for this specific group
    const groupTotal = group.rows.length;
    const groupDone = group.rows.where(p => p.status === "✅ Done" || p.status === "Completed").length;
    const groupPercent = groupTotal > 0 ? Math.round((groupDone / groupTotal) * 100) : 0;

    // Render Phase Header and its Progress Bar
    dv.header(3, phaseName);

    if (phaseIntros[phaseName]) {
        dv.paragraph(`> [!info] ${phaseIntros[phaseName]}`);
    }

    dv.paragraph(createBar(groupPercent));

    // Render the Task Table for this phase
    dv.table(["ID", "Task", "Status", "Priority", "Assignee"],
        group.rows
            .sort(k => {
                if (!k.task_id) return 999999;
                const parts = String(k.task_id).split('-');
                if (parts.length < 2) return parseInt(parts[0]) * 1000;
                return parseInt(parts[0]) * 1000 + parseInt(parts[1]);
            }, 'asc')
            .map(k => [
                k.task_id,
                k.file.link,
                k.status,
                k.priority,
                k.assignee
            ])
    );
}

// --- 3. DATA INTEGRITY AUDIT (The Linter) ---
const fib = [1, 2, 3, 5, 8, 13, 21];
const errors = [];

dv.pages(taskFolder).forEach(p => {
    if (p.type !== "task" || p.file.path.includes("Archive")) return;

    let taskErrors = [];
    if (!p.task_id) taskErrors.push("Missing Task ID");
    if (!p.phase) taskErrors.push("No Phase assigned");
    if (p.effort && !fib.includes(parseInt(p.effort))) taskErrors.push(`Invalid Effort (${p.effort} is not Fibonacci)`);
    if (!p.status) taskErrors.push("Missing Status");

    if (taskErrors.length > 0) {
        errors.push([p.file.link, taskErrors.join(", ")]);
    }
});

if (errors.length > 0) {
    dv.header(2, "⚠️ Data Integrity Audit");
    dv.table(["Task", "Issues Found"], errors);
}
```
