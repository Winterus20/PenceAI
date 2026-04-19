#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

CYAN='\033[36m'
RED='\033[31m'
RESET='\033[0m'

if [ ! -f "$PROJECT_ROOT/.env" ]; then
    echo -e "${RED}Hata:${RESET} .env dosyasi bulunamadi."
    echo "Once kuruluma ihtiyaciniz var:"
    echo -e "  ${CYAN}./scripts/setup.sh${RESET}"
    exit 1
fi

if [ ! -f "$PROJECT_ROOT/dist/gateway/index.js" ]; then
    echo -e "${RED}Hata:${RESET} Build bulunamadi (dist/gateway/index.js)."
    echo "Once build yapin:"
    echo -e "  ${CYAN}npm run build${RESET}"
    echo ""
    echo "Veya kurulum script'ini calistirin:"
    echo -e "  ${CYAN}./scripts/setup.sh${RESET}"
    exit 1
fi

cd "$PROJECT_ROOT"
node dist/gateway/index.js