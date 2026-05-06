# Zulip Plugin Fix Plan — May 2026

## Current State

| Item | Detail |
|---|---|
| OpenClaw Host | `2026.4.29 (a448042)` on device y6 |
| Plugin Version | `2026.4.14` (local workspace) |
| y6 Install | `~/.openclaw/extensions/zulip/` — copied from local `dist/` |
| Status | **Plugin fails to load** — not a runtime monitor issue anymore |

---

## Root Cause Analysis

### Problem 1: `openclaw/plugin-sdk/irc` Subpath Removed (CRITICAL)

OpenClaw 2026.4.29 removed the `irc` subpath export from `plugin-sdk`. The zulip plugin imports:

```ts
import { logInboundDrop, resolveControlCommandGate } from "openclaw/plugin-sdk/irc";
```

Which causes:

```
Error: Cannot find module '.../plugin-sdk/root-alias.cjs/irc'
Require stack: .../dist/src/zulip/monitor.js
```

**Where the functions moved:**

| Function | Old Import | New Import (2026.4.29) |
|---|---|---|
| `logInboundDrop` | `openclaw/plugin-sdk/irc` | `openclaw/plugin-sdk/channel-inbound` |
| `resolveControlCommandGate` | `openclaw/plugin-sdk/irc` | `openclaw/plugin-sdk/command-gating` |

**Files affected:**
- `src/zulip/monitor.ts` (line 2)
- `types/openclaw-plugin-sdk.d.ts` (type stubs for `irc` subpath)

### Problem 2: Health-Monitor "stopped" Restarts (DEFERRED)

From earlier investigation, when the plugin DID load (on 2026.4.23), the health-monitor killed the zulip monitor every ~5 minutes with `reason: stopped`. The root cause was:

1. The health-monitor checks `snapshot.running === false` first
2. If `running` is false, it restarts immediately with `"stopped"`
3. The `statusSink({ running: true, connected: true })` was added at the start of `monitorZulipProvider` as a mitigating fix
4. However, if the promise resolves (e.g., monitor loop exits or initialization fails), the host sets `running: false`
5. This issue is **deferred** until the plugin can actually load

---

## Proposed Fixes

### Phase 1: Fix Import Paths (Immediate)

**Files to change:**

1. `src/zulip/monitor.ts`
   - Replace `import { logInboundDrop, resolveControlCommandGate } from "openclaw/plugin-sdk/irc";`
   - With separate imports from `openclaw/plugin-sdk/channel-inbound` and `openclaw/plugin-sdk/command-gating`

2. `types/openclaw-plugin-sdk.d.ts`
   - Remove `declare module "openclaw/plugin-sdk/irc"` block
   - Add `declare module "openclaw/plugin-sdk/channel-inbound"` with `logInboundDrop`
   - Add `declare module "openclaw/plugin-sdk/command-gating"` with `resolveControlCommandGate`

3. `src/setup-surface.ts`
   - Check if anything from `openclaw/plugin-sdk/irc` is imported (likely not, but verify)

### Phase 2: Verify Loading + Health-Monitor (After Phase 1)

1. Build plugin locally: `npm run build`
2. Copy `dist/` to y6 `~/.openclaw/extensions/zulip/`
3. Restart PM2: `pm2 restart openclaw`
4. Check gateway logs for successful zulip load
5. Observe for 15 minutes to see if health-monitor still restarts
6. If restarts persist, investigate whether `monitorZulipProvider` promise resolves early

### Phase 3: Update Manifest & Deprecation Warnings

Gateway logs show two deprecation warnings even when zulip was partially loading:

```
- plugin zulip: providerAuthEnvVars is deprecated compatibility metadata
- plugin zulip: channel plugin manifest declares zulip without channelConfigs metadata
```

**Actions:**
1. Review `openclaw.plugin.json` and add `channelConfigs` if the new host requires it
2. Migrate `providerAuthEnvVars` to `setup.providers[].envVars` format if applicable

---

## Test Plan

1. After Phase 1 fixes, run `npm run check` locally (typecheck + build + smoke + test + package)
2. Deploy to y6 and verify `zulip` appears in `openclaw plugins doctor` without errors
3. Check `openclaw plugins list` shows zulip status as `loaded`
4. Wait for health-monitor cycle (~5 min) and confirm no `[zulip:default] restarting (reason: stopped)`
5. Send a Zulip DM to `nabu-bot@niyaz.zulipchat.com` and verify a response

---

## Risks & Fallbacks

| Risk | Mitigation |
|---|---|
| Other imports from `irc` exist but were missed | Full grep of `/src` for `"irc"` before committing |
| New SDK paths not available in older OpenClaw versions | The new paths (`channel-inbound`, `command-gating`) were re-exports inside the old `irc` bundle anyway — they are canonical paths now |
| `openclaw.plugin.json` manifest needs new fields for 2026.4.29 | Add `channelConfigs` after reading host documentation |
| Health-monitor still kills the monitor after load fix | Add exhaustive logging to `monitorZulipProvider` to trace promise resolution |

---

## Local Workspace Changes Summary

Already committed (from previous session):
- `src/setup-surface.ts`: Added `credentials: []` to setupWizard
- `src/zulip/polling.ts`: Heartbeat on every poll cycle regardless of event count
- `src/zulip/client.ts`: Abort signal wired through `getZulipEventsWithRetry`
- `src/zulip/monitor.ts`: Immediate `statusSink({ running: true, connected: true })` assertion
- `scripts/check-bootstrap.js` / `scripts/check-package.js`: Removed `child_process` imports
- `package.json` + `openclaw.plugin.json`: Version bumped to `2026.4.14`

**Pending for this session:**
- `src/zulip/monitor.ts`: Fix `openclaw/plugin-sdk/irc` imports
- `types/openclaw-plugin-sdk.d.ts`: Update type stubs for new SDK paths
- Potentially `openclaw.plugin.json`: Add `channelConfigs` metadata

---

*Plan created: 2026-05-01*
