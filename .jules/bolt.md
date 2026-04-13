## 2025-03-03 - Hoisting Static Configurations Out of Message Loops
**Learning:** In highly active integration monitors (like Zulip polling), initializing channel configurations, permissions lists, and expensive Regex objects inside the tight event loop (`handleMessage`) leads to unnecessary CPU cycles and heavy garbage collection per event.
**Action:** Always hoist static channel configuration fetching, regex compilation, and permissions parsing out of the tight polling and event handler loops where they only depend on the static environment config, rather than per-event data.
