[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "..")

$Cyan = "`e[36m"
$Red = "`e[31m"
$Reset = "`e[0m"

if (-not (Test-Path (Join-Path $ProjectRoot ".env"))) {
    Write-Host "${Red}Hata:${Reset} .env dosyasi bulunamadi."
    Write-Host "Once kuruluma ihtiyaciniz var:"
    Write-Host "  ${Cyan}scripts\setup.ps1${Reset}"
    exit 1
}

if (-not (Test-Path (Join-Path $ProjectRoot "dist\gateway\index.js"))) {
    Write-Host "${Red}Hata:${Reset} Build bulunamadi (dist\gateway\index.js)."
    Write-Host "Once build yapin:"
    Write-Host "  ${Cyan}npm run build${Reset}"
    Write-Host ""
    Write-Host "Veya kurulum script'ini calistirin:"
    Write-Host "  ${Cyan}scripts\setup.ps1${Reset}"
    exit 1
}

Set-Location $ProjectRoot
node dist/gateway/index.js