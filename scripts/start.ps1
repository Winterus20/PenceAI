[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "..")

function Write-Step($msg) { Write-Host "  -> " -ForegroundColor Cyan -NoNewline; Write-Host $msg }
function Write-Ok($msg)   { Write-Host "  OK " -ForegroundColor Green -NoNewline; Write-Host $msg }
function Write-Warn($msg) { Write-Host "  !! " -ForegroundColor Yellow -NoNewline; Write-Host $msg }
function Write-Err($msg)  { Write-Host "  XX " -ForegroundColor Red -NoNewline; Write-Host $msg }

function Stop-WithPause($msg) {
    Write-Err $msg
    Write-Host ""
    Write-Host "Pencere kapanmasin diye bekleniyor..." -ForegroundColor Yellow
    Read-Host "Cikmak icin Enter'a basin"
    exit 1
}

function Test-PortAvailable {
    param([int]$Port)
    try {
        $tcpListener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
        $tcpListener.Start()
        $tcpListener.Stop()
        return $true
    } catch {
        return $false
    }
}

function Get-ProcessOnPort {
    param([int]$Port)
    try {
        $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
        if ($connections) {
            $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
            $results = @()
            foreach ($pid in $pids) {
                $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
                if ($proc) {
                    $results += "$($proc.ProcessName) (PID: $pid)"
                }
            }
            return $results -join ", "
        }
    } catch {}
    return $null
}

# -- Pre-flight checks -------------------------------------------------
Write-Host ""
Write-Host "PenceAI baslatiliyor..." -ForegroundColor Cyan
Write-Host "Proje dizini: $ProjectRoot" -ForegroundColor Gray
Write-Host ""

# 1) .env check
Write-Step ".env dosyasi kontrol ediliyor..."
if (-not (Test-Path (Join-Path $ProjectRoot ".env"))) {
    Stop-WithPause ".env dosyasi bulunamadi. Once kuruluma ihtiyaciniz var: scripts\setup.bat"
}
Write-Ok ".env dosyasi mevcut"

# 2) node_modules check
Write-Step "node_modules kontrol ediliyor..."
if (-not (Test-Path (Join-Path $ProjectRoot "node_modules"))) {
    Stop-WithPause "node_modules bulunamadi. Once: npm install veya scripts\setup.bat"
}
Write-Ok "node_modules mevcut"

# 3) Build check
Write-Step "Build dosyalari kontrol ediliyor..."
if (-not (Test-Path (Join-Path $ProjectRoot "dist\gateway\index.js"))) {
    Stop-WithPause "Build bulunamadi (dist\gateway\index.js). Once: npm run build veya scripts\setup.bat"
}
Write-Ok "Build dosyalari mevcut"

# 4) Port check
$configPort = 3001
$envFile = Join-Path $ProjectRoot ".env"
$envPortLine = Select-String -Path $envFile -Pattern "^PORT=" -ErrorAction SilentlyContinue
if ($envPortLine) {
    $configPort = [int](($envPortLine.Line -replace '^PORT=', '').Trim())
}

Write-Step "Port $configPort kontrol ediliyor..."
if (-not (Test-PortAvailable -Port $configPort)) {
    $procInfo = Get-ProcessOnPort -Port $configPort
    if ($procInfo) {
        Write-Warn "Port $configPort zaten kullaniliyor: $procInfo"
    } else {
        Write-Warn "Port $configPort zaten kullaniliyor"
    }
    Write-Host ""
    $confirm = Read-Host "Bu sureci kapatip devam etmek istiyor musunuz? (e/H)"
    if ($confirm -eq "e" -or $confirm -eq "E") {
        $connections = Get-NetTCPConnection -LocalPort $configPort -ErrorAction SilentlyContinue
        if ($connections) {
            $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
            foreach ($pid in $pids) {
                Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
            }
            Start-Sleep -Seconds 2
        }
        if (-not (Test-PortAvailable -Port $configPort)) {
            Stop-WithPause "Port $configPort hala kullaniliyor. Manuel olarak kapatip tekrar deneyin."
        }
        Write-Ok "Port $configPort serbest birakildi"
    } else {
        Stop-WithPause "Port $configPort kullaniliyor. Baska bir port ayarlayin veya mevcut sureci kapatip tekrar deneyin."
    }
} else {
    Write-Ok "Port $configPort musait"
}

# -- Launch ------------------------------------------------------------
Set-Location $ProjectRoot
Write-Host ""
Write-Host "Sunucu baslatiliyor (Port: $configPort)..." -ForegroundColor Gray
Write-Host "Durdurmak icin Ctrl+C basin" -ForegroundColor DarkGray
Write-Host ""

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "node"
$psi.Arguments = "dist/gateway/index.js"
$psi.WorkingDirectory = $ProjectRoot
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true

$proc = [System.Diagnostics.Process]::new()
$proc.StartInfo = $psi

$proc.OutputDataReceived.Add_DataReceived({
    param($sender, $e)
    if ($e.Data) { Write-Host $e.Data }
}) | Out-Null

$proc.ErrorDataReceived.Add_DataReceived({
    param($sender, $e)
    if ($e.Data) { Write-Host $e.Data -ForegroundColor Red }
}) | Out-Null

$proc.EnableRaisingEvents = $true

$proc.Exited += {
    param($sender, $e)
    Write-Host ""
    Write-Host "PenceAI durduruldu." -ForegroundColor Yellow
    Write-Host "Cikis kodu: $($sender.ExitCode)" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "Pencere kapanmasin diye bekleniyor..." -ForegroundColor Yellow
    Read-Host "Cikmak icin Enter'a basin"
}

$proc.Start() | Out-Null
$proc.BeginOutputReadLine()
$proc.BeginErrorReadLine()

$proc.WaitForExit()
