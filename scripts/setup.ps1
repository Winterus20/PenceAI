[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Continue"

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
        [System.IO.File]::WriteAllLines($FilePath, @("${Key}=${Value}"))
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

function Invoke-NpmStream {
    param(
        [string]$WorkingDir,
        [string]$LogPath
    )
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "cmd.exe"
    $psi.Arguments = "/c npm install"
    $psi.WorkingDirectory = $WorkingDir
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true

    $proc = [System.Diagnostics.Process]::new()
    $proc.StartInfo = $psi

    $stdoutLines = [System.Collections.ArrayList]::new()
    $stderrLines = [System.Collections.ArrayList]::new()

    $proc.OutputDataReceived.Add_DataReceived({
        param($sender, $e)
        if ($e.Data) {
            $stdoutLines.Add($e.Data) | Out-Null
            Write-Host "    $($e.Data)"
        }
    }) | Out-Null

    $proc.ErrorDataReceived.Add_DataReceived({
        param($sender, $e)
        if ($e.Data) {
            $stderrLines.Add($e.Data) | Out-Null
            Write-Host "    $($e.Data)" -ForegroundColor DarkGray
        }
    }) | Out-Null

    $proc.Start() | Out-Null
    $proc.BeginOutputReadLine()
    $proc.BeginErrorReadLine()
    $proc.WaitForExit()

    $allLines = $stdoutLines + $stderrLines
    $allLines | Out-File -FilePath $LogPath -Encoding UTF8

    return $proc.ExitCode
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "..")

Write-Host ""
Write-Host "========================================" -ForegroundColor White
Write-Host "    PenceAI Kurulum Sihirbazi" -ForegroundColor White
Write-Host "========================================" -ForegroundColor White
Write-Host ""

# -- Disk space --------------------------------------------------------
Write-Host "[0/9] Disk alani kontrol ediliyor..." -ForegroundColor White
if (-not (Check-DiskSpace -RequiredMB 2000)) {
    Write-Warn "Yetersiz disk alani. En az 2GB bos alan onerilir."
    Write-Host ""
    $confirm = Read-Host "Devam etmek istiyor musunuz? (e/H)"
    if ($confirm -ne "e" -and $confirm -ne "E") {
        Stop-WithPause "Kurulum durduruldu."
    }
}
Write-Ok "Disk alani yeterli"

# -- System dependencies -----------------------------------------------
Write-Host ""
Write-Host "[1/9] Sistem bagimliliklari kontrol ediliyor..." -ForegroundColor White

$missingSys = @()
$sysChecks = @(
    @{ Cmd = "gcc";     Name = "gcc (C derleyici)" },
    @{ Cmd = "g++";     Name = "g++ (C++ derleyici)" },
    @{ Cmd = "make";    Name = "make (build araci)" },
    @{ Cmd = "python3"; Name = "python3" },
    @{ Cmd = "git";     Name = "git" },
    @{ Cmd = "curl";    Name = "curl" }
)

foreach ($check in $sysChecks) {
    if (-not (Test-Command $check.Cmd)) {
        $missingSys += $check.Name
    }
}

if ($missingSys.Count -gt 0) {
    Write-Host ""
    Write-Warn "Asagidaki sistem paketleri eksik:"
    foreach ($dep in $missingSys) {
        Write-Host "    - $dep"
    }
    Write-Host ""
    Write-Step "Eksik paketler yukleniyor..."

    $pkgMap = @{
        "gcc"             = "gcc"
        "g++"             = "g++"
        "make"            = "make"
        "python3"         = "python3"
        "git"             = "git"
        "curl"            = "curl"
    }

    $toInstall = @()
    foreach ($dep in $missingSys) {
        $pkgName = $pkgMap[$dep]
        if ($pkgName) { $toInstall += $pkgName }
    }

    $installed = $false

    if (Test-Command "winget") {
        Write-Step "winget ile yukleniyor..."
        $failed = @()
        foreach ($pkg in $toInstall) {
            Write-Step "winget install $pkg ..."
            try {
                winget install $pkg --accept-source-agreements --accept-package-agreements 2>&1 | Out-Null
                if ($LASTEXITCODE -ne 0) { $failed += $pkg }
            } catch { $failed += $pkg }
        }
        if ($failed.Count -eq 0) {
            $installed = $true
            Write-Ok "Sistem paketleri winget ile yuklendi"
        } else {
            Write-Warn "Bazi paketler yuklenemedi: $($failed -join ', ')"
        }
    }

    if (-not $installed -and (Test-Command "choco")) {
        Write-Step "choco ile yukleniyor..."
        try {
            choco install $toInstall -y 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) {
                $installed = $true
                Write-Ok "Sistem paketleri choco ile yuklendi"
            }
        } catch {}
    }

    if (-not $installed) {
        Write-Host ""
        Write-Err "Otomatik paket kurulumu yapilamadi!"
        Write-Host "  Asagidaki paketleri manuel olarak kurun:"
        foreach ($dep in $missingSys) {
            Write-Host "    - $dep"
        }
        Write-Host ""
        Write-Host "  winget ile:" -ForegroundColor Cyan
        Write-Host "    winget install Git Git.Git Python.Python.3.12" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  veya choco ile:" -ForegroundColor Cyan
        Write-Host "    choco install git python make curl gcc" -ForegroundColor Cyan
        Write-Host ""
        $confirm = Read-Host "Devam etmek istiyor musunuz? (e/H)"
        if ($confirm -ne "e" -and $confirm -ne "E") {
            Stop-WithPause "Kurulum durduruldu."
        }
    }
} else {
    Write-Ok "Tum sistem bagimliliklari mevcut"
}

# -- Node.js -----------------------------------------------------------
Write-Host ""
Write-Host "[2/9] Node.js kontrol ediliyor..." -ForegroundColor White

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
    } elseif ($nodeMajor -gt 22) {
        Write-Warn "Node.js $nodeVersion bulundu - Node.js 22 LTS onerilir (bazı native modullerin prebuilt binary si yok)"
        Write-Host ""
        $confirmNode = Read-Host "Node.js 22 LTS'ye gecmek ister misiniz? (e/H)"
        if ($confirmNode -eq "e" -or $confirmNode -eq "E") {
            $needsUpgrade = $true
        } else {
            Write-Host "  Mevcut Node.js v$nodeVersion ile devam ediliyor." -ForegroundColor Yellow
        }
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

# -- Build tools for native modules ------------------------------------
$nodeVersion = (node -v) -replace '^v', ''
$nodeMajor = [int]($nodeVersion.Split('.')[0])

if ($nodeMajor -gt 22) {
    Write-Host ""
    Write-Host "[2.5/9] Native modul derleme araclari kontrol ediliyor..." -ForegroundColor White
    Write-Warn "Node.js $nodeMajor icin prebuilt binary bulunamadi, derleme gerekli"

    $needBuildTools = $false

    # Check Python
    $pythonFound = $false
    foreach ($py in @("python", "python3", "py")) {
        if (Test-Command $py) {
            $pythonFound = $true
            break
        }
    }
    if (-not $pythonFound) {
        Write-Err "Python bulunamadi (node-gyp icin gerekli)"
        $needBuildTools = $true
    }

    # Check VS Build Tools (corrected paths)
    $vsFound = $false
    $vsPaths = @(
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC",
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC",
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Professional\VC\Tools\MSVC",
        "${env:ProgramFiles (x86)}\Microsoft Visual Studio\2019\BuildTools\VC\Tools\MSVC",
        "${env:ProgramFiles (x86)}\Microsoft Visual Studio\2019\Community\VC\Tools\MSVC"
    )
    foreach ($p in $vsPaths) {
        if (Test-Path $p) { $vsFound = $true; break }
    }
    if (-not $vsFound) {
        Write-Err "Visual Studio Build Tools bulunamadi"
        $needBuildTools = $true
    }

    if ($needBuildTools) {
        Write-Host ""
        Write-Step "Eksik derleme araclari yukleniyor..."
        Write-Host ""
        Write-Host "  1) Python 3:"
        Write-Host "     winget install Python.Python.3.12" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  2) Visual Studio Build Tools:"
        Write-Host "     winget install Microsoft.VisualStudio.2022.BuildTools --override `"--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended`"" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  veya hepsini birlikte:"
        Write-Host "     npm install --global windows-build-tools" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  Alternatif: Node.js 22 LTS kullan (prebuilt binary var, derleme gerekmez):"
        Write-Host "     nvm install 22 && nvm use 22" -ForegroundColor Cyan
        Write-Host ""
        Stop-WithPause "Derleme araclari kuruldugunda tekrar deneyin."
    } else {
        Write-Ok "Derleme araclari mevcut"
    }
}

# -- npm ---------------------------------------------------------------
Write-Host ""
Write-Host "[3/9] Bagimliliklar kuruluyor..." -ForegroundColor White

Set-Location $ProjectRoot

Write-Step "Root bagimliliklari kuruluyor (bu birkac dakika surebilir)..."
$npmRootLog = Join-Path $env:TEMP "penceai_npm_root.log"
try {
    $npmRootExit = Invoke-NpmStream -WorkingDir $ProjectRoot -LogPath $npmRootLog
    if ($npmRootExit -ne 0) {
        Write-Err "npm install basarisiz oldu (cikis kodu: $npmRootExit)"
        Stop-WithPause "Kurulum durduruldu."
    }
} finally {
    Remove-Item $npmRootLog -Force -ErrorAction SilentlyContinue
}
Write-Ok "Root bagimliliklari"

Write-Step "Frontend bagimliliklari kuruluyor..."
$npmFrontLog = Join-Path $env:TEMP "penceai_npm_front.log"
try {
    $npmFrontExit = Invoke-NpmStream -WorkingDir (Join-Path $ProjectRoot "src\web\react-app") -LogPath $npmFrontLog
    if ($npmFrontExit -ne 0) {
        Write-Err "Frontend npm install basarisiz oldu (cikis kodu: $npmFrontExit)"
        Stop-WithPause "Kurulum durduruldu."
    }
} finally {
    Remove-Item $npmFrontLog -Force -ErrorAction SilentlyContinue
}
Write-Ok "Frontend bagimliliklari"

# -- .env --------------------------------------------------------------
Write-Host ""
Write-Host "[4/9] .env dosyasi yapilandiriliyor..." -ForegroundColor White

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
Write-Host "[5/9] LLM API anahtari yapilandiriliyor" -ForegroundColor White
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
Write-Host "[6/9] Proje derleniyor..." -ForegroundColor White

Write-Step "TypeScript + Frontend build (bu birkac dakika surebilir)..."
$buildLog = Join-Path $env:TEMP "penceai_build.log"
try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "cmd.exe"
    $psi.Arguments = "/c npm run build"
    $psi.WorkingDirectory = $ProjectRoot
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true

    $proc = [System.Diagnostics.Process]::new()
    $proc.StartInfo = $psi

    $buildLines = [System.Collections.ArrayList]::new()

    $proc.OutputDataReceived.Add_DataReceived({
        param($sender, $e)
        if ($e.Data) {
            Write-Host "    $($e.Data)"
            $buildLines.Add($e.Data) | Out-Null
        }
    }) | Out-Null

    $proc.ErrorDataReceived.Add_DataReceived({
        param($sender, $e)
        if ($e.Data) {
            Write-Host "    $($e.Data)" -ForegroundColor DarkGray
            $buildLines.Add($e.Data) | Out-Null
        }
    }) | Out-Null

    $proc.Start() | Out-Null
    $proc.BeginOutputReadLine()
    $proc.BeginErrorReadLine()
    $proc.WaitForExit()

    [System.IO.File]::WriteAllLines($buildLog, $buildLines)

    if ($proc.ExitCode -ne 0) {
        Write-Err "Build basarisiz oldu (cikis kodu: $($proc.ExitCode))"
        Write-Host ""
        Write-Host "  Gelistirme modunda baslatmayi deneyebilirsiniz:"
        Write-Host "  npm run dev" -ForegroundColor Cyan
        Stop-WithPause "Kurulum durduruldu."
    }
} finally {
    Remove-Item $buildLog -Force -ErrorAction SilentlyContinue
}
Write-Ok "Build tamamlandi"

# -- Database directory ------------------------------------------------
Write-Host ""
Write-Host "[7/9] Veritabani dizini hazirlaniyor..." -ForegroundColor White

$dbDir = Join-Path $ProjectRoot "data"
if (-not (Test-Path $dbDir)) {
    New-Item -ItemType Directory -Path $dbDir | Out-Null
    Write-Ok "data\ dizini olusturuldu"
} else {
    Write-Ok "data\ dizini zaten mevcut"
}

# -- Port check --------------------------------------------------------
Write-Host ""
Write-Host "[8/9] Port kontrolu yapiliyor..." -ForegroundColor White

$configPort = 3001
$envPortLine = Select-String -Path $envFile -Pattern "^PORT=" -ErrorAction SilentlyContinue
if ($envPortLine) {
    $configPort = [int](($envPortLine.Line -replace '^PORT=', '').Trim())
}

if (-not (Test-PortAvailable -Port $configPort)) {
    Write-Warn "Port $configPort zaten kullaniliyor!"
    Write-Host ""
    $procInfo = Get-NetTCPConnection -LocalPort $configPort -ErrorAction SilentlyContinue | ForEach-Object {
        $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
        if ($proc) { "$($proc.ProcessName) (PID: $($proc.Id))" }
    }
    if ($procInfo) {
        Write-Host "  Kullanilan surec: $($procInfo -join ', ')" -ForegroundColor Yellow
    }
    Write-Host ""
    $confirm = Read-Host "Bu sureci kapatip devam etmek istiyor musunuz? (e/H)"
    if ($confirm -eq "e" -or $confirm -eq "E") {
        $pids = Get-NetTCPConnection -LocalPort $configPort -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($pid in $pids) {
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Seconds 2
        if (Test-PortAvailable -Port $configPort) {
            Write-Ok "Port $configPort serbest birakildi"
        } else {
            Stop-WithPause "Port $configPort hala kullaniliyor. Manuel olarak kapatip tekrar deneyin."
        }
    } else {
        Stop-WithPause "Port $configPort kullaniliyor. Baska bir port ayarlayin veya mevcut sureci kapatip tekrar deneyin."
    }
} else {
    Write-Ok "Port $configPort musait"
}

# -- Summary -----------------------------------------------------------
Write-Host ""
Write-Host "[9/9] Kurulum tamamlandi!" -ForegroundColor White
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
Write-Host "  Dashboard: http://localhost:$configPort" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Yapilandirmayi degistirmek icin:"
Write-Host "    notepad .env" -ForegroundColor Cyan
Write-Host ""
Write-Host "========================================"
Write-Host ""
Write-Host "Pencere kapanmasin diye bekleniyor..." -ForegroundColor Yellow
Read-Host "Cikmak icin Enter'a basin"
