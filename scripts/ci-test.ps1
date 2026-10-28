$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') {
    throw 'This script provisions a test account only in a disposable Windows GitHub Actions runner.'
}

$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'The CI account launcher requires the hosted runner administrator token.'
}

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
$accountName = 'ka-ci-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$password = ConvertTo-SecureString ('Aa1!' + [Guid]::NewGuid().ToString('N')) -AsPlainText -Force
$account = New-LocalUser -Name $accountName -Password $password -AccountNeverExpires -PasswordNeverExpires
$testTemp = Join-Path $env:RUNNER_TEMP $accountName
$stdout = Join-Path $env:RUNNER_TEMP ($accountName + '-stdout.log')
$stderr = Join-Path $env:RUNNER_TEMP ($accountName + '-stderr.log')
$exitCode = 1

try {
    Add-LocalGroupMember -SID 'S-1-5-32-545' -Member $account
    New-Item -ItemType Directory -Path $testTemp -Force | Out-Null
    # The test user needs source/runtime read access and a private writable temp
    # directory. It never joins the Administrators group.
    & icacls.exe $projectRoot /grant ('*{0}:(OI)(CI)RX' -f $account.SID.Value) /T /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not grant source access to the standard test account.' }
    & icacls.exe $testTemp /grant ('*{0}:(OI)(CI)F' -f $account.SID.Value) /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not grant access to the CI temporary directory.' }

    $credential = [PSCredential]::new(($env:COMPUTERNAME + '\' + $accountName), $password)
    $shell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $entry = Join-Path $PSScriptRoot 'ci-entry.ps1'
    $arguments = '-NoProfile -NonInteractive -File "{0}" -NodeExecutable "{1}" -ProjectRoot "{2}" -TempRoot "{3}"' -f $entry, $nodeExecutable, $projectRoot, $testTemp
    $child = Start-Process -FilePath $shell -ArgumentList $arguments -Credential $credential -LoadUserProfile -WindowStyle Hidden -WorkingDirectory $projectRoot -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    $null = $child.Handle
    $child.WaitForExit()
    $exitCode = $child.ExitCode
} finally {
    if (Test-Path -LiteralPath $stdout) { Get-Content -LiteralPath $stdout -Encoding UTF8 }
    if (Test-Path -LiteralPath $stderr) { Get-Content -LiteralPath $stderr -Encoding UTF8 | ForEach-Object { [Console]::Error.WriteLine($_) } }
    Remove-LocalUser -SID $account.SID
}

exit $exitCode
