## 2024-11-20 - Concurrent Zulip attachment downloads
**Learning:** In the Zulip message monitoring pipeline (`src/zulip/media-utils.ts`), processing messages with multiple attachments sequentially using `for...of` loops introduces a significant bottleneck since attachments are downloaded and saved one by one.
**Action:** Always use `Promise.all` with `.map()` when downloading or processing independent arrays of resources (like media attachments) to avoid sequential await blocking, while preserving error isolation so a single failed download doesn't break the entire pipeline.
