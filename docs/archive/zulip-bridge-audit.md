# Zulip Bridge Audit — OpenClaw

## Executive Summary
The current Zulip bridge is functional in concept but not yet production-robust. It successfully connects to Zulip and registers an event queue, but observed runtime failures indicate that inbound message handling is currently degraded.

## What Works
- Zulip channel startup succeeds
- Bot authentication succeeds
- Event queue registration succeeds
- Replies can be emitted back to Zulip
- Stream/topic context is partially mapped into OpenClaw session context

## What Is Broken or Weak
### Critical
1. Inbound handler runtime compatibility failure
2. Plaintext credential storage in config
3. Fragile or underspecified stream/group policy

### High
4. Drift between local custom plugin and installed OpenClaw runtime
5. Lossy topic/message semantics
6. Weak formatting fidelity
7. Narrow media/attachment handling
8. Insufficient observability

### Medium
9. In-memory-only dedupe
10. Partial queue resilience
11. Inconsistent target parsing between layers
12. Silent fallback behavior for missing topics

## Operational Impact
- Messages may be received but fail during handling
- Operators can see a healthy-looking connection while delivery correctness is degraded
- Restarts may increase replay/duplicate risk
- Debugging is slower than it should be

## PM Verdict
Do not treat the current bridge as finished infrastructure. Treat it as a custom adapter that needs a stabilization pass before broader rollout or migration decisions are made.
