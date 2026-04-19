[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

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

function Test-Command($cmd) {
    try { Get-Command $cmd -ErrorAction Stop | Out-Null; return $true }
    catch { return $false }
}

function Set-EnvValue {
    param(
        [string]$FilePath,
        [string]$Key,
        [string]$Value
    )
    if (-not (Test-Path $FilePath)) {
        "${Key}=${Value}" | Out-File -FilePath $FilePath -Encoding UTF8
        return
    }
    $lines = [System.IO.File]::ReadAllLines($FilePath)
    $newLines = [System.Collections.ArrayList]::new()
    $prefix = "${Key}="
    $found = $false
    foreach ($line in $lines) {
        if ($line.StartsWith($prefix)) {
            $newLines.Add("${Key}=${Value}") | Out-Null
            $found = $true
        } else {
            $newLines.Add($line) | Out-Null
        }
    }
    if (-not $found) {
        $newLines.Add("${Key}=${Value}") | Out-Null
    }
    [System.IO.File]::WriteAllLines($FilePath, $newLines)
}

function Check-DiskSpace {
    param([int]$RequiredMB)
    try {
        $drive = (Get-Location).Drive.Name + ":\"
        $disk = Get-PSDrive -Name (Get-Location).Drive.Name
        $freeMB = [math]::Round($disk.Free / 1MB)
        if ($freeMB -lt $RequiredMB) {
            Write-Warn "Disk alani az: ${freeMB}MB mevcut, ~${RequiredMB}MB onerilen"
            return $false
        }
    } catch {
        return $true
    }
    return $true
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "..")

Write-Host ""
Write-Host "========================================" -ForegroundColor White
Write-Host "    PenceAI Kurulum Sihirbazi" -ForegroundColor White
Write-Host "========================================" -ForegroundColor White
Write-Host ""

# -- Disk space --------------------------------------------------------
Write-Host "[0/8] Disk alani kontrol ediliyor..." -ForegroundColor White
if (-not (Check-DiskSpace -RequiredMB 2000)) {
    Write-Warn "Yetersiz disk alani. En az 2GB bos alan onerilir."
    Write-Host ""
    $confirm = Read-Host "Devam etmek istiyor musunuz? (e/H)"
    if ($confirm -ne "e" -and $confirm -ne "E") {
        Stop-WithPause "Kurulum durduruldu."
    }
}
Write-Ok "Disk alani yeterli"

# -- Node.js -----------------------------------------------------------
Write-Host ""
Write-Host "[1/8] Node.js kontrol ediliyor..." -ForegroundColor White

$needsInstall = $false
$needsUpgrade = $false

if (-not (Test-Command "node")) {
    Write-Err "Node.js bulunamadi!"
    $needsInstall = $true
} else {
    $nodeVersion = (node -v) -replace '^v', ''
    $nodeMajor = [int]($nodeVersion.Split('.')[0])
    if ($nodeMajor -lt 22) {
        Write-Err "Node.js $nodeVersion bulundu - 22.0.0 veya uzeri gerekiyor."
        $needsUpgrade = $true
    } else {
        Write-Ok "Node.js v$nodeVersion bulundu"
    }
}

if (-not (Test-Command "npm")) {
    Write-Err "npm bulunamadi! Node.js ile birlikte yuklenmis olmasi gerekir."
    $needsInstall = $true
}

# -- Auto-install Node.js 22 if needed --------------------------------
if ($needsInstall -or $needsUpgrade) {
    Write-Host ""
    if ($needsInstall) {
        Write-Step "Node.js 22 otomatik olarak yukleniyor..."
    } else {
        Write-Step "Node.js 22'ye yukseltiliyor..."
    }

    $installed = $false

    # Try winget (Windows 10/11)
    if (Test-Command "winget") {
        Write-Step "winget ile yukleniyor..."
        $wingetLog = [System.IO.Path]::GetTempFileName()
        try {
            winget install OpenJS.NodeJS.LTS --version 22 --accept-source-agreements --accept-package-agreements 2>&1 | Tee-Object -FilePath $wingetLog | Out-Null
            if ($LASTEXITCODE -eq 0) {
                $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
                if (Test-Command "node") {
                    $installed = $true
                    Write-Ok "winget ile Node.js 22 yuklendi"
                }
            }
        } catch {}
        Remove-Item $wingetLog -Force -ErrorAction SilentlyContinue
    }

    # Try nvm-windows
    if (-not $installed) {
        $nvmHome = "$env:APPDATA\nvm"
        if (Test-Path "$nvmHome\nvm.exe") {
            Write-Step "nvm-windows ile yukleniyor..."
            $env:Path = "$nvmHome;$env:Path"
            try {
                nvm install 22 2>&1 | Out-Null
                nvm use 22 2>&1 | Out-Null
                if (Test-Command "node") {
                    $installed = $true
                    Write-Ok "nvm-windows ile Node.js 22 yuklendi"
                }
            } catch {}
        }
    }

    if (-not $installed) {
        Write-Host ""
        Write-Err "Node.js 22 otomatik yuklenemedi!"
        Write-Host ""
        Write-Host "  Manuel kurulum icin:"
        Write-Host "  https://nodejs.org/" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  veya nvm-windows ile:"
        Write-Host "  https://github.com/coreybutler/nvm-windows/releases"
        Stop-WithPause "Kurulum durduruldu."
    }

    # Verify
    $nodeVersion = (node -v) -replace '^v', ''
    $nodeMajor = [int]($nodeVersion.Split('.')[0])
    if ($nodeMajor -lt 22) {
        Write-Err "Yukleme sonrasi versiyon kontrolu basarisiz: v$nodeVersion"
        Stop-WithPause "Kurulum durduruldu."
    }
    Write-Ok "Node.js v$nodeVersion hazir"
}

# -- npm ---------------------------------------------------------------
Write-Host ""
Write-Host "[2/8] Bagimliliklar kuruluyor..." -ForegroundColor White

Set-Location $ProjectRoot

Write-Step "Root bagimliliklari kuruluyor (bu birkac dakika surebilir)..."
$npmRootLog = [System.IO.Path]::GetTempFileName()
try {
    npm install 2>&1 | Tee-Object -FilePath $npmRootLog | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Err "npm install basarisiz oldu (cikis kodu: $LASTEXITCODE)"
        Write-Host ""
        Get-Content $npmRootLog | ForEach-Object { Write-Host "  $_" }
        Remove-Item $npmRootLog -Force -ErrorAction SilentlyContinue
        Stop-WithPause "Kurulum durduruldu."
    }
} catch {
    Write-Err "npm install basarisiz oldu"
    Write-Host ""
    Get-Content $npmRootLog | ForEach-Object { Write-Host "  $_" }
    Remove-Item $npmRootLog -Force -ErrorAction SilentlyContinue
    Stop-WithPause "Kurulum durduruldu."
}
Remove-Item $npmRootLog -Force -ErrorAction SilentlyContinue
Write-Ok "Root bagimliliklari"

Write-Step "Frontend bagimliliklari kuruluyor..."
Push-Location "src\web\react-app"
$npmFrontLog = [System.IO.Path]::GetTempFileName()
try {
    npm install 2>&1 | Tee-Object -FilePath $npmFrontLog | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Frontend npm install basarisiz oldu (cikis kodu: $LASTEXITCODE)"
        Write-Host ""
        Get-Content $npmFrontLog | ForEach-Object { Write-Host "  $_" }
        Remove-Item $npmFrontLog -Force -ErrorAction SilentlyContinue
        Pop-Location
        Stop-WithPause "Kurulum durduruldu."
    }
} catch {
    Write-Err "Frontend npm install basarisiz oldu"
    Write-Host ""
    Get-Content $npmFrontLog | ForEach-Object { Write-Host "  $_" }
    Remove-Item $npmFrontLog -Force -ErrorAction SilentlyContinue
    Pop-Location
    Stop-WithPause "Kurulum durduruldu."
}
Remove-Item $npmFrontLog -Force -ErrorAction SilentlyContinue
Pop-Location
Write-Ok "Frontend bagimliliklari"

# -- .env --------------------------------------------------------------
Write-Host ""
Write-Host "[3/8] .env dosyasi yapilandiriliyor..." -ForegroundColor White

$envFile = Join-Path $ProjectRoot ".env"
$envExample = Join-Path $ProjectRoot ".env.example"

if (-not (Test-Path $envExample)) {
    Write-Err ".env.example dosyasi bulunamadi!"
    Stop-WithPause "Kurulum durduruldu."
}

if (-not (Test-Path $envFile)) {
    Copy-Item $envExample $envFile
    Write-Ok ".env.example -> .env kopyalandi"
} else {
    Write-Warn ".env dosyasi zaten mevcut, mevcut dosya korunuyor"
}

# -- API Key -----------------------------------------------------------
Write-Host ""
Write-Host "[4/8] LLM API anahtari yapilandiriliyor" -ForegroundColor White
Write-Host ""

$providers = @(
    @{ Name = "OpenAI (varsayilan)"; Key = "OPENAI_API_KEY"; Default = "openai" },
    @{ Name = "Anthropic (Claude)";   Key = "ANTHROPIC_API_KEY"; Default = "anthropic" },
    @{ Name = "Groq";                 Key = "GROQ_API_KEY"; Default = "groq" },
    @{ Name = "Mistral";              Key = "MISTRAL_API_KEY"; Default = "mistral" },
    @{ Name = "MiniMax";              Key = "MINIMAX_API_KEY"; Default = "minimax" },
    @{ Name = "NVIDIA";               Key = "NVIDIA_API_KEY"; Default = "nvidia" },
    @{ Name = "GitHub Models";        Key = "GITHUB_TOKEN"; Default = "github" },
    @{ Name = "Ollama (yerel)";       Key = "OLLAMA_BASE_URL"; Default = "ollama" }
)

for ($i = 0; $i -lt $providers.Count; $i++) {
    Write-Host "  [$($i+1)] $($providers[$i].Name)"
}
Write-Host ""

$choice = Read-Host "Hangi LLM saglayicisini kullanacaksiniz? (1-$($providers.Count)) [1]"
if ([string]::IsNullOrWhiteSpace($choice)) { $choice = "1" }

$idx = 0
if ([int]::TryParse($choice, [ref]$idx) -and $idx -ge 1 -and $idx -le $providers.Count) {
    $idx--
} else {
    Write-Warn "Gecersiz secim, OpenAI kullanilacak"
    $idx = 0
}

$selected = $providers[$idx]
Write-Host ""
Write-Host "  Secilen: $($selected.Name)" -ForegroundColor Cyan
Write-Host ""

if ($selected.Default -eq "ollama") {
    $ollamaUrl = Read-Host "  Ollama sunucu adresi [http://localhost:11434]"
    if ([string]::IsNullOrWhiteSpace($ollamaUrl)) { $ollamaUrl = "http://localhost:11434" }

    Set-EnvValue -FilePath $envFile -Key "OLLAMA_BASE_URL" -Value $ollamaUrl
    Set-EnvValue -FilePath $envFile -Key "DEFAULT_LLM_PROVIDER" -Value "ollama"

    Write-Ok "Ollama yapilandirildi: $ollamaUrl"
} else {
    Write-Host "  $($selected.Key) degerini girin: (girdiniz gizli tutulacaktir)" -ForegroundColor DarkGray
    $secureKey = Read-Host "  " -AsSecureString
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
    $apiKey = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTR)

    if ([string]::IsNullOrWhiteSpace($apiKey)) {
        Write-Warn "API anahtari bos birakildi. Kurulumdan sonra .env dosyasini el ile duzenleyin."
        Write-Host "  notepad $envFile" -ForegroundColor Cyan
    } else {
        Set-EnvValue -FilePath $envFile -Key $selected.Key -Value $apiKey
        Set-EnvValue -FilePath $envFile -Key "DEFAULT_LLM_PROVIDER" -Value $selected.Default

        $masked = $apiKey.Substring(0, [Math]::Min(8, $apiKey.Length)) + "..."
        Write-Ok "API anahtari kaydedildi ($($selected.Key)=$masked)"
    }
}

# -- Build -------------------------------------------------------------
Write-Host ""
Write-Host "[5/8] Proje derleniyor..." -ForegroundColor White

Write-Step "TypeScript + Frontend build (bu birkac dakika surebilir)..."
$buildLog = [System.IO.Path]::GetTempFileName()
try {
    npm run build 2>&1 | Tee-Object -FilePath $buildLog | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Build basarisiz oldu (cikis kodu: $LASTEXITCODE)"
        Write-Host ""
        Get-Content $buildLog | ForEach-Object { Write-Host "  $_" }
        Write-Host ""
        Write-Host "  Gelistirme modunda baslatmayi deneyebilirsiniz:"
        Write-Host "  npm run dev" -ForegroundColor Cyan
        Remove-Item $buildLog -Force -ErrorAction SilentlyContinue
        Stop-WithPause "Kurulum durduruldu."
    }
} catch {
    Write-Err "Build basarisiz oldu"
    Write-Host ""
    Get-Content $buildLog | ForEach-Object { Write-Host "  $_" }
    Write-Host ""
    Write-Host "  Gelistirme modunda baslatmayi deneyebilirsiniz:"
    Write-Host "  npm run dev" -ForegroundColor Cyan
    Remove-Item $buildLog -Force -ErrorAction SilentlyContinue
    Stop-WithPause "Kurulum durduruldu."
}
Remove-Item $buildLog -Force -ErrorAction SilentlyContinue
Write-Ok "Build tamamlandi"

# -- Database directory ------------------------------------------------
Write-Host ""
Write-Host "[6/8] Veritabani dizini hazirlaniyor..." -ForegroundColor White

$dbDir = Join-Path $ProjectRoot "data"
if (-not (Test-Path $dbDir)) {
    New-Item -ItemType Directory -Path $dbDir | Out-Null
    Write-Ok "data\ dizini olusturuldu"
} else {
    Write-Ok "data\ dizini zaten mevcut"
}

# -- Summary -----------------------------------------------------------
Write-Host ""
Write-Host "[7/8] Kurulum tamamlandi!" -ForegroundColor White
Write-Host ""
Write-Host "========================================"
Write-Host ""
Write-Host "  PenceAI hazir!" -ForegroundColor Green
Write-Host ""
Write-Host "  Baslatmak icin:"
Write-Host "    npm start" -ForegroundColor Cyan -NoNewline; Write-Host "              (Production modu)"
Write-Host "    npm run dev" -ForegroundColor Cyan -NoNewline; Write-Host "             (Gelistirme modu, hot-reload)"
Write-Host "    scripts\start.bat" -ForegroundColor Cyan -NoNewline; Write-Host "       (Alternatif baslatma)"
Write-Host ""
Write-Host "  Dashboard: http://localhost:3001" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Yapilandirmayi degistirmek icin:"
Write-Host "    notepad .env" -ForegroundColor Cyan
Write-Host ""
Write-Host "========================================"
Write-Host ""
Write-Host "Pencere kapanmasin diye bekleniyor..." -ForegroundColor Yellow
Read-Host "Cikmak icin Enter'a basin"
