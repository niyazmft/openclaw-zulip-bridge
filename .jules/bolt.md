## 2024-05-18 - Hoist mention regex compilation
**Learning:** To prevent CPU overhead and GC pressure, static channel configurations (like allowlists, runtime configs, and mention regex compilations) should be hoisted outside of tight event loops, such as the `handleMessage` function in `src/zulip/monitor.ts`.
**Action:** When implementing polling loops or event handlers that process high volumes of messages, identify and extract any configuration parsing, regex compilation, or static data structures initialization to execute only once before entering the loop.
