# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Calendar Versioning](https://calver.org/) in the format `YYYY.M.PATCH`.

## [Unreleased]

### Added
- **Session archive repair for hosts without hard links** (Android/Termux): OpenClaw publishes a deleted session's transcript archive with an atomic `fs.link()`. Where hard links are unavailable — Android/Termux rejects `link()` with `EACCES` even inside app-private storage — that publish can never succeed, the row keeps `published_at` NULL, and the host then fails **every** session operation with `Session deletion committed, but N transcript archive file export(s) remain pending in SQLite`, so the bot cannot reply on any channel (observed on Zulip *and* Telegram, with no supported repair path: `sessions cleanup` retries the same blocked `link()`, and `doctor --fix` cannot verify service ownership on Android). The plugin now publishes those archives itself: it writes the stored blob to `{dataDir}/agents/{agentId}/sessions/{archiveName}`, verifies the checksum, and marks the row published. New `sessionArchiveRepair` config — unset (default) is automatic and activates only when a one-time probe shows hard links are actually unavailable, so healthy hosts never have their session database opened; `true` always runs; `false` never runs. Rows are skipped unless the archive name is safe, the blob checksum matches, and no file with different content already exists. This is a workaround for a host limitation and becomes unnecessary once the host falls back to a copy-based publish.

### Fixed
- **CLI `message send --channel zulip` failed with "Zulip runtime not initialized"** (#285): the CLI loads the plugin entry and dispatches channel actions *without* running gateway registration (`registerFull`), so the runtime singleton was never set and `getZulipRuntime()` threw before any network call. `getZulipRuntime()` now falls back to a minimal, cached CLI runtime when no host runtime is registered: config read from `{dataDir}/openclaw.json` (empty object on failure, so `ZULIP_*` env credentials still resolve), console logging, the resolved data dir, and the `channel.text` helpers needed to format and chunk outbound text. The gateway runtime stays authoritative. Gateway-only subsystems (mentions, reply dispatch, session routing, pairing, remote-media fetch) are deliberately absent, and a remote `mediaUrl` sent from the CLI now fails with an actionable message instead of a `TypeError`.

## [2026.9.1] - 2026-09-17

### Added
- **`allowInsecureHttp` opt-in** for self-hosted servers on a trusted network: allows a plain `http://` Zulip URL **and** private/internal host addresses (a LAN Zulip is itself a private address), settable in `channels.zulip`, per account, or via `ZULIP_ALLOW_INSECURE_HTTP=1` for the default account. Because Zulip sends the bot API key as HTTP Basic on every request, this puts credentials on the wire unencrypted: it logs a startup warning, the setup wizard only accepts HTTP once the option is already set, and base-URL errors now name the option instead of failing generically.

### Fixed
- **Idle poll spin loop / log flood** (#287): The monitor polls `/events` without an explicit `timeout`, so on hosts where the server answers immediately with a heartbeat event the loop re-polled every ~1.3s — measured on real hosts at 33,963 polls/day (`y6`, 43 MB of log) and 51,194–67,089 polls/day (`lab-openclaw`, ~99.5% of the entire gateway log, for an idle channel). Three changes:
  - `/register` now requests `fetch_event_types: ["realm"]` so the server actually returns `event_queue_longpoll_timeout_seconds` (it omits the field otherwise), and that value is enforced as the **client-side** `/events` abort budget (clamped to Zulip's 1–90s window, +15s grace). Note: `timeout` is **not** a valid `/events` query parameter — an earlier revision of this fix sent one and it was silently ignored.
  - The event queue is no longer deleted on clean shutdown. Deleting it while the persisted queue id survived made every restart begin with a guaranteed `BAD_EVENT_QUEUE_ID` round-trip, a 1s stall, and a window in which inbound messages could be lost.
  - The idle path now logs on transition and then at most once per 5 minutes (was: every poll).
  - When the server answers immediately with no message events, the loop backs off 1s → 2s → 4s → 5s (capped) and resets on the first real message. The backoff is **latency-gated**: a server that holds the long-poll (responses ≥ 2.5s) gets no added delay, so reply latency on healthy hosts is unchanged.
- **Audit logging silently disabled on Termux/Android**: `AuditLogger` defaulted to a hard-coded `/tmp/openclaw-zulip`, which does not exist on Android, and its write failures are swallowed by design — so every audit event was dropped without a warning. Dedupe, queue and audit now share one resolver (`src/zulip/data-dir.ts`): host `paths.dataDir` → `~/.openclaw` → `os.tmpdir()`. This also moves the queue file and audit log out of container `/tmp` (wiped on recreate) into the persistent data dir.
- **Incomplete data-dir unification**: `media-utils.ts`, `actions-upload.ts` and `send.ts` still used their own divergent `os.tmpdir()`/`~/.openclaw` fallbacks, so on Termux/Android (no `/tmp`) inbound attachments still failed to save and upload staging still landed in a wiped temp dir. All three now use `resolveZulipDataDir()`.
- **Test pollution**: dedupe/queue tests wrote `zulip_dedupe_test_*.json` into the live data dir (13 stray files were found on `lab-openclaw`). Tests now persist into a temp dir.

### Security
- **Allowlist authorization matched a user-settable display name** (`src/zulip/auth.ts`): `isSenderAllowed()` accepted an entry equal to Zulip's `sender_full_name`, so any user could rename their profile to an allowlisted address and bypass pairing and command authorization. Authorization now matches the stable sender id only.
- **Allowlist store could be injected from `/tmp`** (`src/zulip/monitor.ts`): the monitor probed `dataDir`, `~/.openclaw`, `/home/node/.openclaw` and the world-writable `/tmp/openclaw-zulip`, using the first readable file — and a `"*"` entry in it authorized everyone. The store is now read only from the resolved data dir via `src/zulip/allowlist-store.ts`, and a wildcard on disk is ignored.
- **Upload path allowlist exposed credentials and session transcripts** (`src/zulip/client.ts`): any file under `dataDir` (or tmpdir) could be uploaded to Zulip, so a prompt-injected agent could exfiltrate `openclaw.json`, `credentials/**`, session transcripts or the audit log as attachments. Sensitive files and directories are now refused explicitly.
- **Plain HTTP was accepted for the Zulip realm** (`src/zulip/client.ts`): `normalizeZulipBaseUrl()` allowed `http://` while `SECURITY.md` claimed HTTPS-only, putting the bot's API key on the wire in cleartext on every request. HTTPS is now required (see the `allowInsecureHttp` opt-in under Added).
- **Audit logging could fail silently and could prune its own live file** (`src/zulip/audit-logger.ts`): write failures were swallowed (this is how the Android `/tmp` bug stayed hidden) and the rotation filter matched the active log, so it could delete it. Failures are now reported through an `onError` hook wired to the logger, and rotation only considers rotated siblings.
- **Docs corrected**: `SECURITY.md` overstated the SSRF protection and audit-event coverage, and claimed "no runtime npm dependencies" (the plugin depends on `zod`) and a `pnpm-lock.yaml`-only lockfile (CI uses `package-lock.json`).

## [2026.9.0] - 2026-09-07

### Added
- **First-class local file attach flow** (#268): Implemented the core-owned `upload-file` message action — the host hydrates file sources into a buffer, the plugin stages bytes in the sandboxed bot workspace (`dataDir/workspace/`, traversal-rejected, TTL-pruned), uploads via `/user_uploads`, and delivers the Zulip-hosted URL to the target with caption. Wires the previously test-only `createBotWorkspace` into the real flow. `sendMessageZulip` and `send`-action attachments now also accept sandboxed local paths (and `file://` URLs) instead of silently dropping them; relative filenames resolve against the agent workspace. Paths outside the sandbox (e.g. `/etc/passwd`) remain refused and logged.
- **Message length truncation** (#272): New `maxMessageLength` config (default 20,000 chars, `0` disables). Outbound messages exceeding the limit are truncated with a `[...message truncated]` marker before delivery, preventing downstream plugins (e.g. Honcho memory) from failing on >25,000-char content.

### Fixed
- **Internal status messages no longer leak into chat** (#273, #247): The deliver callback drops host-generated transient notices before they reach Zulip — non-terminal tool-error warnings (SDK `isReplyPayloadNonTerminalToolErrorWarning`, 2026.9.2+) and compaction/fallback/status notices. Agent-run failure messages (`isError`) are still delivered deliberately. Hosts older than 2026.9.2 still lack the markers.
- **Zulip topic in session display name** (#274): Stream conversation labels and `GroupChannel` now include the topic (`#general / topic`), so the OpenClaw WebUI shows distinct names per topic instead of duplicate `zulip:#stream` entries. DM sessions set `MessageThreadId` to the sender (#269) for explicit thread context after restarts.
- **Upload allowlist on 2026.9.2 hosts** (#268 follow-up): `getZulipRuntime().paths?.dataDir` is undefined on 2026.9.2, which degraded the upload path allowlist to tmpdir-only. Now defaults to `~/.openclaw` (same fallback as the session fallback reader), and relative attachment filenames resolve against the agent workspace (`~/.openclaw/workspace`) before the CWD fallback.
- **Typing lifecycle on 2026.9.1+** (#279): `typingCallbacks` is passed whole to `createReplyDispatcherWithTyping` so the SDK's typing controller gets `onCleanup` and the indicator stops with the reply.

### Security
- **Multi-user isolation documentation** (#270): New "Multi-User Data Isolation" section documenting per-user DM sessions, shared-by-design stream sessions, and host-global memory/tool scope with operator recommendations.

## [2026.8.9] - 2026-08-13

### Added
- **ClawScan replica** (#267): Vendored the exact ClawHub moderation engine (`scripts/clawscan/`, engine v2.4.26) as a pre-publish security gate. `npm run check:clawscan` scans source + built output + docs with the same rules ClawHub runs on publish; strict gate (exits non-zero on any finding). Wired into `npm run check` and CI.
- **gitleaks + npm audit**: `check:gitleaks` (secret detection; CI-only via `gitleaks/gitleaks-action`, skips locally if not installed) and `check:audit` (`npm audit --omit=dev`) added to the check pipeline.

### Fixed
- **ClawHub `suspicious.env_credential_access` false positive** (#267): `getZulipEnvSecret` refactored from dynamic `process.env[name]` to explicit `process.env.ZULIP_*` access, and `envVars` declared in `package.json` `openclaw.envVars`. The scanner's `hasBroadEnvAccess` heuristic no longer matches, and the declared-env exemption now applies. Verified clean with the vendored replica (was: `suspicious.env_credential_access` at `dist-cjs/index.cjs:857` / `setup-entry.cjs:852`).

## [2026.8.8] - 2026-08-10

### Fixed
- **`openclaw doctor --fix` crash** (#265): `formatPairingApproveHint` was imported from `openclaw/plugin-sdk/channel-core`, which does not export it on host 2026.7.x — the import resolved to `undefined` and calling it threw `TypeError: (0, import_channel_core.formatPairingApproveHint) is not a function`. Moved the import to `openclaw/plugin-sdk/core` (where the host SDK actually exports it), matching the existing `normalizeAccountId` import path.

### Changed
- **Regression guard**: Added `test/sdk-import-paths.test.ts` to statically assert `formatPairingApproveHint` stays on the `core` subpath and that all `channel-core` value imports are host-exported symbols, so a future SDK migration cannot silently reintroduce the wrong import path.

## [2026.8.4] - 2026-07-27

### Added
- **Context metadata** (#211): Inbound messages now carry `conversationTurn`, `sessionGapSeconds`, and `topicChanged` metadata to help the AI agent understand conversation continuity
- **Error placeholder cleanup** (#212): When message dispatch fails, the orphaned "🤔 Thinking..." placeholder is edited to "❌ Error — could not generate response"

### Fixed
- None

### Changed
- **Test suite**: Grew from 115 to 125 tests (9 new monitor-metadata tests)

## [2026.8.1] - 2026-07-21

### Added
- **Placeholder editing** (#199): Bot shows "🤔 Thinking..." placeholder immediately, replaces it with actual response when ready
- **Mark messages as read** (#202): Automatically marks user messages as read after processing
- **Subscription logging** (#203): Logs subscribed streams on monitor startup for debugging visibility
- **Bot workspace** (#201): Sandboxed file storage for generated/downloaded files under `data/zulip-workspace/`
- **Typing indicators** (#191): Best-effort typing indicators during AI generation (60s TTL)
- **Robot fallback reaction** (#191): Shows 🤖 when message processing starts (reactions feature)
- **Error explanation reactions** (#191): Shows ❌ with human-readable tooltip when errors occur
- **Network timeouts** (#190): All Zulip API requests now have explicit timeout handling (30s connect, 60s read, 90s send)
- **Cached allowlist store** (#188): `allowFrom`/`groupAllowFrom` fetched once at monitor init with 30s TTL
- **Deferred attachment downloads** (#188): Media downloads happen asynchronously after policy passes, not blocking inbound dispatch
- **SSRF protection** (#189): `normalizeZulipBaseUrl` rejects internal IPs, localhost, and AWS metadata endpoints
- **Path traversal protection** (#189): `downloadZulipUpload` sanitizes filenames from Content-Disposition
- **Symlink protection** (#189): `readSafeLocalFile` rejects symlinks before reading
- **registerFull duplicate guard** (#198): Prevents duplicate monitor starts from host calling `registerFull` twice
- **Security URL encoding** (#189): All Zulip API endpoints with path parameters now properly URL-encode IDs

### Fixed
- **Health-monitor restarts** (#187): Fixed by placing `gateway.startAccount` inside `createChatChannelPlugin` params.base
- **Swallowed poll errors** (#190): Poll loop errors are now logged instead of silently dropped
- **Temp directory leak** (#192): Uniquely-named temp dirs are cleaned up after processing
- **Dead code removal** (#193): Removed unused exports identified by knip audit (~15 functions)
- **Knip config**: Added `knip.json` for dead-code auditing

### Changed
- **Monitor lifecycle** (#187): Monitor now starts via `gateway.startAccount` (host-managed) instead of `registerFull`
- **Project structure**: Added `src/zulip/workspace.ts` for bot file storage
- **Test suite**: Grew from ~20 to 115 tests (including SSRF, symlink, workspace tests)
- **Build**: Now requires `npm run build` before smoke/package checks (enforced by CI)

### Known Limitations
- **Bot presence** (#200): Zulip API rejects `POST /users/me/presence` for bot accounts. Bots cannot show as "online" in Zulip. This is a platform limitation.

## [2026.8.2] - 2026-07-21

### Added
- **Placeholder editing** (#199): Bot shows "🤔 Thinking..." placeholder immediately, replaces it with actual response when ready
- **Mark messages as read** (#202): Automatically marks user messages as read after processing
- **Subscription logging** (#203): Logs subscribed streams on monitor startup for debugging visibility
- **Bot workspace** (#201): Sandboxed file storage for generated/downloaded files under `data/zulip-workspace/`
- **Typing indicators** (#191): Best-effort typing indicators during AI generation (60s TTL)
- **Robot fallback reaction** (#191): Shows 🤖 when message processing starts (reactions feature)
- **Error explanation reactions** (#191): Shows ❌ with human-readable tooltip when errors occur
- **Network timeouts** (#190): All Zulip API requests now have explicit timeout handling (30s connect, 60s read, 90s send)
- **Cached allowlist store** (#188): `allowFrom`/`groupAllowFrom` fetched once at monitor init with 30s TTL
- **Deferred attachment downloads** (#188): Media downloads happen asynchronously after policy passes, not blocking inbound dispatch
- **SSRF protection** (#189): `normalizeZulipBaseUrl` rejects internal IPs, localhost, and AWS metadata endpoints
- **Path traversal protection** (#189): `downloadZulipUpload` sanitizes filenames from Content-Disposition
- **Symlink protection** (#189): `readSafeLocalFile` rejects symlinks before reading
- **Security URL encoding** (#189): All Zulip API endpoints with path parameters now properly URL-encode IDs

### Fixed
- **Health-monitor restarts** (#187): Fixed by placing `gateway.startAccount` inside `createChatChannelPlugin` params.base
- **Swallowed poll errors** (#190): Poll loop errors are now logged instead of silently dropped
- **Temp directory leak** (#192): Uniquely-named temp dirs are cleaned up after processing
- **Dead code removal** (#193): Removed unused exports identified by knip audit (~15 functions)
- **registerFull duplicate guard** (#198): Prevents duplicate monitor starts from host calling `registerFull` twice

### Changed
- **Monitor lifecycle** (#187): Monitor now starts via `gateway.startAccount` (host-managed) instead of `registerFull`
- **Project structure**: Added `src/zulip/workspace.ts` for bot file storage
- **Test suite**: Grew from ~20 to 115 tests (including SSRF, symlink, workspace tests)
- **Build**: Now requires `npm run build` before smoke/package checks (enforced by CI)

### Known Limitations
- **Bot presence** (#200): Zulip API rejects `POST /users/me/presence` for bot accounts. Bots cannot show as "online" in Zulip. This is a platform limitation.

## [2026.5.1] - 2026-05-01

### Added
- SDK migration to OpenClaw 2026.5.x APIs
- `channel-inbound` and `command-auth` subpath imports
- `channel-reply-options-runtime` migration from `channel-runtime`
- Manifest updated to use `channelConfigs` (cold-path config schema) + `channelEnvVars` (env var mapping)
- Type shims for channel-core, account-core, config-types
- Comprehensive audit trail in `docs/audit/`

### Fixed
- Health-monitor restart issue - `statusSink({ running: true, connected: true })` now called at start of monitor function
- Inbound response behavior matrix for `dmPolicy` (see audit `2026-05-07-inbound-response-audit.md`)
- README alignment with codebase (see audit `2026-05-11-readme-alignment-audit.md`)

### Changed
- Deprecated `providerAuthEnvVars` migrated to `channelEnvVars` in manifest and package.json
- Build process updated for new SDK requirements
- Test loader updated for new import paths

## [2026.4.13] - 2026-04-13

### Added
- Initial ClawHub release
- Basic Zulip channel plugin with stream and DM support
- Traffic policies (dmPolicy, groupPolicy)
- Persistent event polling with queue metadata
- Media upload support
- Reaction-based status indicators
- Multi-account configuration

### Fixed
- Various queue registration stability issues
- Message deduplication edge cases

## [Unreleased]

### Planned
- Performance improvements for response dispatch times
- Additional stream filtering options
- Enhanced error recovery

---

## Version Format

This project uses Calendar Versioning (CalVer):
- `YYYY`: Full year (e.g., 2026)
- `M`: Month number (e.g., 5 for May)
- `PATCH`: Patch number within that month

Example: `2026.5.1` = May 2026, first patch
