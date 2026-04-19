#!/usr/bin/env bash

CYAN='\033[36m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
BOLD='\033[1m'
RESET='\033[0m'

# Global error trap
trap 'err "Beklenmeyen hata! Satir: $LINENO"; echo ""; echo -e "${YELLOW}Pencere kapanmasin diye bekleniyor...${RESET}"; read -rp "Cikmak icin Enter'\''a basin" _; exit 1' ERR

step()  { echo -e "${CYAN}  ->${RESET} $1"; }
ok()    { echo -e "${GREEN}  OK${RESET} $1"; }
warn()  { echo -e "${YELLOW}  !!${RESET} $1"; }
err()   { echo -e "${RED}  XX${RESET} $1"; }

stop_with_pause() {
    err "$1"
    echo ""
    echo -e "${YELLOW}Pencere kapanmasin diye bekleniyor...${RESET}"
    read -rp "Cikmak icin Enter'a basin" _
    exit 1
}

set_env_value() {
    local file="$1"
    local key="$2"
    local value="$3"

    if [ ! -f "$file" ]; then
        echo "${key}=${value}" > "$file"
        return
    fi

    local tmp="${file}.tmp.$$"
    local found=false
    while IFS= read -r line || [ -n "$line" ]; do
        if [[ "$line" == "${key}="* ]]; then
            echo "${key}=${value}"
            found=true
        else
            echo "$line"
        fi
    done < "$file" > "$tmp"

    if [ "$found" = false ]; then
        echo "${key}=${value}" >> "$tmp"
    fi
    mv "$tmp" "$file"
}

check_disk_space() {
    local required_mb="$1"
    local path="$2"
    if command -v df &>/dev/null; then
        local available_kb
        available_kb=$(df -k "$path" 2>/dev/null | awk 'NR==2 {print $4}')
        if [ -n "$available_kb" ]; then
            local available_mb=$((available_kb / 1024))
            if [ "$available_mb" -lt "$required_mb" ]; then
                warn "Disk alani az: ${available_mb}MB mevcut, ~${required_mb}MB onerilen"
                return 1
            fi
        fi
    fi
    return 0
}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo ""
echo -e "${BOLD}========================================${RESET}"
echo -e "${BOLD}    PenceAI Kurulum Sihirbazi${RESET}"
echo -e "${BOLD}========================================${RESET}"
echo ""

# -- Disk space --------------------------------------------------------
echo -e "${BOLD}[0/8] Disk alani kontrol ediliyor...${RESET}"
if ! check_disk_space 2000 "$PROJECT_ROOT"; then
    warn "Yetersiz disk alani. En az 2GB bos alan onerilir."
    echo ""
    read -rp "Devam etmek istiyor musunuz? (e/H) " confirm_disk
    if [[ "$confirm_disk" != "e" && "$confirm_disk" != "E" ]]; then
        stop_with_pause "Kurulum durduruldu."
    fi
fi
ok "Disk alani yeterli"

# -- System dependencies -----------------------------------------------
echo ""
echo -e "${BOLD}[1/7] Sistem bagimliliklari kontrol ediliyor...${RESET}"

MISSING_SYS=()

command -v gcc &>/dev/null  || MISSING_SYS+=("gcc (C derleyici)")
command -v g++ &>/dev/null || MISSING_SYS+=("g++ (C++ derleyici)")
command -v make &>/dev/null || MISSING_SYS+=("make (build araci)")
command -v python3 &>/dev/null || MISSING_SYS+=("python3")
command -v git &>/dev/null || MISSING_SYS+=("git")
command -v curl &>/dev/null || MISSING_SYS+=("curl")

if [ ${#MISSING_SYS[@]} -gt 0 ]; then
    echo ""
    warn "Asagidaki sistem paketleri eksik:"
    for dep in "${MISSING_SYS[@]}"; do
        echo "    - $dep"
    done
    echo ""
    step "Eksik paketler yukleniyor..."

    if command -v apt-get &>/dev/null; then
        PKGS=""
        command -v gcc &>/dev/null  || PKGS="$PKGS gcc"
        command -v g++ &>/dev/null || PKGS="$PKGS g++"
        command -v make &>/dev/null || PKGS="$PKGS make"
        command -v python3 &>/dev/null || PKGS="$PKGS python3"
        command -v git &>/dev/null || PKGS="$PKGS git"
        command -v curl &>/dev/null || PKGS="$PKGS curl"

        if [ -n "$PKGS" ]; then
            step "apt-get install -y$PKGS"
            if apt-get install -y $PKGS 2>&1 | tail -5; then
                ok "Sistem paketleri yuklendi"
            else
                err "apt ile paket kurulumu basarisiz. sudo ile calisiyor musunuz?"
                stop_with_pause "Kurulum durduruldu."
            fi
        fi
    elif command -v dnf &>/dev/null; then
        PKGS=""
        command -v gcc &>/dev/null  || PKGS="$PKGS gcc"
        command -v g++ &>/dev/null || PKGS="$PKGS gcc-c++"
        command -v make &>/dev/null || PKGS="$PKGS make"
        command -v python3 &>/dev/null || PKGS="$PKGS python3"
        command -v git &>/dev/null || PKGS="$PKGS git"
        command -v curl &>/dev/null || PKGS="$PKGS curl"

        if [ -n "$PKGS" ]; then
            step "dnf install -y$PKGS"
            if dnf install -y $PKGS 2>&1 | tail -5; then
                ok "Sistem paketleri yuklendi"
            else
                err "dnf ile paket kurulumu basarisiz. sudo ile calisiyor musunuz?"
                stop_with_pause "Kurulum durduruldu."
            fi
        fi
    elif command -v yum &>/dev/null; then
        PKGS=""
        command -v gcc &>/dev/null  || PKGS="$PKGS gcc"
        command -v g++ &>/dev/null || PKGS="$PKGS gcc-c++"
        command -v make &>/dev/null || PKGS="$PKGS make"
        command -v python3 &>/dev/null || PKGS="$PKGS python3"
        command -v git &>/dev/null || PKGS="$PKGS git"
        command -v curl &>/dev/null || PKGS="$PKGS curl"

        if [ -n "$PKGS" ]; then
            step "yum install -y$PKGS"
            if yum install -y $PKGS 2>&1 | tail -5; then
                ok "Sistem paketleri yuklendi"
            else
                err "yum ile paket kurulumu basarisiz. sudo ile calisiyor musunuz?"
                stop_with_pause "Kurulum durduruldu."
            fi
        fi
    elif command -v brew &>/dev/null; then
        PKGS=""
        command -v gcc &>/dev/null  || PKGS="$PKGS gcc"
        command -v make &>/dev/null || PKGS="$PKGS make"
        command -v python3 &>/dev/null || PKGS="$PKGS python"
        command -v git &>/dev/null || PKGS="$PKGS git"
        command -v curl &>/dev/null || PKGS="$PKGS curl"

        if [ -n "$PKGS" ]; then
            step "brew install$PKGS"
            if brew install $PKGS 2>&1 | tail -5; then
                ok "Sistem paketleri yuklendi"
            else
                err "Homebrew ile paket kurulumu basarisiz."
                stop_with_pause "Kurulum durduruldu."
            fi
        fi
    else
        err "Paket yoneticisi bulunamadi (apt/dnf/yum/brew)."
        echo "  Asagidaki paketleri manuel olarak kurun:"
        for dep in "${MISSING_SYS[@]}"; do
            echo "    - $dep"
        done
        read -rp "Devam etmek istiyor musunuz? (e/H) " confirm_sys
        if [[ "$confirm_sys" != "e" && "$confirm_sys" != "E" ]]; then
            stop_with_pause "Kurulum durduruldu."
        fi
    fi
else
    ok "Tum sistem bagimliliklari mevcut"
fi

# -- Node.js -----------------------------------------------------------
echo ""
echo -e "${BOLD}[2/8] Node.js kontrol ediliyor...${RESET}"

NEEDS_INSTALL=false
NEEDS_UPGRADE=false

if ! command -v node &>/dev/null; then
    err "Node.js bulunamadi!"
    NEEDS_INSTALL=true
else
    NODE_VERSION=$(node -v | sed 's/^v//')
    NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)

    if [ "$NODE_MAJOR" -lt 22 ]; then
        err "Node.js $NODE_VERSION bulundu - 22.0.0 veya uzeri gerekiyor."
        NEEDS_UPGRADE=true
    else
        ok "Node.js v${NODE_VERSION} bulundu"
    fi
fi

# Check npm separately
if ! command -v npm &>/dev/null; then
    err "npm bulunamadi! Node.js ile birlikte yuklenmis olmasi gerekir."
    NEEDS_INSTALL=true
fi

# -- Auto-install Node.js 22 if needed --------------------------------
if [ "$NEEDS_INSTALL" = true ] || [ "$NEEDS_UPGRADE" = true ]; then
    echo ""
    if [ "$NEEDS_INSTALL" = true ]; then
        step "Node.js 22 otomatik olarak yukleniyor..."
    else
        step "Node.js 22'ye yukseltiliyor..."
    fi

    INSTALLED=false

    # Check curl is available (needed for NodeSource)
    if ! command -v curl &>/dev/null; then
        err "curl bulunamadi! Node.js kurulumu icin gerekli."
        echo ""
        echo "  Debian/Ubuntu: apt-get install -y curl"
        echo "  Fedora/RHEL:   dnf install -y curl"
        echo "  macOS:         brew install curl"
        stop_with_pause "Kurulum durduruldu."
    fi

    # Try nvm first (works on Linux + macOS)
    if command -v nvm &>/dev/null || [ -s "$HOME/.nvm/nvm.sh" ]; then
        step "nvm ile yukleniyor..."
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
        if nvm install 22 2>&1 && nvm use 22 2>&1; then
            INSTALLED=true
            ok "nvm ile Node.js 22 yuklendi"
        fi
    fi

    # Try official NodeSource setup script (Debian/Ubuntu)
    if [ "$INSTALLED" = false ] && command -v apt-get &>/dev/null; then
        step "apt uzerinden yukleniyor (NodeSource)..."
        if curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh 2>/dev/null; then
            if bash /tmp/nodesource_setup.sh 2>&1 | tail -3 && apt-get install -y nodejs 2>&1 | tail -3; then
                INSTALLED=true
                ok "apt ile Node.js 22 yuklendi"
            fi
            rm -f /tmp/nodesource_setup.sh
        fi
    fi

    # Try Homebrew (macOS / Linux)
    if [ "$INSTALLED" = false ] && command -v brew &>/dev/null; then
        step "Homebrew ile yukleniyor..."
        if brew install node@22 2>&1 | tail -3; then
            INSTALLED=true
            ok "Homebrew ile Node.js 22 yuklendi"
        fi
    fi

    # Try yum/dnf (RHEL/CentOS/Fedora)
    if [ "$INSTALLED" = false ] && command -v dnf &>/dev/null; then
        step "dnf uzerinden yukleniyor..."
        if curl -fsSL https://rpm.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh 2>/dev/null; then
            if bash /tmp/nodesource_setup.sh 2>&1 | tail -3 && dnf install -y nodejs 2>&1 | tail -3; then
                INSTALLED=true
                ok "dnf ile Node.js 22 yuklendi"
            fi
            rm -f /tmp/nodesource_setup.sh
        fi
    fi

    # Fallback: try yum (older RHEL/CentOS)
    if [ "$INSTALLED" = false ] && command -v yum &>/dev/null; then
        step "yum uzerinden yukleniyor..."
        if curl -fsSL https://rpm.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh 2>/dev/null; then
            if bash /tmp/nodesource_setup.sh 2>&1 | tail -3 && yum install -y nodejs 2>&1 | tail -3; then
                INSTALLED=true
                ok "yum ile Node.js 22 yuklendi"
            fi
            rm -f /tmp/nodesource_setup.sh
        fi
    fi

    # Final check
    if [ "$INSTALLED" = false ]; then
        echo ""
        err "Node.js 22 otomatik yuklenemedi!"
        echo ""
        echo "  Manuel kurulum icin:"
        echo -e "  ${CYAN}https://nodejs.org/${RESET}"
        echo ""
        echo "  veya nvm ile:"
        echo "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
        echo "  nvm install 22 && nvm use 22"
        stop_with_pause "Kurulum durduruldu."
    fi

    # Verify installation
    NODE_VERSION=$(node -v | sed 's/^v//')
    NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
    if [ "$NODE_MAJOR" -lt 22 ]; then
        err "Yukleme sonrasi versiyon kontrolu basarisiz: v${NODE_VERSION}"
        stop_with_pause "Kurulum durduruldu."
    fi
    ok "Node.js v${NODE_VERSION} hazir"
fi

# -- npm ---------------------------------------------------------------
echo ""
echo -e "${BOLD}[3/8] Bagimliliklar kuruluyor...${RESET}"

cd "$PROJECT_ROOT"

step "Root bagimliliklari kuruluyor (bu birkac dakika surebilir)..."
set +e
npm install 2>&1 | tee /tmp/penceai_npm_root.log
NPM_EXIT=${PIPESTATUS[0]:-$?}
set -u
if [ "$NPM_EXIT" -ne 0 ]; then
    err "npm install basarisiz oldu (cikis kodu: $NPM_EXIT)"
    echo ""
    cat /tmp/penceai_npm_root.log
    rm -f /tmp/penceai_npm_root.log
    stop_with_pause "Kurulum durduruldu."
fi
grep -E "^(npm warn|added|removed|changed|up to date|[0-9]+ package)" /tmp/penceai_npm_root.log || true
rm -f /tmp/penceai_npm_root.log
ok "Root bagimliliklari"

step "Frontend bagimliliklari kuruluyor..."
cd "$PROJECT_ROOT/src/web/react-app"
set +e
npm install 2>&1 | tee /tmp/penceai_npm_front.log
NPM_EXIT=${PIPESTATUS[0]:-$?}
set -u
if [ "$NPM_EXIT" -ne 0 ]; then
    err "Frontend npm install basarisiz oldu (cikis kodu: $NPM_EXIT)"
    echo ""
    cat /tmp/penceai_npm_front.log
    rm -f /tmp/penceai_npm_front.log
    stop_with_pause "Kurulum durduruldu."
fi
grep -E "^(npm warn|added|removed|changed|up to date|[0-9]+ package)" /tmp/penceai_npm_front.log || true
rm -f /tmp/penceai_npm_front.log
cd "$PROJECT_ROOT"
ok "Frontend bagimliliklari"

# -- .env --------------------------------------------------------------
echo ""
echo -e "${BOLD}[4/8] .env dosyasi yapilandiriliyor...${RESET}"

ENV_FILE="$PROJECT_ROOT/.env"
ENV_EXAMPLE="$PROJECT_ROOT/.env.example"

if [ ! -f "$ENV_EXAMPLE" ]; then
    err ".env.example dosyasi bulunamadi!"
    stop_with_pause "Kurulum durduruldu."
fi

if [ ! -f "$ENV_FILE" ]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    ok ".env.example -> .env kopyalandi"
else
    warn ".env dosyasi zaten mevcut, mevcut dosya korunuyor"
fi

# -- API Key -----------------------------------------------------------
echo ""
echo -e "${BOLD}[5/8] LLM API anahtari yapilandiriliyor${RESET}"
echo ""

PROVIDERS=(
    "OpenAI (varsayilan)|OPENAI_API_KEY|openai"
    "Anthropic (Claude)|ANTHROPIC_API_KEY|anthropic"
    "Groq|GROQ_API_KEY|groq"
    "Mistral|MISTRAL_API_KEY|mistral"
    "MiniMax|MINIMAX_API_KEY|minimax"
    "NVIDIA|NVIDIA_API_KEY|nvidia"
    "GitHub Models|GITHUB_TOKEN|github"
    "Ollama (yerel)|OLLAMA_BASE_URL|ollama"
)

for i in "${!PROVIDERS[@]}"; do
    IFS='|' read -r name key default <<< "${PROVIDERS[$i]}"
    echo "  [$((i+1))] $name"
done
echo ""

read -p "Hangi LLM saglayicisini kullanacaksiniz? (1-${#PROVIDERS[@]}) [1] " choice
choice="${choice:-1}"

if [[ "$choice" =~ ^[0-9]+$ ]] && [ "$choice" -ge 1 ] && [ "$choice" -le "${#PROVIDERS[@]}" ]; then
    idx=$((choice - 1))
else
    warn "Gecersiz secim, OpenAI kullanilacak"
    idx=0
fi

IFS='|' read -r sel_name sel_key sel_default <<< "${PROVIDERS[$idx]}"

echo ""
echo -e "  Secilen: ${CYAN}${sel_name}${RESET}"
echo ""

if [ "$sel_default" = "ollama" ]; then
    read -p "  Ollama sunucu adresi [http://localhost:11434]: " ollama_url
    ollama_url="${ollama_url:-http://localhost:11434}"

    set_env_value "$ENV_FILE" "OLLAMA_BASE_URL" "$ollama_url"
    set_env_value "$ENV_FILE" "DEFAULT_LLM_PROVIDER" "ollama"

    ok "Ollama yapilandirildi: $ollama_url"
else
    echo "  ${sel_key} degerini girin: (girdiniz gizli tutulacaktir)"
    read -s -p "  " api_key
    echo ""

    if [ -z "$api_key" ]; then
        warn "API anahtari bos birakildi. Kurulumdan sonra .env dosyasini el ile duzenleyin."
        echo -e "  ${CYAN}\$EDITOR .env${RESET}"
    else
        set_env_value "$ENV_FILE" "$sel_key" "$api_key"
        set_env_value "$ENV_FILE" "DEFAULT_LLM_PROVIDER" "$sel_default"

        MASKED="${api_key:0:8}..."
        ok "API anahtari kaydedildi (${sel_key}=${MASKED})"
    fi
fi

# -- Build -------------------------------------------------------------
echo ""
echo -e "${BOLD}[6/8] Proje derleniyor...${RESET}"

step "TypeScript + Frontend build (bu birkac dakika surebilir)..."
set +e
npm run build 2>&1 | tee /tmp/penceai_build.log
BUILD_EXIT=${PIPESTATUS[0]:-$?}
set -u
if [ "$BUILD_EXIT" -ne 0 ]; then
    err "Build basarisiz oldu (cikis kodu: $BUILD_EXIT)"
    echo ""
    cat /tmp/penceai_build.log
    echo ""
    echo "  Gelistirme modunda baslatmayi deneyebilirsiniz:"
    echo -e "  ${CYAN}npm run dev${RESET}"
    rm -f /tmp/penceai_build.log
    stop_with_pause "Kurulum durduruldu."
fi
grep -E "(error|Error|failed|Building|built|Compil|^\s*(src/|dist/))" /tmp/penceai_build.log || true
rm -f /tmp/penceai_build.log
ok "Build tamamlandi"

# -- Database directory ------------------------------------------------
echo ""
echo -e "${BOLD}[7/8] Veritabani dizini hazirlaniyor...${RESET}"

DB_DIR="$PROJECT_ROOT/data"
if [ ! -d "$DB_DIR" ]; then
    mkdir -p "$DB_DIR"
    ok "data/ dizini olusturuldu"
else
    ok "data/ dizini zaten mevcut"
fi

# -- Summary -----------------------------------------------------------
echo ""
echo -e "${BOLD}[8/8] Kurulum tamamlandi!${RESET}"
echo ""
echo "========================================"
echo ""
echo -e "${GREEN}${BOLD}  PenceAI hazir!${RESET}"
echo ""
echo "  Baslatmak icin:"
echo -e "    ${CYAN}npm start${RESET}              (Production modu)"
echo -e "    ${CYAN}npm run dev${RESET}             (Gelistirme modu, hot-reload)"
echo -e "    ${CYAN}./scripts/start.sh${RESET}       (Alternatif baslatma)"
echo ""
echo -e "  Dashboard: ${CYAN}http://localhost:3001${RESET}"
echo ""
echo "  Yapilandirmayi degistirmek icin:"
echo -e "    ${CYAN}\$EDITOR .env${RESET}"
echo ""
echo "========================================"
echo ""
echo -e "${YELLOW}Pencere kapanmasin diye bekleniyor...${RESET}"
read -rp "Cikmak icin Enter'a basin" _
