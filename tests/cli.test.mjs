import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repo = path.resolve(import.meta.dirname, "..");
const plugin = path.join(repo, "plugins", "codex-background-studio");
const cli = path.join(plugin, "scripts", "studio-cli.mjs");
const injector = path.join(plugin, "runtime", "injector.mjs");
const renderer = path.join(plugin, "runtime", "assets", "renderer-inject.js");
const stylesheet = path.join(plugin, "runtime", "assets", "background-studio.css");
const defaultBackground = path.join(plugin, "runtime", "assets", "default-background.png");

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

    const uninstall = spawnSync(process.execPath, [cli, "uninstall", "--port", "64321"], { encoding: "utf8", env });
    assert.equal(uninstall.status, 0, uninstall.stderr);
    assert.equal(fs.existsSync(home), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
