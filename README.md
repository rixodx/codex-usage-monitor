# codex-usage-monitor

Windows 原生置顶小窗，连接 **[zJay26/codex-usage](https://github.com/zJay26/codex-usage) 本地服务**。
它不修改 Codex 启动参数、系统代理或账号配置。

支持 **5 小时、7 天订阅额度已用百分比、进度条和重置倒计时**；完整和精简模式均可查看。
额度读取方式参考 [Justin-147/codex-usage-hud](https://github.com/Justin-147/codex-usage-hud)，见 [第三方说明](THIRD_PARTY_NOTICES.md)。

## 启动

最小运行包仅包含 EXE、窗口与采集脚本、第三方说明和简要使用说明；不包含源码、测试、个人设置、统计记录或已下载的服务缓存。完整解压后运行 `codex-usage-monitor.exe`。仍需 Windows 自带的 PowerShell / .NET Framework，以及已安装的 Node.js 18+。

1. 完整解压到可写目录。
2. 双击 **codex-usage-monitor.exe**（不弹终端），或 **Start.cmd**，自动检查并启动采集服务。
3. 保持本文件夹可写；需要 Windows PowerShell 5.1、.NET Framework 和 Node.js 18+。

下载后先完整解压，再运行。`Start.vbs` 和 `Start.cmd` 也是可用入口。
首次启动缺少采集服务时，从上游 GitHub Release 下载最新 Windows 正式版；不需要手动安装 codex-usage。

## 采集服务自动更新

每次启动悬浮窗，都读取正在运行的服务版本，并查询上游最新正式版。已有最新版时复用服务；缺少服务时下载并启动；存在新版时下载、校验，再切换到新版。菜单中的“检查采集服务更新”可手动触发检查。

悬浮窗运行期间，采集服务被关闭或连接失败时也会自动恢复，失败后每 30 秒重试一次。有已校验的缓存时先从本地启动，再联网检查更新，无需等待 GitHub 响应；缺少缓存才下载。再次双击 EXE 会显示已有窗口并触发服务检查。更新项目文件后，需要点击窗口“×”完全退出并重新打开，旧进程才会加载新代码。

- 自动选择 Windows x64 / ARM64，忽略预发布版；执行前校验 GitHub 提供的 SHA-256 和程序自身版本。
- GitHub API 被限流时，回退到上游官方 Release 页面和 `SHA256SUMS` 获取版本与校验值，无需 GitHub Token。
- 程序缓存在本文件夹的 `.runtime/<版本>/`。更新时沿用现有统计数据库和模型定价配置，先停止经进程身份核验的旧服务，再备份数据；新版启动失败时尝试恢复旧程序和备份。
- GitHub 不可达时继续使用正在运行的服务；没有运行的服务时，可启动以前下载并校验过的缓存。界面会说明尚未核实最新版本。
- 首次下载需要能够连接 GitHub。可在菜单“服务地址”中填写“GitHub 更新代理”，例如 `http://127.0.0.1:你的Clash端口`。只影响更新请求，无需系统代理或 TUN；留空时采用 `HTTPS_PROXY` 环境变量或直接连接。
- 更新过程显示在窗口底部，错误详情可悬停查看。该功能更新的是 **codex-usage 采集服务**，悬浮窗本身仍需更新项目文件。
- 不注册开机启动。采集服务独立运行，退出悬浮窗后继续采集；统计数据默认位于 `%LOCALAPPDATA%/codex-usage`。

## 操作

- 在标题、数字、正文或空白区域按住左键拖动窗口；移动超过系统拖动阈值后才开始拖动，位置自动保存。按钮和菜单保留正常点击。
- 双击标题切换精简/完整模式。
- 点击 **···** 或右键：直接选择今日/近 7 天/本月/近 30 天。菜单使用单层选项，避免左右展开的子菜单难以选择；透明度和刷新频率在“透明度与刷新设置…”中修改。
- **—** 收到系统托盘；双击托盘图标恢复，或右键托盘选择“显示悬浮窗”，均保持隐藏前的桌面位置。
- 窗口也会显示在任务栏；再次运行启动程序会恢复已有窗口到主屏幕右上角。
- **×** 完全退出，仅关闭本悬浮窗的采集器，不关闭 codex-usage 服务或 Codex。
- **完整面板 ↗** 打开原有本地网页。
- **模型定价（网页）**：在原网页的“模型定价”中编辑价格，悬浮窗随后使用服务的新价格。
- 额度每约 60 秒通过 Codex CLI 的 `account/rateLimits/read` 更新；“立即刷新”也会触发查询。
- 查询受网络影响时，回退到本机最近会话的额度快照，并显示其时间。无需为本地快照额外配置代理。
- 不自动添加开机启动；不请求账号登录；不读取 auth.json。

## 数据含义

- 窗口默认每 5 秒查询本机服务，随统计服务将日志写入索引而更新，并非逐 token 流式计数。
- 日期范围为北京时间；token 总量直接采用服务的 grand_total，不将缓存或推理 token 再次加进总量。
- 费用直接采用服务的**标准 API 文本价格估算**，不使用 `codex_fast_weighted` 的订阅 credits 倍率；它不等于订阅账单或实际 API 账单。
- 显示价格覆盖率；服务报告未计价、分类异常或本地记录不完整时明确标注。未计价部分不会被默认为免费。
- 服务失联时保留最后成功数值并将状态变为黄色。切换日期范围时会隐藏旧范围数字。
- 只统计现有服务包含的本机数据；其他设备、未记录的调用不在内。
- 额度与上方 token 的日期范围独立：5 小时/7 天是服务端额度窗口，不是“今天”或“近 7 天”的 token 合计。
- 已用百分比由服务返回，剩余量为 `100 - 已用百分比`。不会从 token 数量推算订阅额度。
- 服务未返回的窗口显示“未提供”；快照已过重置时间时显示“快照已过期”，不会伪造为 0% 或 100%。
- “实时查询”“本地快照”“上次查询”显示数据来源；超过 5 分钟的记录标记“旧”。本地记录可能来自账号切换前的会话，应以当前账号在线查询为准。
- 仅调用只读额度接口，不创建聊天、不运行模型、不消费重置券；不直接读取或展示 auth.json 中的凭据。

## Codex CLI 路径

额度查询需要已登录的 Codex CLI。程序会自动寻找安装路径；找不到时仍可显示本地快照。
如需手动指定，退出悬浮窗，在 `settings.json` 中设置 `codexExe` 为 `codex.exe` 的完整路径（JSON 路径中的反斜杠需写成 `\\`），再启动。
不要指定桌面启动器 `app\Codex.exe`，应使用 CLI 或 `app\resources\codex.exe`。
网络失败不会清空已有 token 或费用统计。

## 文件

- `Widget.ps1`：Windows WPF 窗口。
- `codex-usage-monitor.exe`：原生启动器，无需 VBS；`Launcher.cs` 为其源代码。
- `DesktopIdentity.cs`：按 Windows 桌面区分单实例，已编译进 EXE；运行包无需附带该源码。
- `collector.js`：只读本地 HTTP 接口，拒绝非本机地址与重定向。
- `quota.js`：额度查询、时长识别、CLI 生命周期和本地快照回退。
- `backend.js` / `service-control.ps1`：上游版本检查、校验下载、后台启动和失败恢复。
- `settings.json`：位置、透明度、时间范围和服务地址（首次启动生成）。
- `state.json`：最新统计快照（自动生成，含本地聚合用量）。
- `collector-error.log`：采集器错误诊断。
- `widget-error.log` / `ui-status.json`：窗口启动和显示状态诊断。
- `launcher.log`：启动时间、桌面名称及窗口进程编号。若 EXE 没有反应，运行 `Diagnose.cmd` 查看可见错误。

更新脚本时可保留 settings.json 和 `.runtime`。移除悬浮窗前先退出；采集服务和统计数据独立保留，正在运行的 EXE 可能需要先结束再删除其缓存目录。

## 验证

如需从源码重建启动器，双击 `Build.cmd`。它使用 Windows 自带 .NET Framework 的 C# 编译器，不需要额外的 .NET SDK。
编译后运行 `codex-usage-monitor.exe`、`Start.cmd` 或 `Start.vbs`。

```powershell
node collector.test.js
node quota.test.js
node backend.test.js
node collector.js --once --no-bootstrap
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File .\Widget.ps1 -Validate
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File .\Widget.ps1 -SelfTest
```

本程序为本地自制适配器；依赖的 codex-usage 接口变化后可能需要调整。
