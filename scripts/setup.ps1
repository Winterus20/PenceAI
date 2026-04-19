[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

$Cyan = "`e[36m"
$Green = "`e[32m"
$Yellow = "`e[33m"
$Red = "`e[31m"
$Bold = "`e[1m"
$Reset = "`e[0m"

function Write-Step($msg) { Write-Host "${Cyan}  ->${Reset} $msg" }
function Write-Ok($msg)   { Write-Host "${Green}  OK${Reset} $msg" }
function Write-Warn($msg) { Write-Host "${Yellow}  !!${Reset} $msg" }
function Write-Err($msg)  { Write-Host "${Red}  XX${Reset} $msg" }

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

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "..")

Write-Host ""
Write-Host "${Bold}========================================${Reset}"
Write-Host "${Bold}    PenceAI Kurulum Sihirbazi${Reset}"
Write-Host "${Bold}========================================${Reset}"
Write-Host ""

# -- Node.js -----------------------------------------------------------
Write-Host "${Bold}[1/6] Node.js kontrol ediliyor...${Reset}"

if (-not (Test-Command "node")) {
    Write-Err "Node.js bulunamadi!"
    Write-Host ""
    Write-Host "  Lutfen Node.js 22 veya uzerini kurun:"
    Write-Host "  ${Cyan}https://nodejs.org/${Reset}"
    Write-Host ""
    Write-Host "  nvm kullaniyorsaniz:"
    Write-Host "  nvm install 22 && nvm use 22"
    exit 1
}

$nodeVersion = (node -v) -replace '^v', ''
$nodeMajor = [int]($nodeVersion.Split('.')[0])

if ($nodeMajor -lt 22) {
    Write-Err "Node.js $nodeVersion bulundu - 22.0.0 veya uzeri gerekiyor."
    Write-Host ""
    Write-Host "  Guncellemek icin:"
    Write-Host "  ${Cyan}https://nodejs.org/${Reset}"
    exit 1
}

Write-Ok "Node.js v$nodeVersion bulundu"

# -- npm ---------------------------------------------------------------
Write-Host ""
Write-Host "${Bold}[2/6] Bagimliliklar kuruluyor...${Reset}"

Set-Location $ProjectRoot

Write-Step "Root bagimliliklari kuruluyor (bu birkac dakika surebilir)..."
$npmRootLog = [System.IO.Path]::GetTempFileName()
try {
    npm install 2>&1 | Tee-Object -FilePath $npmRootLog | ForEach-Object {
        if ($_ -match "^(npm warn|added|removed|changed|up to date)" -or $_ -match "^\d+ package") {
            Write-Host "  $_"
        }
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Err "npm install basarisiz oldu. Son 20 satir:"
        Get-Content $npmRootLog | Select-Object -Last 20 | ForEach-Object { Write-Host "  $_" }
        Remove-Item $npmRootLog -Force -ErrorAction SilentlyContinue
        exit 1
    }
} catch {
    Write-Err "npm install basarisiz oldu. Son 20 satir:"
    Get-Content $npmRootLog | Select-Object -Last 20 | ForEach-Object { Write-Host "  $_" }
    Remove-Item $npmRootLog -Force -ErrorAction SilentlyContinue
    exit 1
}
Remove-Item $npmRootLog -Force -ErrorAction SilentlyContinue
Write-Ok "Root bagimliliklari"

Write-Step "Frontend bagimliliklari kuruluyor..."
Push-Location "src\web\react-app"
$npmFrontLog = [System.IO.Path]::GetTempFileName()
try {
    npm install 2>&1 | Tee-Object -FilePath $npmFrontLog | ForEach-Object {
        if ($_ -match "^(npm warn|added|removed|changed|up to date)" -or $_ -match "^\d+ package") {
            Write-Host "  $_"
        }
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Frontend npm install basarisiz oldu. Son 20 satir:"
        Get-Content $npmFrontLog | Select-Object -Last 20 | ForEach-Object { Write-Host "  $_" }
        Remove-Item $npmFrontLog -Force -ErrorAction SilentlyContinue
        Pop-Location
        exit 1
    }
} catch {
    Write-Err "Frontend npm install basarisiz oldu. Son 20 satir:"
    Get-Content $npmFrontLog | Select-Object -Last 20 | ForEach-Object { Write-Host "  $_" }
    Remove-Item $npmFrontLog -Force -ErrorAction SilentlyContinue
    Pop-Location
    exit 1
}
Remove-Item $npmFrontLog -Force -ErrorAction SilentlyContinue
Pop-Location
Write-Ok "Frontend bagimliliklari"

# -- .env --------------------------------------------------------------
Write-Host ""
Write-Host "${Bold}[3/6] .env dosyasi yapilandiriliyor...${Reset}"

$envFile = Join-Path $ProjectRoot ".env"
$envExample = Join-Path $ProjectRoot ".env.example"

if (-not (Test-Path $envFile)) {
    Copy-Item $envExample $envFile
    Write-Ok ".env.example -> .env kopyalandi"
} else {
    Write-Warn ".env dosyasi zaten mevcut, mevcut dosya korunuyor"
}

# -- API Key -----------------------------------------------------------
Write-Host ""
Write-Host "${Bold}[4/6] LLM API anahtari yapilandiriliyor${Reset}"
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
        Write-Host "  ${Cyan}notepad $envFile${Reset}"
    } else {
        Set-EnvValue -FilePath $envFile -Key $selected.Key -Value $apiKey
        Set-EnvValue -FilePath $envFile -Key "DEFAULT_LLM_PROVIDER" -Value $selected.Default

        $masked = $apiKey.Substring(0, [Math]::Min(8, $apiKey.Length)) + "..."
        Write-Ok "API anahtari kaydedildi ($($selected.Key)=$masked)"
    }
}

# -- Build -------------------------------------------------------------
Write-Host ""
Write-Host "${Bold}[5/6] Proje derleniyor...${Reset}"

Write-Step "TypeScript + Frontend build (bu birkac dakika surebilir)..."
$buildLog = [System.IO.Path]::GetTempFileName()
try {
    npm run build 2>&1 | Tee-Object -FilePath $buildLog | ForEach-Object {
        if ($_ -match "(error|Error|failed|Building|built|Compil)" -or $_ -match "^\s*(src/|dist/)") {
            Write-Host "  $_"
        }
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Build basarisiz oldu. Son 20 satir:"
        Get-Content $buildLog | Select-Object -Last 20 | ForEach-Object { Write-Host "  $_" }
        Remove-Item $buildLog -Force -ErrorAction SilentlyContinue
        Write-Host ""
        Write-Host "  Gelistirme modunda baslatmayi deneyebilirsiniz:"
        Write-Host "  ${Cyan}npm run dev${Reset}"
        exit 1
    }
} catch {
    Write-Err "Build basarisiz oldu. Son 20 satir:"
    Get-Content $buildLog | Select-Object -Last 20 | ForEach-Object { Write-Host "  $_" }
    Remove-Item $buildLog -Force -ErrorAction SilentlyContinue
    exit 1
}
Remove-Item $buildLog -Force -ErrorAction SilentlyContinue
Write-Ok "Build tamamlandi"

# -- Summary -----------------------------------------------------------
Write-Host ""
Write-Host "${Bold}[6/6] Kurulum tamamlandi!${Reset}"
Write-Host ""
Write-Host "========================================"
Write-Host ""
Write-Host "${Green}${Bold}  PenceAI hazir!${Reset}"
Write-Host ""
Write-Host "  Baslatmak icin:"
Write-Host "    ${Cyan}npm start${Reset}              (Production modu)"
Write-Host "    ${Cyan}npm run dev${Reset}             (Gelistirme modu, hot-reload)"
Write-Host "    ${Cyan}scripts\start.ps1${Reset}       (Alternatif baslatma)"
Write-Host ""
Write-Host "  Dashboard: ${Cyan}http://localhost:3001${Reset}"
Write-Host ""
Write-Host "  Yapilandirmayi degistirmek icin:"
Write-Host "    ${Cyan}notepad .env${Reset}"
Write-Host ""
Write-Host "========================================"
Write-Host ""