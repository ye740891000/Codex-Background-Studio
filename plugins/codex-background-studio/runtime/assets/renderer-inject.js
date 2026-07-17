((cssText, artDataUrl) => {
  const STATE_KEY = "__CODEX_BACKGROUND_STUDIO_SKIN_STATE__";
  const STYLE_ID = "codex-background-studio-skin-style";
  const CHROME_ID = "codex-background-studio-skin-chrome";
  const MEDIA_LAYER_ID = "background-studio-media-layer";
  const PANEL_ID = "background-studio-background-settings";
  const TRIGGER_ID = "background-studio-background-settings-trigger";
  const STORAGE_KEY = "codex-background-studio-settings-v1";
  const DB_NAME = "codex-background-studio";
  const DB_STORE = "media";
  const VERSION = "0.1.0";
  const DEFAULTS = Object.freeze({
    mediaKind: "default",
    mediaName: "国徽默认背景",
    mediaOpacity: 100,
    panelOpacity: 24,
    scrim: 8,
    blur: 0,
    fit: "cover",
    positionX: 50,
    positionY: 50,
    loop: true,
    speed: 1,
  });

  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value)));
  const readPreferences = () => {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
    } catch {
      return { ...DEFAULTS };
    }
  };
  let preferences = readPreferences();
  let currentMediaUrl = null;
  let currentMediaElement = null;
  let currentMediaType = "image/png";
  let currentMediaName = preferences.mediaName;
  window.__CODEX_BACKGROUND_STUDIO_SKIN_DISABLED__ = false;

  const previous = window[STATE_KEY];
  previous?.observer?.disconnect();
  if (previous?.timer) clearInterval(previous.timer);
  if (previous?.scheduler?.timeout) clearTimeout(previous.scheduler.timeout);
  if (previous?.onResize) window.removeEventListener("resize", previous.onResize);
  if (previous?.mediaUrl) URL.revokeObjectURL(previous.mediaUrl);
  document.getElementById(CHROME_ID)?.remove();
  document.getElementById(MEDIA_LAYER_ID)?.remove();
  document.getElementById(PANEL_ID)?.remove();
  document.getElementById(TRIGGER_ID)?.remove();

  const artUrl = previous?.artUrl || (() => {
    const comma = artDataUrl.indexOf(",");
    const binary = atob(artDataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  })();

  const existingStyle = document.getElementById(STYLE_ID);
  if (existingStyle) {
    existingStyle.textContent = cssText;
    existingStyle.dataset.backgroundStudioVersion = VERSION;
  }

  const savePreferences = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  };

  const openDatabase = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DB_STORE)) request.result.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  const writeMediaRecord = async (file) => {
    const db = await openDatabase();
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(DB_STORE, "readwrite");
        transaction.objectStore(DB_STORE).put({
          blob: file,
          name: file.name,
          type: file.type,
          lastModified: file.lastModified,
        }, "active");
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      db.close();
    }
  };

  const readMediaRecord = async () => {
    const db = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get("active");
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  };

  const deleteMediaRecord = async () => {
    const db = await openDatabase();
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(DB_STORE, "readwrite");
        transaction.objectStore(DB_STORE).delete("active");
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      db.close();
    }
  };

  const setStatus = (message) => {
    const status = document.querySelector(`#${PANEL_ID} [data-role="status"]`);
    if (status) status.textContent = message;
  };

  const formatValue = (key, value) => {
    if (["mediaOpacity", "panelOpacity", "scrim", "positionX", "positionY"].includes(key)) return `${value}%`;
    if (key === "blur") return `${value}px`;
    if (key === "speed") return `${value}x`;
    return String(value);
  };

  const applyPreferences = () => {
    const root = document.documentElement;
    if (!root) return;
    const panelAlpha = clamp(preferences.panelOpacity, 5, 90) / 100;
    root.style.setProperty("--background-studio-media-opacity", String(clamp(preferences.mediaOpacity, 10, 100) / 100));
    root.style.setProperty("--background-studio-panel-alpha", panelAlpha.toFixed(2));
    root.style.setProperty("--background-studio-composer-alpha", Math.min(.92, panelAlpha + .24).toFixed(2));
    root.style.setProperty("--background-studio-header-alpha", Math.min(.78, panelAlpha + .12).toFixed(2));
    root.style.setProperty("--background-studio-scrim-alpha", String(clamp(preferences.scrim, 0, 70) / 100));
    root.style.setProperty("--background-studio-media-blur", `${clamp(preferences.blur, 0, 16)}px`);
    root.style.setProperty("--background-studio-media-fit", ["cover", "contain", "fill"].includes(preferences.fit) ? preferences.fit : "cover");
    root.style.setProperty("--background-studio-media-x", `${clamp(preferences.positionX, 0, 100)}%`);
    root.style.setProperty("--background-studio-media-y", `${clamp(preferences.positionY, 0, 100)}%`);
    if (currentMediaElement) {
      currentMediaElement.loop = Boolean(preferences.loop);
      if (currentMediaElement instanceof HTMLVideoElement) currentMediaElement.playbackRate = clamp(preferences.speed, .5, 2);
    }
    document.querySelectorAll(`#${PANEL_ID} [data-output-for]`).forEach((output) => {
      const key = output.dataset.outputFor;
      output.textContent = formatValue(key, preferences[key]);
    });
    document.querySelectorAll(`#${PANEL_ID} [data-fit]`).forEach((button) => {
      button.classList.toggle("is-active", button.dataset.fit === preferences.fit);
      button.setAttribute("aria-pressed", String(button.dataset.fit === preferences.fit));
    });
  };

  const refreshMediaLabel = () => {
    const label = document.querySelector(`#${PANEL_ID} [data-role="media-name"]`);
    if (label) label.textContent = currentMediaName || "默认背景";
    const play = document.querySelector(`#${PANEL_ID} [data-action="toggle-play"]`);
    if (play) {
      const isVideo = currentMediaElement instanceof HTMLVideoElement;
      play.hidden = !isVideo;
      play.textContent = isVideo && currentMediaElement.paused ? "播放" : "暂停";
    }
  };

  const ensureMediaLayer = () => {
    if (!document.body) return null;
    let layer = document.getElementById(MEDIA_LAYER_ID);
    if (!layer) {
      layer = document.createElement("div");
      layer.id = MEDIA_LAYER_ID;
      layer.setAttribute("aria-hidden", "true");
      document.body.prepend(layer);
    }
    document.documentElement.classList.add("background-studio-media-active");
    return layer;
  };

  const renderMedia = (record = null) => {
    const layer = ensureMediaLayer();
    if (!layer) return;
    if (currentMediaUrl) URL.revokeObjectURL(currentMediaUrl);
    currentMediaUrl = record?.blob ? URL.createObjectURL(record.blob) : null;
    if (window[STATE_KEY]) window[STATE_KEY].mediaUrl = currentMediaUrl;
    currentMediaType = record?.type || "image/png";
    currentMediaName = record?.name || "国徽默认背景";
    const isVideo = currentMediaType.startsWith("video/");
    const media = document.createElement(isVideo ? "video" : "img");
    media.className = "background-studio-media-content";
    media.src = currentMediaUrl || artUrl;
    media.draggable = false;
    if (isVideo) {
      media.muted = true;
      media.autoplay = true;
      media.playsInline = true;
      media.loop = Boolean(preferences.loop);
      media.playbackRate = clamp(preferences.speed, .5, 2);
      media.addEventListener("canplay", () => media.play().catch(() => setStatus("点击播放以启动视频")), { once: true });
    } else {
      media.alt = "";
    }
    media.addEventListener("error", () => setStatus("媒体无法加载，请选择其他文件"), { once: true });
    const scrim = document.createElement("div");
    scrim.className = "background-studio-media-scrim";
    layer.replaceChildren(media, scrim);
    currentMediaElement = media;
    applyPreferences();
    refreshMediaLabel();
  };

  const buildPanel = () => {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;
    panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.setAttribute("aria-label", "背景设置");
    panel.innerHTML = `
      <header class="background-studio-settings-header">
        <div><strong>背景设置</strong><small data-role="media-name"></small></div>
        <button type="button" data-action="close" aria-label="关闭背景设置" title="关闭">×</button>
      </header>
      <div class="background-studio-settings-actions">
        <button type="button" data-action="choose">选择媒体</button>
        <button type="button" data-action="reset">恢复默认</button>
        <button type="button" data-action="toggle-play" hidden>暂停</button>
        <input data-role="file" type="file" accept="image/*,video/mp4,video/webm" hidden>
      </div>
      <label class="background-studio-setting-row"><span>背景亮度 <output data-output-for="mediaOpacity"></output></span><input type="range" min="10" max="100" step="1" data-setting="mediaOpacity"></label>
      <label class="background-studio-setting-row"><span>面板不透明度 <output data-output-for="panelOpacity"></output></span><input type="range" min="5" max="90" step="1" data-setting="panelOpacity"></label>
      <label class="background-studio-setting-row"><span>暗色遮罩 <output data-output-for="scrim"></output></span><input type="range" min="0" max="70" step="1" data-setting="scrim"></label>
      <label class="background-studio-setting-row"><span>背景模糊 <output data-output-for="blur"></output></span><input type="range" min="0" max="16" step="1" data-setting="blur"></label>
      <div class="background-studio-setting-row"><span>填充方式</span><div class="background-studio-segmented" role="group" aria-label="背景填充方式"><button type="button" data-fit="cover">裁切</button><button type="button" data-fit="contain">完整</button><button type="button" data-fit="fill">拉伸</button></div></div>
      <label class="background-studio-setting-row"><span>水平焦点 <output data-output-for="positionX"></output></span><input type="range" min="0" max="100" step="1" data-setting="positionX"></label>
      <label class="background-studio-setting-row"><span>垂直焦点 <output data-output-for="positionY"></output></span><input type="range" min="0" max="100" step="1" data-setting="positionY"></label>
      <div class="background-studio-settings-inline">
        <label><input type="checkbox" data-setting="loop"> 视频循环</label>
        <label>速度 <select data-setting="speed"><option value="0.5">0.5x</option><option value="0.75">0.75x</option><option value="1">1x</option><option value="1.25">1.25x</option><option value="1.5">1.5x</option><option value="2">2x</option></select></label>
      </div>
      <p class="background-studio-settings-status" data-role="status" role="status">支持 JPG、PNG、GIF、MP4 和 WebM</p>`;
    document.body.appendChild(panel);

    const fileInput = panel.querySelector('[data-role="file"]');
    panel.addEventListener("input", (event) => {
      const key = event.target.dataset.setting;
      if (!key || event.target.type === "checkbox" || event.target.tagName === "SELECT") return;
      preferences[key] = Number(event.target.value);
      savePreferences();
      applyPreferences();
    });
    panel.addEventListener("change", (event) => {
      const key = event.target.dataset.setting;
      if (key) {
        preferences[key] = event.target.type === "checkbox" ? event.target.checked : event.target.tagName === "SELECT" ? Number(event.target.value) : Number(event.target.value);
        savePreferences();
        applyPreferences();
      }
    });
    panel.addEventListener("click", async (event) => {
      const target = event.target.closest("button");
      if (!target) return;
      if (target.dataset.fit) {
        preferences.fit = target.dataset.fit;
        savePreferences();
        applyPreferences();
        return;
      }
      const action = target.dataset.action;
      if (action === "close") panel.classList.remove("is-open");
      if (action === "choose") fileInput.click();
      if (action === "toggle-play" && currentMediaElement instanceof HTMLVideoElement) {
        if (currentMediaElement.paused) await currentMediaElement.play().catch(() => setStatus("视频播放被系统阻止"));
        else currentMediaElement.pause();
        refreshMediaLabel();
      }
      if (action === "reset") {
        preferences = { ...DEFAULTS };
        savePreferences();
        await deleteMediaRecord().catch(() => {});
        renderMedia();
        syncPanel();
        setStatus("已恢复国徽默认背景");
      }
    });
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const supported = file.type.startsWith("image/") || ["video/mp4", "video/webm"].includes(file.type);
      if (!supported) {
        setStatus("仅支持图片、GIF、MP4 或 WebM");
        return;
      }
      renderMedia({ blob: file, name: file.name, type: file.type });
      preferences.mediaKind = "custom";
      preferences.mediaName = file.name;
      savePreferences();
      try {
        await writeMediaRecord(file);
        setStatus("已保存，本地重启后仍会保留");
      } catch {
        setStatus("已预览，但文件过大或无法持久保存");
      }
      fileInput.value = "";
    });
    return panel;
  };

  const syncPanel = () => {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    panel.querySelectorAll("[data-setting]").forEach((control) => {
      const key = control.dataset.setting;
      if (control.type === "checkbox") control.checked = Boolean(preferences[key]);
      else control.value = String(preferences[key]);
    });
    applyPreferences();
    refreshMediaLabel();
  };

  const positionControls = () => {
    const trigger = document.getElementById(TRIGGER_ID);
    const panel = document.getElementById(PANEL_ID);
    if (!trigger || !panel) return;
    const aside = document.querySelector("aside.app-shell-left-panel");
    const box = aside?.getBoundingClientRect();
    if (box && box.width >= 160) {
      trigger.style.left = `${Math.round(box.right - 70)}px`;
      trigger.style.right = "auto";
      trigger.style.top = "auto";
      trigger.style.bottom = "10px";
      panel.style.left = `${Math.min(innerWidth - 364, Math.round(box.right + 12))}px`;
      panel.style.right = "auto";
      panel.style.bottom = "12px";
      panel.style.top = "auto";
    } else {
      trigger.style.left = "auto";
      trigger.style.right = "76px";
      trigger.style.top = "42px";
      trigger.style.bottom = "auto";
      panel.style.left = "auto";
      panel.style.right = "12px";
      panel.style.top = "82px";
      panel.style.bottom = "auto";
    }
  };

  const ensureSettingsControl = () => {
    if (!document.body) return;
    const panel = buildPanel();
    let trigger = document.getElementById(TRIGGER_ID);
    if (!trigger) {
      trigger = document.createElement("button");
      trigger.id = TRIGGER_ID;
      trigger.type = "button";
      trigger.setAttribute("aria-label", "背景设置");
      trigger.title = "背景设置";
      const nativeIcon = document.querySelector('aside.app-shell-left-panel button[aria-label="打开个人资料菜单"] svg');
      if (nativeIcon) trigger.appendChild(nativeIcon.cloneNode(true));
      else trigger.textContent = "⚙";
      trigger.addEventListener("click", () => {
        panel.classList.toggle("is-open");
        trigger.setAttribute("aria-expanded", String(panel.classList.contains("is-open")));
        if (panel.classList.contains("is-open")) syncPanel();
      });
      document.body.appendChild(trigger);
    }
    positionControls();
  };

  const ensure = () => {
    if (window.__CODEX_BACKGROUND_STUDIO_SKIN_DISABLED__) return;
    const root = document.documentElement;
    if (!root) return;
    root.classList.add("codex-background-studio-skin");
    root.style.setProperty("--background-studio-art", `url("${artUrl}")`);
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head || root).appendChild(style);
    }
    if (style.dataset.backgroundStudioVersion !== VERSION) {
      style.textContent = cssText;
      style.dataset.backgroundStudioVersion = VERSION;
    }

    const shellMain = document.querySelector("main.main-surface") || document.querySelector("main");
    const home = document.querySelector('[role="main"]:has([data-testid="home-icon"])');
    for (const candidate of document.querySelectorAll('[role="main"].background-studio-home')) {
      if (candidate !== home) candidate.classList.remove("background-studio-home");
    }
    if (home) home.classList.add("background-studio-home");
    if (!shellMain || !document.body) return;
    shellMain.classList.toggle("background-studio-home-shell", Boolean(home));

    const composer = document.querySelector(".composer-surface-chrome");
    document.querySelectorAll(".background-studio-composer-frame").forEach((node) => node.classList.remove("background-studio-composer-frame"));
    document.querySelectorAll(".background-studio-composer-dock").forEach((node) => node.classList.remove("background-studio-composer-dock"));
    document.querySelectorAll(".background-studio-composer-aux-surface").forEach((node) => node.classList.remove("background-studio-composer-aux-surface"));
    if (composer) {
      let frame = composer.parentElement;
      while (frame && frame !== shellMain && !frame.classList.contains("px-toolbar")) frame = frame.parentElement;
      frame?.classList.add("background-studio-composer-frame");
      let dock = frame?.parentElement;
      while (dock && dock !== shellMain && !(dock.classList.contains("pb-4") && (dock.classList.contains("sticky") || dock.classList.contains("z-20")))) dock = dock.parentElement;
      dock?.classList.add("background-studio-composer-dock");
      const composerBox = composer.getBoundingClientRect();
      for (const candidate of frame?.querySelectorAll("*") || []) {
        const box = candidate.getBoundingClientRect();
        const isWideUpperSurface = box.width >= composerBox.width * .7 && box.height > 0 &&
          box.bottom <= composerBox.top + 2 && box.top >= (frame?.getBoundingClientRect().top || 0) - 2;
        if (isWideUpperSurface) candidate.classList.add("background-studio-composer-aux-surface");
      }
    }

    let chrome = document.getElementById(CHROME_ID);
    if (!chrome || chrome.parentElement !== document.body) {
      chrome?.remove();
      chrome = document.createElement("div");
      chrome.id = CHROME_ID;
      chrome.setAttribute("aria-hidden", "true");
      chrome.innerHTML = `
        <div class="background-studio-brand"><span class="background-studio-note">★</span><span><b>CODEX</b><small>Focused work</small></span></div>
        <div class="background-studio-signature">Build with purpose</div>
        <div class="background-studio-sparkles"><i></i><i></i><i></i><i></i><i></i><i></i></div>
        <div class="background-studio-ribbon"><span>✦</span><span>◆</span><span>✦</span></div>
        <div class="background-studio-polaroid"></div>`;
      document.body.appendChild(chrome);
    }
    const shellBox = shellMain.getBoundingClientRect();
    chrome.style.left = `${Math.round(shellBox.left)}px`;
    chrome.style.top = `${Math.round(shellBox.top)}px`;
    chrome.style.width = `${Math.round(shellBox.width)}px`;
    chrome.style.height = `${Math.round(shellBox.height)}px`;
    chrome.classList.toggle("background-studio-home-shell", Boolean(home));
    ensureMediaLayer();
    ensureSettingsControl();
    applyPreferences();
  };

  const cleanup = () => {
    window.__CODEX_BACKGROUND_STUDIO_SKIN_DISABLED__ = true;
    const state = window[STATE_KEY];
    state?.observer?.disconnect();
    if (state?.timer) clearInterval(state.timer);
    if (state?.scheduler?.timeout) clearTimeout(state.scheduler.timeout);
    if (state?.onResize) window.removeEventListener("resize", state.onResize);
    document.documentElement?.classList.remove("codex-background-studio-skin", "background-studio-media-active");
    ["--background-studio-art", "--background-studio-media-opacity", "--background-studio-panel-alpha", "--background-studio-composer-alpha", "--background-studio-header-alpha", "--background-studio-scrim-alpha", "--background-studio-media-blur", "--background-studio-media-fit", "--background-studio-media-x", "--background-studio-media-y"].forEach((key) => document.documentElement?.style.removeProperty(key));
    document.querySelectorAll(".background-studio-home").forEach((node) => node.classList.remove("background-studio-home"));
    document.querySelectorAll(".background-studio-home-shell").forEach((node) => node.classList.remove("background-studio-home-shell"));
    document.querySelectorAll(".background-studio-composer-frame").forEach((node) => node.classList.remove("background-studio-composer-frame"));
    document.querySelectorAll(".background-studio-composer-dock").forEach((node) => node.classList.remove("background-studio-composer-dock"));
    document.querySelectorAll(".background-studio-composer-aux-surface").forEach((node) => node.classList.remove("background-studio-composer-aux-surface"));
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(CHROME_ID)?.remove();
    document.getElementById(MEDIA_LAYER_ID)?.remove();
    document.getElementById(PANEL_ID)?.remove();
    document.getElementById(TRIGGER_ID)?.remove();
    if (state?.mediaUrl) URL.revokeObjectURL(state.mediaUrl);
    if (state?.artUrl) URL.revokeObjectURL(state.artUrl);
    delete window[STATE_KEY];
    return true;
  };

  const scheduler = { timeout: null };
  const scheduleEnsure = () => {
    if (scheduler.timeout) clearTimeout(scheduler.timeout);
    scheduler.timeout = setTimeout(() => {
      scheduler.timeout = null;
      ensure();
    }, 180);
  };
  const observer = new MutationObserver(scheduleEnsure);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  const timer = setInterval(ensure, 5000);
  const onResize = () => positionControls();
  window.addEventListener("resize", onResize);
  window[STATE_KEY] = { ensure, cleanup, observer, timer, scheduler, onResize, artUrl, mediaUrl: null, version: VERSION };
  ensure();
  renderMedia();
  syncPanel();
  if (preferences.mediaKind === "custom") {
    readMediaRecord().then((record) => {
      if (record) renderMedia(record);
      else {
        preferences.mediaKind = "default";
        preferences.mediaName = DEFAULTS.mediaName;
        savePreferences();
      }
    }).catch(() => setStatus("无法读取已保存的媒体，已使用默认背景"));
  }
  return { installed: true, version: VERSION };
})(__BACKGROUND_STUDIO_CSS_JSON__, __BACKGROUND_STUDIO_ART_JSON__)
