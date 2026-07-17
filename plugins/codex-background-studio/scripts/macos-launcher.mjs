function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

export function buildMacAutoCloseLauncher(nodePath, cliPath) {
  return `#!/bin/sh
terminal_tty=$(/usr/bin/tty 2>/dev/null || true)
${shellQuote(nodePath)} ${shellQuote(cliPath)} launch "$@"
launch_status=$?
if [ "$launch_status" -eq 0 ] && [ "\${TERM_PROGRAM:-}" = "Apple_Terminal" ] && [ -n "$terminal_tty" ]; then
  (
    /bin/sleep 0.25
    /usr/bin/osascript - "$terminal_tty" <<'APPLESCRIPT'
on run argv
  set targetTty to item 1 of argv
  tell application "Terminal"
    repeat with terminalWindow in windows
      repeat with terminalTab in tabs of terminalWindow
        if tty of terminalTab is targetTty then
          if (count of tabs of terminalWindow) > 1 then
            close terminalTab
          else
            close terminalWindow
          end if
          return
        end if
      end repeat
    end repeat
  end tell
end run
APPLESCRIPT
  ) >/dev/null 2>&1 &
fi
exit "$launch_status"
`;
}
