# AGENTS.md — OpenClaw Zulip Bridge

## Table of Contents

- [Essential Commands](#essential-commands)
- [Architecture](#architecture)
- [Activity Trace](#activity-trace)
- [TypeScript Conventions](#typescript-conventions)
- [Testing](#testing)
- [CI](#ci)
- [Build Artifacts](#build-artifacts)
- [Plugin Manifest](#plugin-manifest)
- [Environment](#environment)
- [Deployment](#deployment)
- [Security & Permissions](#security--permissions)
- [SDK Migration Notes](#sdk-migration-notes)
- [ClawScan Replica](#clawscan-replica-pre-publish-security-gate)
- [Troubleshooting](#troubleshooting)
- [Known Issues](#known-issues)

## Essential Commands

```bash
npm run check              # Full validation: bootstrap → typecheck → build → smoke → test → package → clawscan → audit
npm run typecheck          # tsc -p tsconfig.json (noEmit, type-checking only)
npm run build              # build:esm (tsc -p tsconfig.build.json → dist/) then build:cjs (scripts/build-cjs.js → dist-cjs/)
npm run test               # node --test --experimental-strip-types --loader ./test-loader.js test/*.test.ts
npm run check:bootstrap    # Verifies tsc is installed (skips devDeps if NODE_ENV=production)
npm run check:smoke        # Validates built dist/ artifacts with a loader that does NOT remap .js→.ts
npm run check:package      # Validates version sync, required fields, and npm pack integrity
npm run check:clawscan     # ClawHub moderation-engine replica (vendored) — scans src/ + dist/ + dist-cjs/ + docs
npm run check:gitleaks     # Secret detection (skips locally if gitleaks not installed; CI runs it)
npm run check:audit        # npm audit --omit=dev (production dependency vulnerabilities)
npm run check:compat       # Tier 1: loads the built plugin against real pinned OpenClaw hosts
npm run check:tier2        # Tier 2: outbound behaviour tests against a local fake Zulip server
```

**Command order matters**: `npm run check` runs steps sequentially. Building must precede smoke tests and package checks.

**`check:compat` and `check:tier2` are deliberately NOT part of `npm run check`** — both download a real `openclaw` host (~390 MB) and need network access, so they run as separate CI jobs.

## Architecture

- **Entry points**: `index.ts` (plugin) and `setup-entry.ts` (onboarding wizard). Both emit to `dist/`.
- **Core wiring**: `src/channel.ts` — the single file that glues config, accounts, messaging, security, and monitoring together via `createChatChannelPlugin`.
- **Host dependency**: `openclaw/plugin-sdk` subpaths are **not npm packages**. They are provided at runtime by the OpenClaw host. Type shims live in `types/openclaw-plugin-sdk.d.ts`; runtime test shims in `test/openclaw-plugin-sdk-shim.js`.
  - Prefer `openclaw/plugin-sdk/channel-core` for channel plugin APIs, but **several helpers exist *only* on `openclaw/plugin-sdk/core`**: `normalizeAccountId`, `deleteAccountFromConfigSection`, `setAccountEnabledInConfigSection`, `formatPairingApproveHint` (`src/channel.ts`) and `applyAccountNameToChannelSection` (`src/setup-core.ts`). Importing those from `channel-core`/`account-core` breaks the ESM entry at link time, and `test/smoke-loader.js` cannot catch it because its stub exports everything — only `npm run check:compat` does.
- **Monitor lifecycle**: The monitor must be started via `gateway.startAccount` inside the `base` parameter of `createChatChannelPlugin`. Putting `gateway` at the top level of the returned object causes `createChatChannelPlugin` to strip it during destructuring, resulting in the host throwing "Channel zulip does not support runtime start".
  - `gateway.startAccount(ctx)` receives `ctx.setStatus`, `ctx.abortSignal`, `ctx.account`, `ctx.accountId`, `ctx.cfg`, `ctx.runtime`, `ctx.log`.
- **Bot workspace**: `src/zulip/workspace.ts` provides sandboxed file storage under `{dataDir}/workspace/` with path-traversal rejection, TTL pruning (1h default), and optional Zulip upload integration.
- **Session recovery**: `src/zulip/recovery.ts` recovers interrupted messages after gateway restart. Opt-in via `enableSessionRecovery: true` (default: `false`).
- **Audit logging**: `src/zulip/audit-logger.ts` writes persistent JSON-line audit events to `{dataDir}/audit/{accountId}.audit.log` with 1MB rotation.
- **Rate limiting**: Configurable per-sender rate limit via `maxMessagesPerMinute` (default: `60`, `0` disables). Sliding 60-second window.
- **Activity trace**: `src/zulip/activity-trace.ts` (primitive), `src/zulip/tool-trace.ts` (mode A hooks), `src/zulip/progress-tool.ts` (mode B tool). Opt-in via `activityTrace`. See [Activity Trace](#activity-trace).
- **History-aware context**: `src/zulip/history-context.ts` harvests a bounded slice of the current stream/topic into the agent's prompt. Opt-in via `historyContext` (`"off"` default, `"on-demand"`, `"always"`). Bounded by `historyMaxMessages` (8) / `historyWindowHours` (72) / `historyMaxChars` (4000), wrapped in a 2s timeout, and log-and-drop on failure so a harvest can never delay or fail a dispatch. It appends to the agent-facing `Body` only (commands keep `CommandBody`/`RawBody`), applies to streams/topics only (DMs keep per-user session continuity + isolation), and reuses `fetchZulipMessages` — no new network path.
- **Actionable refs**: `src/zulip/refs.ts` renders `[[zulip_ref: <github url> | <label>]]` markers as links, but only after a **real** validation call. Opt-in via `renderRefs` (default `false`). Two invariants to preserve: (1) **nothing user-controlled is ever fetched** — only `https://github.com/<owner>/<repo>/{pull|issues|commit|actions/runs}/<id>` matches an anchored regex, the API origin is the hardcoded `GITHUB_API_ORIGIN`, and malformed refs are rejected *before* any fetch, so there is no allowlist knob that could become an SSRF primitive; (2) **validation failure degrades, never errors** — 404/rate-limit/timeout/network error render the ref as backticked plain text and the send proceeds. Validation is unauthenticated (public refs only; no credentials ever leave the process), cached 10 min, capped at 3 refs/message. Applied pre-chunk in `reply-handler.ts` (so a marker cannot split across messages) and in `sendMessageZulip` as the safety net for the CLI/fallback/trace paths.
- **Schema/manifest parity**: the runtime schema (`src/config-schema.ts`, zod) and the two hand-written JSON schemas in `openclaw.plugin.json` (`configSchema` + `channelConfigs.zulip.schema`) must describe the **same** keys. `test/schema-manifest-parity.test.ts` enforces it, because both JSON schemas are `additionalProperties: false` and the host validates the root one at load time on older hosts — so a key that exists at runtime but is missing from the manifest is a real config-validation bug, not a cosmetic one. Add a key to the runtime schema **and both manifest schemas** (plus `config-ui-hints.ts`) in the same change.
- **In-channel action triggers**: `src/zulip/reaction-triggers.ts` plus monitor/polling wiring. Opt-in via `reactionTriggers` (emoji name → instruction); absent means the `reaction` event type is not requested at all. Invariants to preserve: (1) a reaction is a **trigger, never an authorisation bypass** — the synthetic message (`buildReactionTriggerMessage`) carries the *reacting human* as its sender, so `decidePolicy`, the allowlists, the store allowlist, the command gate and the per-sender rate limit all apply to them; (2) only the bot's own **stream** messages are actionable unless `reactionTriggerAnyMessage` is set; (3) the synthetic message is marked `_reactionTrigger`, which is what bypasses the *mention/onchar* gates in `handleMessage` and nothing else; (4) it is deduped per `(message, emoji, user)` through the existing dedupe store (key from `reactionDedupeKey`, never the plain message key), so replays and restarts fire once; (5) each dispatch is audit-logged as `reaction_trigger`; (6) **the bot must be subscribed to the stream** — Zulip delivers `reaction` events only to *subscribers* while `message` events arrive anyway via `all_public_streams`, so an unsubscribed stream fails **silently** for triggers; the monitor warns at startup with the missing streams (`findUnsubscribedStreams`, which returns `[]` for `"*"` because that cannot be enumerated); (7) a live reaction event carries **`user_id` only** (no `user` object), so the reacting user's email is resolved via `fetchZulipUser` before the synthetic message is built — `handleMessage` derives its sender from `sender_email`, and without it every email-based allowlist rejects the turn as an un-authorizable numeric id. If the email cannot be resolved the trigger is dropped **with a warning**, never silently (this exact combination made the feature look broken in the field).
- **Per-session dispatch queue**: `src/zulip/session-queue.ts`, opt-in via `queueMode: "followup"` (default `"off"`). It exists because **a topic is one session**: the host's default (`messages.queue.mode: "steer"`) injects a mid-run message into the running turn, so a second person can redirect the first person's work — and the host's per-channel knob is unusable here (`messages.queue.byChannel.zulip` → `Unrecognized key: "zulip"`, since `byChannel` accepts only known/bundled channel ids) while a per-message override is not exposed to channel plugins (`queueModeOverride` lives only on the host's internal/gateway chat-send path). So the plugin queues *before* handing the message over and the host never sees two concurrent turns for one session. Invariants: **FIFO per session** — chain onto the tail **at enqueue time**, because reading it after the wait lets two followers wait on the same predecessor and then run concurrently; the task's result/error propagates unchanged (the monitor uses it for terminal status, so queuing must not swallow an error); a full queue (`queueCap`, default `20`) **dispatches immediately rather than dropping** (`onCapReached`); and the waiting message is marked via `reactions.onQueued` (default `hourglass`) since Zulip has no queued-input surface; each transition is also audit-logged as `message_queued`/`message_dequeued`, because the ⏳ is transient and the gateway log is not a reliable record (see [Testing](#testing)). Telegram and other channels are unaffected.
- **Security docs**: See `SECURITY.md` for full security policy covering credential handling, data access, and network communication.

## Activity Trace

Epic #293. When `activityTrace: true`, the plugin keeps **one dedicated bot-owned status message
per work item** and edits it in place as the run progresses, instead of the room seeing only the
final reply (or nothing at all when a run produces no reply).

- **The rule**: *status detail edits the trace; actionable results are posted as new messages.* The
  trace layer only ever edits its own message; agent replies stay separate.
- **Module split**: `activity-trace.ts` is the primitive (`TraceState`, stable step ids, coalescer,
  renderer, registry). `tool-trace.ts` is mode A. `progress-tool.ts` is mode B. `reply-handler.ts`
  owns the run boundary (start on dispatch, finish on success/error/abort).
- **Mode A — plugin-driven**: registers the host's `after_tool_call` hook with
  `{ matcher: ["exec"], timeoutMs: 2000, registrationId }`, falling back to simpler options and never
  registering without a matcher. **Never register `before_tool_call`** — it is a *fail-closed* gate, so
  a slow handler there blocks the agent's own tool call. The handler is synchronous (no I/O) and hands
  off to the coalescer. Hook payloads identify the *agent run* (`sessionKey`/`runId`), never the room,
  so attribution is done through `findActivityTrace()`; unattributable hooks are **dropped**, never
  guessed. Registration is idempotent with its own guard plus a stable `registrationId` (openclaw#86241
  documents N-fold delivery from handler stacking across hot reloads).
- **Mode B — agent-driven**: the `zulip_progress` tool lets the agent narrate intent mode A cannot
  infer. **Surface decision**: the `message` tool's action vocabulary is a deliberately *closed,
  core-owned* list (`src/channels/plugins/message-action-names.ts`: "Plugins add names through a core
  PR; runtime registration is intentionally unsupported") and the message-tool schema is built from
  that list, so the channel action adapter **cannot** carry a new verb. `api.registerTool` is the
  supported plugin surface for a plugin-owned tool and requires `contracts.tools: ["zulip_progress"]`
  in `openclaw.plugin.json`. Correlation comes from the per-run `OpenClawPluginToolContext.sessionKey`.
  No active trace is a no-op, never an error.
- **Write path**: posts go through `sendMessageZulip` (secret guard + media/SSRF hardening inherited);
  edits go through `editZulipMessage`. **Trace edits bypass `sendMessageZulip`'s secret guard**, so
  `createZulipTraceIo` redacts known host credentials (`redactSecrets` in `secret-guard.ts`) for both.
- **Coalescing is non-negotiable**: `traceCoalesceMs` (default `400`) plus a hard `traceMaxRate`
  ceiling (default `2`/sec) because Zulip edits are ~600ms round-trips. An unchanged render spends no
  PATCH at all.
- **Failure policy**: a failed post drops the trace; a failed edit is logged and dropped. Never a retry
  loop (cf. the #287 poll spin loop), never a user-visible error, never on the agent's critical path —
  the final edit is not awaited. A dead trace must not fail a dispatch or suppress a reply.
- **Knobs**: `activityTrace` (default `false`), `traceCoalesceMs` (400), `traceMaxRate` (2) — in the
  runtime schema, `config-ui-hints.ts`, and **both** manifest schemas + `uiHints`. With the flag off,
  behaviour is identical to a build without the feature.
- **Restart recovery**: in-flight traces are persisted to
  `{dataDir}/zulip_traces_{accountId}.json` (message id + target + title + createdAt), and
  `recoverInterruptedTraces()` runs at monitor start to collapse anything a previous process left
  mid-run to `⚪ **Cancelled** — run interrupted by a gateway restart` (audited as
  `activity_trace_recovered`, or `activity_trace_recovery_failed` with the reason when Zulip refuses
  the edit). This exists because **only the process that created a trace can
  finalize it**: a deploy, OOM or crash mid-run otherwise left `**Working** — …` frozen in the topic
  forever — the one case where "no trace is left permanently in progress" did not hold (hit live on
  y6 when a deploy landed during a run). `stop()` persists rather than clears, so a graceful
  shutdown is covered too, and a failed recovery edit is logged while the file is still cleared so it
  cannot repeat on every start.

## TypeScript Conventions

- **ESM only**: `"type": "module"` in package.json. All imports use `.js` extensions (NodeNext resolution) even though source files are `.ts`.
- **Lenient config**: `strict: false`, `noImplicitAny: false` — don't add strictness flags without asking.
- **Two tsconfigs**: `tsconfig.json` for typechecking (noEmit, includes `test/`); `tsconfig.build.json` extends it, enables emit, disables `allowImportingTsExtensions`, excludes `test/`.

## Testing

- Uses Node.js built-in test runner (`--test` flag), not Jest/Vitest.
- Custom loader (`test-loader.js`) remaps `openclaw/plugin-sdk` imports to the shim and resolves `.ts` from `.js` imports.
- Run a single test: `node --test --experimental-strip-types --loader ./test-loader.js test/policy.test.ts`
- The `npm run test` glob is `test/*.test.ts`, so **`test/tier2/` is excluded by construction** — those tests import built `dist/` artifacts and need a real host in `node_modules` (supplied by `npm run check:tier2`).
- No external services required: unit tests use in-process SDK shims, and the Tier 2 fake Zulip server is a local HTTP server created per test.
- **Verify in the field through the audit log, not the gateway log**: plugin child-logger output does not reach the host log on every host (verified on Termux: zero plugin lines in the gateway log), so behaviour is confirmed through `{dataDir}/audit/{accountId}.audit.log` or the Zulip API. Field notes elsewhere in this file assume that.

## CI

Triggers: pushes to `main`, and all pull requests. `push` is deliberately scoped to `main` — an unscoped `push` together with `pull_request` fires both events for a PR branch and runs every job twice (this was live: 8 checks for 4 jobs). A `concurrency` group with `cancel-in-progress` cancels superseded runs when a PR is pushed repeatedly.

Three jobs, Node 22 + pnpm 10.32.1:

| Job | Purpose | Runs |
|-----|---------|------|
| `zulip-bridge` | The gate: `pnpm install`, then `pnpm run check` (bootstrap → typecheck → build → smoke → test → package → clawscan → audit), gitleaks, and a pristine-working-directory check (`git diff --exit-code`) | Always |
| `compat` | Tier 1 host compatibility — the only check that catches `openclaw/plugin-sdk/*` subpath/named-export drift and registration/manifest shape bugs. Matrix `2026.7.1`, `2026.9.1` with `fail-fast: false` so both versions report | Code changes only |
| `tier2` | Outbound behaviour against the local fake Zulip server | Code changes only |

`compat` and `tier2` both `needs: zulip-bridge`, so a typecheck or unit-test failure does not first spend ~780 MB downloading hosts. They are also skipped when a change touches only documentation (`*.md`, `docs/`, `LICENSE`) — `zulip-bridge` publishes a `code` output computed with a plain `git diff` (no third-party path-filter action) and the heavy jobs gate on it. Both cache `~/.npm`, which is where the throwaway-workspace `npm install openclaw@<version>` lands.

**Never skip `zulip-bridge` for docs-only changes**: ClawScan scans `docs/` and `check:package` asserts that files referenced by `package.json` exist, so a README edit can legitimately fail CI.

**Branch-protection caveat**: a skipped job reports as *skipped*, not *successful*. If `compat`/`tier2` are made required checks, a docs-only PR can be left blocked — mark only `zulip-bridge` as required, or drop the docs-only gating.

## Build Artifacts

`dist/` is gitignored and must be built locally. The smoke test imports from `dist/`, so `npm run build` must succeed before `check:smoke` or `check:package` can pass.

- The **smoke test** (`scripts/smoke-test-dist.js`) is executed via `test/smoke-loader.js`, which **only** shims `openclaw/plugin-sdk` and deliberately does **not** redirect `.js` imports to `.ts`. This ensures the test exercises actual built artifacts in `dist/`, not source files.
- The **package check** (`scripts/check-package.js`) verifies version sync between `package.json` and `openclaw.plugin.json`, confirms every file in `package.json` `"files"` exists, and validates that critical artifacts and metadata are included in `npm pack --dry-run` output.

### Tier 2 behaviour tests (outbound)

`npm run check:tier2` runs integration-style tests against a **local fake Zulip server** (no external network). The fake server implements the small Zulip API surface the plugin uses (`/register`, `/events`, `/messages`, `/user_uploads`, reactions, edits, typing). Tests verify:

- `sendZulipStreamMessage` — stream, topic, and content are captured
- `sendZulipPrivateMessage` — DM recipients and content are captured
- `uploadZulipFile` — multipart upload is captured
- `addZulipReaction` — emoji name and message ID are captured
- `editZulipMessage` — PATCH body and message ID are captured
- `sendZulipTyping` — typing op and recipients are captured

Why a workspace? The test files import `../dist/src/zulip/client.js`, which in turn imports `openclaw/plugin-sdk/*`. Those subpaths only resolve when `openclaw` is present in `node_modules` — which the repo intentionally does **not** ship. The runner creates a throwaway workspace, installs the pinned host, copies `dist/` and `test/tier2/`, and runs the tests.

**Not included in `npm run check`** — Tier 2 requires downloading `openclaw` (~390 MB) and is therefore run as a separate CI job (`check:tier2`).

## Plugin Manifest

`openclaw.plugin.json` version must stay in sync with `package.json` version. `npm run check:package` validates this.

## Environment

Dev dependencies must be installed. `.npmrc` sets `include=dev` to prevent npm from skipping devDeps. If bootstrap fails, check that `NODE_ENV` is not set to `production`.

## Deployment

This plugin targets **any OpenClaw host** running `>=2026.7.1`. It is not limited to a specific device or platform.

### Install via ClawHub (recommended)

```bash
openclaw plugins install clawhub:@niyazmft/openclaw-zulip
```

Then restart the gateway and run `openclaw channels add` to configure.

### Manual deployment

1. Build: `npm run build`
2. Copy `dist/` and `openclaw.plugin.json` into the host's extensions directory (default: `~/.openclaw/extensions/zulip/`).
3. Restart the OpenClaw gateway.

Example — local host:
```bash
npm run build
rsync -avh --delete dist/ ~/.openclaw/extensions/zulip/
rsync -avh openclaw.plugin.json ~/.openclaw/extensions/zulip/
# Restart the gateway
```

Example — remote host:
```bash
npm run build
ssh remote "mkdir -p ~/.openclaw/extensions/zulip/"
rsync -avh --delete dist/ remote:.openclaw/extensions/zulip/
rsync -avh openclaw.plugin.json remote:.openclaw/extensions/zulip/
# Restart the gateway on the remote host
```

The host provides the `openclaw/plugin-sdk/*` modules at runtime (they are **not** npm packages). The plugin's npm runtime dependencies are `zod` (config-schema validation) and `typebox` (the `zulip_progress` tool schema, pinned to the host's own version so the schema objects are identical), staged during install by `openclaw.build.stageRuntimeDependencies`.

**Deploy the manifest before the config that uses it.** A channel config section is validated against the *installed* manifest, so a new key written to `openclaw.json` before the updated `openclaw.plugin.json` reaches the host fails validation: the host logs a failed channel restart and restarts the gateway to recover (hit in the field while deploying the #297 queue keys). Ship the manifest first, or both together.

## Security & Permissions

### Destructive Actions

The following actions require **explicit confirmation** (`confirm: true`) to prevent accidental execution by AI agents:

| Action | Confirmation Required | Admin Privilege Required | Description |
|--------|----------------------|-------------------------|-------------|
| `delete` | ✅ `confirm: true` | ❌ No | Permanently deletes a Zulip message |
| `channel-delete` | ✅ `confirm: true` | ✅ Yes | Deletes a Zulip stream/channel |
| `user-deactivate` | ✅ `confirm: true` | ✅ Yes | Deactivates a Zulip user account |
| `user-reactivate` | ✅ `confirm: true` | ✅ Yes | Reactivates a Zulip user account |
| `org-settings-edit` | ✅ `confirm: true` | ✅ Yes | Updates organization settings |

### Admin Actions Gate

Actions marked "Admin Privilege Required" are additionally protected by:

1. **`enableAdminActions: true`** in your Zulip channel config
2. **The bot account must have Zulip admin privileges** on the server

Without both safeguards, admin actions will throw an error.

### Best Practices

- Use a **least-privilege bot account** (Generic Bot, not Admin Bot)
- Keep `enableAdminActions: false` unless you explicitly need stream management or user lifecycle operations
- Restrict `streams` and `allowFrom` to minimize exposure

### Multi-User Data Isolation

| Surface | Isolation | Mechanism |
|---------|-----------|-----------|
| DM sessions | ✅ Per-user | Each sender gets their own session key via the host's `dmScope: "per-channel-peer"`. DM session rotation (`dmSessionTurnLimit`) further bounds context lifetime. |
| Stream/topic sessions | ⚠️ Shared by design | All users in a stream/topic share one session — this is intentional. |
| Agent memory / workspace | ❌ Host-global | Long-term memory, notes, and workspace files are scoped by the host, not by this plugin. |
| Tool/credential scope | ❌ Host-global | The agent's tools and credentials are the same regardless of which user is talking. |

**Recommendations for multi-user deployments:**

1. Treat stream sessions as **public context** — never rely on them for private data.
2. Restrict `allowFrom`/`groupAllowFrom` to trusted users; for strict single-user isolation, allowlist a single address.
3. Prefer DMs for anything private; the per-user DM session keys ensure DM context never mixes across senders.

## SDK Migration Notes

### 2026.4.29 → 2026.5.x
Migration complete as of v2026.5.1:
- `openclaw/plugin-sdk/irc` → `channel-inbound` + `command-auth` subpaths
- `channel-runtime` → `channel-reply-options-runtime`
- Manifest uses `channelConfigs` (cold-path config schema); env vars are declared under `setup.providers[].envVars` in the manifest and `openclaw.envVars` in `package.json` — `providerAuthEnvVars`/`channelEnvVars` are no longer used (removed in v2026.7.7)

### 2026.5.x → 2026.6.x / 2026.7.x
Migration complete as of v2026.7.0:
- `openclaw/plugin-sdk/core` → `openclaw/plugin-sdk/channel-core` for channel plugin imports **except** the helpers that exist *only* on `openclaw/plugin-sdk/core`:
  - `normalizeAccountId`
  - `deleteAccountFromConfigSection`, `setAccountEnabledInConfigSection`, `formatPairingApproveHint` (`src/channel.ts`)
  - `applyAccountNameToChannelSection` (`src/setup-core.ts`) — not exported from `account-core` either
  - Getting these wrong is invisible to `npm run check` (the smoke loader stubs every SDK specifier with `noOp`, so a missing export cannot surface); `npm run check:compat` is what catches it.
- `openclaw/plugin-sdk/zod` → the subpath existed on hosts `2026.6.x`–`2026.7.x` but was **removed by 2026.9.x**. The plugin uses bare `zod` (declared as a runtime dependency) which is the correct current approach.
- Keep both root `configSchema` and `channelConfigs` in the manifest. OpenClaw 2026.6.x still validates the root schema at load time
- Manifest `uiHints` synced with runtime schema for full cold-path label coverage
- `minGatewayVersion` and `minHostVersion` are both `>=2026.7.1` — the lowest OpenClaw version actually published on npm (both `2026.6.0` and `2026.7.0` are phantom versions; `npm view openclaw@2026.7.0` is a 404)

## ClawScan Replica (pre-publish security gate)

`scripts/clawscan/` vendors the **exact ClawHub moderation engine** (`convex/lib/moderationEngine.ts` + `moderationReasonCodes.ts`, engine v2.4.26, commit `60b02c09`) and runs it against source + built output + docs. This is the same scanner ClawHub runs on publish, so a clean local run means a clean ClawHub scan (for the static rules).

- **Run**: `npm run check:clawscan` (also part of `npm run check` and CI)
- **Strict gate**: exits non-zero on any finding — a finding blocks merge/publish
- **Vendor update**: re-download from the commit header in `scripts/clawscan/vendor/moderationEngine.ts` and re-apply the one-line import patch (`./moderationReasonCodes` → `./moderationReasonCodes.js`)
- **Env-var exemption**: the scanner suppresses `env_credential_access` only when every referenced env var is declared in manifest metadata (`envVars`/`env`/`primaryEnv`/`requires.env`) AND access is explicit (not `process.env[name]`). The plugin satisfies both: explicit access in `getZulipEnvSecret` (`src/zulip/accounts.ts`) + `openclaw.envVars` in `package.json`.
- **#268 safety**: the local-file attach fix must keep file reads in `readSafeLocalFile` and network sends in `uploadZulipFile` — a new `readFile`+`fetch` pair in an action handler would trip `potential_exfiltration`.

## Troubleshooting

- **Health-monitor restarts every ~5 min** with `reason: stopped`: Fixed in v2026.8.4+. `gateway.startAccount` must be placed inside the `base` parameter of `createChatChannelPlugin`, not at the top level. The host checks `snapshot.running` to decide if channel is alive.
- **Monitor never starts after hot reload / wizard config**: If `startZulipMonitor` creates an `AbortController` before validating credentials, and credentials are missing at startup, the controller blocks all future starts. Only create the controller **after** credential validation, right before launching the actual monitor loop.
- **Host calls `registerFull` twice**: harmless in practice — a module-level `registerFullCalled` guard skips the duplicate (present since v2026.7.4). This is normal host behavior.
- **"Invalid config: must not have additional properties: streaming"**: The host's `openclaw channels add` wizard writes `"streaming": true` to the config. If your manifest JSON Schema has `"additionalProperties": false` and `streaming` isn't in `properties`, config validation fails. Add `streaming` to BOTH `configSchema` and `channelConfigs.schema` in `openclaw.plugin.json`.
- **`readAllowFromStore(channelName)` throws** "invalid pairing channel: expected non-empty string; got undefined": SDK bug in host `2026.7.1`. Workaround: read `credentials/zulip-{accountId}-allowFrom.json` directly from the data directory.
- **Zulip poll spin loop floods the gateway log** (#287): The monitor re-polled `/events` every ~1.3s on hosts where the server answers immediately with a heartbeat event (measured: 34k–67k polls/day; 97.8–99.5% of the entire gateway log, tens of MB/day, for an *idle* channel). Fixed in v2026.9.1 by enforcing the server's `event_queue_longpoll_timeout_seconds` (requested at `/register` with `fetch_event_types: ["realm"]`) as the **client-side** `/events` abort budget — `timeout` is *not* a valid `/events` query parameter — plus throttling the idle log line to once per 5 minutes and a latency-gated idle backoff (1s→5s). Note the backoff must stay latency-gated: a server-held long-poll (~50s responses, e.g. zulipchat.com) gets **no** added delay, otherwise every reply gains up to 5–30s of latency.
- **Audit log silently dead on Termux/Android**: `core.paths.dataDir` is undefined on Termux, and `AuditLogger` fell back to a hard-coded `/tmp/openclaw-zulip` — Android has no `/tmp`, and the write failure is swallowed, so all audit events were dropped silently. Termux now resolves to `~/.openclaw` (shared resolver in `src/zulip/data-dir.ts`). On containers the same change moves the queue file and audit log out of `/tmp` (wiped on recreate).
- **Dedupe store blocks re-processing across restarts**: the dedupe file (`{dataDir}/zulip_dedupe_{accountId}.json`) survives restarts, including container recreation. Delete it when testing fresh message flows.
- **Env vars override config**: The host resolves credentials from env vars first, then config. If `ZULIP_EMAIL` or `ZULIP_API_KEY` are set in the host environment, they override `openclaw.json` values.
- **Missing channelConfigs warning**: Ensure openclaw.plugin.json has `channelConfigs` section with `schema` and `uiHints`.
- **No startup logs** for your channel? Verify host calls `startAccount` and `listAccountIds` returns expected account IDs.
- **Telegram fetch timeouts**: Separate network issue on the test device, not related to your plugin.
- **Zulip responses are slower than Telegram**: Zulip API round-trips from the container take ~600ms each. To reduce latency, keep `showThinkingPlaceholder: false` (default) so the bot only shows a typing indicator instead of posting and editing a "Thinking..." placeholder message. Enable the placeholder only when users need the extra visual feedback.
- **`message` tool removed by host `coding` profile**: The host's `tools.profile: "coding"` strips the `message` tool from the agent, so replies fall back to reading the session trajectory after the run ends. For the cleanest chat UX, use a profile that keeps `message` (e.g., `"chat"`) or add `message` to the profile's allowlist. This affects all chat channels, not just Zulip.
- **`typingCallbacks.onIdle()` returns `undefined`** (host 2026.7.1-2): The SDK's `createTypingCallbacks` may return `undefined` from `onIdle()`. Calling `.catch()` on `undefined` throws a `TypeError` that is silently swallowed by the dispatcher's `onError` handler, crashing the deliver callback before `sendMessageZulip` is called. Fixed in v2026.8.4+ with a type guard and try-catch around the deliver callback body.
- **`describeMessageTool` fails** with "expected chat channel metadata: zulip to be defined": `getChatChannelMeta("zulip")` always returns `undefined` because Zulip is a third-party plugin. Fixed in v2026.8.4+ by returning the plugin's own `zulipChannelMeta` directly.
- **Fallback reader misses replies**: The mtime-based file filter was unreliable because session files are reused and buffered writes don't always update `mtime` synchronously. Fixed in v2026.8.4+ by removing the mtime filter entirely and using event-time filtering (`event.ts >= dispatchStartTime`) instead.
- **`humanDelay` adds ~16s delay**: The SDK's `resolveHumanDelayConfig` has a built-in default of ~14-16 seconds. Fixed in v2026.8.4+ by setting `humanDelay: 0` in `reply-handler.ts`.
- **`core.log` is a no-op**: The `core.log` function provided by the host does not write to any log file. The working logger is `core.logging?.getChildLogger({ module: "zulip" })?.info` / `.error`. All debug logging in the message flow now uses the proper logger.
- **Node 24 / CJS Gateway hosts `ERR_REQUIRE_ESM_RACE_CONDITION`**: The plugin ships a CommonJS build (`dist-cjs/index.cjs`) via `openclaw.runtimeExtensions`. This lets CJS Gateway hosts load the plugin entry via `require()` without a runtime ESM translator, which avoids the jiti fallback crash seen on some Node 24 hosts. It does **not** fully bypass the Node.js ESM/CJS loader race on Termux because the host-provided OpenClaw SDK modules remain ESM. The proper fix is upstream in OpenClaw (openclaw/openclaw#83035). Until then, Node 22 is the recommended host runtime; Termux users are blocked because Termux only ships Node 24 LTS.
- **Honcho HTTP 422 on messages >25,000 chars**: The `openclaw-honcho` plugin fails when message content exceeds Honcho's limit. The plugin caps outbound messages via `maxMessageLength` (default 20,000 chars). Set to `0` to disable truncation if your Honcho deployment supports larger messages.
- **Internal status messages leak into chat**: Fixed for 2026.9.2+ hosts. The deliver callback drops non-terminal tool-error warnings (SDK `isReplyPayloadNonTerminalToolErrorWarning` marker) and compaction/fallback/status notices before they reach Zulip. Agent-run failure messages (`payload.isError`) are still delivered — they are deliberately user-facing. On hosts older than 2026.9.2 the markers are absent, so leaks can still occur there.
- **Zulip topics share one session display name**: Stream conversation labels now include the topic (`#main / topic`), so the host WebUI shows distinct names per topic. Existing sessions adopt the new label on their next message.
- **File attachments (#268)**: The core `upload-file` action (`src/actions-upload.ts`) stages bytes in the bot workspace (`dataDir/workspace/`) and uploads via `uploadZulipFile`. Local `mediaUrl` paths in `send.ts` also go through `uploadZulipFile`. Safety invariant: file reads stay in `readSafeLocalFile` (path allowlist: tmpdir + dataDir; symlink/traversal rejection) and network sends in `uploadZulipFile` — a new `readFile`+`fetch` pair in an action handler would trip ClawScan's `potential_exfiltration` rule. The bot workspace helper (`src/zulip/workspace.ts`) is now wired into the action flow (was test-only).

- **"Zulip site URL uses plain http://" / bot refuses to start after upgrade**: HTTPS is required because Zulip sends the bot API key as HTTP Basic on every request. For a self-hosted server on a trusted network, set `allowInsecureHttp: true` in `channels.zulip` (or on a specific account, or `ZULIP_ALLOW_INSECURE_HTTP=1` for the default account). This also permits private/internal host addresses — needed for a LAN server — and logs a startup warning that credentials are unencrypted. The setup wizard only accepts an `http://` URL once the option is already present in config.
- **"Zulip allowlist store contained '*'"**: the persisted allowlist file had a wildcard entry, which is now ignored (only static config may authorize everyone). Rewrite the file with explicit user emails/ids if you intended to authorize specific people.

- **CLI `message send --channel zulip` says "Zulip runtime not initialized"**: fixed in v2026.9.1. The CLI loads the plugin entry and dispatches channel actions without running gateway registration (`registerFull`), so the runtime singleton was never set. `getZulipRuntime()` now falls back to a minimal CLI runtime (config, logging, data dir, text chunking helpers) instead of throwing; the gateway runtime still takes precedence. Gateway-only subsystems stay absent from the fallback, so a remote `mediaUrl` sent from the CLI reports that it needs the gateway runtime rather than throwing a `TypeError`.
- **Bot stops replying on *every* channel: "Session deletion committed, but N transcript archive file export(s) remain pending in SQLite"**: a host/platform limitation, not a plugin bug. OpenClaw publishes a deleted session's transcript archive with `fs.link()`, and Android/Termux rejects `link()` with `EACCES` even inside app-private storage — so the publish never completes and the host then throws on every session operation (Zulip *and* Telegram, not just the deleted session). The plugin repairs these itself: `sessionArchiveRepair` (unset = automatic, active only when the hard-link probe fails; `true` = always; `false` = off). Note `openclaw sessions cleanup` and `doctor --fix` cannot help here — the former retries the same blocked `link()`, the latter refuses on Android ("Gateway service install not supported on android"). Inspect the backlog with `SELECT COUNT(*) FROM session_transcript_archives WHERE published_at IS NULL` in `{dataDir}/agents/{agentId}/agent/openclaw-agent.sqlite`. Repair activity is logged as `zulip session archive repair: …` (plugin logs do not surface on every host — see [Testing](#testing)); the SQL count above is the reliable check.

- **Agent pasted credentials into chat**: the plugin now blocks outbound messages containing a credential value from the host config (`blockSecretLeaks`, default on) and audit-logs the matching config path (`secret_leak_blocked`). Be aware of the limits: (a) the plugin cannot stop the agent *reading* `~/.openclaw/openclaw.json` — that is host tool policy, so restrict tool access if this matters; (b) a message already sent can only be deleted/edited by the bot within the realm's `message_content_delete_limit_seconds` / `message_content_edit_limit_seconds` — past that, only a realm admin can remove it (we hit exactly this: the bot got `400 The time limit for deleting this message has passed`); (c) deleting a session does **not** destroy its transcript — the host *archives* it into `session_transcript_archives`, so purge the archive row/blob too. Rotation of the exposed credentials is the only real remedy.

## Known Issues

- **Bot Presence (Online Status)**: Zulip's `POST /users/me/presence` endpoint explicitly rejects bot requests — the bot never shows as 🟢 online. This is a platform limitation, not a bug.
- **Performance: First Message After Startup is Slower**: The first message after startup takes longer because the plugin initializes connections and warms up caches.
- **Typing indicator TTL exceeded**: The typing indicator auto-stops after 60 seconds if the response takes longer. This is expected behavior.
- **Legacy Skill Packages**: Old `openclaw skill` packages are deprecated in favor of the current plugin architecture. Migrate any legacy skills to the new plugin format.
- **DM/Thread Session Conflation After Restart**: After a gateway restart, the agent may occasionally conflate context from different conversations. The OpenClaw host uses a filesystem fallback reader for third-party plugins when the SQLite WAL has not flushed. Mitigation: the plugin sets `MessageThreadId` to senderId for DMs and topic for streams; use `dmSessionTurnLimit` (default 20) to rotate sessions; use `/new` or `/reset` to force a fresh session. The proper fix is upstream.

**Note**: This file is maintained as project documentation and is safe to commit.
