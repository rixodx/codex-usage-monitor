# Codex Usage 悬浮窗

Windows 原生置顶小窗，连接 **[zJay26/codex-usage](https://github.com/zJay26/codex-usage) 本地服务**。
它不修改 Codex 启动参数、系统代理或账号配置。

## 启动

1. 保持 codex-usage 后台服务运行（默认 `http://127.0.0.1:43189`）。
2. 双击 **CodexUsageWidget.exe**（不弹终端），或 **Start.cmd**。
3. 保持本文件夹可写；需要 Windows PowerShell 5.1、.NET Framework 和 Node.js 18+。

下载后先完整解压，再运行。`Start.vbs` 和 `Start.cmd` 也是可用入口。
本项目不包含统计服务本身，需要先安装并启动上面链接中的 codex-usage。

## 操作

- 拖动标题区域移动窗口；位置自动保存。
- 双击标题切换精简/完整模式。
- 点击 **···** 或右键：切换今日/近 7 天/本月/近 30 天，置顶、透明度、刷新频率和服务地址。
- **—** 收到系统托盘；双击托盘图标恢复，或右键托盘选择“显示悬浮窗”。
- 窗口也会显示在任务栏；再次运行启动程序会恢复已有窗口到主屏幕右上角。
- **×** 完全退出，仅关闭本悬浮窗的采集器，不关闭 codex-usage 服务或 Codex。
- **完整面板 ↗** 打开原有本地网页。
- **模型定价（网页）**：在原网页的“模型定价”中编辑价格，悬浮窗随后使用服务的新价格。
- 不自动添加开机启动；不请求账号登录；不读取 auth.json。

## 数据含义

- 窗口默认每 5 秒查询本机服务，随统计服务将日志写入索引而更新，并非逐 token 流式计数。
- 日期范围为北京时间；token 总量直接采用服务的 grand_total，不将缓存或推理 token 再次加进总量。
- 费用直接采用服务的**标准 API 文本价格估算**，不使用 `codex_fast_weighted` 的订阅 credits 倍率；它不等于订阅账单或实际 API 账单。
- 显示价格覆盖率；服务报告未计价、分类异常或本地记录不完整时明确标注。未计价部分不会被默认为免费。
- 服务失联时保留最后成功数值并将状态变为黄色。切换日期范围时会隐藏旧范围数字。
- 只统计现有服务包含的本机数据；其他设备、未记录的调用不在内。
- 不显示账号剩余额度百分比；那需要联网，不能仅从 token 精确换算。

## 文件

- `Widget.ps1`：Windows WPF 窗口。
- `CodexUsageWidget.exe`：原生启动器，无需 VBS；`Launcher.cs` 为其源代码。
- `DesktopIdentity.cs`：按 Windows 桌面区分单实例，隔离测试不会占用用户桌面的实例。
- `collector.js`：只读本地 HTTP 接口，拒绝非本机地址与重定向。
- `settings.json`：位置、透明度、时间范围和服务地址（首次启动生成）。
- `state.json`：最新统计快照（自动生成，含本地聚合用量）。
- `collector-error.log`：采集器错误诊断。
- `widget-error.log` / `ui-status.json`：窗口启动和显示状态诊断。
- `launcher.log`：启动时间、桌面名称及窗口进程编号。若 EXE 没有反应，运行 `Diagnose.cmd` 查看可见错误。

退出后删除整个文件夹即可移除。更新脚本时可保留 settings.json。

## 验证

如需从源码重建启动器，双击 `Build.cmd`。它使用 Windows 自带 .NET Framework 的 C# 编译器，不需要额外的 .NET SDK。
编译后运行 `CodexUsageWidget.exe`、`Start.cmd` 或 `Start.vbs`。

```powershell
node collector.test.js
node collector.js --once
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File .\Widget.ps1 -Validate
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File .\Widget.ps1 -SelfTest
```

本程序为本地自制适配器；依赖的 codex-usage 接口变化后可能需要调整。
