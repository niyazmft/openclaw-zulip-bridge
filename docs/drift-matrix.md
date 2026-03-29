# Zulip Bridge Drift Matrix

This matrix compares the legacy installed state of the Zulip bridge against the current repository state (`main`).

| Feature / Aspect | Legacy Behavior (Installed) | Repo Behavior (Current) | Category | Impact |
| :--- | :--- | :--- | :--- | :--- |
| **Event Queue** | In-memory only; loses state on restart. | Persistent `queueId` and `lastEventId` in `os.tmpdir()`. | Runtime | High: Prevents missed messages during restarts. |
| **Deduplication** | In-memory only; risk of replay on restart. | Durable `ZulipDedupeStore` with filesystem persistence. | Runtime | High: Prevents duplicate message processing. |
| **Secret Handling** | Plaintext `apiKey` and `email` in `openclaw.json`. | Supports environment variables (`ZULIP_API_KEY`, etc.) with precedence. | Runtime | Critical: Security improvement, prevents secret leakage. |
| **Traffic Policies** | Fragile or underspecified DM/Stream routing. | Explicit `dmPolicy` (pairing, allowlist, open) and `groupPolicy`. | Runtime | High: Predictable and secure message routing. |
| **Observability** | Minimal logs; potential PII leakage. | Standardized logs with PII masking (`maskPII`) and stable identifiers. | Runtime | Medium: Safer and easier troubleshooting. |
| **Multi-account** | Single account support. | Explicit `accounts` map support in config (no env-var fallback for secondary). | Runtime | Medium: Enables multi-realm connectivity. |
| **Response Behavior** | Basic message sending. | Reaction-based status indicators and `blockStreaming` support. | Runtime | Medium: Improved user feedback and performance. |
| **Testing** | Limited or no local tests. | Full suite of unit and smoke tests (`test/*.test.ts`). | Dev-only | High: Ensures regression-free development. |
| **Documentation** | Minimal setup instructions. | Comprehensive `README.md`, `docs/config.md`, and `docs/smoke-test.md`. | Dev-only | Medium: Faster onboarding and clearer configuration. |

## Runtime vs. Dev-only Differences

- **Runtime-relevant**: Changes to logic in `src/zulip/` (queue management, deduplication, policy enforcement, PII masking) and the configuration schema. These directly affect how the bridge behaves and its security posture.
- **Dev-only**: Tests, documentation, and internal build tooling. While these don't change the execution logic, they are essential for long-term maintenance and reliable deployment.
