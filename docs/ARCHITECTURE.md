# Architecture

## Components

```text
official Codex desktop app
        |
        | IPv4/IPv6 loopback CDP only
        v
runtime/injector.mjs
        |
        +-- renderer-inject.js: media layer, settings UI, persistence
        +-- background-studio.css: transparent theme and compatibility fixes
        +-- default-background.png: bundled default

scripts/studio-cli.mjs
        +-- install / launch / verify / stop / uninstall
        +-- platform discovery and user-local launch entries
```

## Installation locations

- Windows: `%LOCALAPPDATA%/CodexBackgroundStudio`
- macOS: `~/Library/Application Support/CodexBackgroundStudio`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/codex-background-studio`

The installer copies only this project's runtime and CLI. It does not write into the Codex package or configuration directory.

## Runtime lifecycle

1. Discover the official Codex desktop executable or use `CODEX_EXECUTABLE`.
2. If Codex is already running without the selected port, wait for a normal user exit.
3. Request `--remote-debugging-address=127.0.0.1`, then discover the renderer on IPv4 or IPv6 loopback.
4. Start a detached Node injector and record its PID and expected path.
5. Reapply the renderer layer after page loads and in-app navigation.
6. On uninstall, validate the recorded process command before stopping it.

## Persistence

Presentation values are stored in renderer `localStorage`. Selected media blobs are stored in renderer IndexedDB. Ordinary uninstall leaves both intact. `--purge` clears them when the renderer is reachable.

## Compatibility

The visual layer uses current Codex DOM selectors and includes compatibility fixes for the sidebar, title area, home suggestions, project selector, task status strip, and composer. A Codex update may change those selectors; rerun `verify` and update the compatibility CSS without patching Codex itself.

## Linux boundary

Ubuntu 22.04/24.04 x64 is the first supported baseline. Since Codex desktop packaging can vary, Linux discovery checks common commands and user AppImages. Other layouts must set `CODEX_EXECUTABLE`.
