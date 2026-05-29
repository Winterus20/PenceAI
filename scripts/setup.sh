#!/usr/bin/env bash
set -euo pipefail

CYAN='\033[36m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
BOLD='\033[1m'
GRAY='\033[90m'
DARKGRAY="$GRAY"
RESET='\033[0m'

# Global error trap: show error + pause, then exit
trap 'err "Beklenmeyen hata! Satir: $LINENO"; echo ""; echo -e "${YELLOW}Pencere kapanmasin diye bekleniyor...${RESET}"; read -rp "Cikmak icin Enter'\''a basin" _; exit 1' ERR

# Exit trap: always pause before closing (unless ERR trap already paused)
_EXIT_PAUSED=false
trap 'if [ "$_EXIT_PAUSED" = false ]; then echo -e "${YELLOW}Pencere kapanmasin diye bekleniyor...${RESET}"; read -rp "Cikmak icin Enter'\''a basin" _; fi' EXIT

step()  { echo -e "${CYAN}  ->${RESET} $1"; }
ok()    { echo -e "${GREEN}  OK${RESET} $1"; }
warn()  { echo -e "${YELLOW}  !!${RESET} $1"; }
err()   { echo -e "${RED}  XX${RESET} $1"; }

stop_with_pause() {
    err "$1"
    echo ""
    echo -e "${YELLOW}Pencere kapanmasin diye bekleniyor...${RESET}"
    read -rp "Cikmak icin Enter'a basin" _
    _EXIT_PAUSED=true
    exit 1
}

stream_output() {
    while IFS= read -r line || [ -n "$line" ]; do
        echo -e "${DARKGRAY}    $line${RESET}"
    done
}

read_from_clipboard() {
    if command -v pbpaste &>/dev/null; then
        pbpaste 2>/dev/null | tr -d '\r\n'
    elif command -v wl-paste &>/dev/null; then
        wl-paste -n 2>/dev/null
    elif command -v xclip &>/dev/null; then
        xclip -selection clipboard -o 2>/dev/null | tr -d '\r\n'
    else
        echo ""
    fi
}

read_setup_line() {
    local prompt="$1"
    local default="${2:-}"
    echo -e "  ${DARKGRAY}${prompt}${RESET}"
    if [ -n "$default" ]; then
        echo -e "  ${DARKGRAY}Yapistir + Enter — bos Enter = varsayilan (${default})${RESET}"
    else
        echo -e "  ${DARKGRAY}Yapistir + Enter — bos Enter = panodan otomatik oku${RESET}"
    fi
    read -r -p "  > " value
    value="${value//$'\r'/}"
    if [ -z "$value" ]; then
        if [ -n "$default" ]; then
            echo "$default"
            return
        fi
        value=$(read_from_clipboard)
    fi
    echo "$value" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

read_setup_secret() {
    local label="$1"
    echo -e "  ${DARKGRAY}${label}${RESET}"
    echo -e "  ${DARKGRAY}Yapistir + Enter — bos Enter = panodan otomatik oku (satir gorunur)${RESET}"
    read -r -p "  > " value
    value="${value//$'\r'/}"
    if [ -z "$value" ]; then
        value=$(read_from_clipboard)
    fi
    echo "$value" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

apply_env_updates_from_exports() {
    local tmp
    tmp=$(mktemp /tmp/penceai_env.XXXXXX.json)
    if ! python3 - "$tmp" <<'PY'
import json, os, sys
updates = {}
if p := os.environ.get("PENCE_PROVIDER"):
    updates["DEFAULT_LLM_PROVIDER"] = p
if m := os.environ.get("PENCE_MODEL"):
    updates["DEFAULT_LLM_MODEL"] = m
for k, v in os.environ.items():
    if k.startswith("PENCE_KV_") and v:
        updates[k[9:]] = v
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump(updates, f, ensure_ascii=False)
PY
    then
        rm -f "$tmp"
        stop_with_pause ".env JSON olusturulamadi."
    fi
    if ! (cd "$PROJECT_ROOT" && npx tsx scripts/setup-env.ts --file "$tmp" 2>&1 | stream_output); then
        rm -f "$tmp"
        stop_with_pause ".env guncellemesi basarisiz (secureUpdateEnv)."
    fi
    rm -f "$tmp"
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

test_port_available() {
    local port="$1"
    if command -v ss &>/dev/null; then
        if ss -tlnp 2>/dev/null | grep -q ":${port} "; then
            return 1
        fi
    elif command -v lsof &>/dev/null; then
        if lsof -i ":${port}" &>/dev/null; then
            return 1
        fi
    elif command -v nc &>/dev/null; then
        if nc -z localhost "$port" 2>/dev/null; then
            return 1
        fi
    fi
    return 0
}

get_process_on_port() {
    local port="$1"
    if command -v lsof &>/dev/null; then
        lsof -i ":${port}" -t 2>/dev/null | while read -r pid; do
            ps -p "$pid" -o comm= 2>/dev/null | while read -r name; do
                echo "$name (PID: $pid)"
            done
        done | tr '\n' ', ' | sed 's/,$//'
    elif command -v fuser &>/dev/null; then
        fuser "${port}/tcp" 2>/dev/null
    fi
}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo ""
echo -e "${BOLD}========================================${RESET}"
echo -e "${BOLD}    PenceAI Kurulum Sihirbazi${RESET}"
echo -e "${BOLD}========================================${RESET}"
echo ""
if [ "$EUID" -ne 0 ]; then
    warn "Script root (sudo) yetkisiyle calistirilmiyor."
    echo -e "${DARKGRAY}  Paket kurulumlarinda parolaniz sorulabilir veya yetki hatalari olusabilir.${RESET}"
    echo ""
fi

# -- Disk space --------------------------------------------------------
echo -e "${BOLD}[0/10] Disk alani kontrol ediliyor...${RESET}"
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
echo -e "${BOLD}[1/10] Sistem bagimliliklari kontrol ediliyor...${RESET}"

MISSING_CMDS=()
MISSING_NAMES=()

command -v gcc &>/dev/null  || { MISSING_CMDS+=("gcc"); MISSING_NAMES+=("gcc (C derleyici)"); }
command -v g++ &>/dev/null || { MISSING_CMDS+=("g++"); MISSING_NAMES+=("g++ (C++ derleyici)"); }
command -v make &>/dev/null || { MISSING_CMDS+=("make"); MISSING_NAMES+=("make (build araci)"); }
command -v python3 &>/dev/null || { MISSING_CMDS+=("python3"); MISSING_NAMES+=("python3"); }
command -v git &>/dev/null || { MISSING_CMDS+=("git"); MISSING_NAMES+=("git"); }
command -v curl &>/dev/null || { MISSING_CMDS+=("curl"); MISSING_NAMES+=("curl"); }

if [ ${#MISSING_CMDS[@]} -gt 0 ]; then
    echo ""
    warn "Asagidaki sistem paketleri eksik:"
    for dep in "${MISSING_NAMES[@]}"; do
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
            step "sudo apt-get install -y$PKGS"
            if sudo apt-get install -y $PKGS 2>&1 | stream_output; then
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
            step "sudo dnf install -y$PKGS"
            if sudo dnf install -y $PKGS 2>&1 | stream_output; then
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
            step "sudo yum install -y$PKGS"
            if sudo yum install -y $PKGS 2>&1 | stream_output; then
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
            if brew install $PKGS 2>&1 | stream_output; then
                ok "Sistem paketleri yuklendi"
            else
                err "Homebrew ile paket kurulumu basarisiz."
                stop_with_pause "Kurulum durduruldu."
            fi
        fi
    else
        err "Paket yoneticisi bulunamadi (apt/dnf/yum/brew)."
        echo "  Asagidaki paketleri manuel olarak kurun:"
        for dep in "${MISSING_NAMES[@]}"; do
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
echo -e "${BOLD}[2/10] Node.js kontrol ediliyor...${RESET}"

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
    elif [ "$NODE_MAJOR" -gt 22 ]; then
        warn "Node.js $NODE_VERSION bulundu - Node.js 22 LTS onerilir (bazı native modullerin prebuilt binary si yok)"
        echo ""
        read -rp "Node.js 22 LTS'ye gecmek ister misiniz? (e/H) " confirm_node
        if [ "$confirm_node" = "e" ] || [ "$confirm_node" = "E" ]; then
            NEEDS_UPGRADE=true
        else
            echo -e "  ${YELLOW}Mevcut Node.js v${NODE_VERSION} ile devam ediliyor.${RESET}"
        fi
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
            if bash /tmp/nodesource_setup.sh 2>&1 | stream_output && sudo apt-get install -y nodejs 2>&1 | stream_output; then
                INSTALLED=true
                ok "apt ile Node.js 22 yuklendi"
            fi
            rm -f /tmp/nodesource_setup.sh
        fi
    fi

    # Try Homebrew (macOS / Linux)
    if [ "$INSTALLED" = false ] && command -v brew &>/dev/null; then
        step "Homebrew ile yukleniyor..."
        if brew install node@22 2>&1 | stream_output; then
            INSTALLED=true
            ok "Homebrew ile Node.js 22 yuklendi"
        fi
    fi

    # Try yum/dnf (RHEL/CentOS/Fedora)
    if [ "$INSTALLED" = false ] && command -v dnf &>/dev/null; then
        step "dnf uzerinden yukleniyor..."
        if curl -fsSL https://rpm.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh 2>/dev/null; then
            if bash /tmp/nodesource_setup.sh 2>&1 | stream_output && sudo dnf install -y nodejs 2>&1 | stream_output; then
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
            if bash /tmp/nodesource_setup.sh 2>&1 | stream_output && sudo yum install -y nodejs 2>&1 | stream_output; then
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
echo -e "${BOLD}[3/10] Bagimliliklar kuruluyor...${RESET}"

cd "$PROJECT_ROOT"

step "Root bagimliliklari kuruluyor (bu birkac dakika surebilir)..."
NPM_ROOT_LOG=$(mktemp /tmp/penceai_npm_root.XXXXXX.log)
set +e
npm install 2>&1 | tee "$NPM_ROOT_LOG"
NPM_EXIT=${PIPESTATUS[0]}
set -e
if [ "$NPM_EXIT" -ne 0 ]; then
    err "npm install basarisiz oldu (cikis kodu: $NPM_EXIT)"
    echo ""
    cat "$NPM_ROOT_LOG"
    rm -f "$NPM_ROOT_LOG"
    stop_with_pause "Kurulum durduruldu."
fi
grep -E "^(npm warn|added|removed|changed|up to date|[0-9]+ package)" "$NPM_ROOT_LOG" || true
rm -f "$NPM_ROOT_LOG"
ok "Root bagimliliklari"

step "Frontend bagimliliklari kuruluyor..."
cd "$PROJECT_ROOT/src/web/react-app"
NPM_FRONT_LOG=$(mktemp /tmp/penceai_npm_front.XXXXXX.log)
set +e
npm install 2>&1 | tee "$NPM_FRONT_LOG"
NPM_EXIT=${PIPESTATUS[0]}
set -e
if [ "$NPM_EXIT" -ne 0 ]; then
    err "Frontend npm install basarisiz oldu (cikis kodu: $NPM_EXIT)"
    echo ""
    cat "$NPM_FRONT_LOG"
    rm -f "$NPM_FRONT_LOG"
    stop_with_pause "Kurulum durduruldu."
fi
grep -E "^(npm warn|added|removed|changed|up to date|[0-9]+ package)" "$NPM_FRONT_LOG" || true
rm -f "$NPM_FRONT_LOG"
cd "$PROJECT_ROOT"
ok "Frontend bagimliliklari"

# -- .env --------------------------------------------------------------
echo ""
echo -e "${BOLD}[4/10] .env dosyasi yapilandiriliyor...${RESET}"

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
echo -e "${BOLD}[5/10] LLM saglayici yapilandiriliyor${RESET}"
echo -e "${DARKGRAY}  (scripts/setup-providers.ts ile hizali)${RESET}"
echo ""

PROVIDERS=(
    "OpenAI (varsayilan)|OPENAI_API_KEY|openai|gpt-4o|apiKey"
    "Anthropic (Claude)|ANTHROPIC_API_KEY|anthropic|claude-sonnet-4-20250514|apiKey"
    "Groq|GROQ_API_KEY|groq|llama-3.3-70b-versatile|apiKey"
    "Mistral|MISTRAL_API_KEY|mistral|mistral-large-latest|apiKey"
    "MiniMax|MINIMAX_API_KEY|minimax|MiniMax-Text-01|apiKey"
    "NVIDIA|NVIDIA_API_KEY|nvidia|meta/llama-3.1-70b-instruct|apiKey"
    "GitHub Models|GITHUB_TOKEN|github|gpt-4o|apiKey"
    "OpenRouter|OPENROUTER_API_KEY|openrouter|openai/gpt-4o-mini|apiKey"
    "Custom OpenAI (LiteLLM vb.)|CUSTOM_OPENAI_API_KEY|custom||custom"
    "Ollama (yerel)|OLLAMA_BASE_URL|ollama|llama3.2|ollama"
)

for i in "${!PROVIDERS[@]}"; do
    IFS='|' read -r name key default _ <<< "${PROVIDERS[$i]}"
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

IFS='|' read -r sel_name sel_key sel_default sel_model sel_kind <<< "${PROVIDERS[$idx]}"

echo ""
echo -e "  Secilen: ${CYAN}${sel_name}${RESET}"
echo ""

export PENCE_PROVIDER="$sel_default"
unset PENCE_MODEL
for var in $(env | grep -E '^PENCE_KV_' | cut -d= -f1); do unset "$var"; done

if [ "$sel_kind" = "ollama" ]; then
    ollama_url=$(read_setup_line "Ollama sunucu adresi" "http://localhost:11434")
    export "PENCE_KV_OLLAMA_BASE_URL=$ollama_url"
    ok "Ollama yapilandirildi: $ollama_url"
elif [ "$sel_kind" = "custom" ]; then
    custom_base=$(read_setup_line "CUSTOM_OPENAI_BASE_URL (ornek: https://openrouter.ai/api/v1)")
    if [ -n "$custom_base" ]; then
        export "PENCE_KV_CUSTOM_OPENAI_BASE_URL=$custom_base"
    fi
    api_key=$(read_setup_secret "CUSTOM_OPENAI_API_KEY (bos birakilabilir)")
    if [ -n "$api_key" ]; then
        export "PENCE_KV_CUSTOM_OPENAI_API_KEY=$api_key"
        MASKED="${api_key:0:8}..."
        ok "API anahtari kaydedildi (CUSTOM_OPENAI_API_KEY=${MASKED})"
    else
        warn "API anahtari bos birakildi."
    fi
    sel_model="ornek-model-adi"
else
    api_key=$(read_setup_secret "${sel_key} degerini girin")
    if [ -z "$api_key" ]; then
        warn "API anahtari bos birakildi. Kurulumdan sonra .env dosyasini el ile duzenleyin."
        echo -e "  ${CYAN}\$EDITOR .env${RESET}"
    else
        export "PENCE_KV_${sel_key}=$api_key"
        MASKED="${api_key:0:8}..."
        ok "API anahtari kaydedildi (${sel_key}=${MASKED})"
    fi
fi

model_hint="$sel_model"
model_input=$(read_setup_line "Model adi (DEFAULT_LLM_MODEL)" "$model_hint")
if [ -n "$model_input" ]; then
    export PENCE_MODEL="$model_input"
    ok "Model: $model_input"
fi

apply_env_updates_from_exports
unset PENCE_PROVIDER PENCE_MODEL
for var in $(env | grep -E '^PENCE_KV_' | cut -d= -f1); do unset "$var"; done

# -- Build -------------------------------------------------------------
echo ""
echo -e "${BOLD}[6/10] Proje derleniyor...${RESET}"

step "TypeScript + Frontend build (bu birkac dakika surebilir)..."
BUILD_LOG=$(mktemp /tmp/penceai_build.XXXXXX.log)
set +e
npm run build 2>&1 | tee "$BUILD_LOG"
BUILD_EXIT=${PIPESTATUS[0]}
set -e
if [ "$BUILD_EXIT" -ne 0 ]; then
    err "Build basarisiz oldu (cikis kodu: $BUILD_EXIT)"
    echo ""
    cat "$BUILD_LOG"
    echo ""
    echo "  Gelistirme modunda baslatmayi deneyebilirsiniz:"
    echo -e "  ${CYAN}npm run dev${RESET}"
    rm -f "$BUILD_LOG"
    stop_with_pause "Kurulum durduruldu."
fi
grep -E "(error|Error|failed|Building|built|Compil|^\s*(src/|dist/))" "$BUILD_LOG" || true
rm -f "$BUILD_LOG"
ok "Build tamamlandi"

# -- Database directory ------------------------------------------------
echo ""
echo -e "${BOLD}[7/10] Veritabani dizini hazirlaniyor...${RESET}"

DB_DIR="$PROJECT_ROOT/data"
if [ ! -d "$DB_DIR" ]; then
    mkdir -p "$DB_DIR"
    ok "data/ dizini olusturuldu"
else
    ok "data/ dizini zaten mevcut"
fi

# -- Port check --------------------------------------------------------
echo ""
echo -e "${BOLD}[8/10] Port kontrolu yapiliyor...${RESET}"

CONFIG_PORT=3001
env_port_line=$(grep -E "^PORT=" "$ENV_FILE" 2>/dev/null || true)
if [ -n "$env_port_line" ]; then
    CONFIG_PORT="$(echo "${env_port_line#PORT=}" | tr -d '[:space:]')"
fi

if ! test_port_available "$CONFIG_PORT"; then
    proc_info=$(get_process_on_port "$CONFIG_PORT")
    if [ -n "$proc_info" ]; then
        warn "Port $CONFIG_PORT zaten kullaniliyor: $proc_info"
    else
        warn "Port $CONFIG_PORT zaten kullaniliyor"
    fi
    echo ""
    read -rp "Bu sureci kapatip devam etmek istiyor musunuz? (e/H) " confirm_port
    if [ "$confirm_port" = "e" ] || [ "$confirm_port" = "E" ]; then
        if command -v lsof &>/dev/null; then
            lsof -i ":${CONFIG_PORT}" -t 2>/dev/null | while read -r pid; do
                kill -9 "$pid" 2>/dev/null || warn "PID $pid kapatilamadi (Yetkisiz erisim). Lutfen manuel kapatin."
            done
        elif command -v fuser &>/dev/null; then
            fuser -k "${CONFIG_PORT}/tcp" 2>/dev/null || warn "Port $CONFIG_PORT kapatilamadi. Lutfen manuel kapatin."
        fi
        sleep 2
        if ! test_port_available "$CONFIG_PORT"; then
            stop_with_pause "Port $CONFIG_PORT hala kullaniliyor. Manuel olarak kapatip tekrar deneyin."
        fi
        ok "Port $CONFIG_PORT serbest birakildi"
    else
        stop_with_pause "Port $CONFIG_PORT kullaniliyor. Baska bir port ayarlayin veya mevcut sureci kapatip tekrar deneyin."
    fi
else
    ok "Port $CONFIG_PORT musait"
fi

# -- Verification ------------------------------------------------------
echo ""
echo -e "${BOLD}[9/10] Kurulum dogrulaniyor...${RESET}"

read -rp "LLM API baglantisi test edilsin mi? (e/H) " test_llm
verify_args=()
if [ "$test_llm" = "e" ] || [ "$test_llm" = "E" ]; then
    verify_args=()
else
    verify_args=(--skip-llm)
fi

set +e
verify_output=$(cd "$PROJECT_ROOT" && npx tsx scripts/setup-verify.ts "${verify_args[@]}" 2>&1)
verify_exit=$?
set -e
while IFS= read -r line; do
    [ -z "$line" ] && continue
    if [[ "$line" == OK* ]]; then ok "$line"
    elif [[ "$line" == WARN* ]]; then warn "${line#WARN }"
    elif [[ "$line" == ERR* ]]; then err "${line#ERR }"
    else echo -e "${DARKGRAY}  $line${RESET}"
    fi
done <<< "$verify_output"
if [ "$verify_exit" -ne 0 ]; then
    warn "Dogrulama tamamlanamadi — .env ve API anahtarini kontrol edip tekrar deneyin:"
    echo -e "  ${CYAN}npx tsx scripts/setup-verify.ts${RESET}"
fi

# -- Summary -----------------------------------------------------------
echo ""
echo -e "${BOLD}[10/10] Kurulum tamamlandi!${RESET}"
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
echo -e "  Dashboard: ${CYAN}http://localhost:${CONFIG_PORT}${RESET}"
echo ""
echo "  Yapilandirmayi degistirmek icin:"
echo -e "    ${CYAN}\$EDITOR .env${RESET}"
echo ""
echo "========================================"
echo ""
