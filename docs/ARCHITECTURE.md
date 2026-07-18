# Architecture

## Components

```text
official Codex desktop app
        |
        | IPv4/IPv6 loopback CDP only
        v
runtime/injector.mjs
        |
        +-- target-discovery.mjs: trusted renderer-origin filtering
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
3. Request `--remote-debugging-address=127.0.0.1`, then discover the renderer on IPv4 or IPv6 loopback. Standard packages use `app://`; the validated Arch package uses a loopback-only HTTP WebView on port `5175`.
4. Start a detached Node injector and record its PID and expected path.
5. Reapply the renderer layer after page loads and in-app navigation.
6. On uninstall, validate the recorded process command before stopping it.

## Persistence

Presentation values, including the custom accent and surface colors, are stored in renderer `localStorage`. Selected media blobs are stored in renderer IndexedDB. Ordinary uninstall leaves both intact. `--purge` clears them when the renderer is reachable.

## Compatibility

The visual layer uses current Codex DOM selectors and includes compatibility fixes for the sidebar, title area, home suggestions, project selector, task status strip, and composer. The settings trigger detects the compact native action cluster in the top toolbar and positions itself to its left. Auxiliary renderer routes such as the avatar overlay are excluded from injection. A Codex update may change those selectors; rerun `verify` and update the compatibility CSS without patching Codex itself.

## Linux boundary

Ubuntu 22.04/24.04 x64 and Arch Linux x64 with X11 are validated baselines. Linux discovery checks common commands and user AppImages; process lifecycle matching also recognizes the Arch `/bin/bash /usr/bin/codex-desktop` launcher shape.

The Arch package serves its renderer from a local WebView instead of `app://`. Target discovery accepts that layout only when all of the following are true: the target is a CDP page with a WebSocket debugger URL, the platform is Linux, the scheme is plain HTTP, the host is IPv4/IPv6 loopback or `localhost`, and the port is exactly `5175`. Other layouts must set `CODEX_EXECUTABLE` and may require an explicit compatibility update.

Native Wayland is not yet a validated baseline. XWayland or Electron's X11 fallback may work, but must be verified before being documented as supported.
