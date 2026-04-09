## 2026-04-09 - Add tests for listZulipAccountIds
**Learning:** Learned to add missing tests for checking default empty responses and proper sorted order for multiple elements for listZulipAccountIds. Also had to use `--experimental-loader ./test-loader.js` inside tests which is specified in `npm test` script.
**Action:** Always check test patterns and the `npm test` script to see what specific arguments are needed, or run `npm test` as the standard test task when possible.
## 2024-05-18 - [Parallel Media Downloads]
**Learning:** Sequential processing of multiple attachments in the Zulip monitor can be a performance bottleneck.
**Action:** Use `Promise.all` with `.map()` to process array iterations asynchronously to speed up concurrent remote file downloads, while preserving array ordering.
