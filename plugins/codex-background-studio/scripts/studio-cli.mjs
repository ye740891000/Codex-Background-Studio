#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isCodexRendererTarget } from "../runtime/target-discovery.mjs";
import { buildMacAutoCloseLauncher } from "./macos-launcher.mjs";
import { matchingAppProcesses, waitForInitialAppExit } from "./process-lifecycle.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, "..");
const sourceRuntime = path.join(pluginRoot, "runtime");
const DEFAULT_PORT = 9335;
const WAIT_FOR_EXIT_MS = 10 * 60 * 1000;
const LOOPBACK_HOSTS = ["127.0.0.1", "[::1]", "localhost"];

function dataRoot() {
  if (process.env.CBS_HOME) return path.resolve(process.env.CBS_HOME);
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA || os.homedir(), "CodexBackgroundStudio");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "CodexBackgroundStudio");
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "codex-background-studio");
}

function parseArgs(argv) {
  const options = { command: argv[0] || "help", port: Number(process.env.CBS_PORT || DEFAULT_PORT), purge: false };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--port") options.port = Number(argv[++index]);
    else if (arg === "--purge") options.purge = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) throw new Error(`Invalid port: ${options.port}`);
  return options;
}

function assertNodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) throw new Error(`Node.js 22 or newer is required; found ${process.version}`);
}

async function exists(candidate) {
  try { await fs.access(candidate); return true; } catch { return false; }
}

async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function powershellQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function commandOutput(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : "";
}

/**
 * 2026-07-18 苍朮
 * 从回环 CDP 端口读取可注入的 Codex 页面，包含 Arch Linux 本地 WebView 目标。
 * @param {number} port Chromium DevTools Protocol 的本地端口。
 * @returns {Promise<Array<object>>} 已通过平台与来源校验的 Codex 页面目标。
 */
async function getTargets(port) {
  for (const host of LOOPBACK_HOSTS) {
    try {
      const response = await fetch(`http://${host}:${port}/json/list`, { signal: AbortSignal.timeout(1200) });
      if (!response.ok) continue;
      const targets = (await response.json()).filter((target) => isCodexRendererTarget(target));
      if (targets.length) return targets;
    } catch {}
  }
  return [];
}

async function waitForTargets(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const targets = await getTargets(port);
    if (targets.length) return targets;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Codex did not expose an IPv4 or IPv6 loopback CDP target on port ${port}`);
}

async function discoverCodex() {
  if (process.env.CODEX_EXECUTABLE) {
    const executable = path.resolve(process.env.CODEX_EXECUTABLE);
    if (!await exists(executable)) throw new Error(`CODEX_EXECUTABLE does not exist: ${executable}`);
    return { executable, launchKind: "executable" };
  }

  if (process.platform === "win32") {
    const script = "$p=Get-AppxPackage OpenAI.Codex|Sort-Object Version -Descending|Select-Object -First 1;if($p){$m=Get-AppxPackageManifest $p;$a=$m.Package.Applications.Application|Select-Object -First 1;if($a){[pscustomobject]@{Executable=(Join-Path $p.InstallLocation $a.Executable);AppUserModelId=($p.PackageFamilyName+'!'+$a.Id)}|ConvertTo-Json -Compress}}";
    const output = commandOutput("powershell.exe", ["-NoProfile", "-Command", script]);
    const packageInfo = output ? JSON.parse(output) : null;
    if (packageInfo?.Executable && packageInfo?.AppUserModelId && await exists(packageInfo.Executable)) {
      return {
        executable: packageInfo.Executable,
        appUserModelId: packageInfo.AppUserModelId,
        launchKind: "windows-app",
      };
    }
  }

  if (process.platform === "darwin") {
    for (const bundle of [
      "/Applications/Codex.app",
      "/Applications/ChatGPT.app",
      path.join(os.homedir(), "Applications", "Codex.app"),
      path.join(os.homedir(), "Applications", "ChatGPT.app"),
    ]) if (await exists(bundle)) return { executable: bundle, launchKind: "mac-bundle" };
  }

  if (process.platform === "linux") {
    for (const name of ["codex-desktop", "codex-app", "chatgpt-desktop"]) {
      const executable = commandOutput("sh", ["-lc", `command -v ${name}`]);
      if (executable) return { executable, launchKind: "executable" };
    }
    const appImageDir = path.join(os.homedir(), "Applications");
    if (await exists(appImageDir)) {
      const entries = await fs.readdir(appImageDir);
      const appImage = entries.find((name) => /^(codex|chatgpt).*\.appimage$/i.test(name));
      if (appImage) return { executable: path.join(appImageDir, appImage), launchKind: "executable" };
    }
  }

  throw new Error("Codex desktop was not found. Set CODEX_EXECUTABLE to the official executable or app bundle.");
}

function processList() {
  if (process.platform === "win32") {
    const script = "Get-CimInstance Win32_Process|Select-Object ProcessId,ExecutablePath,CommandLine|ConvertTo-Json -Compress";
    const output = commandOutput("powershell.exe", ["-NoProfile", "-Command", script]);
    if (!output) return [];
    const parsed = JSON.parse(output);
    return (Array.isArray(parsed) ? parsed : [parsed]).map((item) => ({
      pid: Number(item.ProcessId),
      executable: item.ExecutablePath || "",
      command: `${item.ExecutablePath || ""} ${item.CommandLine || ""}`,
    }));
  }
  return commandOutput("ps", ["-ax", "-o", "pid=,command="]).split(/\r?\n/).map((line) => {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    return match ? { pid: Number(match[1]), command: match[2] } : null;
  }).filter(Boolean);
}

function appIsRunning(app) {
  return matchingAppProcesses(app, processList()).some((item) => item.pid !== process.pid);
}

async function waitForNormalExit(app) {
  try {
    const result = await waitForInitialAppExit(app, {
      listProcesses: processList,
      sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      timeoutMs: WAIT_FOR_EXIT_MS,
      onWait: () => console.log("Codex is already open without the Background Studio port. Quit Codex normally and do not reopen it; launch will continue automatically."),
    });
    if (result.waited && appIsRunning(app)) {
      throw new Error("Codex was reopened without the Background Studio port before the queued launch could start. Quit it and run the launcher again; do not reopen Codex manually.");
    }
    return result;
  } catch (error) {
    if (error.message.startsWith("Timed out waiting for app process IDs")) {
      throw new Error("Timed out waiting for Codex to exit normally");
    }
    throw error;
  }
}

function launchCodex(app, port) {
  const debugArgs = [`--remote-debugging-address=127.0.0.1`, `--remote-debugging-port=${port}`];
  if (app.launchKind === "windows-app") {
    const activator = path.join(pluginRoot, "scripts", "windows-activate.ps1");
    const result = spawnSync("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", activator,
      "-AppUserModelId", app.appUserModelId,
      "-Arguments", debugArgs.join(" "),
    ], { encoding: "utf8", windowsHide: true });
    if (result.status !== 0) {
      throw new Error(`Windows packaged Codex activation failed: ${result.stderr || result.stdout || result.error?.message}`);
    }
    return;
  }
  const command = app.launchKind === "mac-bundle" ? "open" : app.executable;
  const args = app.launchKind === "mac-bundle" ? ["-na", app.executable, "--args", ...debugArgs] : debugArgs;
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}

async function processCommand(pid) {
  const processInfo = processList().find((item) => item.pid === Number(pid));
  return processInfo?.command || "";
}

async function stopDaemon(root = dataRoot()) {
  const stateFile = path.join(root, "state.json");
  const state = await readJson(stateFile);
  if (!state?.injectorPid) return false;
  const command = await processCommand(state.injectorPid);
  const expected = path.normalize(path.join(root, "runtime", "injector.mjs")).toLowerCase();
  if (!command || !path.normalize(command).toLowerCase().includes(expected)) return false;
  try { process.kill(Number(state.injectorPid)); } catch {}
  await fs.rm(stateFile, { force: true });
  return true;
}

async function startDaemon(port, root = dataRoot()) {
  await stopDaemon(root);
  const logs = path.join(root, "logs");
  await fs.mkdir(logs, { recursive: true });
  const stdout = await fs.open(path.join(logs, "injector.log"), "a");
  const stderr = await fs.open(path.join(logs, "injector-error.log"), "a");
  const injector = path.join(root, "runtime", "injector.mjs");
  const child = spawn(process.execPath, [injector, "--watch", "--port", String(port)], {
    detached: true,
    stdio: ["ignore", stdout.fd, stderr.fd],
    windowsHide: true,
  });
  child.unref();
  await writeJson(path.join(root, "state.json"), {
    injectorPid: child.pid,
    injectorPath: injector,
    port,
    startedAt: new Date().toISOString(),
  });
  await stdout.close();
  await stderr.close();
  return child.pid;
}

async function installedCli(root = dataRoot()) {
  return path.join(root, "scripts", "studio-cli.mjs");
}

/**
 * 2026-07-18 苍朮
 * 为 macOS 或 Linux 写入平台原生启动入口，Linux 入口同时安装透明图标并声明 Codex 窗口类。
 * @param {string} root Background Studio 的用户级安装目录。
 * @returns {Promise<object|null>} 已创建的启动入口路径；没有额外入口信息时返回 null。
 */
async function writeUnixLaunchers(root) {
  const cli = await installedCli(root);
  const launcher = `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(cli)} launch "$@"\n`;
  const uninstaller = `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(cli)} uninstall "$@"\n`;
  await fs.writeFile(path.join(root, "launch.sh"), launcher, "utf8");
  await fs.writeFile(path.join(root, "uninstall.sh"), uninstaller, "utf8");
  await fs.chmod(path.join(root, "launch.sh"), 0o755);
  await fs.chmod(path.join(root, "uninstall.sh"), 0o755);

  if (process.platform === "darwin") {
    const applications = path.join(os.homedir(), "Applications");
    const launchEntry = path.join(applications, "Codex Background Studio.command");
    const appEntry = path.join(applications, "Codex Background Studio.app");
    const appContents = path.join(appEntry, "Contents");
    const appExecutable = path.join(appContents, "MacOS", "CodexBackgroundStudio");
    const appResources = path.join(appContents, "Resources");
    const appLaunchEntry = path.join(appResources, "Launch.command");
    const uninstallEntry = path.join(applications, "Uninstall Codex Background Studio.command");
    await fs.mkdir(applications, { recursive: true });
    await fs.copyFile(path.join(root, "launch.sh"), launchEntry);
    await fs.copyFile(path.join(root, "uninstall.sh"), uninstallEntry);
    await fs.chmod(launchEntry, 0o755);
    await fs.chmod(uninstallEntry, 0o755);
    await fs.rm(appEntry, { recursive: true, force: true });
    await fs.mkdir(path.dirname(appExecutable), { recursive: true });
    await fs.mkdir(appResources, { recursive: true });
    await fs.writeFile(appLaunchEntry, buildMacAutoCloseLauncher(process.execPath, cli), "utf8");
    await fs.chmod(appLaunchEntry, 0o755);
    await fs.writeFile(appExecutable, `#!/bin/sh\nexec /usr/bin/open ${shellQuote(appLaunchEntry)}\n`, "utf8");
    await fs.chmod(appExecutable, 0o755);
    await fs.copyFile(path.join(root, "runtime", "assets", "app-icon.icns"), path.join(appResources, "AppIcon.icns"));
    await fs.writeFile(path.join(appContents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key><string>Codex Background Studio</string>
  <key>CFBundleExecutable</key><string>CodexBackgroundStudio</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleIdentifier</key><string>com.local.CodexBackgroundStudio</string>
  <key>CFBundleName</key><string>Codex Background Studio</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
`, "utf8");
    const signature = spawnSync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", appEntry], { encoding: "utf8" });
    if (signature.status !== 0) throw new Error(`macOS launcher signing failed: ${signature.stderr || signature.stdout}`);
    return { appEntry, launchEntry, uninstallEntry };
  }

  if (process.platform === "linux") {
    const desktopDir = path.join(os.homedir(), ".local", "share", "applications");
    const iconDir = path.join(os.homedir(), ".local", "share", "icons", "hicolor", "512x512", "apps");
    const desktopEntry = path.join(desktopDir, "codex-background-studio.desktop");
    const iconPath = path.join(iconDir, "codex-background-studio.png");
    await fs.mkdir(desktopDir, { recursive: true });
    await fs.mkdir(iconDir, { recursive: true });
    await fs.copyFile(path.join(root, "runtime", "assets", "linux-app-icon.png"), iconPath);
    await fs.writeFile(desktopEntry, [
      "[Desktop Entry]",
      "Type=Application",
      "Name=Codex Background Studio",
      `Exec=${path.join(root, "launch.sh")}`,
      `Icon=${iconPath}`,
      "Terminal=false",
      "StartupNotify=true",
      "StartupWMClass=codex",
      "Categories=Development;Utility;",
      "",
    ].join("\n"), "utf8");
    return { desktopEntry, iconPath };
  }
  return null;
}

/**
 * 2026-07-18 苍朮
 * 移除当前平台由 Background Studio 管理的用户级启动入口与专用图标。
 * @returns {Promise<void>}
 */
async function removeUnixLaunchers() {
  if (process.platform === "darwin") {
    await fs.rm(path.join(os.homedir(), "Applications", "Codex Background Studio.app"), { recursive: true, force: true });
    await fs.rm(path.join(os.homedir(), "Applications", "Codex Background Studio.command"), { force: true });
    await fs.rm(path.join(os.homedir(), "Applications", "Uninstall Codex Background Studio.command"), { force: true });
  }
  if (process.platform === "linux") {
    await fs.rm(path.join(os.homedir(), ".local", "share", "applications", "codex-background-studio.desktop"), { force: true });
    await fs.rm(path.join(os.homedir(), ".local", "share", "icons", "hicolor", "512x512", "apps", "codex-background-studio.png"), { force: true });
  }
}

function runWindowsShortcutHelper(action, root) {
  const helper = path.join(pluginRoot, "scripts", "windows-shortcuts.ps1");
  const result = spawnSync("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helper,
    "-Action", action, "-InstallRoot", root, "-NodePath", process.execPath,
  ], { stdio: "inherit", windowsHide: true });
  if (result.status !== 0) throw new Error(`Windows shortcut helper failed (${result.status})`);
}

async function install() {
  assertNodeVersion();
  const root = dataRoot();
  if (!await exists(sourceRuntime)) throw new Error(`Runtime not found: ${sourceRuntime}`);
  await fs.mkdir(root, { recursive: true });
  await fs.rm(path.join(root, "runtime"), { recursive: true, force: true });
  await fs.cp(sourceRuntime, path.join(root, "runtime"), { recursive: true });
  await fs.mkdir(path.join(root, "scripts"), { recursive: true });
  await fs.copyFile(fileURLToPath(import.meta.url), path.join(root, "scripts", "studio-cli.mjs"));
  await fs.copyFile(path.join(here, "macos-launcher.mjs"), path.join(root, "scripts", "macos-launcher.mjs"));
  await fs.copyFile(path.join(here, "process-lifecycle.mjs"), path.join(root, "scripts", "process-lifecycle.mjs"));
  const shortcutHelper = path.join(pluginRoot, "scripts", "windows-shortcuts.ps1");
  if (await exists(shortcutHelper)) await fs.copyFile(shortcutHelper, path.join(root, "scripts", "windows-shortcuts.ps1"));
  const windowsLauncher = path.join(pluginRoot, "scripts", "windows-launch.ps1");
  if (await exists(windowsLauncher)) await fs.copyFile(windowsLauncher, path.join(root, "scripts", "windows-launch.ps1"));
  const windowsActivator = path.join(pluginRoot, "scripts", "windows-activate.ps1");
  if (await exists(windowsActivator)) await fs.copyFile(windowsActivator, path.join(root, "scripts", "windows-activate.ps1"));
  await writeJson(path.join(root, "installation.json"), {
    version: "0.1.0",
    source: pluginRoot,
    installedAt: new Date().toISOString(),
    platform: process.platform,
  });
  let integration = null;
  if (process.env.CBS_SKIP_INTEGRATION !== "1") {
    if (process.platform === "win32") runWindowsShortcutHelper("install", root);
    else integration = await writeUnixLaunchers(root);
  }
  console.log(`Installed Codex Background Studio to ${root}`);
  if (integration?.appEntry) console.log(`macOS app launcher: ${integration.appEntry}`);
  if (integration?.launchEntry) console.log(`macOS command launcher: ${integration.launchEntry}`);
}

async function launch(port) {
  assertNodeVersion();
  const root = dataRoot();
  if (!await exists(path.join(root, "runtime", "injector.mjs"))) throw new Error("Background Studio is not installed. Run the install script first.");
  if (!(await getTargets(port)).length) {
    const app = await discoverCodex();
    await waitForNormalExit(app);
    launchCodex(app, port);
    await waitForTargets(port);
  }
  const pid = await startDaemon(port, root);
  await new Promise((resolve) => setTimeout(resolve, 900));
  const result = spawnSync(process.execPath, [path.join(root, "runtime", "injector.mjs"), "--verify", "--port", String(port)], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Injection verification failed: ${result.stderr || result.stdout}`);
  console.log(`Codex Background Studio is active on loopback port ${port} (injector PID ${pid})`);
}

async function verify(port) {
  const root = dataRoot();
  const assets = spawnSync(process.execPath, [path.join(root, "runtime", "injector.mjs"), "--validate-assets"], { encoding: "utf8" });
  if (assets.status !== 0) throw new Error(assets.stderr || "Asset validation failed");
  const targets = await getTargets(port);
  const state = await readJson(path.join(root, "state.json"));
  console.log(JSON.stringify({ installed: true, root, port, targets: targets.length, state, assets: JSON.parse(assets.stdout) }, null, 2));
}

async function uninstall(purge, port) {
  const root = dataRoot();
  await stopDaemon(root);
  if (purge && (await getTargets(port)).length && await exists(path.join(root, "runtime", "injector.mjs"))) {
    spawnSync(process.execPath, [path.join(root, "runtime", "injector.mjs"), "--purge", "--port", String(port)], { stdio: "inherit" });
  } else if ((await getTargets(port)).length && await exists(path.join(root, "runtime", "injector.mjs"))) {
    spawnSync(process.execPath, [path.join(root, "runtime", "injector.mjs"), "--remove", "--port", String(port)], { stdio: "inherit" });
  }
  if (process.env.CBS_SKIP_INTEGRATION !== "1") {
    if (process.platform === "win32" && await exists(path.join(pluginRoot, "scripts", "windows-shortcuts.ps1"))) runWindowsShortcutHelper("uninstall", root);
    else await removeUnixLaunchers();
  }
  await fs.rm(root, { recursive: true, force: true });
  console.log(`Uninstalled Codex Background Studio${purge ? " and purged renderer settings where reachable" : ""}`);
}

function printHelp() {
  console.log(`Codex Background Studio\n\nCommands:\n  install\n  launch [--port 9335]\n  verify [--port 9335]\n  stop\n  uninstall [--purge] [--port 9335]\n\nEnvironment:\n  CODEX_EXECUTABLE  Explicit Codex executable or macOS app bundle\n  CBS_HOME          Override installation directory\n  CBS_PORT          Override loopback CDP port`);
}

const options = parseArgs(process.argv.slice(2));
try {
  if (options.command === "install") await install();
  else if (options.command === "launch") await launch(options.port);
  else if (options.command === "verify") await verify(options.port);
  else if (options.command === "stop") console.log(await stopDaemon() ? "Stopped injector" : "No matching injector was running");
  else if (options.command === "uninstall") await uninstall(options.purge, options.port);
  else printHelp();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
