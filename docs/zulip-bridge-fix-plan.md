# Zulip Bridge Fix Plan — OpenClaw

## Objective
Upgrade the Zulip bridge from prototype-grade to production-trustworthy.

## Phase 0 — Success Criteria
- No inbound handler crashes
- No silent message drops
- Rare and recoverable queue re-registration
- Explicit DM/stream routing policy
- No plaintext secrets in main config
- Traceable logs for inbound and outbound handling

## Phase 1 — Critical Stabilization
1. Fix inbound runtime crash
2. Rebase / align plugin with current OpenClaw runtime
3. Make group and stream policy explicit
4. Move Zulip secrets out of plain config

## Phase 2 — Reliability Hardening
5. Add structured logging with message/session trace fields
6. Stop swallowing attachment and parse failures
7. Add durable dedupe / replay protection
8. Harden queue lifecycle recovery

## Phase 3 — Routing & Semantics
9. Remove unsafe default topic fallback
10. Preserve source message metadata structurally
11. Unify target parsing between action/send layers

## Phase 4 — Fidelity & UX
12. Replace regex stripping with proper formatting conversion
13. Improve media and attachment support matrix

## Phase 5 — Maintainability
14. Reduce local override fragility
15. Add regression tests for DM, stream, queue expiry, replay, routing, and attachments

## Suggested Delivery Sequence
### Sprint 1
- Runtime crash fix
- SDK/runtime alignment
- Policy clarification
- Secret migration
- Minimal structured logs

### Sprint 2
- Durable dedupe
- Queue hardening
- Error visibility improvements
- Topic handling cleanup
- Target parser unification

### Sprint 3
- Formatting fidelity
- Better message context preservation
- Media support improvements
- Regression tests
- Ownership/upstreaming decision

## Ownership Suggestion
- Anu: architecture, runtime compatibility, dedupe, recovery
- Enki: analysis, metrics, test matrix, log review
- Ninsun: formatting fidelity and operator readability
- Inanna: rollout framing and platform comparison implications
