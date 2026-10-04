param(
    [string]$CertificatePath = (Join-Path $PSScriptRoot "lan-root-ca.crt")
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $CertificatePath)) {
    throw "Certificate not found: $CertificatePath. Run .\scripts\start-lan-https.ps1 first."
}

$principal = New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent()
)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run PowerShell as Administrator to install the root CA certificate."
}

Import-Certificate -FilePath $CertificatePath -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
Write-Host "The Caddy root CA certificate is now trusted by Windows."
