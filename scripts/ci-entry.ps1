param(
    [Parameter(Mandatory = $true)][string]$NodeExecutable,
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [Parameter(Mandatory = $true)][string]$TempRoot
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'The integration suite must run as a standard user.'
}

$env:USERPROFILE = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
$env:LOCALAPPDATA = Join-Path $env:USERPROFILE 'AppData\Local'
$env:APPDATA = Join-Path $env:USERPROFILE 'AppData\Roaming'
$env:TEMP = $TempRoot
$env:TMP = $TempRoot
$env:npm_config_cache = Join-Path $TempRoot 'npm-cache'
$env:KEEPAWAKE_TRAY_TEST = ''
Set-Location -LiteralPath $ProjectRoot
Write-Output 'Running integration tests under a standard user token.'
& $NodeExecutable --test --test-concurrency=1 'test/*.test.js'
exit $LASTEXITCODE
