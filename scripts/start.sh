#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

CYAN='\033[36m'
RED='\033[31m'
YELLOW='\033[33m'
RESET='\033[0m'

stop_with_pause() {
    echo -e "${RED}Hata:${RESET} $1"
    echo ""
    echo -e "${YELLOW}Pencere kapanmasin diye bekleniyor...${RESET}"
    read -rp "Cikmak icin Enter'a basin" _
    exit 1
}

if [ ! -f "$PROJECT_ROOT/.env" ]; then
    stop_with_pause ".env dosyasi bulunamadi. Once kuruluma ihtiyaciniz var: ./scripts/setup.sh"
fi

if [ ! -f "$PROJECT_ROOT/dist/gateway/index.js" ]; then
    stop_with_pause "Build bulunamadi (dist/gateway/index.js). Once: npm run build veya ./scripts/setup.sh"
fi

cd "$PROJECT_ROOT"
node dist/gateway/index.js