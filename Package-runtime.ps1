param([string]$OutputName = 'codex-usage-monitor-windows-x64-portable.zip')
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = $PSScriptRoot
$version = '24.22.1'
$archiveName = "node-v$version-win-x64.zip"
$baseUrl = "https://nodejs.org/dist/v$version"
$cache = Join-Path $root '.runtime\packaging'
[void][IO.Directory]::CreateDirectory($cache)
$archive = Join-Path $cache $archiveName
$sums = (Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/SHASUMS256.txt").Content
if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }
$match = [regex]::Match([string]$sums, '(?m)^([a-f0-9]{64})\s+' + [regex]::Escape($archiveName) + '\s*$')
if (-not $match.Success) { throw 'Official Node.js checksum is missing.' }
$expected = $match.Groups[1].Value
if (-not (Test-Path -LiteralPath $archive) -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expected) {
    Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/$archiveName" -OutFile $archive
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expected) { throw 'Node.js SHA-256 verification failed.' }
$stage = Join-Path $cache ([Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory((Join-Path $stage 'runtime'))
$files = @('codex-usage-monitor.exe','Widget.ps1','collector.js','quota.js','backend.js','service-control.ps1','THIRD_PARTY_NOTICES.md')
foreach ($name in $files) { Copy-Item -LiteralPath (Join-Path $root $name) -Destination (Join-Path $stage $name) }
Copy-Item -LiteralPath (Join-Path $root 'README.runtime.md') -Destination (Join-Path $stage 'README.md')
$zip = [IO.Compression.ZipFile]::OpenRead($archive)
try {
    foreach ($name in @('node.exe','LICENSE')) {
        $entry = $zip.GetEntry("node-v$version-win-x64/$name")
        if ($null -eq $entry) { throw "Node.js archive is missing $name" }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $stage "runtime\$name"))
    }
} finally { $zip.Dispose() }
$node = Join-Path $stage 'runtime\node.exe'
$actualVersion = & $node --version
if ($LASTEXITCODE -ne 0 -or $actualVersion -ne "v$version") { throw 'Bundled Node.js version check failed.' }
foreach ($name in @('collector.js','quota.js','backend.js')) {
    & $node --check (Join-Path $stage $name)
    if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax check failed: $name" }
}
$output = Join-Path $root $OutputName
if (Test-Path -LiteralPath $output) { throw "Output already exists: $output" }
[IO.Compression.ZipFile]::CreateFromDirectory($stage, $output, [IO.Compression.CompressionLevel]::Optimal, $false)
Write-Output "Package: $output"
Write-Output "Node.js: $actualVersion; SHA-256 verified; staging directory: $stage"
Get-Item -LiteralPath $output | Select-Object Name,Length
