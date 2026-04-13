
## 2026-04-11 - Optimize media uploads sending
**Learning:** Promise.all is great for executing independent async tasks like uploading different media files.
**Action:** Use Promise.all() when sending media replies to improve speed and reduce wait times.
