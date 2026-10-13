# Static updater helper. All variable values come from a private JSON config;
# none is evaluated as PowerShell code or through a command shell.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$utf8 = New-Object System.Text.UTF8Encoding($false)
$configuration = $null
$parentExited = $false
$failureKind = 'installation-failed'

function Get-UpdateHash([string] $File) {
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($File)
    try { return [System.BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}

function Write-UpdateResult([string] $Status, [string] $Message) {
    $result = @{ schema = 1; status = $Status; version = $configuration.version; message = $Message; logPath = $configuration.logPath; timestamp = [DateTime]::UtcNow.ToString('o') }
    $temporary = $configuration.resultPath + '.tmp'
    [System.IO.File]::WriteAllText($temporary, ($result | ConvertTo-Json -Compress), $utf8)
    if ([System.IO.File]::Exists($configuration.resultPath)) { [System.IO.File]::Replace($temporary, $configuration.resultPath, $null) }
    else { [System.IO.File]::Move($temporary, $configuration.resultPath) }
}

function Get-InstallationScope {
    # Exact appId-derived NSIS GUID; never infer ownership from folder writability.
    $keyName = 'Software\977d56cb-bf9d-5e99-8e00-f5d825fc9966'
    foreach ($scope in @('CurrentUser', 'LocalMachine')) {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::$scope, [Microsoft.Win32.RegistryView]::Registry64)
        try {
            $key = $base.OpenSubKey($keyName)
            if ($null -ne $key) {
                try {
                    $location = $key.GetValue('InstallLocation', '')
                    if ($location -and [System.IO.Path]::GetFullPath($location).TrimEnd('\') -eq $configuration.installDirectory.TrimEnd('\')) {
                        if ($scope -eq 'LocalMachine') { return '/allusers' }
                        return '/currentuser'
                    }
                } finally { $key.Dispose() }
            }
        } finally { $base.Dispose() }
    }
    if ($configuration.requiresElevation) { throw 'Не удалось определить владельца установки. Переустановите приложение в прежний каталог, сохранив выбранный режим установки.' }
    return '/currentuser'
}

function Assert-InstalledPackage {
    $root = $configuration.installDirectory.TrimEnd('\') + '\'
    $manifestFile = [System.IO.Path]::Combine($configuration.installDirectory, 'resources', 'package-integrity.json')
    $manifest = [System.IO.File]::ReadAllText($manifestFile) | ConvertFrom-Json
    if ($manifest.schemaVersion -ne 1 -or $manifest.platform -ne 'win32' -or $manifest.arch -ne 'x64' -or $manifest.version -ne $configuration.version) {
        throw 'Установленная версия или состав приложения не совпадают с обновлением.'
    }
    $checked = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $manifest.files) {
        if ($entry.path -notmatch '^[^:\\]+$' -or $entry.path -match '(^|/)\.\.?(/|$)' -or $entry.sha256 -notmatch '^[a-f0-9]{64}$' -or $entry.size -lt 0) { throw 'Повреждён список файлов установленного приложения.' }
        $file = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($configuration.installDirectory, $entry.path.Replace('/', '\')))
        if (-not $file.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or -not $checked.Add($entry.path)) { throw 'Недействительный путь установленного приложения.' }
        $info = New-Object System.IO.FileInfo($file)
        if (-not $info.Exists -or $info.Length -ne $entry.size -or ($info.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 -or (Get-UpdateHash $file) -ne $entry.sha256) { throw ('Файл приложения отсутствует или повреждён: ' + $entry.path) }
    }
    foreach ($critical in @('fresh-supply.exe', 'resources/app.asar', 'resources/runtime/manifest.json', 'resources/runtime/python/python.exe', 'resources/runtime/java/bin/java.exe', 'resources/runtime/postgres/bin/postgres.exe', 'resources/runtime/backend.jar', 'resources/runtime/frontend/index.html')) {
        if (-not $checked.Contains($critical)) { throw ('Обновление не содержит обязательный файл: ' + $critical) }
    }
}

function Start-InstalledApplication([bool] $Failed) {
    $reopen = New-Object System.Diagnostics.ProcessStartInfo
    $reopen.FileName = [System.IO.Path]::Combine($configuration.installDirectory, 'fresh-supply.exe')
    if ($Failed -and [System.IO.File]::Exists($configuration.installedExecutable)) { $reopen.FileName = $configuration.installedExecutable }
    $reopen.Arguments = '--updated'
    if ($Failed) { $reopen.Arguments = '--update-failed' }
    $reopen.WorkingDirectory = $configuration.installDirectory
    $reopen.UseShellExecute = $false
    # This helper retained the caller's token; never launch from elevated NSIS.
    $null = [System.Diagnostics.Process]::Start($reopen)
}

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
    $installationScope = Get-InstallationScope
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
    $actualHash = Get-UpdateHash $configuration.installer
    if ($actualHash -ne $configuration.sha256) { throw 'The update checksum changed; no installation was attempted.' }
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = $configuration.installer
    # NSIS /D= consumes the rest of the command line and MUST be the final,
    # unquoted option, including when the directory contains spaces.
    $start.Arguments = '/S --updated ' + $installationScope
    if ($installationScope -eq '/currentuser') {
        $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
        try { $start.Arguments += ' /fresh-supply-user-sid=' + $identity.User.Value } finally { $identity.Dispose() }
    }
    $start.Arguments += ' /D=' + $configuration.installDirectory
    $start.WorkingDirectory = $configuration.installDirectory
    $start.UseShellExecute = [bool] $configuration.requiresElevation
    if ($configuration.requiresElevation) { $start.Verb = 'runas' }
    else { $start.CreateNoWindow = $true }
    Write-UpdateLog ('Installing fresh-supply ' + $configuration.version)
    try { $installer = [System.Diagnostics.Process]::Start($start) }
    catch {
        $nativeError = $_.Exception
        while ($null -ne $nativeError -and -not ($nativeError -is [System.ComponentModel.Win32Exception])) { $nativeError = $nativeError.InnerException }
        if ($null -ne $nativeError -and $nativeError.NativeErrorCode -eq 1223) {
            $failureKind = 'uac-cancelled'
            throw 'Подтверждение Windows отменено. Обновление не установлено; прежняя версия продолжит работу.'
        }
        throw
    }
    $installer.WaitForExit()
    if ($installer.ExitCode -ne 0) { throw ('The installer returned exit code ' + $installer.ExitCode) }
    Assert-InstalledPackage
    Write-UpdateLog 'Installation completed.'
    Write-UpdateResult 'success' 'Обновление установлено.'
    Start-InstalledApplication $false
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
            [System.IO.File]::WriteAllText($failureTemporary, (@{ message = $message; kind = $failureKind } | ConvertTo-Json -Compress), $utf8)
            [System.IO.File]::Move($failureTemporary, $configuration.failurePath)
            if ($parentExited) { Write-UpdateResult 'failed' $message }
        } catch { }
        # Recovery never closes or kills the parent. If it already exited, let
        # the current application reopen so its normal startup recovery can run.
        if ($parentExited -and ([System.IO.File]::Exists($configuration.installedExecutable) -or [System.IO.File]::Exists([System.IO.Path]::Combine($configuration.installDirectory, 'fresh-supply.exe')))) {
            try {
                Start-InstalledApplication $true
            } catch { }
        } elseif ($parentExited) {
            # A partial legacy installation may have already removed its EXE.
            # Keep the verified installer and surface repair instructions even
            # when there is no application available to consume the result.
            try {
                $null = [System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms')
                $text = 'Не удалось завершить обновление fresh-supply. Данные сохранены. Запустите установщик повторно в прежний каталог.' + [Environment]::NewLine + [Environment]::NewLine + $message + [Environment]::NewLine + 'Установщик: ' + $configuration.installer + [Environment]::NewLine + 'Журнал: ' + $configuration.logPath
                $null = [System.Windows.Forms.MessageBox]::Show($text, 'Обновление fresh-supply', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error)
            } catch { }
        }
    }
    exit 1
}
