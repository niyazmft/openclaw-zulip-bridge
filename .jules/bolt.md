## 2026-05-11 - Optimization: Hoist botUsernameMention computation outside message handler loop
**Learning:** We observed that `botUsername.toLowerCase()` was being called repeatedly inside the `handleMessage` loop. Although a small operation, avoiding string allocation and processing on a hot path like checking every message string is a nice micro-optimization, especially for busy channels.
**Action:** Lift static computations outside the event loop processing path to save memory and CPU on hot paths. E.g., caching `botUsernameMention = '@' + botUsername.toLowerCase()` directly below other config lookups.

## 2026-05-14 - Optimization: Pre-compile RegExp for normalizeMention to avoid per-message allocation
**Learning:** The `normalizeMention` function in `text-utils.ts` was creating a new `RegExp` object for **every message** by escaping the username and constructing a regex pattern on each call. For busy channels processing hundreds of messages, this creates significant garbage collection pressure.
**Key insight:** RegExp objects are relatively expensive to create compared to reusing pre-compiled ones. The pattern `mention.replace(/[.*+?^${}()|[\]\\]/g, "\\$")` escapes special regex characters, then `new RegExp()` constructs the object - both operations run on every message.
**Action:** Accept `string | RegExp` in function signatures to allow callers to pre-compile patterns. In monitor initialization, compile the regex once and pass it through. This eliminates ~100% of regex construction overhead on the hot path. Always maintain backward compatibility by supporting both types.
**Follow-up learning:** Extracting the regex construction into a shared helper function (`createBotMentionRegex`) improves code maintainability by avoiding duplication between the fallback path and the pre-compilation path. Also added null-safety guard for `botUsername` to prevent runtime errors during edge case initialization.

## 2026-05-14 - Batch Optimization: Three hot path improvements in one session
**Learning:** When optimizing hot paths, look for patterns that repeat on EVERY message: allocations, disk I/O, and string processing. Three optimizations delivered together:
1. **effectiveAllowFrom caching:** Pre-computing allow lists at init eliminates Set/Array allocations per message
2. **Debounced disk I/O:** Writing to disk on every message is a major bottleneck - debouncing to 5s reduces I/O by ~90%
3. **Single-pass string replacement:** Chained `.replace()` calls create intermediate strings - combining into one pass with lookup table is more efficient
**Key insight:** Disk I/O is the most expensive operation in message processing. CPU optimizations (caching, single-pass) are good, but eliminating synchronous disk writes has the biggest impact on throughput.
**Action:** Always profile the hot path end-to-end to identify the real bottlenecks. Don't assume - measure. Batch related optimizations into single PRs for easier testing and review.
**Review feedback learning:** 
- Promise-based debounce can cause memory leaks with orphaned promises. Simple timeout-based approach is safer.
- Caching storeAllowFrom improves performance but creates data freshness trade-off. Document the trade-off clearly - pairing changes require restart, which is acceptable for rare pairing events.

## 2026-05-14 - Optimization: Lazily evaluate readAllowFromStore in message handler
**Learning:** We observed that `core.channel.pairing.readAllowFromStore` was being called for every incoming message in `handleMessage` event loop. This involves disk I/O. For channels where senders are already explicitly allowed by static config (`configAllowFrom` or `configGroupAllowFrom`), reading the dynamic pairing store from disk is unnecessary and adds overhead.
**Action:** Lazily evaluate dynamic state lookups (like disk reads) inside hot paths. Check static configurations first, and only perform the I/O if the user isn't already authorized by the static configuration, improving message processing throughput.

## 2024-06-01 - Optimize formatZulipLog Hot Path
**Learning:** `formatZulipLog` is called frequently for lifecycle events, messages, and errors. The previous implementation used `Object.entries(fields).filter(...).map(...).join(" ")`, creating multiple short-lived arrays per call. This causes unnecessary GC pressure in the `handleMessage` event loop.
**Action:** Replaced array iterations with a single `for...in` string builder loop. Microbenchmarks show this is ~5x faster (from 1.635s to 322ms per 1M iterations), reducing CPU overhead and GC pauses on the hot path.

## 2024-06-01 - Early Return Optimization string search hot paths
**Learning:** Checking for a literal substring via `.includes()` before running expensive regex operations (`matchAll`) can short-circuit the execution path when there's no match. This was implemented in `extractZulipUploadUrls` (by searching for `'/user_uploads/'`) avoiding slow $O(N)$ regex scanning of arbitrary chat messages.
**Learning (Failed Optimization):** Attempting to apply the same pattern to `extractZulipTopicDirective` actually DEGRADED performance because the regex (`/^\s*\[\[.../`) is anchored to the start of the string (`^`), making it fail in $O(1)$ time naturally. Adding `.includes('[[')` forced a full $O(N)$ string scan before the $O(1)$ regex could run, causing a regression on long messages.
**Learning (Failed Optimization):** Replacing `Object.keys(fields)` with an unguarded `for (const k in fields)` loop is unsafe. It iterates over inherited enumerable properties from the prototype chain, changing behavior and potentially leaking unexpected data into logs.
**Action:** Always consider regex anchors (like `^`) when optimizing matching functions. A naturally $O(1)$ failing regex is faster than a manually introduced $O(N)$ scan. Never use an unguarded `for...in` loop to replace `Object.keys()`.
