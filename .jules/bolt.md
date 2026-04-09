## 2024-05-18 - [Parallel Media Downloads]
**Learning:** Sequential processing of multiple attachments in the Zulip monitor can be a performance bottleneck.
**Action:** Use `Promise.all` with `.map()` to process array iterations asynchronously to speed up concurrent remote file downloads, while preserving array ordering.
