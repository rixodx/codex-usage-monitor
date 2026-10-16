param([ValidateSet('Probe','Stop','StopOwned')][string]$Mode='Probe', [int]$Port=43189, [int]$ExpectedPid=0, [string]$ExpectedPath='')
$ErrorActionPreference='Stop'
if ($Port -lt 1 -or $Port -gt 65535) { throw 'Invalid port.' }
if ($Mode -eq 'StopOwned') {
    if ($ExpectedPid -lt 1 -or -not $ExpectedPath) { throw 'Missing owned process identity.' }
    $owned=Get-Process -Id $ExpectedPid -ErrorAction SilentlyContinue
    if (-not $owned) { @{missing=$true} | ConvertTo-Json -Compress; exit 0 }
    $ownerIds=@($ExpectedPid)
} else {
 $ownerIds=@()
 try {
    $ownerIds=@(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique)
 } catch {
    $ownerIds=@(netstat.exe -ano -p TCP | ForEach-Object {
        $parts=$_.Trim() -split '\s+'
        if ($parts.Length -eq 5 -and $parts[3] -eq 'LISTENING' -and $parts[1] -match (':'+$Port+'$')) { [int]$parts[4] }
    } | Select-Object -Unique)
 }
}
if ($ownerIds.Count -ne 1) { throw 'Cannot uniquely identify the local service process.' }
$backend=Get-Process -Id $ownerIds[0] -ErrorAction Stop
$file=$backend.Path
if (-not $file -or [IO.Path]::GetFileName($file) -notmatch '^codex-usage(?:-windows-(?:amd64|arm64))?\.exe$') { throw 'The listening process is not a recognized codex-usage executable.' }
if ($backend.SessionId -ne [Diagnostics.Process]::GetCurrentProcess().SessionId) { throw 'The service belongs to a different Windows session.' }
$result=@{pid=$backend.Id;path=$file}
if ($Mode -in @('Stop','StopOwned')) {
    if ($ExpectedPid -ne $backend.Id -or -not [string]::Equals($ExpectedPath,$file,[StringComparison]::OrdinalIgnoreCase)) { throw 'Service identity changed; update cancelled.' }
    Stop-Process -Id $backend.Id -ErrorAction Stop
    if (-not $backend.WaitForExit(10000)) { throw 'Service did not exit.' }
}
$result | ConvertTo-Json -Compress
