## 2024-06-25 - Batching Disk I/O operations in Event Polling Loop
**Learning:** The event polling loop in Zulip queue manager repeatedly flushed metadata to disk (O(N) operations) for every processed event, causing excessive disk I/O when processing large batches of events.
**Action:** When iterating over a batch of items that each require an update to a persisted state or cursor (like an `eventId`), keep track of the maximum value within the loop block, and perform a single write/update (O(1)) at the end of the batch instead of continuously updating it for each item.
