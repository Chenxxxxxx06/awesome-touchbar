# Local development preferences

- Keep changes and builds local for the user to try. Do not push commits, create pull requests, or publish GitHub releases unless the human explicitly requests upload/publication of the current work. A passing test suite is not publication approval.
- Never change real audio volume, mute, or media playback while testing. Desktop tests must force mock controls; AI tests use fixtures and must not read the real profile.
- AI monitoring is local and read-only. Do not read authentication files or send local sessions, configuration, task text, or credentials to remote services. Never print raw sessions or secrets in diagnostics.
- Distinguish recorded token usage from account quota. Show unknown or stale states honestly; do not infer remaining quota from token totals or running state solely from an installed executable.
- Preserve the compact dark, slightly rounded horizontal/vertical bar, free dragging and always-on-top behavior.
