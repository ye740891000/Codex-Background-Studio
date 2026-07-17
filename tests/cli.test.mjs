import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const repo = path.resolve(import.meta.dirname, "..");
const plugin = path.join(repo, "plugins", "codex-background-studio");
const rootInstallCmd = path.join(repo, "install.cmd");
const rootInstallPowerShell = path.join(repo, "install.ps1");
const cli = path.join(plugin, "scripts", "studio-cli.mjs");
const macosLauncher = path.join(plugin, "scripts", "macos-launcher.mjs");
const processLifecycle = path.join(plugin, "scripts", "process-lifecycle.mjs");
const windowsLauncher = path.join(plugin, "scripts", "windows-launch.ps1");
const windowsActivator = path.join(plugin, "scripts", "windows-activate.ps1");
const windowsShortcuts = path.join(plugin, "scripts", "windows-shortcuts.ps1");
const injector = path.join(plugin, "runtime", "injector.mjs");
const renderer = path.join(plugin, "runtime", "assets", "renderer-inject.js");
const stylesheet = path.join(plugin, "runtime", "assets", "background-studio.css");
const defaultBackground = path.join(plugin, "runtime", "assets", "default-background.png");
const appIcon = path.join(plugin, "runtime", "assets", "app-icon.ico");

test("runtime assets build a renderer payload", () => {
  const result = spawnSync(process.execPath, [injector, "--validate-assets"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.valid, true);
  assert.ok(payload.payloadBytes > 100_000);
});

test("runtime uses an isolated project namespace and bundled PNG", () => {
  const runtimeSource = [
    fs.readFileSync(injector, "utf8"),
    fs.readFileSync(cli, "utf8"),
    fs.readFileSync(renderer, "utf8"),
    fs.readFileSync(stylesheet, "utf8"),
  ].join("\n");
  assert.match(runtimeSource, /codex-background-studio-settings-v1/);
  assert.match(runtimeSource, /codex-background-studio-skin/);
  assert.match(runtimeSource, /\[::1\]/);
  assert.match(runtimeSource, /127\.0\.0\.1/);
  assert.match(runtimeSource, /切换置顶摘要/);
  assert.match(runtimeSource, /切换指定摘要/);
  assert.match(runtimeSource, /toggle pinned summary/);
  assert.match(runtimeSource, /显示\/隐藏侧边栏/);
  assert.match(runtimeSource, /app-region:\s*no-drag/);
  assert.match(runtimeSource, /-webkit-app-region/);

  const image = fs.readFileSync(defaultBackground);
  assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(image.byteLength > 1_000_000);
});

test("isolated install and uninstall do not touch desktop integration", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cbs-test-"));
  const env = { ...process.env, CBS_HOME: home, CBS_SKIP_INTEGRATION: "1", CBS_PORT: "64321" };
  try {
    const install = spawnSync(process.execPath, [cli, "install"], { encoding: "utf8", env });
    assert.equal(install.status, 0, install.stderr);
    assert.ok(fs.existsSync(path.join(home, "runtime", "injector.mjs")));
    assert.ok(fs.existsSync(path.join(home, "runtime", "assets", "default-background.png")));
    assert.ok(fs.existsSync(path.join(home, "scripts", "studio-cli.mjs")));
    assert.ok(fs.existsSync(path.join(home, "scripts", "macos-launcher.mjs")));
    assert.ok(fs.existsSync(path.join(home, "scripts", "windows-launch.ps1")));
    assert.ok(fs.existsSync(path.join(home, "scripts", "windows-activate.ps1")));

    const uninstall = spawnSync(process.execPath, [cli, "uninstall", "--port", "64321"], { encoding: "utf8", env });
    assert.equal(uninstall.status, 0, uninstall.stderr);
    assert.equal(fs.existsSync(home), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("Windows launcher keeps status visible and shortcuts use the app icon", () => {
  const launcherSource = fs.readFileSync(windowsLauncher, "utf8");
  const shortcutSource = fs.readFileSync(windowsShortcuts, "utf8");
  const icon = fs.readFileSync(appIcon);

  assert.match(launcherSource, /studio-cli\.mjs/);
  assert.match(launcherSource, /Read-Host/);
  assert.match(shortcutSource, /windows-launch\.ps1/);
  assert.match(shortcutSource, /IconLocation/);
  assert.deepEqual([...icon.subarray(0, 4)], [0, 0, 1, 0]);
});

test("Windows MSIX launch uses package activation instead of spawning WindowsApps directly", () => {
  const cliSource = fs.readFileSync(cli, "utf8");
  const activatorSource = fs.readFileSync(windowsActivator, "utf8");

  assert.match(cliSource, /appUserModelId/);
  assert.match(cliSource, /launchKind:\s*"windows-app"/);
  assert.match(cliSource, /windows-activate\.ps1/);
  assert.match(activatorSource, /IApplicationActivationManager/);
  assert.match(activatorSource, /ActivateApplication/);
});

test("Windows install entry points share one visible and diagnosable path", () => {
  const cmdSource = fs.readFileSync(rootInstallCmd, "utf8");
  const powerShellSource = fs.readFileSync(rootInstallPowerShell, "utf8");

  assert.match(cmdSource, /powershell\.exe/i);
  assert.match(cmdSource, /install\.ps1/i);
  assert.match(cmdSource, /Installation failed/i);
  assert.match(powerShellSource, /Get-Command node/);
  assert.match(powerShellSource, /studio-cli\.mjs/);
  assert.match(powerShellSource, /Installation failed/i);
});

test("verification waits for the Codex renderer to finish mounting", () => {
  const injectorSource = fs.readFileSync(injector, "utf8");
  assert.match(injectorSource, /options\.mode === "verify"/);
  assert.match(injectorSource, /waitForVerifiedSession\(session, options\.timeoutMs\)/);
});

test("macOS app launcher closes only its successful Terminal tab", async () => {
  const { buildMacAutoCloseLauncher } = await import(pathToFileURL(macosLauncher));
  const script = buildMacAutoCloseLauncher("/opt/homebrew/bin/node", "/Users/test/Library/Application Support/CodexBackgroundStudio/scripts/studio-cli.mjs");

  assert.match(script, /launch_status=\$\?/);
  assert.match(script, /"\$launch_status" -eq 0/);
  assert.match(script, /tty of terminalTab is targetTty/);
  assert.match(script, /count of tabs of terminalWindow/);
  assert.match(script, /close terminalTab/);
  assert.match(script, /close terminalWindow/);
  assert.match(script, /exit "\$launch_status"/);
});

test("macOS exit wait tracks the original main process instead of a replacement", async () => {
  const { matchingAppProcesses, waitForInitialAppExit } = await import(pathToFileURL(processLifecycle));
  const app = { executable: "/Applications/ChatGPT.app", launchKind: "mac-bundle" };
  const main = "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT";
  const helper = "/Applications/ChatGPT.app/Contents/Frameworks/Codex Framework.framework/Helpers/Codex (Renderer)";
  const snapshots = [
    [{ pid: 101, command: main }, { pid: 102, command: helper }],
    [{ pid: 202, command: main }],
  ];
  let readIndex = 0;

  assert.deepEqual(matchingAppProcesses(app, snapshots[0]).map((item) => item.pid), [101]);
  const result = await waitForInitialAppExit(app, {
    listProcesses: () => snapshots[Math.min(readIndex++, snapshots.length - 1)],
    sleep: async () => {},
    pollIntervalMs: 1,
    timeoutMs: 100,
  });

  assert.equal(result.waited, true);
  assert.deepEqual(result.initialPids, [101]);
  assert.equal(readIndex, 2);
});

test("macOS install reports and creates executable launch entries", { skip: process.platform !== "darwin" }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cbs-macos-install-"));
  const data = path.join(home, "data");
  const env = { ...process.env, HOME: home, CBS_HOME: data, CBS_PORT: "64322" };
  const launcher = path.join(home, "Applications", "Codex Background Studio.command");
  const appLauncher = path.join(home, "Applications", "Codex Background Studio.app");
  const appExecutable = path.join(appLauncher, "Contents", "MacOS", "CodexBackgroundStudio");
  const appIcon = path.join(appLauncher, "Contents", "Resources", "AppIcon.icns");
  const appLaunchEntry = path.join(appLauncher, "Contents", "Resources", "Launch.command");
  const uninstaller = path.join(home, "Applications", "Uninstall Codex Background Studio.command");
  try {
    const install = spawnSync(process.execPath, [cli, "install"], { encoding: "utf8", env });
    assert.equal(install.status, 0, install.stderr);
    assert.match(install.stdout, /macOS app launcher:/);
    assert.match(install.stdout, /macOS command launcher:/);
    assert.ok(fs.existsSync(launcher));
    assert.ok(fs.statSync(launcher).mode & 0o111);
    assert.ok(fs.existsSync(appExecutable));
    assert.ok(fs.statSync(appExecutable).mode & 0o111);
    assert.ok(fs.existsSync(appLaunchEntry));
    assert.ok(fs.statSync(appLaunchEntry).mode & 0o111);
    const launcherSyntax = spawnSync("/bin/sh", ["-n", appLaunchEntry], { encoding: "utf8" });
    assert.equal(launcherSyntax.status, 0, launcherSyntax.stderr);
    assert.ok(fs.statSync(appIcon).size > 1_000);
    const signature = spawnSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", appLauncher], { encoding: "utf8" });
    assert.equal(signature.status, 0, signature.stderr);
    assert.ok(fs.existsSync(uninstaller));

    const uninstall = spawnSync(process.execPath, [cli, "uninstall", "--port", "64322"], { encoding: "utf8", env });
    assert.equal(uninstall.status, 0, uninstall.stderr);
    assert.equal(fs.existsSync(launcher), false);
    assert.equal(fs.existsSync(appLauncher), false);
    assert.equal(fs.existsSync(uninstaller), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
