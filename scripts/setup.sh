#!/usr/bin/env bash
set -euo pipefail

CYAN='\033[36m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
BOLD='\033[1m'
RESET='\033[0m'

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
    local tmp="${file}.tmp.$$"
    while IFS= read -r line || [ -n "$line" ]; do
        if [[ "$line" == "${key}="* ]]; then
            echo "${key}=${value}"
        else
            echo "$line"
        fi
    done < "$file" > "$tmp"
    mv "$tmp" "$file"
}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo ""
echo -e "${BOLD}========================================${RESET}"
echo -e "${BOLD}    PenceAI Kurulum Sihirbazi${RESET}"
echo -e "${BOLD}========================================${RESET}"
echo ""

# -- Node.js -----------------------------------------------------------
echo -e "${BOLD}[1/6] Node.js kontrol ediliyor...${RESET}"

if ! command -v node &>/dev/null; then
    err "Node.js bulunamadi!"
    echo ""
    echo "  Lutfen Node.js 22 veya uzerini kurun:"
    echo -e "  ${CYAN}https://nodejs.org/${RESET}"
    echo ""
    echo "  nvm kullaniyorsaniz:"
    echo "  nvm install 22 && nvm use 22"
    stop_with_pause "Kurulum durduruldu."
fi

NODE_VERSION=$(node -v | sed 's/^v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)

if [ "$NODE_MAJOR" -lt 22 ]; then
    err "Node.js $NODE_VERSION bulundu - 22.0.0 veya uzeri gerekiyor."
    echo ""
    echo "  Guncellemek icin:"
    echo -e "  ${CYAN}https://nodejs.org/${RESET}"
    stop_with_pause "Kurulum durduruldu."
fi

ok "Node.js v${NODE_VERSION} bulundu"

# -- npm ---------------------------------------------------------------
echo ""
echo -e "${BOLD}[2/6] Bagimliliklar kuruluyor...${RESET}"

cd "$PROJECT_ROOT"

step "Root bagimliliklari kuruluyor (bu birkac dakika surebilir)..."
if ! npm install 2>&1 | tail -5; then
    err "npm install basarisiz oldu."
    stop_with_pause "Kurulum durduruldu."
fi
ok "Root bagimliliklari"

step "Frontend bagimliliklari kuruluyor..."
cd "$PROJECT_ROOT/src/web/react-app"
if ! npm install 2>&1 | tail -5; then
    err "Frontend npm install basarisiz oldu."
    stop_with_pause "Kurulum durduruldu."
fi
cd "$PROJECT_ROOT"
ok "Frontend bagimliliklari"

# -- .env --------------------------------------------------------------
echo ""
echo -e "${BOLD}[3/6] .env dosyasi yapilandiriliyor...${RESET}"

ENV_FILE="$PROJECT_ROOT/.env"
ENV_EXAMPLE="$PROJECT_ROOT/.env.example"

if [ ! -f "$ENV_FILE" ]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    ok ".env.example -> .env kopyalandi"
else
    warn ".env dosyasi zaten mevcut, mevcut dosya korunuyor"
fi

# -- API Key -----------------------------------------------------------
echo ""
echo -e "${BOLD}[4/6] LLM API anahtari yapilandiriliyor${RESET}"
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
echo -e "${BOLD}[5/6] Proje derleniyor...${RESET}"

step "TypeScript + Frontend build (bu birkac dakika surebilir)..."
if ! npm run build; then
    err "Build basarisiz oldu. Yukaridaki hatalari kontrol edin."
    echo ""
    echo "  Gelistirme modunda baslatmayi deneyebilirsiniz:"
    echo -e "  ${CYAN}npm run dev${RESET}"
    stop_with_pause "Kurulum durduruldu."
fi
ok "Build tamamlandi"

# -- Summary -----------------------------------------------------------
echo ""
echo -e "${BOLD}[6/6] Kurulum tamamlandi!${RESET}"
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