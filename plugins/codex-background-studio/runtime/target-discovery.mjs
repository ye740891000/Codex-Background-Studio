const ARCH_LINUX_WEBVIEW_PORT = "5175";
const LOOPBACK_WEBVIEW_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

/**
 * 2026-07-18 苍朮
 * 判断 CDP 页面是否属于可安全注入的 Codex 渲染器，同时兼容 Arch Linux 的本地 WebView 服务。
 * @param {{ type?: string, url?: string, webSocketDebuggerUrl?: string }} target CDP 返回的候选目标。
 * @param {string} platform 当前运行平台，默认使用 Node.js 的 process.platform。
 * @returns {boolean} 候选目标可作为 Codex 渲染器时返回 true，否则返回 false。
 */
export function isCodexRendererTarget(target, platform = process.platform) {
  if (target?.type !== "page" || !target.webSocketDebuggerUrl || !target.url) return false;

  try {
    const url = new URL(target.url);
    if (url.searchParams.get("initialRoute") === "/avatar-overlay") return false;
    if (url.protocol === "app:") return true;
    if (platform !== "linux" || url.protocol !== "http:" || url.port !== ARCH_LINUX_WEBVIEW_PORT) return false;

    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return LOOPBACK_WEBVIEW_HOSTS.has(hostname);
  } catch {
    return false;
  }
}
