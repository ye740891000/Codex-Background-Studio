import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = here;
const LOOPBACK_HOSTS = ["127.0.0.1", "[::1]", "localhost"];

function parseArgs(argv) {
  const options = { port: 9335, mode: "watch", timeoutMs: 30000, screenshot: null, reload: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port") options.port = Number(argv[++i]);
    else if (arg === "--once") options.mode = "once";
    else if (arg === "--watch") options.mode = "watch";
    else if (arg === "--verify") options.mode = "verify";
    else if (arg === "--remove") options.mode = "remove";
    else if (arg === "--purge") options.mode = "purge";
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++i]);
    else if (arg === "--screenshot") options.screenshot = path.resolve(argv[++i]);
    else if (arg === "--reload") options.reload = true;
    else if (arg === "--validate-assets") options.mode = "validate-assets";
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) {
    throw new Error(`Invalid port: ${options.port}`);
  }
  return options;
}

class CdpSession {
  constructor(target) {
    this.target = target;
    this.ws = new WebSocket(target.webSocketDebuggerUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.closed = false;
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => this.onMessage(event));
    this.ws.addEventListener("close", () => {
      this.closed = true;
      for (const waiter of this.pending.values()) waiter.reject(new Error("CDP socket closed"));
      this.pending.clear();
    });
    await this.send("Runtime.enable");
    await this.send("Page.enable");
    return this;
  }

  onMessage(event) {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`${message.error.message} (${message.error.code})`));
      else waiter.resolve(message.result);
      return;
    }
    for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {});
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error("CDP session is closed"));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: false,
    });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
      throw new Error(`Renderer evaluation failed: ${detail}`);
    }
    return result.result?.value;
  }

  close() {
    if (!this.closed) this.ws.close();
    this.closed = true;
  }
}

async function waitForTargets(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    for (const host of LOOPBACK_HOSTS) {
      try {
        const response = await fetch(`http://${host}:${port}/json/list`, { signal: AbortSignal.timeout(1200) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const targets = await response.json();
        const pages = targets.filter((item) => item.type === "page" && item.url.startsWith("app://"));
        if (pages.length) return pages;
      } catch (error) {
        lastError = error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`No Codex renderer target on the loopback port ${port}: ${lastError?.message ?? "timed out"}`);
}

async function loadPayload() {
  const [css, template, art] = await Promise.all([
    fs.readFile(path.join(root, "assets", "background-studio.css"), "utf8"),
    fs.readFile(path.join(root, "assets", "renderer-inject.js"), "utf8"),
    fs.readFile(path.join(root, "assets", "default-background.png")),
  ]);
  const artDataUrl = `data:image/png;base64,${art.toString("base64")}`;
  return template
    .replace("__BACKGROUND_STUDIO_CSS_JSON__", JSON.stringify(css))
    .replace("__BACKGROUND_STUDIO_ART_JSON__", JSON.stringify(artDataUrl));
}

async function connectTarget(target) {
  return new CdpSession(target).open();
}

async function applyToSession(session, payload) {
  return session.evaluate(payload);
}

async function removeFromSession(session) {
  return session.evaluate(`(() => {
    window.__CODEX_BACKGROUND_STUDIO_SKIN_DISABLED__ = true;
    const state = window.__CODEX_BACKGROUND_STUDIO_SKIN_STATE__;
    if (state?.cleanup) return state.cleanup();
    document.documentElement?.classList.remove('codex-background-studio-skin');
    document.documentElement?.style.removeProperty('--background-studio-art');
    document.getElementById('codex-background-studio-skin-style')?.remove();
    document.getElementById('codex-background-studio-skin-chrome')?.remove();
    return true;
  })()`);
}

async function purgeFromSession(session) {
  return session.evaluate(`(async () => {
    window.__CODEX_BACKGROUND_STUDIO_SKIN_DISABLED__ = true;
    const state = window.__CODEX_BACKGROUND_STUDIO_SKIN_STATE__;
    if (state?.cleanup) state.cleanup();
    localStorage.removeItem('codex-background-studio-settings-v1');
    await new Promise((resolve) => {
      const request = indexedDB.deleteDatabase('codex-background-studio');
      request.onsuccess = resolve;
      request.onerror = resolve;
      request.onblocked = resolve;
    });
    return true;
  })()`);
}

async function verifySession(session) {
  return session.evaluate(`(() => {
    const box = (node) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    };
    const layoutBox = (node) => {
      if (!node) return null;
      const style = getComputedStyle(node);
      const extraWidth = style.boxSizing === 'content-box'
        ? parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)
        : 0;
      const extraHeight = style.boxSizing === 'content-box'
        ? parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
        : 0;
      return {
        width: Math.round(parseFloat(style.width) + extraWidth),
        height: Math.round(parseFloat(style.height) + extraHeight),
      };
    };
    const home = document.querySelector('.background-studio-home');
    const suggestions = home?.querySelector('.group\\\\/home-suggestions') ?? null;
    const cards = suggestions ? [...suggestions.querySelectorAll('button')].map(box) : [];
    const sidebar = document.querySelector('aside.app-shell-left-panel');
    const sidebarIcons = sidebar ? [...sidebar.querySelectorAll('svg')].map(layoutBox).filter((item) => item.width > 0 && item.height > 0) : [];
    const oversizedSidebarIcons = sidebarIcons.filter((item) => item.width > 20 || item.height > 20);
    const loadingNode = sidebar?.querySelector('[data-app-action-sidebar-thread-row] .animate-spin');
    const loadingIcon = loadingNode ? { ...layoutBox(loadingNode), rendered: box(loadingNode) } : null;
    const settingsTriggerNode = document.getElementById('background-studio-background-settings-trigger');
    const settingsTriggerRect = settingsTriggerNode?.getBoundingClientRect() ?? null;
    const summaryToggleNode = [...document.querySelectorAll('button, [role="button"]')].find((node) => {
      const rect = node.getBoundingClientRect();
      const labels = [node.getAttribute('aria-label'), node.getAttribute('title')].filter(Boolean);
      return rect.width > 0 && rect.height > 0 && labels.some((label) => /^(切换摘要|toggle summary)$/i.test(label.trim()));
    });
    const summaryToggleRect = summaryToggleNode?.getBoundingClientRect() ?? null;
    const overlaps = (a, b) => a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const nativeControlOverlaps = settingsTriggerRect
      ? [...document.querySelectorAll('button, a, [role="button"]')]
        .filter((node) => {
          if (node === settingsTriggerNode || !overlaps(settingsTriggerRect, node.getBoundingClientRect())) return false;
          const style = getComputedStyle(node);
          return style.pointerEvents !== 'none' && style.visibility !== 'hidden' && style.display !== 'none';
        })
        .map((node) => node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent?.trim().slice(0, 40) || node.tagName)
      : [];
    const summaryGap = settingsTriggerRect && summaryToggleRect
      ? Math.round(summaryToggleRect.left - settingsTriggerRect.right)
      : null;
    const summaryCenterDelta = settingsTriggerRect && summaryToggleRect
      ? Math.round((settingsTriggerRect.top + settingsTriggerRect.height / 2) - (summaryToggleRect.top + summaryToggleRect.height / 2))
      : null;
    const result = {
      installed: document.documentElement.classList.contains('codex-background-studio-skin'),
      version: window.__CODEX_BACKGROUND_STUDIO_SKIN_STATE__?.version ?? null,
      stylePresent: Boolean(document.getElementById('codex-background-studio-skin-style')),
      chromePresent: Boolean(document.getElementById('codex-background-studio-skin-chrome')),
      chromePointerEvents: getComputedStyle(document.getElementById('codex-background-studio-skin-chrome') || document.body).pointerEvents,
      homePresent: Boolean(home),
      suggestionsPresent: Boolean(suggestions),
      hero: box(home?.firstElementChild?.firstElementChild?.firstElementChild),
      cards,
      composer: box(document.querySelector('.composer-surface-chrome')),
      sidebar: box(sidebar),
      sidebarIcons: {
        count: sidebarIcons.length,
        maxWidth: Math.max(0, ...sidebarIcons.map((item) => item.width)),
        maxHeight: Math.max(0, ...sidebarIcons.map((item) => item.height)),
        oversized: oversizedSidebarIcons,
      },
      loadingIcon,
      settingsTrigger: {
        box: box(settingsTriggerNode),
        nativeControlOverlaps,
        summaryToggle: box(summaryToggleNode),
        summaryGap,
        summaryCenterDelta,
      },
      viewport: { width: innerWidth, height: innerHeight },
      documentOverflow: {
        x: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        y: document.documentElement.scrollHeight > document.documentElement.clientHeight,
      },
    };
    result.sidebarIconsPass = oversizedSidebarIcons.length === 0 &&
      (!loadingIcon || (loadingIcon.width <= 16 && loadingIcon.height <= 16));
    result.settingsTriggerPass = Boolean(settingsTriggerNode) && nativeControlOverlaps.length === 0 &&
      (!summaryToggleNode || (summaryGap >= 4 && summaryGap <= 8 && Math.abs(summaryCenterDelta) <= 1));
    result.pass = result.installed && result.stylePresent && result.chromePresent &&
      result.chromePointerEvents === 'none' && Boolean(result.composer) && Boolean(result.sidebar) &&
      result.sidebarIconsPass && result.settingsTriggerPass &&
      (!result.homePresent || (Boolean(result.hero) &&
        (!result.suggestionsPresent || (result.cards.length >= 2 && result.cards.length <= 4))));
    return result;
  })()`);
}

async function waitForVerifiedSession(session, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastResult;
  while (Date.now() < deadline) {
    lastResult = await verifySession(session);
    if (lastResult.pass) return lastResult;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return lastResult;
}

async function capture(session, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await session.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await session.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  const viewport = await session.evaluate("({ width: innerWidth, height: innerHeight })");
  await session.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: Math.round(viewport.width * 0.64),
    y: Math.round(viewport.height * 0.62),
    button: "none",
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const result = await session.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await fs.writeFile(outputPath, Buffer.from(result.data, "base64"));
}

async function runOneShot(options) {
  const targets = await waitForTargets(options.port, options.timeoutMs);
  const payload = (options.mode === "once" || options.reload) ? await loadPayload() : null;
  const results = [];
  for (const target of targets) {
    const session = await connectTarget(target);
    try {
      if (options.mode === "remove") await removeFromSession(session);
      else if (options.mode === "purge") await purgeFromSession(session);
      else if (options.mode === "once") await applyToSession(session, payload);
      if (options.mode === "once") {
        await new Promise((resolve) => setTimeout(resolve, 850));
      }
      if (options.reload) {
        await session.send("Page.reload", { ignoreCache: true });
        await new Promise((resolve) => setTimeout(resolve, 1600));
        if (options.mode !== "remove") await applyToSession(session, payload);
      }
      const verified = options.mode === "remove" || options.mode === "purge"
        ? await session.evaluate("!document.documentElement.classList.contains('codex-background-studio-skin')")
        : (options.reload || options.mode === "once")
          ? await waitForVerifiedSession(session, options.timeoutMs)
          : await verifySession(session);
      results.push({ targetId: target.id, title: target.title, url: target.url, result: verified });
      if (options.screenshot) await capture(session, options.screenshot);
    } finally {
      session.close();
    }
  }
  console.log(JSON.stringify({ mode: options.mode, port: options.port, targets: results }, null, 2));
  if (options.mode === "verify" && results.some((item) => !item.result.pass)) process.exitCode = 2;
}

async function runWatch(options) {
  const payload = await loadPayload();
  const sessions = new Map();
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (!stopping) {
    let targets = [];
    try {
      targets = await waitForTargets(options.port, 2000);
    } catch (error) {
      console.error(`[background-studio] ${new Date().toISOString()} ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }

    const activeIds = new Set(targets.map((target) => target.id));
    for (const [id, session] of sessions) {
      if (!activeIds.has(id) || session.closed) {
        session.close();
        sessions.delete(id);
      }
    }

    for (const target of targets) {
      if (sessions.has(target.id)) continue;
      try {
        const session = await connectTarget(target);
        session.on("Page.loadEventFired", () => {
          setTimeout(() => applyToSession(session, payload).catch((error) => {
            console.error(`[background-studio] reinject failed: ${error.message}`);
          }), 250);
        });
        await applyToSession(session, payload);
        sessions.set(target.id, session);
        console.log(`[background-studio] injected target ${target.id} (${target.title || target.url})`);
      } catch (error) {
        console.error(`[background-studio] inject failed for ${target.id}: ${error.message}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 900));
  }

  for (const session of sessions.values()) session.close();
}

const options = parseArgs(process.argv.slice(2));
if (options.mode === "validate-assets") {
  const payload = await loadPayload();
  console.log(JSON.stringify({ valid: true, payloadBytes: Buffer.byteLength(payload), root }));
} else if (options.mode === "watch") await runWatch(options);
else await runOneShot(options);
