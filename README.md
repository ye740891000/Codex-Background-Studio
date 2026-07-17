# Codex Background Studio

一个干净、可逆、本地优先的 Codex 桌面背景扩展。支持图片、GIF、MP4、WebM，以及透明度、遮罩、模糊、裁切、焦点、循环和播放速度设置。

它不会修改 Codex 官方程序、`app.asar`、签名、配置、任务或登录信息。运行时仅通过 IPv4/IPv6 loopback（`127.0.0.1`、`[::1]` 或 `localhost`）上的 Chromium DevTools Protocol 添加可移除的视觉层。

## 快速使用

要求：官方 Codex 桌面应用、Node.js 22 或更高版本。

### Windows

1. 在 GitHub 仓库页面选择 **Code > Download ZIP**。
2. 解压 ZIP，进入解压后的 `Codex-Background-Studio` 文件夹（不要直接在压缩包预览中运行）。
3. 双击 `install.cmd`，安装器会在桌面和开始菜单创建启动、卸载快捷方式。
4. 正常退出当前 Codex。
5. 双击桌面的 **Codex Background Studio**，以后也始终从这个快捷方式打开。

也可以在 PowerShell 中运行：

```powershell
./install.ps1
./launch.ps1
```

### macOS

```bash
chmod +x install.command launch.command uninstall.command
./install.command
./launch.command
```

安装后可以从 `~/Applications/Codex Background Studio.app` 启动；同目录下的 `Codex Background Studio.command` 是可见终端输出的备用入口。

这里的 `~/Applications` 是当前用户目录下的“应用程序”文件夹，不是系统级 `/Applications`。可以在 Finder 中选择 **前往 > 个人**，再打开“Applications”，或在终端执行：

```bash
open ~/Applications
```

如果启动器提示 Codex 已经打开，请保持启动器终端窗口运行，用 `Command+Q` 完全退出 ChatGPT/Codex，并等待启动器自动重新打开应用。不要手动点击图标重开，否则新实例不会携带 Background Studio 调试端口。`Codex Background Studio.app` 会打开这个终端启动流程，并使用项目内置图标显示在 Finder 中。

### Linux

首期基线：Ubuntu 22.04/24.04 x64。

```bash
chmod +x install.sh launch.sh uninstall.sh
./install.sh
./launch.sh
```

如果无法自动发现 Codex：

```bash
CODEX_EXECUTABLE=/path/to/official-codex ./launch.sh
```

## 更换背景

启动后，点击 Codex 左下角设置区旁的背景按钮：

- 选择 JPG、PNG、GIF、MP4 或 WebM
- 调整背景亮度、面板不透明度、暗色遮罩和模糊
- 选择裁切、完整显示或拉伸
- 调整水平、垂直焦点
- 控制视频循环、播放暂停和 0.5x-2x 速度
- 一键恢复项目内置的国徽默认背景

媒体仅保存在本机 Codex 渲染器的 IndexedDB 中，不会上传。

## 包含的界面适配

第一版同时封装了当前主题的实用修复：

- 左侧栏和主任务区使用透明、沉浸式表面
- 任务标题栏与正文区域扁平融合，不使用毛玻璃边界
- 新任务页、项目选择器和四个建议卡片与背景融合
- 建议卡片使用稳定的纯文字布局，规避 Codex 版本变化造成的图标错位
- 清除对话输入框四周、任务状态条下方的割裂阴影，并保留底部间距
- 保留原生交互、可访问性标签和任务数据，不替换官方业务逻辑
- 背景按钮会动态避让侧栏中的更新、帮助、个人资料等原生可点击控件

## 卸载

普通卸载移除运行时和启动入口，保留媒体设置，便于以后重装：

```powershell
./uninstall.ps1
```

```bash
./uninstall.sh
```

彻底清除媒体和设置：

```powershell
./uninstall.ps1 --purge
```

```bash
./uninstall.sh --purge
```

`--purge` 需要 Codex 正通过 Background Studio 端口运行，才能清除渲染器存储。

## 可选 Codex 插件

独立运行时不依赖插件。若希望在 Codex 中通过技能管理安装、启动和卸载，可添加仓库 Marketplace：

```bash
codex plugin marketplace add /absolute/path/to/codex-background-studio
codex plugin add codex-background-studio@personal
```

安装插件后可使用 `$manage-codex-background`。

## 安全边界

- CDP 只使用 IPv4/IPv6 loopback，不得代理或暴露到局域网。
- 已打开但没有调试端口的 Codex 不会被强制关闭；启动器等待用户正常退出。
- 卸载器会校验 PID 对应的命令行，只停止本项目注入器。
- 官方应用、签名、任务、认证和配置保持不变。

架构细节见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。默认图片的许可说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

---

## English quick start

Codex Background Studio is a reversible, local-only image/GIF/video background for the official Codex desktop app. It requires Node.js 22+ and never patches the app bundle or `app.asar`.

- Windows: run `install.cmd`, quit Codex normally, then use the desktop shortcut.
- macOS: run `./install.command`, then `./launch.command`.
- Ubuntu/Linux: run `./install.sh`, then `./launch.sh`; set `CODEX_EXECUTABLE` when discovery fails.
- Open the background button beside the lower-left Codex settings controls to select media and tune presentation.
- The bundled compatibility theme flattens the title area, sidebar, new-task surface, suggestion cards, project selector, and composer shadows.
- Run the matching `uninstall` script to remove the helper. Add `--purge` only when saved media and settings should also be deleted.

Source code is MIT licensed. The supplied default photograph has separate terms in `THIRD_PARTY_NOTICES.md`.
