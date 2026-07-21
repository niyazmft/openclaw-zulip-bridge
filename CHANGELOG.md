# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Calendar Versioning](https://calver.org/) in the format `YYYY.M.PATCH`.

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
