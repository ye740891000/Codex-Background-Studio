# Platform behavior

## Windows

- Discover the latest `OpenAI.Codex` Appx package on every launch.
- Start its official `app/ChatGPT.exe` with a loopback CDP port.
- Create launch and uninstall shortcuts on the Desktop and Start menu.
- Set `CODEX_EXECUTABLE` only for an official non-Store installation.

## macOS

- Search `/Applications` and `~/Applications` for `Codex.app` or `ChatGPT.app`.
- Launch with `open -na ... --args` so the official bundle remains unchanged and signed.
- Create `.command` launch and uninstall entries in `~/Applications`.

## Linux

- Support Ubuntu 22.04/24.04 x64 as the baseline.
- Search `codex-desktop`, `codex-app`, `chatgpt-desktop`, then `~/Applications/*.AppImage`.
- Set `CODEX_EXECUTABLE` for other package layouts.
- Create a user-local desktop entry under `~/.local/share/applications`.

## Existing Codex process

If Codex is already running without the selected CDP port, wait up to ten minutes for the user to quit it normally. Do not terminate the official process.
