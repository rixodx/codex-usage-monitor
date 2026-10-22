$ErrorActionPreference='Stop'
$tokens=$null; $parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Widget.ps1'),[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
foreach ($name in @('Resolve-CollectionHome','Start-CollectionCommand')) {
    $function=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true)
    Invoke-Expression $function.Extent.Text
}
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('codex-home-test-'+[Guid]::NewGuid().ToString('N'))
$testHome=Join-Path $testRoot 'space home 中文'
$sessions=Join-Path $testHome 'sessions'
[void][IO.Directory]::CreateDirectory($sessions)
try {
    if ((Resolve-CollectionHome (' '+$testHome+' ')) -ne $testHome) { throw 'Home paths with spaces and Unicode must be preserved.' }
    foreach ($invalid in @('', $sessions, (Join-Path $testHome 'missing'), $testRoot)) {
        $rejected=$false
        try { [void](Resolve-CollectionHome $invalid) } catch { $rejected=$true }
        if (-not $rejected) { throw "Invalid home accepted: $invalid" }
    }
    [IO.Directory]::Delete($sessions)
    $archived=Join-Path $testHome 'archived_sessions'; [void][IO.Directory]::CreateDirectory($archived)
    if ((Resolve-CollectionHome $testHome) -ne $testHome) { throw 'Archive-only home must be accepted.' }
    # Exercise the real asynchronous CLI wrapper without changing user settings.
    $script:Root=$PSScriptRoot
    $script:CollectionServiceExe=Join-Path $PSScriptRoot '.runtime\v2.7.2\codex-usage-windows-amd64.exe'
    if (Test-Path -LiteralPath $script:CollectionServiceExe) {
        $script:CollectionServiceHome=$testRoot
        Start-CollectionCommand 'version'
        if (-not $script:CollectionProcess.WaitForExit(15000)) { $script:CollectionProcess.Kill(); throw 'CLI timed out.' }
        $output=$script:CollectionOutput.Result
        if ($script:CollectionProcess.ExitCode -ne 0 -or $output -notmatch '2\.7\.2') { throw 'Background CLI did not return a successful version.' }
        $script:CollectionProcess.Dispose()
    }
    Write-Output 'Collection settings checks passed: validation, spaces/Unicode, archived sessions and background CLI.'
} finally {
    foreach ($path in @((Join-Path $testHome 'sessions'),(Join-Path $testHome 'archived_sessions'),$testHome,$testRoot)) {
        if (Test-Path -LiteralPath $path) { [IO.Directory]::Delete($path) }
    }
}
