# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Calendar Versioning](https://calver.org/) in the format `YYYY.M.PATCH`.

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
