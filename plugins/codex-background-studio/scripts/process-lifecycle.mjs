import path from "node:path";

function canonical(value) {
  return String(value || "").replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

function commandStartsWithExecutable(command, executable) {
  const normalizedCommand = canonical(command);
  const normalizedExecutable = canonical(executable);
  return normalizedCommand === normalizedExecutable || normalizedCommand.startsWith(`${normalizedExecutable} `);
}

export function appProcessMatches(app, processInfo) {
  if (app.launchKind === "mac-bundle") {
    const bundleName = path.basename(app.executable, ".app");
    const mainExecutable = path.join(app.executable, "Contents", "MacOS", bundleName);
    return commandStartsWithExecutable(processInfo.command, mainExecutable);
  }

  if (processInfo.executable) return canonical(processInfo.executable) === canonical(app.executable);
  return commandStartsWithExecutable(processInfo.command, app.executable);
}

export function matchingAppProcesses(app, processes) {
  return processes.filter((processInfo) => appProcessMatches(app, processInfo));
}

export async function waitForInitialAppExit(app, options) {
  const {
    listProcesses,
    sleep,
    pollIntervalMs = 250,
    timeoutMs,
    onWait = () => {},
  } = options;
  const initialPids = matchingAppProcesses(app, listProcesses()).map((item) => item.pid);
  if (!initialPids.length) return { waited: false, initialPids };

  onWait(initialPids);
  const pending = new Set(initialPids);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);
    const runningPids = new Set(listProcesses().map((item) => item.pid));
    for (const pid of pending) {
      if (!runningPids.has(pid)) pending.delete(pid);
    }
    if (!pending.size) return { waited: true, initialPids };
  }

  throw new Error(`Timed out waiting for app process IDs to exit: ${[...pending].join(", ")}`);
}
