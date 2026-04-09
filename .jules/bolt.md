## 2026-04-09 - [Testing Gap Addressed]
**Learning:** Learned about the `resolveDefaultZulipAccountId` function and its precedence rules for account resolution.
**Action:** Added comprehensive test coverage for `resolveDefaultZulipAccountId` in `test/accounts.test.ts` to ensure consistent and correct behavior across various configuration scenarios.
## 2024-05-18 - [Parallel Media Downloads]
**Learning:** Sequential processing of multiple attachments in the Zulip monitor can be a performance bottleneck.
**Action:** Use `Promise.all` with `.map()` to process array iterations asynchronously to speed up concurrent remote file downloads, while preserving array ordering.
