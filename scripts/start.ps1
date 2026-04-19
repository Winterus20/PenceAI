[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "..")

$Cyan = "`e[36m"
$Red = "`e[31m"
$Yellow = "`e[33m"
$Reset = "`e[0m"

function Stop-WithPause($msg) {
    Write-Host "${Red}Hata:${Reset} $msg"
    Write-Host ""
    Write-Host "${Yellow}Pencere kapanmasin diye bekleniyor...${Reset}"
    Read-Host "Cikmak icin Enter'a basin"
    exit 1
}

if (-not (Test-Path (Join-Path $ProjectRoot ".env"))) {
    Stop-WithPause ".env dosyasi bulunamadi. Once kuruluma ihtiyaciniz var: scripts\setup.ps1"
}

if (-not (Test-Path (Join-Path $ProjectRoot "dist\gateway\index.js"))) {
    Stop-WithPause "Build bulunamadi (dist\gateway\index.js). Once: npm run build veya scripts\setup.ps1"
}

Set-Location $ProjectRoot
node dist/gateway/index.js