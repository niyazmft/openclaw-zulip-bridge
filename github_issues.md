# GitHub Issues — OpenClaw Zulip Bridge

## Issue 1: Fallback Reader mtime Race Condition (FIXED)

**Status:** ✅ Fixed in local workspace, deployed to y6 and container

**Description:**
The fallback reader (`src/zulip/fallback-reader.ts`) used filesystem `mtime` to filter trajectory files with a 30-second window. This was unreliable because:

- Session trajectory files are reused across multiple messages in the same DM
- Buffered filesystem writes don't always update `mtime` synchronously
- The `maxAgeMs` cutoff could exclude the correct file before the host flushes `trace.artifacts`

**Impact:**
When the agent outputs plain text (no `message()` tool call), the `deliver` callback never fires. The fallback reader is supposed to extract `assistantTexts` from the trajectory file and send them as a reply. But the mtime filter caused it to miss the correct file, resulting in no reply being delivered. The user sees 👀 → ✅ reactions but no reply text.

**Fix:**
- Removed the `mtime` filter entirely
- Added `startTime` parameter (ISO timestamp recorded before `dispatchReplyFromConfig`)
- Filter `trace.artifacts` events by `event.ts >= startTime` instead
- Extended `maxAgeMs` default from 30s → 300s (5 min) for API compat
- Added comprehensive debug logging via `log` callback

**Files changed:**
- `src/zulip/fallback-reader.ts`
- `src/zulip/reply-handler.ts`
- `test/fallback-reader.test.ts`

---

## Issue 2: Dedupe Store Durability (Minor)

**Status:** 🟡 Open — minor, low priority

**Description:**
The dedupe store (`src/zulip/dedupe-store.ts`) uses a debounced save with a 5-second delay (`SAVE_DEBOUNCE_MS = 5000`). Every new message resets the timer. The in-memory cache is only persisted to disk 5 seconds after the LAST message.

If the process crashes or is restarted within that window, in-memory dedupe entries are lost. On restart, the old file is loaded, and those messages could be re-processed — meaning the bot might respond twice to the same message.

**Impact:**
Minor. Message re-processing is not catastrophic (Zulip API has its own event queue deduplication). But it could cause duplicate responses in rare cases.

**Potential fix:**
- Call `dedupeStore.flush()` on graceful shutdown (e.g., in the monitor's cleanup path)
- Or reduce the debounce window
- Or write synchronously for critical messages

**Files:**
- `src/zulip/dedupe-store.ts`
- `src/zulip/monitor.ts` (where the store is used)

---

## Issue 3: Dedupe File Location Inconsistency

**Status:** 🟡 Open — minor, low priority

**Description:**
The dedupe file path depends on whether `core.paths?.dataDir` is available:

```typescript
private getPersistencePath(): string {
  const dataDir = this.runtime.paths?.dataDir;
  if (dataDir) {
    return path.join(dataDir, `zulip_dedupe_${safeAccountId}.json`);
  }
  return path.join(os.tmpdir(), "openclaw-zulip", `zulip_dedupe_${safeAccountId}.json`);
}
```

On y6 (Termux/Android), `core.paths?.dataDir` is not available, so the file ends up at:
```
/data/data/com.termux/files/usr/tmp/openclaw-zulip/zulip_dedupe_default.json
```

This is inconsistent with other plugin data files that live under `~/.openclaw/`. The file also survives restarts in an unexpected location, which can be confusing during debugging.

**Impact:**
Low. The dedupe works correctly regardless of location. But it's confusing when troubleshooting.

**Potential fix:**
- Always use a consistent path under the OpenClaw data directory
- Or document the fallback path behavior

**Files:**
- `src/zulip/dedupe-store.ts`

---

## Issue 4: Missing Reply Delivery When `message` Tool Is Stripped

**Status:** 🟡 Open — mitigated by Issue 1 fix, but root cause is upstream

**Description:**
The OpenClaw host's `coding` profile strips the `message` tool from the agent. When the agent generates a response, it outputs plain text instead of calling `message()`. The SDK's `dispatchReplyFromConfig` only delivers replies when the `deliver` callback fires (i.e., when the agent calls the messaging tool). If `deliver` never fires, no reply is sent.

The Telegram channel has built-in special-case code to handle this, but that code is not available to third-party plugins. The Zulip plugin relies on the fallback reader (Issue 1) to extract plain-text responses from trajectory files.

**Impact:**
Without the fallback reader fix, users see 👀 → ✅ reactions but no reply text. This affects all users of the `coding` profile (which is the default for many setups).

**Upstream dependency:**
The OpenClaw SDK does not expose `onAssistantTextNotDelivered` or `onSettled` hooks to plugins. A proper fix would require an SDK change. See commit `a91b873` (May 2026) which noted this gap.

**Workaround:**
- Use a profile that includes `message` tool (e.g., `full`, `messaging`)
- Or rely on the fallback reader fix (Issue 1)

**Files:**
- `src/zulip/reply-handler.ts`
- `src/zulip/fallback-reader.ts`

---

## Issue 5: CJS vs ESM Build Confusion

**Status:** 🟡 Open — documentation/deployment issue

**Description:**
The host on y6 (Node 24, Termux/Android) loads the **CJS bundle** (`dist-cjs/index.cjs`), not the ESM build (`dist/`). The `package.json` specifies:

```json
"openclaw": {
  "runtimeExtensions": ["./dist-cjs/index.cjs"],
  "runtimeSetupEntry": "./dist-cjs/setup-entry.cjs"
}
```

This means:
- Patches to `dist/src/zulip/*.js` (ESM files) have **no effect** on y6
- Only the CJS bundle in `dist-cjs/` is actually loaded
- Debug instrumentation must use correct imports (CJS bundle only imports `node:fs/promises`, not bare `fs`)

**Impact:**
Developers may waste time patching the wrong files. Debug patches that use `fs.writeFileSync` (not imported in the CJS bundle) fail silently inside try-catch.

**Potential fix:**
- Document the CJS vs ESM behavior clearly
- Add a build step that validates both bundles
- Consider adding a runtime check to log which build is loaded

**Files:**
- `package.json` (build config)
- `scripts/smoke-test-dist.js`
- `test/smoke-loader.js`

---

## Issue 6: `rsync --delete` With Multiple Source Dirs Flattens Structure

**Status:** 🟡 Open — deployment/documentation issue

**Description:**
Running `rsync -avh --delete dist/ dist-cjs/ host:dir/` copies the **contents** of both source directories into the destination root, destroying subdirectory structure. For example:

```
# What you expect:
host:dir/dist-cjs/index.cjs
host:dir/dist/src/zulip/reply-handler.js

# What actually happens:
host:dir/index.cjs          # from dist-cjs/
host:dir/src/zulip/...      # from dist/
```

This caused the host to report "runtime setup entry not found: ./dist-cjs/setup-entry.cjs" because the `dist-cjs/` directory was flattened away.

**Impact:**
Plugin deployment breaks. The host cannot find entry points specified in `package.json`.

**Fix:**
Use one of:
- `rsync -avh --delete dist/ host:dir/dist/ && rsync -avh --delete dist-cjs/ host:dir/dist-cjs/`
- Or sync from the parent directory: `rsync -avh --delete parent/ host:dir/` (where parent contains both `dist/` and `dist-cjs/`)

**Documentation:**
Update AGENTS.md deployment instructions to warn about this.

---

## Issue 7: `openclaw doctor --fix` Crashes With TypeError

**Status:** 🟡 Open — upstream bug

**Description:**
Running `openclaw doctor --fix` on y6 (host 2026.7.1-2) crashes at the end with:

```
TypeError: (0 , import_channel_core2.formatPairingApproveHint) is not a function
```

This crash occurs after the doctor has already processed most fixes. It may leave the config or plugin registry in an inconsistent state.

**Impact:**
- The doctor's cleanup/state-migration steps may not complete
- The config may be marked as "stale" or "invalid" even after files are fixed
- The plugin registry may not be properly updated

**Workaround:**
- Avoid `openclaw doctor --fix` when the zulip plugin is involved
- Manually fix directory structure and restart via pm2
- Restore from `.bak` files if config gets corrupted

**Upstream:**
This is a bug in OpenClaw 2026.7.1-2. The `formatPairingApproveHint` function is not exported from the `channel-core` module in this version.

---

## Issue 8: Restart-Loop Breaker Suppresses Channel Auto-Start

**Status:** 🟡 Open — operational issue

**Description:**
After multiple failed boots (e.g., due to missing plugin files), the OpenClaw host activates a restart-loop breaker:

```
restart-loop breaker tripped: 7 unclean boot(s) within 300000ms;
suppressing channel/provider account auto-start
```

This prevents channels (zulip, telegram) from auto-starting even after the underlying issue is fixed. The gateway itself starts, but channels remain stopped.

**Impact:**
Users may think the fix didn't work because channels don't start automatically. Requires manual intervention.

**Recovery:**
- `pm2 stop openclaw && pm2 start openclaw` — a clean restart resets the breaker
- Or wait for the breaker to expire (5 minutes of clean uptime)

**Files:**
- No code change needed — this is host behavior
- Document in troubleshooting section of AGENTS.md

---

## Issue 9: `typingCallbacks.onIdle()` Returns Undefined, Crashes Deliver Callback (FIXED)

**Status:** ✅ Fixed

**Description:**
The `deliver` callback in `src/zulip/reply-handler.ts` calls `typingCallbacks.onIdle()` to stop the typing indicator after a reply is delivered. In some SDK versions, `onIdle()` returns `undefined` instead of a Promise. The code then calls `.catch()` on the result, which throws:

```
TypeError: Cannot read properties of undefined (reading 'catch')
```

This error is caught by the dispatcher's `onError` handler, which uses `core.error` — a no-op that doesn't write to any log. The error is silently swallowed, and the `deliver` callback crashes before it can call `sendMessageZulip`. The reply is never sent to Zulip, even though the LLM correctly called the `message()` tool.

**Impact:**
Every reply fails silently. The user sees 👀 → ✅ reactions (because the dispatch completes without error from the plugin's perspective), but no reply text ever arrives in Zulip. This affects all messages where the LLM calls the `message()` tool.

**Root cause:**
`typingCallbacks.onIdle()` is created by the SDK's `createTypingCallbacks()` function. In OpenClaw host 2026.7.1-2, this function may return `undefined` from `onIdle()` instead of a Promise, depending on the typing parameters.

**Fix:**
Guard the `.catch()` call with a type check:

```typescript
const idleResult = typingCallbacks.onIdle();
if (idleResult && typeof (idleResult as Promise<void>).catch === "function") {
  void (idleResult as Promise<void>).catch(() => undefined);
}
```

Also wrapped the entire `deliver` callback body in a try-catch with proper error logging via `core.logging?.getChildLogger` to prevent future silent failures.

**Files changed:**
- `src/zulip/reply-handler.ts`

**Related:**
- Added comprehensive debug logging throughout the message flow using `core.logging?.getChildLogger` (which actually writes to the gateway log file) instead of `core.log` (which is a no-op)
- `src/zulip/monitor.ts` — reaction lifecycle logs
- `src/zulip/send.ts` — API call logs with try-catch
- `src/zulip/fallback-reader.ts` — mtime filter removal (Issue 1)
