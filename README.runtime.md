# codex-usage-monitor

Windows 桌面用量悬浮窗。完整解压到可写目录，双击 codex-usage-monitor.exe。

运行环境：Windows PowerShell 5.1、.NET Framework（Windows 通常自带）。Windows x64 运行包已内置 Node.js 24.22.1，仅包含必要的 node.exe 和许可证，无需单独安装 Node.js 或 npm。请保留 runtime 文件夹；程序优先使用 runtime\node.exe，缺少时才尝试系统安装的 Node.js 18+。

采集服务会在缺少时自动下载、启动，有新版时更新。服务意外关闭后自动恢复；失败每 30 秒重试。下载内容会进行 SHA-256 校验。

GitHub 无法访问时，在窗口“··· → 本地服务地址…”中填写“GitHub 更新代理”，使用自己的 Clash HTTP 代理地址，例如 http://127.0.0.1:7890。不需要系统代理或 TUN。已有缓存时优先从本地启动。

5 小时和 7 天显示订阅额度已用比例，悬停查看重置时间；token 和费用来自本机统计，费用是 API 等价估算。实时额度需要已登录的 Codex CLI；查询失败时显示本机额度快照及其时间。

点击 × 完全退出；— 收起到托盘，双击托盘图标或选择“显示悬浮窗”后保持原来的桌面位置。采集服务独立运行，退出悬浮窗后继续采集。

多个 Codex 实例使用独立记录目录时，在“··· → 采集目录…”选择包含 sessions 或 archived_sessions 的 Codex Home，点击“添加并扫描”即可合并统计。不会移动或删除原始记录。

settings.json、state.json、日志和 .runtime 在运行后生成。此包不含个人设置、账号凭据或统计数据。

上游采集服务：https://github.com/zJay26/codex-usage
项目源码：https://github.com/rixodx/codex-usage-monitor
第三方说明见 THIRD_PARTY_NOTICES.md。
