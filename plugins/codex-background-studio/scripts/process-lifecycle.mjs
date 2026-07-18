import path from "node:path";

const POSIX_SHELL_NAMES = new Set(["bash", "dash", "sh", "zsh"]);

function canonical(value) {
  return String(value || "").replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

/**
 * 2026-07-18 苍朮
 * 判断进程命令是否直接启动目标程序，或通过 Arch 常见的 POSIX Shell 包装脚本启动目标程序。
 * @param {string} command 进程表中的完整命令行。
 * @param {string} executable 期望匹配的 Codex 可执行文件路径。
 * @returns {boolean} 命令直接或经受信任的 Shell 包装启动目标程序时返回 true。
 */
function commandStartsWithExecutable(command, executable) {
  const normalizedCommand = canonical(command);
  const normalizedExecutable = canonical(executable);
  if (normalizedCommand === normalizedExecutable || normalizedCommand.startsWith(`${normalizedExecutable} `)) return true;

  const [interpreter, wrappedExecutable] = normalizedCommand.split(/\s+/, 3);
  return POSIX_SHELL_NAMES.has(path.basename(interpreter)) && wrappedExecutable === normalizedExecutable;
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
