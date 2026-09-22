# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Calendar Versioning](https://calver.org/) in the format `YYYY.M.PATCH`.

## [Unreleased]

### Added
- **`check:compat` — Tier 1 host-compatibility gate**: loads the built plugin against a real, pinned OpenClaw host in a throwaway workspace and asserts that every `openclaw/plugin-sdk/*` subpath it imports actually resolves and exports what the plugin uses, that both the ESM (`dist/index.js`) and CJS (`dist-cjs/index.cjs`) entries load, and that full registration produces exactly one channel whose `gateway.startAccount` is callable and whose config callbacks run. The existing smoke test collapses every SDK specifier into a single permissive stub, so it is *structurally* incapable of catching subpath or named-export drift — this closes that gap. Requires network access and a ~390 MB host install, so it is deliberately **not** part of `npm run check` and runs as its own CI job.
- **`check:tier2` — outbound behaviour tests**: drives the real client against a local fake Zulip server (no external network) and verifies the payloads for stream send, private-message send, file upload, reaction, message edit, and typing indicator. Also its own CI job.
- **Progressive activity trace — make agent work visible in the topic** (epic #293, opt-in via `activityTrace`): the room used to see only the final reply, and a run that produced no reply left nothing at all, while the actual work (`exec`, edits, tests, pushes) happened off-screen. Now the plugin keeps **one dedicated bot-owned status message per work item** and edits it in place as the run progresses, collapsing to a single compact line when the run ends. The message is never deleted, so the topic keeps an audit trail.
  - **The rule**: *status detail edits the trace; actionable results are posted as new messages* — a readable status board instead of one message per tool call.
  - **Run boundary (#301)**: a trace starts when a run is dispatched (targeted with the same stream/topic the reply uses, so it can never land in the wrong topic) and is finalized on **success, error and abort** — the guaranteed floor, requiring no new host surface. No-reply runs are now visible ("run finished in 12s — no reply sent").
  - **Mode A — plugin-driven (#302)**: the host's `after_tool_call` hook is registered with `matcher: ["exec"]`, an explicit `timeoutMs`, and a stable `registrationId` (idempotent; openclaw#86241 documents N-fold delivery from handler stacking). `before_tool_call` is deliberately never registered — it is a fail-closed gate that could block the agent's own tool call. The handler is synchronous, does no I/O, and drops unattributable hooks rather than guessing a topic. Hook payloads identify the *agent run*, not the room, so correlation is maintained by the plugin.
  - **Mode B — agent-driven (#303)**: a `zulip_progress` tool lets the agent narrate intent hooks cannot infer ("about to ask a clarifying question", "switching approach"). The `message` tool's action vocabulary is a closed, core-owned list ("plugins add names through a core PR"), so the channel action adapter cannot carry a new verb; the tool is registered through `api.registerTool` with `contracts.tools` declared in the manifest, and correlates via the per-run tool context. No active trace is a no-op, not an error.
  - **Coalescing and failure policy**: `traceCoalesceMs` (default 400) plus a hard `traceMaxRate` ceiling (default 2 edits/sec), since Zulip edits are ~600ms round-trips; an unchanged render spends no PATCH. A failed post drops the trace and a failed edit is logged and dropped — no retry loop, no user-visible error, and never on the agent's critical path. Trace **edits** bypass `sendMessageZulip`'s outbound secret guard, so both trace writes redact known host credentials (`redactSecrets`).
  - **Default off**: with `activityTrace` unset, behaviour is identical to a build without the feature.
- **`typebox` runtime dependency** (pinned to the host's `1.3.30`): needed for the `zulip_progress` tool parameter schema. Staged during install by `openclaw.build.stageRuntimeDependencies`, so a ClawHub install still needs no manual steps.
- **History-aware context — answer with receipts, not vibes** (#294, opt-in via `historyContext`): the only durable record of a topic is Zulip itself, but by default the agent saw just the current message plus whatever survived in its own runtime memory, so "have we seen this error before?" was answered from fresh vibes. The bridge now harvests a **bounded** slice of the current stream/topic into the agent's prompt as evidence.
  - **Triggers**: `"off"` (default) never harvests; `"on-demand"` only when the message looks like a "do we know this?" question (narrow intent patterns — a harvest is one extra Zulip round-trip and costs context budget); `"always"` adds the block to every inbound stream message.
  - **Bounded on every axis**: `historyMaxMessages` (8), `historyWindowHours` (72), `historyMaxChars` (4000), with selection keeping the *newest* lines so a topic with months of history cannot blow up the context window.
  - **Best-effort**: a slow or failing harvest is logged and dropped inside a 2s timeout, so it can never stall or fail a dispatch, and it appends to the agent-facing `Body` only — commands are unaffected.
  - **Streams/topics only**: DMs keep their per-user session continuity and strict isolation. Reuses the existing `fetchZulipMessages` path, so it adds no new file reads or network surface (ClawScan-clean).
- **Actionable refs in replies — refs as data, not prose** (#295, opt-in via `renderRefs`): "I opened a PR" was readable but not *actionable*. The agent can now emit `[[zulip_ref: <github url> | <label>]]` and the plugin turns it into a validated, clickable link.
  - **Validation is real, not cosmetic.** Each ref is checked against the GitHub API before it becomes a link (pull/issue, commit, Actions run), so the reply is evidence rather than a claim. A label is optional; one is derived (`owner/repo#128`) when omitted.
  - **Degradation, never failure**: a malformed URL, 404, rate limit, timeout or network error renders the ref as backticked plain text (so Zulip will not auto-link it) and the reply still sends.
  - **No user-controlled fetch target**: only `https://github.com/...` refs are handled, matched by an anchored regex (lookalike hosts, ports, credentials and queries do not match), and the API origin is a hardcoded `https://api.github.com` — there is no configurable host that could be widened into an SSRF primitive. Malformed refs are rejected *before* any request.
  - **No credentials are sent**: validation is unauthenticated, so private refs simply 404 and degrade. Outcomes are cached for 10 minutes, and at most 3 refs per message are validated, to stay inside GitHub's 60-requests/hour/IP unauthenticated budget.
  - Applied before chunking in `reply-handler.ts` so a marker can never be split across two messages, and in `sendMessageZulip` as the safety net for the CLI, fallback and activity-trace paths.
- **In-channel action triggers — a reaction can mean "go"** (#297, opt-in via `reactionTriggers`): the bridge was read/send only, so a human could reply but not act from inside the topic. A `reactionTriggers` map (emoji name → instruction, e.g. `{"+1": "Proceed with the proposed step."}`) turns a reaction on the **bot's own message** in a monitored stream into a normal turn for that same stream/topic session, so the agent acts where the discussion already is and its reply (and activity trace) land in the same topic.
  - **A reaction is a trigger, never an authorisation bypass.** The synthetic turn is dispatched through the normal message path carrying the *reacting human* as its sender, so `dmPolicy`/`groupPolicy`, the static and persisted allowlists, the control-command gate and the per-sender rate limit all apply to them. A stranger's reaction does nothing.
  - **Only the bot's own stream messages are actionable by default** (`reactionTriggerAnyMessage` relaxes it deliberately): a reaction is an approval of the agent's proposal, so it must not be a way to make the agent act on someone else's message.
  - **Fired once per (message, emoji, user)** through the existing on-disk dedupe store, so repeated taps, toggles and replayed events — including across a restart — cannot re-trigger work. Each dispatch is audit-logged as `reaction_trigger`.
  - **Off by default**: with no `reactionTriggers` map, no emoji is recognised and the `reaction` event type is not even requested from Zulip, so an account without triggers pays nothing.
  - Deliberately **not** a workflow/script launcher: the trigger is an instruction to the agent already in that conversation, so its blast radius is the same as someone typing it.
- **Manifest config schemas were missing four runtime keys** (#298): `dmSessionTurnLimit`, `enableSessionRecovery`, `maxMessagesPerMinute` and `maxMessageLength` existed in the runtime schema and the UI hints but in **neither** JSON schema in `openclaw.plugin.json`. Both schemas are `additionalProperties: false`, and the host validates the root one at load time on older hosts, so a config using any of those keys could be rejected. All four are now declared in both, and a new `test/schema-manifest-parity.test.ts` asserts the runtime account schema, both manifest schemas and the UI hints describe the same key set — so this drift cannot recur silently.

### Changed
- **CI: four checks instead of eight, and no host downloads for documentation changes**: the workflow declared a bare `on: push` alongside `on: pull_request`, so a push to a branch with an open PR fired both events and ran every job twice — each commit produced two workflow runs, and the PR listed 8 checks for 4 jobs. `push` is now scoped to `main`, and a `concurrency` group with `cancel-in-progress` cancels superseded runs. The main job also ran `check:bootstrap`, `check:clawscan` and `check:audit` as separate steps on top of `pnpm run check`, which already runs all three, so each executed twice per run for no extra signal — those duplicated steps are gone and `check` is now the single source of truth. `compat` and `tier2` now `needs` the main job, so an obvious typecheck or unit-test failure no longer spends ~780 MB of host downloads before reporting, and they are skipped entirely when a change touches only documentation (`*.md`, `docs/`, `LICENSE`), detected with a plain `git diff` rather than a third-party path-filter action. The main job is deliberately never skipped: ClawScan scans `docs/` and `check:package` asserts that files referenced by `package.json` exist, so a README edit can legitimately fail CI. Also added pnpm-store and `~/.npm` caching, per-job `timeout-minutes`, and `fail-fast: false` on the compat matrix so one host version failing no longer cancels the other.

### Fixed
- **SDK imports that no OpenClaw host exports** (found by `check:compat`): `deleteAccountFromConfigSection` and `setAccountEnabledInConfigSection` were imported from `openclaw/plugin-sdk/channel-core`, and `applyAccountNameToChannelSection` from `openclaw/plugin-sdk/account-core` — none of those subpaths export them. All three now import from `openclaw/plugin-sdk/core`.
- **Duplicate channel registration**: `registerFull` called `api.registerChannel({ plugin: zulipPlugin })` even though the `defineChannelPluginEntry` wrapper already registers the channel, so the host observed two registrations.
- **`allowInsecureHttp` was discarded on every API call** (`src/zulip/client.ts`): `buildZulipApiUrl()` re-normalized the already-normalized base URL *without* passing the option, so a plain-`http://` self-hosted realm (or a private/LAN address) that `createZulipClient()` had just accepted failed on the next request with `Zulip baseUrl is required`. The redundant re-normalization was removed.
- **Supported host floor declared as `2026.7.1`**: `openclaw.install.minHostVersion` was `>=2026.7.0` and `openclaw.compat.minGatewayVersion` was `>=2026.6.0` — neither `2026.6.0` nor `2026.7.0` was ever published to npm (both 404), so they named phantom versions and disagreed with each other. Both are now `>=2026.7.1`, matching the versions exercised by the `check:compat` CI matrix (`2026.7.1`, `2026.9.1`), and the README/AGENTS.md prerequisites were raised to match.
- **Docs corrected**: README, CONTRIBUTING and the PR template described the `npm run check` suite without its `clawscan` and `audit` steps; AGENTS.md did not document `check:compat`/`check:tier2`; and the AGENTS.md `zod` guidance was inverted (it pointed at `openclaw/plugin-sdk/zod`, which hosts removed by 2026.9.x — the plugin correctly uses bare `zod` as a runtime dependency).

## [2026.9.1] - 2026-09-20

### Added
- **`allowInsecureHttp` opt-in** for self-hosted servers on a trusted network: allows a plain `http://` Zulip URL **and** private/internal host addresses (a LAN Zulip is itself a private address), settable in `channels.zulip`, per account, or via `ZULIP_ALLOW_INSECURE_HTTP=1` for the default account. Because Zulip sends the bot API key as HTTP Basic on every request, this puts credentials on the wire unencrypted: it logs a startup warning, the setup wizard only accepts HTTP once the option is already set, and base-URL errors now name the option instead of failing generically.
- **Session archive repair for hosts without hard links** (Android/Termux): OpenClaw publishes a deleted session's transcript archive with an atomic `fs.link()`. Where hard links are unavailable — Android/Termux rejects `link()` with `EACCES` even inside app-private storage — that publish can never succeed, the row keeps `published_at` NULL, and the host then fails **every** session operation with `Session deletion committed, but N transcript archive file export(s) remain pending in SQLite`, so the bot cannot reply on any channel (observed on Zulip *and* Telegram, with no supported repair path: `sessions cleanup` retries the same blocked `link()`, and `doctor --fix` cannot verify service ownership on Android). The plugin now publishes those archives itself: it writes the stored blob to `{dataDir}/agents/{agentId}/sessions/{archiveName}`, verifies the checksum, and marks the row published. New `sessionArchiveRepair` config — unset (default) is automatic and activates only when a one-time probe shows hard links are actually unavailable, so healthy hosts never have their session database opened; `true` always runs; `false` never runs. Rows are skipped unless the archive name is safe, the blob checksum matches, and no file with different content already exists. This is a workaround for a host limitation and becomes unnecessary once the host falls back to a copy-based publish.

### Fixed
- **Idle poll spin loop / log flood** (#287): The monitor polls `/events` without an explicit `timeout`, so on hosts where the server answers immediately with a heartbeat event the loop re-polled every ~1.3s — measured on real hosts at 33,963 polls/day (`y6`, 43 MB of log) and 51,194–67,089 polls/day (`lab-openclaw`, ~99.5% of the entire gateway log, for an idle channel). Three changes:
  - `/register` now requests `fetch_event_types: ["realm"]` so the server actually returns `event_queue_longpoll_timeout_seconds` (it omits the field otherwise), and that value is enforced as the **client-side** `/events` abort budget (clamped to Zulip's 1–90s window, +15s grace). Note: `timeout` is **not** a valid `/events` query parameter — an earlier revision of this fix sent one and it was silently ignored.
  - The event queue is no longer deleted on clean shutdown. Deleting it while the persisted queue id survived made every restart begin with a guaranteed `BAD_EVENT_QUEUE_ID` round-trip, a 1s stall, and a window in which inbound messages could be lost.
  - The idle path now logs on transition and then at most once per 5 minutes (was: every poll).
  - When the server answers immediately with no message events, the loop backs off 1s → 2s → 4s → 5s (capped) and resets on the first real message. The backoff is **latency-gated**: a server that holds the long-poll (responses ≥ 2.5s) gets no added delay, so reply latency on healthy hosts is unchanged.
- **Audit logging silently disabled on Termux/Android**: `AuditLogger` defaulted to a hard-coded `/tmp/openclaw-zulip`, which does not exist on Android, and its write failures are swallowed by design — so every audit event was dropped without a warning. Dedupe, queue and audit now share one resolver (`src/zulip/data-dir.ts`): host `paths.dataDir` → `~/.openclaw` → `os.tmpdir()`. This also moves the queue file and audit log out of container `/tmp` (wiped on recreate) into the persistent data dir.
- **Incomplete data-dir unification**: `media-utils.ts`, `actions-upload.ts` and `send.ts` still used their own divergent `os.tmpdir()`/`~/.openclaw` fallbacks, so on Termux/Android (no `/tmp`) inbound attachments still failed to save and upload staging still landed in a wiped temp dir. All three now use `resolveZulipDataDir()`.
- **Test pollution**: dedupe/queue tests wrote `zulip_dedupe_test_*.json` into the live data dir (13 stray files were found on `lab-openclaw`). Tests now persist into a temp dir.
- **CLI `message send --channel zulip` failed with "Zulip runtime not initialized"** (#285): the CLI loads the plugin entry and dispatches channel actions *without* running gateway registration (`registerFull`), so the runtime singleton was never set and `getZulipRuntime()` threw before any network call. `getZulipRuntime()` now falls back to a minimal, cached CLI runtime when no host runtime is registered: config read from `{dataDir}/openclaw.json` (empty object on failure, so `ZULIP_*` env credentials still resolve), console logging, the resolved data dir, and the `channel.text` helpers needed to format and chunk outbound text. The gateway runtime stays authoritative. Gateway-only subsystems (mentions, reply dispatch, session routing, pairing, remote-media fetch) are deliberately absent, and a remote `mediaUrl` sent from the CLI now fails with an actionable message instead of a `TypeError`.

### Security
- **Allowlist authorization matched a user-settable display name** (`src/zulip/auth.ts`): `isSenderAllowed()` accepted an entry equal to Zulip's `sender_full_name`, so any user could rename their profile to an allowlisted address and bypass pairing and command authorization. Authorization now matches the stable sender id only.
- **Allowlist store could be injected from `/tmp`** (`src/zulip/monitor.ts`): the monitor probed `dataDir`, `~/.openclaw`, `/home/node/.openclaw` and the world-writable `/tmp/openclaw-zulip`, using the first readable file — and a `"*"` entry in it authorized everyone. The store is now read only from the resolved data dir via `src/zulip/allowlist-store.ts`, and a wildcard on disk is ignored.
- **Upload path allowlist exposed credentials and session transcripts** (`src/zulip/client.ts`): any file under `dataDir` (or tmpdir) could be uploaded to Zulip, so a prompt-injected agent could exfiltrate `openclaw.json`, `credentials/**`, session transcripts or the audit log as attachments. Sensitive files and directories are now refused explicitly.
- **Plain HTTP was accepted for the Zulip realm** (`src/zulip/client.ts`): `normalizeZulipBaseUrl()` allowed `http://` while `SECURITY.md` claimed HTTPS-only, putting the bot's API key on the wire in cleartext on every request. HTTPS is now required (see the `allowInsecureHttp` opt-in under Added).
- **Audit logging could fail silently and could prune its own live file** (`src/zulip/audit-logger.ts`): write failures were swallowed (this is how the Android `/tmp` bug stayed hidden) and the rotation filter matched the active log, so it could delete it. Failures are now reported through an `onError` hook wired to the logger, and rotation only considers rotated siblings.
- **Docs corrected**: `SECURITY.md` overstated the SSRF protection and audit-event coverage, and claimed "no runtime npm dependencies" (the plugin depends on `zod`) and a `pnpm-lock.yaml`-only lockfile (CI uses `package-lock.json`).
- **Outbound secret guard**: the plugin now refuses to send a Zulip message whose text contains a credential value from the host config. Reported after a live leak — an agent read `openclaw.json` and pasted six credential values into a Zulip DM. A path allowlist on file *uploads* cannot stop that, because nothing was uploaded: the agent read the file and typed its contents. The guard inspects the outbound text at the send choke point, blocks the message, and logs an audit event that names only *where* the credential came from (e.g. `channels.zulip.apiKey`) — never the value, since the message describing a leak must not become one. It cannot stop the file from being read (that is host tool policy); it stops the plugin from transmitting the value. New `blockSecretLeaks` config (default: enabled) opts out.

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
