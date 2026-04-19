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

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo ""
echo -e "${BOLD}========================================${RESET}"
echo -e "${BOLD}    PenceAI Kurulum Sihirbazi${RESET}"
echo -e "${BOLD}========================================${RESET}"
echo ""

# ── Node.js ──────────────────────────────────────────────────────
echo -e "${BOLD}[1/6] Node.js kontrol ediliyor...${RESET}"

if ! command -v node &>/dev/null; then
    err "Node.js bulunamadi!"
    echo ""
    echo "  Lutfen Node.js 22 veya uzerini kurun:"
    echo "  ${CYAN}https://nodejs.org/${RESET}"
    echo ""
    echo "  nvm kullaniyorsaniz:"
    echo "  nvm install 22 && nvm use 22"
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/^v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)

if [ "$NODE_MAJOR" -lt 22 ]; then
    err "Node.js $NODE_VERSION bulundu — 22.0.0 veya uzeri gerekiyor."
    echo ""
    echo "  Guncellemek icin:"
    echo "  ${CYAN}https://nodejs.org/${RESET}"
    exit 1
fi

ok "Node.js v${NODE_VERSION} bulundu"

# ── npm ───────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[2/6] Bağımlılıklar kuruluyor...${RESET}"

cd "$PROJECT_ROOT"

step "Root bağımlılıkları kuruluyor (bu birkas dakika surebilir)..."
if ! npm install --silent 2>/dev/null; then
    err "npm install basarisiz oldu. Yukaridaki hatalari kontrol edin."
    exit 1
fi
ok "Root bağımlılıkları"

step "Frontend bağımlılıkları kuruluyor..."
cd "$PROJECT_ROOT/src/web/react-app"
if ! npm install --silent 2>/dev/null; then
    err "Frontend npm install basarisiz oldu."
    exit 1
fi
cd "$PROJECT_ROOT"
ok "Frontend bağımlılıkları"

# ── .env ──────────────────────────────────────────────────────────
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

# ── API Key ──────────────────────────────────────────────────────
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

    if [[ "$(uname)" == "Darwin" ]]; then
        SED_INPLACE="sed -i ''"
    else
        SED_INPLACE="sed -i"
    fi

    $SED_INPLACE "s|^OLLAMA_BASE_URL=.*|OLLAMA_BASE_URL=${ollama_url}|" "$ENV_FILE"
    $SED_INPLACE "s|^DEFAULT_LLM_PROVIDER=.*|DEFAULT_LLM_PROVIDER=ollama|" "$ENV_FILE"

    ok "Ollama yapilandirildi: $ollama_url"
else
    read -p "  ${sel_key} degerini girin: " api_key

    if [ -z "$api_key" ]; then
        warn "API anahtari bos birakildi. Kurulumdan sonra .env dosyasini el ile duzenleyin."
        echo -e "  ${CYAN}\$EDITOR .env${RESET}"
    else
        if [[ "$(uname)" == "Darwin" ]]; then
            SED_INPLACE="sed -i ''"
        else
            SED_INPLACE="sed -i"
        fi

        $SED_INPLACE "s|^${sel_key}=.*|${sel_key}=${api_key}|" "$ENV_FILE"
        $SED_INPLACE "s|^DEFAULT_LLM_PROVIDER=.*|DEFAULT_LLM_PROVIDER=${sel_default}|" "$ENV_FILE"

        MASKED="${api_key:0:8}..."
        ok "API anahtari kaydedildi (${sel_key}=${MASKED})"
    fi
fi

# ── Build ─────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[5/6] Proje derleniyor...${RESET}"

step "TypeScript + Frontend build..."
if ! npm run build; then
    err "Build basarisiz oldu. Yukaridaki hatalari kontrol edin."
    echo ""
    echo "  Gelistirme modunda baslatmayi deneyebilirsiniz:"
    echo "  ${CYAN}npm run dev${RESET}"
    exit 1
fi
ok "Build tamamlandi"

# ── Summary ───────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[6/6] Kurulum tamamlandi!${RESET}"
echo ""
echo "========================================"
echo ""
echo -e "${GREEN}${BOLD}  PenceAI hazir!${RESET}"
echo ""
echo "  Baslatmak icin:"
echo "    ${CYAN}npm start${RESET}              (Production modu)"
echo "    ${CYAN}npm run dev${RESET}             (Gelistirme modu, hot-reload)"
echo "    ${CYAN}./scripts/start.sh${RESET}       (Alternatif baslatma)"
echo ""
echo "  Dashboard: ${CYAN}http://localhost:3001${RESET}"
echo ""
echo "  Yapilandirmayi degistirmek icin:"
echo "    ${CYAN}\$EDITOR .env${RESET}"
echo ""
echo "========================================"
echo ""