# Security model

- Request an IPv4 loopback bind and accept Codex targets only from IPv4/IPv6 loopback hosts.
- Treat the CDP port as locally sensitive while Codex is open.
- Store the helper, state, PID, and logs only in the current user's application-data directory.
- Store selected media in the Codex renderer's local IndexedDB; never upload it.
- Validate a recorded injector PID against its expected command before stopping it.
- Keep ordinary uninstall reversible by preserving renderer settings.
- Require explicit confirmation before `uninstall --purge` because it deletes saved media and settings.
- Never patch `app.asar`, the app bundle, package contents, signatures, Codex config, tasks, or authentication data.
