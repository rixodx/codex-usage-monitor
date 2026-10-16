param([switch]$Validate, [switch]$SelfTest, [string]$TestStatePath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Windows.Forms, System.Drawing, System.Net.Http
trap {
    try { [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'widget-error.log'), ($_ | Out-String), (New-Object Text.UTF8Encoding($false))) } catch { }
    if (-not $Validate -and -not $SelfTest) { [void][Windows.MessageBox]::Show('悬浮窗启动遇到错误，请查看同目录 widget-error.log。','Codex Usage') }
    exit 1
}
$script:Root = $PSScriptRoot
$script:SettingsPath = Join-Path $script:Root 'settings.json'
$script:StatePath = Join-Path $script:Root 'state.json'
$script:ShowFlag = Join-Path $script:Root 'show.flag'
Add-Type -Path (Join-Path $script:Root 'DesktopIdentity.cs')
$script:DesktopName=[WidgetDesktopIdentity]::GetName()
$script:Config = @{ baseUrl='http://127.0.0.1:43189'; period='today'; interval=5; opacity=0.96; topmost=$true; compact=$false; left=$null; top=$null; codexExe=''; updateProxy='' }
if (Test-Path -LiteralPath $script:SettingsPath) {
    try {
        $saved = Get-Content -LiteralPath $script:SettingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($property in $saved.PSObject.Properties) { if ($script:Config.ContainsKey($property.Name)) { $script:Config[$property.Name] = $property.Value } }
    } catch { }
}
$script:Config.opacity = [Math]::Max(0.6, [Math]::Min(1.0, [double]$script:Config.opacity))
if (@('today','week','month','30days') -notcontains $script:Config.period) { $script:Config.period='today' }
if (@(5,15,30) -notcontains [int]$script:Config.interval) { $script:Config.interval=5 }
$script:Labels = @{today='今日'; week='近 7 天'; month='本月'; '30days'='近 30 天'}

[xml]$layout = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
 Title="Codex Usage 悬浮窗" Width="370" Height="430" MinWidth="370" MinHeight="130" WindowStyle="None"
 AllowsTransparency="True" Background="Transparent" ResizeMode="NoResize" ShowInTaskbar="True"
 FontFamily="Segoe UI, Microsoft YaHei UI" Foreground="#F3F6F7" Topmost="True" WindowStartupLocation="Manual">
 <Window.Resources>
  <Style TargetType="Button">
   <Setter Property="Foreground" Value="#AAB5BA"/><Setter Property="Background" Value="Transparent"/>
   <Setter Property="BorderThickness" Value="0"/><Setter Property="Padding" Value="7,4"/>
   <Setter Property="Cursor" Value="Hand"/><Setter Property="FontSize" Value="13"/>
   <Setter Property="Template"><Setter.Value><ControlTemplate TargetType="Button">
    <Border x:Name="ButtonBorder" Background="{TemplateBinding Background}" CornerRadius="5" Padding="{TemplateBinding Padding}">
     <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
    </Border><ControlTemplate.Triggers>
     <Trigger Property="IsMouseOver" Value="True"><Setter TargetName="ButtonBorder" Property="Background" Value="#293438"/><Setter Property="Foreground" Value="#FFFFFF"/></Trigger>
    </ControlTemplate.Triggers>
   </ControlTemplate></Setter.Value></Setter>
  </Style>
  <Style TargetType="TextBlock"><Setter Property="TextOptions.TextFormattingMode" Value="Display"/></Style>
 </Window.Resources>
 <Border Margin="10" CornerRadius="17" Background="#151C20" BorderBrush="#344248" BorderThickness="1">
  <Border.Effect><DropShadowEffect Color="#000000" BlurRadius="14" ShadowDepth="3" Opacity="0.35"/></Border.Effect>
  <Grid Margin="18,13,18,12">
   <Grid.RowDefinitions><RowDefinition Height="32"/><RowDefinition Height="*"/><RowDefinition Height="25"/></Grid.RowDefinitions>
   <Grid x:Name="DragArea" Background="Transparent" Cursor="SizeAll">
    <Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/><ColumnDefinition Width="Auto"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>
    <StackPanel Orientation="Horizontal" VerticalAlignment="Center">
     <Ellipse x:Name="StatusDot" Fill="#5EE5BB" Width="6" Height="6" Margin="0,0,8,0"/>
     <TextBlock Text="CODEX" FontSize="12" FontWeight="Bold" Foreground="#E6F4EE" VerticalAlignment="Center"/>
     <TextBlock Text=" / USAGE" FontSize="10" Foreground="#748990" VerticalAlignment="Center" Margin="4,1,0,0"/>
    </StackPanel>
    <Button x:Name="MenuButton" Grid.Column="1" Content="···" ToolTip="设置 / 时间范围 / 模型价格" AutomationProperties.Name="设置菜单"/>
    <Button x:Name="HideButton" Grid.Column="2" Content="—" ToolTip="收起到系统托盘" AutomationProperties.Name="收起到托盘"/>
    <Button x:Name="CloseButton" Grid.Column="3" Content="×" ToolTip="退出悬浮窗" AutomationProperties.Name="退出"/>
   </Grid>
   <Grid Grid.Row="1">
    <Grid.RowDefinitions><RowDefinition Height="*"/><RowDefinition Height="124"/></Grid.RowDefinitions>
    <StackPanel x:Name="FullView" Margin="0,12,0,0">
     <DockPanel Margin="0,0,0,6">
      <TextBlock x:Name="RangeLabel" Text="今日" FontSize="12" Foreground="#91A5AE" DockPanel.Dock="Left"/>
      <TextBlock Text="本地记录" FontSize="10" Foreground="#667D87" HorizontalAlignment="Right"/>
     </DockPanel>
     <Grid>
      <Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>
      <StackPanel><TextBlock x:Name="TokenValue" Text="—" FontSize="34" FontWeight="SemiBold"/>
       <TextBlock Text="TOKENS" FontSize="10" Foreground="#7D949E" Margin="1,1,0,0"/></StackPanel>
      <StackPanel Grid.Column="1" HorizontalAlignment="Right" VerticalAlignment="Center">
       <TextBlock x:Name="CostValue" Text="—" FontSize="25" FontWeight="SemiBold" Foreground="#68E3BC" HorizontalAlignment="Right"/>
       <TextBlock Text="API 等价 · USD" FontSize="10" Foreground="#7D949E" HorizontalAlignment="Right" Margin="0,4,0,0"/>
      </StackPanel>
     </Grid>
     <Border Height="1" Background="#2B383E" Margin="0,15,0,12"/>
     <Grid>
      <Grid.ColumnDefinitions><ColumnDefinition/><ColumnDefinition/><ColumnDefinition/></Grid.ColumnDefinitions>
      <StackPanel><TextBlock Text="未缓存输入" FontSize="10" Foreground="#7D949E"/><TextBlock x:Name="InputValue" Text="—" FontSize="14" Margin="0,4,0,0"/></StackPanel>
      <StackPanel Grid.Column="1"><TextBlock Text="缓存输入" FontSize="10" Foreground="#7D949E"/><TextBlock x:Name="CacheValue" Text="—" FontSize="14" Margin="0,4,0,0"/></StackPanel>
      <StackPanel Grid.Column="2"><TextBlock Text="输出" FontSize="10" Foreground="#7D949E"/><TextBlock x:Name="OutputValue" Text="—" FontSize="14" Margin="0,4,0,0"/></StackPanel>
     </Grid>
     <TextBlock x:Name="ModelLine" Text="正在连接本地统计服务…" FontSize="10" Foreground="#8FA3AD" TextTrimming="CharacterEllipsis" Margin="0,13,0,0"/>
     <TextBlock x:Name="CoverageLine" Text="费用为估算，非订阅扣款" FontSize="10" Foreground="#C5AD78" TextTrimming="CharacterEllipsis" Margin="0,5,0,0"/>
    </StackPanel>
    <Grid x:Name="CompactView" Visibility="Collapsed" VerticalAlignment="Center">
     <Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>
     <TextBlock x:Name="CompactTokens" Text="— tokens" FontSize="23" FontWeight="SemiBold" VerticalAlignment="Center"/>
     <TextBlock x:Name="CompactCost" Grid.Column="1" Text="—" Foreground="#68E3BC" FontSize="23" FontWeight="SemiBold" VerticalAlignment="Center"/>
    </Grid>
    <StackPanel Grid.Row="1" Margin="0,8,0,0">
     <Border Height="1" Background="#2B383E" Margin="0,0,0,10"/>
     <Grid>
      <Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>
      <TextBlock x:Name="FiveHourValue" Text="5 小时 · 等待数据" FontSize="11" Foreground="#E1E9EB"/>
      <TextBlock x:Name="FiveHourReset" Grid.Column="1" Text="" FontSize="10" Foreground="#7D949E"/>
     </Grid>
     <ProgressBar x:Name="FiveHourBar" Height="4" Minimum="0" Maximum="100" Value="0" Foreground="#68E3BC" Background="#29383E" BorderThickness="0" Margin="0,6,0,10"/>
     <Grid>
      <Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>
      <TextBlock x:Name="SevenDayValue" Text="7 天 · 等待数据" FontSize="11" Foreground="#E1E9EB"/>
      <TextBlock x:Name="SevenDayReset" Grid.Column="1" Text="" FontSize="10" Foreground="#7D949E"/>
     </Grid>
     <ProgressBar x:Name="SevenDayBar" Height="4" Minimum="0" Maximum="100" Value="0" Foreground="#68E3BC" Background="#29383E" BorderThickness="0" Margin="0,6,0,9"/>
     <TextBlock x:Name="QuotaStatus" Text="额度 · 正在读取" FontSize="9" Foreground="#91A5AE" TextTrimming="CharacterEllipsis"/>
    </StackPanel>
   </Grid>
   <DockPanel Grid.Row="2" VerticalAlignment="Bottom">
    <Button x:Name="DetailButton" Content="完整面板 ↗" FontSize="10" Padding="0,2,4,0" DockPanel.Dock="Right" Foreground="#80BAA9" HorizontalAlignment="Right"/>
    <TextBlock x:Name="StatusLine" Text="正在连接 · 5 秒刷新" FontSize="10" Foreground="#728992" VerticalAlignment="Bottom" TextTrimming="CharacterEllipsis"/>
   </DockPanel>
  </Grid>
 </Border>
</Window>
'@
$reader = New-Object System.Xml.XmlNodeReader $layout
$script:Window = [Windows.Markup.XamlReader]::Load($reader)
$script:UI = @{}
foreach ($name in @('DragArea','StatusDot','MenuButton','HideButton','CloseButton','FullView','CompactView','RangeLabel','TokenValue','CostValue','InputValue','CacheValue','OutputValue','ModelLine','CoverageLine','CompactTokens','CompactCost','DetailButton','StatusLine','FiveHourValue','FiveHourReset','FiveHourBar','SevenDayValue','SevenDayReset','SevenDayBar','QuotaStatus')) {
    $script:UI[$name] = $script:Window.FindName($name)
}
if ($Validate) { Write-Output 'WPF XAML valid; controls loaded.'; exit 0 }

if (-not $SelfTest) {
    $createdNew = $false
    # Windows named mutexes span desktops in one session. Keep sandbox tests
    # from suppressing the user's interactive desktop instance.
    $pathHash=[WidgetDesktopIdentity]::MutexSuffix($PSScriptRoot,$script:DesktopName)
    $script:ShowFlag=Join-Path $script:Root ('show.'+$pathHash+'.flag')
    $script:Mutex = New-Object System.Threading.Mutex($true, ('Local\CodexUsageFloatingWidget_'+$pathHash), [ref]$createdNew)
    if (-not $createdNew) {
        [IO.File]::WriteAllText($script:ShowFlag,'show')
        [IO.File]::WriteAllText((Join-Path $script:Root 'backend-update.flag'),'')
        $script:Mutex.Dispose(); exit 0
    }
    [IO.File]::WriteAllText((Join-Path $script:Root 'widget-error.log'),'')
}
$script:Worker = $null
$script:LastState = $null
$script:LastRaw = ''
$script:LastStatusText = ''
$script:Window.Topmost = [bool]$script:Config.topmost
$script:Window.Opacity = [double]$script:Config.opacity
$script:Window.Left = [System.Windows.SystemParameters]::WorkArea.Right - $script:Window.Width - 20
$script:Window.Top = [System.Windows.SystemParameters]::WorkArea.Top + 70
if ($null -ne $script:Config.left -and $null -ne $script:Config.top) {
    $left=[double]$script:Config.left; $top=[double]$script:Config.top
    $virtualLeft=[System.Windows.SystemParameters]::VirtualScreenLeft
    $virtualTop=[System.Windows.SystemParameters]::VirtualScreenTop
    $virtualRight=$virtualLeft+[System.Windows.SystemParameters]::VirtualScreenWidth
    $virtualBottom=$virtualTop+[System.Windows.SystemParameters]::VirtualScreenHeight
    $script:Window.Left = [Math]::Max($virtualLeft,[Math]::Min($left,$virtualRight-370))
    $script:Window.Top = [Math]::Max($virtualTop,[Math]::Min($top,$virtualBottom-130))
}

function Save-Settings {
    $script:Config.left=$script:Window.Left; $script:Config.top=$script:Window.Top
    $text = $script:Config | ConvertTo-Json
    [IO.File]::WriteAllText($script:SettingsPath + '.tmp', $text, (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath ($script:SettingsPath + '.tmp') -Destination $script:SettingsPath -Force
}
function Request-Refresh {
    [IO.File]::WriteAllText((Join-Path $script:Root 'refresh.flag'), '')
}
function Format-Tokens($n) {
    $n=[double]$n
    if ($n -ge 1000000000) { return ($n/1000000000).ToString('0.00')+'B' }
    if ($n -ge 1000000) { return ($n/1000000).ToString('0.00')+'M' }
    if ($n -ge 1000) { return ($n/1000).ToString('0.0')+'K' }
    return $n.ToString('N0')
}
function Open-Dashboard {
    try {
        $url = [Uri][string]$script:Config.baseUrl
        if ($url.Scheme -ne 'http' -or -not $url.IsLoopback -or $url.UserInfo) { throw '仅允许本机 HTTP 服务' }
        Start-Process $url.AbsoluteUri
    } catch { [Windows.MessageBox]::Show($_.Exception.Message,'无法打开面板') | Out-Null }
}
function Show-Widget {
    $script:Window.WindowState='Normal'
    $script:Window.Show()
    # Bring a hidden or misplaced widget back to the primary work area.
    $script:Window.Left=[Windows.SystemParameters]::WorkArea.Right-$script:Window.Width-20
    $script:Window.Top=[Windows.SystemParameters]::WorkArea.Top+70
    $script:Window.Activate() | Out-Null
}
function Apply-View {
    if ($script:Config.compact) {
        $script:UI.FullView.Visibility='Collapsed'; $script:UI.CompactView.Visibility='Visible'; $script:Window.Height=270
    } else {
        $script:UI.FullView.Visibility='Visible'; $script:UI.CompactView.Visibility='Collapsed'; $script:Window.Height=430
    }
    $script:UI.RangeLabel.Text = $script:Labels[$script:Config.period]
}
function Paint-State {
    $s=$script:LastState
    Paint-Quota $s.quota
    if (-not $s) { return }
    $samePeriod = $s.period -eq $script:Config.period
    if ($null -ne $s.total -and $samePeriod) {
        $script:UI.TokenValue.Text=Format-Tokens $s.total
        $money='$'+([double]$s.usd).ToString('0.0000',[Globalization.CultureInfo]::InvariantCulture)
        $script:UI.CostValue.Text=$money
        $script:UI.InputValue.Text=Format-Tokens $s.uncached
        $script:UI.CacheValue.Text=Format-Tokens $s.cached
        $script:UI.OutputValue.Text=Format-Tokens $s.output
        $script:UI.CompactTokens.Text=(Format-Tokens $s.total)+' tokens'
        $script:UI.CompactCost.Text=$money
        $script:UI.TokenValue.ToolTip=([double]$s.total).ToString('N0')+' tokens（沿用统计服务总量）'
        $script:UI.ModelLine.Text=(@($s.models | Select-Object -First 2 | ForEach-Object {$_.name}) -join '  ·  ')
        $script:UI.ModelLine.ToolTip=(@($s.models | ForEach-Object { $_.name+'  '+(Format-Tokens $_.tokens)+' tokens / $'+([double]$_.usd).ToString('0.4') }) -join "`n")
        $coverage='价格覆盖率未知'
        if ($null -ne $s.coverage) { $coverage='已计价 '+([double]$s.coverage*100).ToString('0.0')+'%' }
        $script:UI.CoverageLine.Text=$coverage+' · '+ $(if ($s.warnings.Count) { $s.warnings -join ' / ' } else { '非订阅扣款' })
        $script:UI.CoverageLine.ToolTip='价格表日期：'+$s.pricingDate+"`n费用为标准 API 等价估算；不使用订阅 Fast credits 倍率。`n"+($s.warnings -join "`n")
        $script:UI.CostValue.ToolTip=$script:UI.CoverageLine.ToolTip
        $script:UI.CompactCost.ToolTip=$script:UI.CoverageLine.Text+"`n"+$script:UI.CoverageLine.ToolTip
        if ($null -ne $s.coverage -and [double]$s.coverage -eq 0 -and [double]$s.total -gt 0) {
            $script:UI.CostValue.Text='未计价'; $script:UI.CompactCost.Text='未计价'
        }
    } elseif (-not $samePeriod) {
        $script:UI.TokenValue.Text='…'; $script:UI.CostValue.Text='…'
        $script:UI.CompactTokens.Text='正在切换…'; $script:UI.CompactCost.Text='…'
        foreach ($key in @('InputValue','CacheValue','OutputValue')) { $script:UI[$key].Text='—' }
        $script:UI.ModelLine.Text=''; $script:UI.CoverageLine.Text='正在读取所选时间范围'
    }
    $fresh=$false
    if ($s.updatedAt) {
        $age=([DateTime]::UtcNow - [DateTime]::Parse($s.updatedAt).ToUniversalTime()).TotalSeconds
        $fresh=$age -lt [Math]::Max(20,([int]$script:Config.interval*3))
    }
    if ($s.ok -and $fresh -and $samePeriod) {
        $script:UI.StatusDot.Fill='#5EE5BB'
        $time=[TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::Parse($s.updatedAt).ToUniversalTime(),'China Standard Time').ToString('HH:mm:ss')
        $script:UI.StatusLine.Text=$script:Labels[$s.period]+' · '+$time+' · '+$script:Config.interval+'秒'
        $script:UI.StatusLine.ToolTip='北京时间；统计随本地日志写入更新。' + "`n最近记录：" + $s.lastEvent
    } else {
        $script:UI.StatusDot.Fill='#D8AD69'
        $script:UI.StatusLine.Text='等待数据 · 保留上次记录'
        $script:UI.StatusLine.ToolTip= $(if ($s.error) { $s.error } elseif (-not $samePeriod) { '正在切换时间范围' } else { '采集器未更新，请检查本地服务和 Node.js' })
    }
    if ($s.backend) {
        if ($s.backend.phase -in @('checking','downloading','installing','starting') -or ($s.ok -and $s.backend.phase -ne 'ready')) {
            $script:UI.StatusLine.Text=$s.backend.text
            $script:UI.StatusLine.ToolTip=$s.backend.text+"`n"+$s.backend.error
        } elseif ($s.ok) {
            $script:UI.StatusLine.Text='v'+$s.backend.currentVersion+' · '+$script:Labels[$s.period]+' · '+$script:Config.interval+'秒'
            $script:UI.StatusLine.ToolTip=$s.backend.text+"`n检查时间："+$s.backend.checkedAt+"`n"+$script:UI.StatusLine.ToolTip
        } else {
            $script:UI.StatusLine.ToolTip=$script:UI.StatusLine.ToolTip+"`n"+$s.backend.text+"`n"+$s.backend.error
        }
    }
}

function Paint-Quota($quota) {
    $stamp=$null
    if ($quota.observedAt) { try { $stamp=[DateTime]::Parse($quota.observedAt).ToUniversalTime() } catch {} }
    $age=0
    if ($stamp) { $age=([DateTime]::UtcNow-$stamp).TotalSeconds }
    foreach ($pair in @(@{key='fiveHour';prefix='FiveHour';label='5 小时'},@{key='sevenDay';prefix='SevenDay';label='7 天'})) {
        $value=$quota.($pair.key)
        $text=$script:UI[($pair.prefix+'Value')]
        $reset=$script:UI[($pair.prefix+'Reset')]
        $bar=$script:UI[($pair.prefix+'Bar')]
        $bar.Value=0; $bar.Foreground='#60747D'
        $text.Text=$pair.label+' · 未提供'; $reset.Text=''
        $text.ToolTip='账号未返回该时长的额度；不会将其他额度窗口或 token 数量换算成此项。'
        $reset.ToolTip=$null
        if (-not $value -or $null -eq $value.usedPercent) { continue }
        $percent=[Math]::Max(0,[Math]::Min(100,[double]$value.usedPercent))
        $expired=$false
        if ($value.resetsAt) {
            $resetTime=([DateTime]'1970-01-01T00:00:00Z').ToUniversalTime().AddSeconds([double]$value.resetsAt)
            $remaining=$resetTime-[DateTime]::UtcNow
            $expired=$remaining.TotalSeconds -le 0
            $reset.ToolTip='北京时间 '+[TimeZoneInfo]::ConvertTimeBySystemTimeZoneId($resetTime,'China Standard Time').ToString('MM-dd HH:mm:ss')
            if ($expired) { $reset.Text='等待更新' }
            elseif ($remaining.TotalDays -ge 1) { $reset.Text=([Math]::Floor($remaining.TotalDays)).ToString()+'天'+$remaining.Hours+'小时后重置' }
            elseif ($remaining.TotalHours -ge 1) { $reset.Text=([Math]::Floor($remaining.TotalHours)).ToString()+'小时'+$remaining.Minutes+'分后重置' }
            else { $reset.Text=([Math]::Max(1,[Math]::Ceiling($remaining.TotalMinutes))).ToString()+'分钟后重置' }
        } else { $reset.Text='重置时间未知' }
        if ($expired) {
            $text.Text=$pair.label+' · 快照已过期'
            $text.ToolTip='上次已用 '+$percent.ToString('0.#')+'%；已过重置时间，等待新数据。'
            continue
        }
        $text.Text=$pair.label+' · 已用 '+$percent.ToString('0.#')+'%'
        $text.ToolTip='已用 '+$percent.ToString('0.#')+'%，剩余 '+(100-$percent).ToString('0.#')+'%。'
        $bar.Value=$percent
        $bar.Foreground= $(if ($percent -ge 95) { '#F18484' } elseif ($percent -ge 80) { '#E8BF76' } else { '#68E3BC' })
    }
    if ($stamp) {
        $source= $(if ($quota.source -eq 'local') { '本地快照' } elseif ($quota.error -or $age -gt 180) { '上次查询' } else { '实时查询' })
        $time=[TimeZoneInfo]::ConvertTimeBySystemTimeZoneId($stamp,'China Standard Time').ToString('MM-dd HH:mm')
        $script:UI.QuotaStatus.Text='额度 · '+$source+' '+$time
        if ($age -gt 300) { $script:UI.QuotaStatus.Text+='（旧）' }
        $script:UI.QuotaStatus.ToolTip='额度独立于上方 token 的日期范围。实时查询间隔约 60 秒；本地快照随正常聊天记录更新。'
    } else {
        $script:UI.QuotaStatus.Text='额度 · 暂无可用数据'
        $script:UI.QuotaStatus.ToolTip='请正常登录 Codex。可在 settings.json 设置 codexExe 为 Codex CLI 完整路径。'
    }
    if ($quota.error) { $script:UI.QuotaStatus.ToolTip+="`n"+$quota.error; $script:UI.QuotaStatus.Foreground='#C5AD78' }
    else { $script:UI.QuotaStatus.Foreground='#91A5AE' }
}

function Show-ConnectionSettings {
    $dialog=New-Object Windows.Window
    $dialog.Title='悬浮窗服务地址'; $dialog.Width=430; $dialog.Height=290
    $dialog.ResizeMode='NoResize'; $dialog.WindowStartupLocation='CenterOwner'; $dialog.Owner=$script:Window
    $dialog.Background='#192328'; $dialog.Foreground='#F3F6F7'; $dialog.FontFamily='Microsoft YaHei UI'
    $panel=New-Object Windows.Controls.StackPanel; $panel.Margin='20'; $dialog.Content=$panel
    $label=New-Object Windows.Controls.TextBlock; $label.Text='本地 codex-usage 服务地址'; $label.Margin='0,0,0,10'; [void]$panel.Children.Add($label)
    $field=New-Object Windows.Controls.TextBox; $field.Text=$script:Config.baseUrl; $field.Padding='6'; [void]$panel.Children.Add($field)
    $hint=New-Object Windows.Controls.TextBlock; $hint.Text='只接受本机 HTTP 地址；默认端口 43189'; $hint.Margin='0,10,0,10'; $hint.FontSize=11; [void]$panel.Children.Add($hint)
    $proxyLabel=New-Object Windows.Controls.TextBlock; $proxyLabel.Text='GitHub 更新代理（可留空）'; $proxyLabel.Margin='0,3,0,6'; [void]$panel.Children.Add($proxyLabel)
    $proxyField=New-Object Windows.Controls.TextBox; $proxyField.Text=$script:Config.updateProxy; $proxyField.Padding='6'; $proxyField.Margin='0,0,0,10'; [void]$panel.Children.Add($proxyField)
    $save=New-Object Windows.Controls.Button; $save.Content='保存并连接'; $save.Padding='8'; [void]$panel.Children.Add($save)
    $script:ConnectionField=$field; $script:ConnectionDialog=$dialog
    $script:ProxyField=$proxyField
    $save.Add_Click({
        try {
            $uri=[Uri]$script:ConnectionField.Text.Trim()
            if ($uri.Scheme -ne 'http' -or @('127.0.0.1','localhost','[::1]') -notcontains $uri.Host -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or $uri.AbsolutePath -ne '/') { throw '请输入本机 HTTP 地址，例如 http://127.0.0.1:43189' }
            $script:Config.baseUrl=$uri.GetLeftPart([UriPartial]::Authority)
            $proxyText=$script:ProxyField.Text.Trim()
            if ($proxyText) {
                $proxyUri=[Uri]$proxyText
                if ($proxyUri.Scheme -ne 'http' -or $proxyUri.UserInfo -or $proxyUri.Query -or $proxyUri.Fragment -or $proxyUri.AbsolutePath -ne '/') { throw '更新代理请输入 http://主机:端口，不要填写账号密码。' }
            }
            $script:Config.updateProxy=$proxyText
            Save-Settings; Request-Refresh; $script:ConnectionDialog.Close()
            [IO.File]::WriteAllText((Join-Path $script:Root 'backend-update.flag'),'')
        } catch { [Windows.MessageBox]::Show($_.Exception.Message,'地址无效') | Out-Null }
    })
    [void]$dialog.ShowDialog()
}

function Add-MenuItem($parent,$header,$action,$value,$checked=$false) {
    $item=New-Object Windows.Controls.MenuItem
    $item.Header=$header; $item.Tag=@{action=$action;value=$value}
    if ($checked) { $item.IsCheckable=$true; $item.IsChecked=$true }
    if ($action) {
        $item.Add_Click({ param($sender,$eventArgs)
            $tag=$sender.Tag
            switch ($tag.action) {
                'period' { $script:Config.period=$tag.value; Apply-View; Save-Settings; Paint-State; Request-Refresh }
                'interval' { $script:Config.interval=[int]$tag.value; Save-Settings; Request-Refresh }
                'opacity' { $script:Config.opacity=[double]$tag.value; $script:Window.Opacity=$script:Config.opacity; Save-Settings }
                'topmost' { $script:Config.topmost=-not $script:Config.topmost; $script:Window.Topmost=$script:Config.topmost; Save-Settings }
                'compact' { $script:Config.compact=-not $script:Config.compact; Apply-View; Save-Settings }
                'refresh' { Request-Refresh }
                'web' { Open-Dashboard }
                'pricing' { Open-Dashboard; [void][Windows.MessageBox]::Show('在完整面板中点击「模型定价」即可编辑。悬浮窗会自动使用更新后的价格。','模型定价', 'OK', 'Information') }
                'connection' { Show-ConnectionSettings }
                'backendUpdate' { [IO.File]::WriteAllText((Join-Path $script:Root 'backend-update.flag'),'') }
                'quit' { $script:Window.Close() }
            }
            $eventArgs.Handled=$true
        })
    }
    [void]$parent.Items.Add($item)
    return $item
}
function Show-Menu {
    $menu=New-Object Windows.Controls.ContextMenu
    $periodMenu=Add-MenuItem $menu '时间范围' '' ''
    foreach ($p in @('today','week','month','30days')) { [void](Add-MenuItem $periodMenu $script:Labels[$p] 'period' $p ($script:Config.period -eq $p)) }
    [void](Add-MenuItem $menu '精简模式' 'compact' '' ([bool]$script:Config.compact))
    [void](Add-MenuItem $menu '始终置顶' 'topmost' '' ([bool]$script:Config.topmost))
    $opacityMenu=Add-MenuItem $menu '不透明度' '' ''
    foreach ($op in @(1.0,0.96,0.85,0.70)) { [void](Add-MenuItem $opacityMenu (($op*100).ToString('0')+'%') 'opacity' $op ($script:Config.opacity -eq $op)) }
    $intervalMenu=Add-MenuItem $menu '自动刷新' '' ''
    foreach ($seconds in @(5,15,30)) { [void](Add-MenuItem $intervalMenu ($seconds.ToString()+' 秒') 'interval' $seconds ($script:Config.interval -eq $seconds)) }
    [void]$menu.Items.Add((New-Object Windows.Controls.Separator))
    [void](Add-MenuItem $menu '立即刷新' 'refresh' '')
    [void](Add-MenuItem $menu '完整网页面板' 'web' '')
    [void](Add-MenuItem $menu '模型定价（网页）' 'pricing' '')
    [void](Add-MenuItem $menu '本地服务地址…' 'connection' '')
    [void](Add-MenuItem $menu '检查采集服务更新' 'backendUpdate' '')
    [void](Add-MenuItem $menu '退出' 'quit' '')
    $menu.PlacementTarget=$script:UI.MenuButton; $menu.IsOpen=$true
}

if ($SelfTest) {
    if ($TestStatePath) { $script:StatePath=$TestStatePath }
    if (-not (Test-Path -LiteralPath $script:StatePath)) { throw 'Run node collector.js --once before SelfTest.' }
    $script:LastState=Get-Content -LiteralPath $script:StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $script:Config.period=$script:LastState.period
    $script:Config.compact=$false
    Apply-View; Paint-State
    if ($script:UI.TokenValue.Text -eq '—') { throw 'Live token values were not rendered.' }
    function Export-Preview($file) {
        $size=New-Object Windows.Size($script:Window.Width,$script:Window.Height)
        $surface=$script:Window.Content
        $surface.Measure($size)
        $surface.Arrange((New-Object Windows.Rect(0,0,$size.Width,$size.Height)))
        $surface.UpdateLayout()
        $bitmap=New-Object Windows.Media.Imaging.RenderTargetBitmap([int]$size.Width,[int]$size.Height,96,96,[Windows.Media.PixelFormats]::Pbgra32)
        $bitmap.Render($surface)
        $encoder=New-Object Windows.Media.Imaging.PngBitmapEncoder
        $encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
        $stream=[IO.File]::Create((Join-Path $script:Root $file))
        try { $encoder.Save($stream) } finally { $stream.Dispose() }
    }
    Export-Preview 'preview.png'
    $originalTokens=$script:UI.TokenValue.Text
    $script:LastState.ok=$false
    $script:LastState | Add-Member -NotePropertyName error -NotePropertyValue 'Test: service unavailable' -Force
    Paint-State
    if ($script:UI.TokenValue.Text -ne $originalTokens -or $script:UI.StatusLine.Text -notmatch '保留') { throw 'Offline state lost the previous successful data.' }
    $script:LastState.ok=$true
    $script:Config.compact=$true; Apply-View; Paint-State
    if ($script:UI.CompactView.Visibility -ne 'Visible' -or $script:Window.Height -ne 270) { throw 'Compact view failed.' }
    Export-Preview 'preview-compact.png'
    $script:Config.period='week'; Paint-State
    if ($script:UI.CompactTokens.Text -ne '正在切换…') { throw 'Old range values leaked into the new period.' }
    $resetFuture=([DateTime]::UtcNow.AddHours(2)-([DateTime]'1970-01-01T00:00:00Z').ToUniversalTime()).TotalSeconds
    $testQuota=[pscustomobject]@{source='local';observedAt=[DateTime]::UtcNow.ToString('o');fiveHour=[pscustomobject]@{usedPercent=7;resetsAt=$resetFuture};sevenDay=[pscustomobject]@{usedPercent=6;resetsAt=$resetFuture+86400}}
    Paint-Quota $testQuota
    if ($script:UI.FiveHourValue.Text -notmatch '7%' -or $script:UI.SevenDayValue.Text -notmatch '6%' -or $script:UI.FiveHourBar.Value -ne 7) { throw 'Quota windows were not rendered correctly.' }
    $testQuota.fiveHour=$null; Paint-Quota $testQuota
    if ($script:UI.FiveHourValue.Text -notmatch '未提供') { throw 'Missing quota appeared as zero usage.' }
    $testQuota.sevenDay.resetsAt=1; Paint-Quota $testQuota
    if ($script:UI.SevenDayValue.Text -notmatch '过期') { throw 'Expired quota snapshot was displayed as current.' }
    Write-Output ('WPF live data, offline, compact, date range, quota percentage, missing and expired window checks passed. Tokens: '+$originalTokens)
    exit 0
}

$script:UI.MenuButton.Add_Click({ Show-Menu })
$script:Window.Add_MouseRightButtonUp({ Show-Menu })
$script:UI.DetailButton.Add_Click({ Open-Dashboard })
$script:UI.CloseButton.Add_Click({ $script:Window.Close() })
$script:UI.HideButton.Add_Click({ $script:Window.Hide() })
$script:UI.DragArea.Add_MouseLeftButtonDown({ param($sender,$eventArgs)
    $source=$eventArgs.OriginalSource
    while ($null -ne $source) {
        if ($source -is [Windows.Controls.Button]) { return }
        $source=[Windows.Media.VisualTreeHelper]::GetParent($source)
    }
    if ($eventArgs.ClickCount -eq 2) { $script:Config.compact=-not $script:Config.compact; Apply-View; Save-Settings }
    else { try { $script:Window.DragMove(); Save-Settings } catch { } }
})
$script:Tray=New-Object System.Windows.Forms.NotifyIcon
$script:Tray.Icon=[Drawing.SystemIcons]::Information
$script:Tray.Text='Codex Usage 悬浮窗'; $script:Tray.Visible=$true
$script:Tray.Add_DoubleClick({ Show-Widget })
$trayMenu=New-Object System.Windows.Forms.ContextMenuStrip
$showItem=$trayMenu.Items.Add('显示悬浮窗'); $showItem.Add_Click({ Show-Widget })
$webItem=$trayMenu.Items.Add('完整面板'); $webItem.Add_Click({ Open-Dashboard })
$quitItem=$trayMenu.Items.Add('退出'); $quitItem.Add_Click({ $script:Window.Close() })
$script:Tray.ContextMenuStrip=$trayMenu

Apply-View
Save-Settings
try {
    $node=(Get-Command node.exe -ErrorAction Stop).Source
    # .NET avoids the Windows PowerShell Start-Process PATH/Path duplicate-key bug.
    $workerInfo=New-Object Diagnostics.ProcessStartInfo
    $workerInfo.FileName=$node
    $workerInfo.Arguments='"'+(Join-Path $script:Root 'collector.js')+'" --parent-pid '+$PID
    $workerInfo.WorkingDirectory=$script:Root
    $workerInfo.UseShellExecute=$false
    $workerInfo.CreateNoWindow=$true
    $script:Worker=[Diagnostics.Process]::Start($workerInfo)
} catch {
    [IO.File]::WriteAllText((Join-Path $script:Root 'widget-error.log'), ($_ | Out-String), (New-Object Text.UTF8Encoding($false)))
    [void][Windows.MessageBox]::Show('启动采集器失败，请安装 Node.js 18 或以上版本。'+"`n"+$_.Exception.Message,'Codex Usage')
    $script:Tray.Dispose(); $script:Mutex.ReleaseMutex(); $script:Mutex.Dispose(); exit 1
}
$script:Timer=New-Object Windows.Threading.DispatcherTimer
$script:Timer.Interval=[TimeSpan]::FromMilliseconds(500)
$script:Timer.Add_Tick({
    try {
        if (Test-Path -LiteralPath $script:ShowFlag) {
            [IO.File]::Delete($script:ShowFlag)
            Show-Widget
        }
        if (Test-Path -LiteralPath $script:StatePath) {
            $raw=[IO.File]::ReadAllText($script:StatePath)
            if ($raw -ne $script:LastRaw) { $script:LastState=$raw | ConvertFrom-Json; $script:LastRaw=$raw }
        }
        Paint-State
        if ($script:Worker.HasExited) {
            $script:UI.StatusDot.Fill='#D8AD69'; $script:UI.StatusLine.Text='采集器停止 · 请重启悬浮窗'
            $script:UI.StatusLine.ToolTip='检查 collector-error.log；需要 Node.js 18 或以上版本。'
        }
        $diagnostic=@{pid=$PID;desktop=$script:DesktopName;visible=$script:Window.IsVisible;loaded=$script:Window.IsLoaded;left=$script:Window.Left;top=$script:Window.Top;width=$script:Window.ActualWidth;height=$script:Window.ActualHeight;updatedAt=[DateTime]::UtcNow.ToString('o');workerPid=$script:Worker.Id;workerExited=$script:Worker.HasExited}
        [IO.File]::WriteAllText((Join-Path $script:Root 'ui-status.json'),($diagnostic | ConvertTo-Json))
    } catch { $script:UI.StatusLine.ToolTip=$_.Exception.Message }
})
$script:Window.Add_Closed({
    $script:Timer.Stop()
    try { Save-Settings } catch { }
    if ($script:Worker -and -not $script:Worker.HasExited) { Stop-Process -Id $script:Worker.Id -ErrorAction SilentlyContinue }
    $script:Tray.Visible=$false; $script:Tray.Dispose()
    $script:Mutex.ReleaseMutex(); $script:Mutex.Dispose()
})
$script:Timer.Start()
$script:Application=New-Object Windows.Application
$script:Application.ShutdownMode='OnExplicitShutdown'
$script:Window.Add_Closed({ $script:Application.Shutdown() })
[void]$script:Application.Run($script:Window)
