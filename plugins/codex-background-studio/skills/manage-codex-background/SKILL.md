---
name: manage-codex-background
description: Install, launch, configure, verify, stop, or uninstall Codex Background Studio on Windows, macOS, and Linux. Use when a user wants a private Codex image, GIF, MP4, or WebM background; wants to adjust opacity, blur, crop, focus, or playback; needs the loopback CDP helper repaired after a Codex update; or wants a reversible uninstall without modifying the official app bundle or app.asar.
---

# Manage Codex Background

Use the bundled deterministic CLI instead of editing Codex files or reproducing shell logic.

## Workflow

1. Detect the operating system and verify Node.js 22 or newer.
2. Read [platforms.md](references/platforms.md) when discovery or launch behavior differs by OS.
3. Run the relevant command through `scripts/studio.mjs`.
4. Ask the user to quit Codex normally if it is already open without the loopback debugging port. Never force-kill Codex.
5. Run `verify` after install, launch, repair, or update.

## Commands

Run commands from this skill directory:

```bash
node scripts/studio.mjs install
node scripts/studio.mjs launch
node scripts/studio.mjs verify
node scripts/studio.mjs stop
node scripts/studio.mjs uninstall
```

Use `uninstall --purge` only after explicit confirmation. It removes saved background media and visual settings when the Codex renderer is reachable. Ordinary uninstall preserves them.

Pass `--port <1024-65535>` when port `9335` is occupied. Set `CODEX_EXECUTABLE` when automatic desktop-app discovery fails, especially on Linux.

## Guardrails

- Keep CDP on IPv4/IPv6 loopback only; never expose or proxy it.
- Do not modify Codex, its package signature, `app.asar`, config, tasks, authentication, or plugins.
- Keep all selected media local. Do not upload or resolve remote media URLs.
- Stop if the discovered executable is not the official Codex desktop app.
- Read [security.md](references/security.md) before changing launch, storage, purge, or uninstall behavior.
