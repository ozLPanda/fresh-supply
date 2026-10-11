# Static updater helper. All variable values come from a private JSON config;
# none is evaluated as PowerShell code or through a command shell.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$utf8 = New-Object System.Text.UTF8Encoding($false)
$configuration = $null
$parentExited = $false

function Write-UpdateSignal([string] $Destination) {
    $temporary = $Destination + '.tmp'
    [System.IO.File]::WriteAllText($temporary, '1', $utf8)
    [System.IO.File]::Move($temporary, $Destination)
}

function Write-UpdateLog([string] $Message) {
    if ($null -ne $configuration) {
        [System.IO.File]::AppendAllText($configuration.logPath, ([DateTime]::UtcNow.ToString('o') + ' ' + $Message + [Environment]::NewLine), $utf8)
    }
}

try {
    $configuration = [System.IO.File]::ReadAllText($env:FRESH_SUPPLY_UPDATE_CONFIG) | ConvertFrom-Json
    Write-UpdateLog ('Helper started; helper PID ' + $PID + ', application PID ' + $configuration.parentPid)
    if ($configuration.schema -ne 1 -or $configuration.parentPid -le 0 -or $configuration.parentPid -eq $PID) {
        throw 'Invalid updater configuration.'
    }
    if ($configuration.sha256 -notmatch '^[a-f0-9]{64}$' -or $configuration.version -notmatch '^\d+\.\d+\.\d+$') {
        throw 'Invalid update checksum or version.'
    }
    if ($configuration.installDirectory -match '["\r\n\x00]' -or -not [System.IO.Path]::IsPathRooted($configuration.installDirectory)) {
        throw 'Invalid installation directory.'
    }
    if (-not [System.IO.File]::Exists($configuration.installer) -or -not [System.IO.File]::Exists($configuration.installedExecutable)) {
        throw 'The installer or the installed application is missing.'
    }
    $parent = [System.Diagnostics.Process]::GetProcessById([int] $configuration.parentPid)
    # Opening the process handle now also prevents confusing a subsequently reused PID.
    $null = $parent.Handle
    Write-UpdateLog ('Application handle opened; exited=' + $parent.HasExited)
    Write-UpdateSignal $configuration.readyPath
    Write-UpdateLog 'Helper ready; waiting for application confirmation.'
    $deadline = [DateTime]::UtcNow.AddSeconds(120)
    while (-not [System.IO.File]::Exists($configuration.commitPath)) {
        if ([System.IO.File]::Exists($configuration.cancelPath)) {
            Write-UpdateLog 'Cancelled before application confirmation.'
            exit 0
        }
        if ($parent.HasExited) {
            Write-UpdateLog 'Application exited before confirmation; no installation attempted.'
            exit 0
        }
        if ([DateTime]::UtcNow -gt $deadline) { throw 'The application did not confirm installation.' }
        Start-Sleep -Milliseconds 100
    }
    if ([System.IO.File]::Exists($configuration.cancelPath)) {
        Write-UpdateLog 'Cancelled after confirmation, before accepting handoff.'
        exit 0
    }
    Write-UpdateSignal $configuration.acceptedPath
    Write-UpdateLog 'Installation handoff accepted; waiting for application exit.'
    $deadline = [DateTime]::UtcNow.AddMilliseconds([int] $configuration.parentExitTimeoutMs)
    while (-not $parent.HasExited) {
        if ([System.IO.File]::Exists($configuration.cancelPath)) {
            Write-UpdateLog 'Cancelled while waiting for application exit.'
            exit 0
        }
        if ([DateTime]::UtcNow -gt $deadline) { throw 'The application did not exit; no installation was attempted.' }
        Start-Sleep -Milliseconds 100
    }
    $parentExited = $true
    Write-UpdateLog 'Application exited; verifying update before installation.'
    if ([System.IO.File]::Exists($configuration.cancelPath)) {
        Write-UpdateLog 'Cancelled after application exit.'
        exit 0
    }
    # Avoid module auto-loading: PSModulePath may have been inherited from PS7.
    $hashAlgorithm = [System.Security.Cryptography.SHA256]::Create()
    $hashStream = [System.IO.File]::OpenRead($configuration.installer)
    try {
        $actualHash = [System.BitConverter]::ToString($hashAlgorithm.ComputeHash($hashStream)).Replace('-', '').ToLowerInvariant()
    } finally {
        $hashStream.Dispose()
        $hashAlgorithm.Dispose()
    }
    if ($actualHash -ne $configuration.sha256) { throw 'The update checksum changed; no installation was attempted.' }
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = $configuration.installer
    # NSIS /D= consumes the rest of the command line and MUST be the final,
    # unquoted option, including when the directory contains spaces.
    $start.Arguments = '/S --updated --force-run /D=' + $configuration.installDirectory
    $start.WorkingDirectory = $configuration.installDirectory
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    Write-UpdateLog ('Installing fresh-supply ' + $configuration.version)
    $installer = [System.Diagnostics.Process]::Start($start)
    $installer.WaitForExit()
    if ($installer.ExitCode -ne 0) { throw ('The installer returned exit code ' + $installer.ExitCode) }
    Write-UpdateLog 'Installation completed.'
    # Never recursively remove paths from the release metadata. Only remove the
    # verified installer and its now empty, direct download-* cache directory.
    try {
        $download = [System.IO.DirectoryInfo]::new($configuration.downloadDirectory)
        if ($download.Name -match '^download-[\w-]+$' -and $download.Parent.FullName -eq $configuration.cacheDirectory -and [System.IO.Path]::GetDirectoryName($configuration.installer) -eq $download.FullName) {
            [System.IO.File]::Delete($configuration.installer)
            if ([System.IO.Directory]::GetFileSystemEntries($download.FullName).Length -eq 0) {
                [System.IO.Directory]::Delete($download.FullName)
            }
        }
    } catch {
        Write-UpdateLog ('Cache cleanup deferred: ' + $_.Exception.Message)
    }
    exit 0
} catch {
    $message = $_.Exception.Message
    if ($null -ne $configuration) {
        try {
            Write-UpdateLog ('Update failed: ' + $message)
            $failureTemporary = $configuration.failurePath + '.tmp'
            [System.IO.File]::WriteAllText($failureTemporary, (@{ message = $message } | ConvertTo-Json -Compress), $utf8)
            [System.IO.File]::Move($failureTemporary, $configuration.failurePath)
        } catch { }
        # Recovery never closes or kills the parent. If it already exited, let
        # the current application reopen so its normal startup recovery can run.
        if ($parentExited -and [System.IO.File]::Exists($configuration.installedExecutable)) {
            try {
                $reopen = New-Object System.Diagnostics.ProcessStartInfo
                $reopen.FileName = $configuration.installedExecutable
                $reopen.UseShellExecute = $false
                $null = [System.Diagnostics.Process]::Start($reopen)
            } catch { }
        }
    }
    exit 1
}
