[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "..")

function Stop-WithPause($msg) {
    Write-Host "Hata: $msg" -ForegroundColor Red
    Write-Host ""
    Write-Host "Pencere kapanmasin diye bekleniyor..." -ForegroundColor Yellow
    Read-Host "Cikmak icin Enter'a basin"
    exit 1
}

if (-not (Test-Path (Join-Path $ProjectRoot ".env"))) {
    Stop-WithPause ".env dosyasi bulunamadi. Once kuruluma ihtiyaciniz var: scripts\setup.bat"
}

if (-not (Test-Path (Join-Path $ProjectRoot "dist\gateway\index.js"))) {
    Stop-WithPause "Build bulunamadi (dist\gateway\index.js). Once: npm run build veya scripts\setup.bat"
}

Set-Location $ProjectRoot
node dist/gateway/index.js
