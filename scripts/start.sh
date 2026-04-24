#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

CYAN='\033[36m'
RED='\033[31m'
YELLOW='\033[33m'
GREEN='\033[32m'
GRAY='\033[90m'
DARKGRAY='\033[2m'
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

# -- Pre-flight checks -------------------------------------------------
echo ""
echo -e "${CYAN}PenceAI baslatiliyor...${RESET}"
echo -e "${GRAY}Proje dizini: ${PROJECT_ROOT}${RESET}"
echo ""

# 1) .env check
step ".env dosyasi kontrol ediliyor..."
if [ ! -f "$PROJECT_ROOT/.env" ]; then
    stop_with_pause ".env dosyasi bulunamadi. Once kuruluma ihtiyaciniz var: ./scripts/setup.sh"
fi
ok ".env dosyasi mevcut"

# 2) node_modules check
step "node_modules kontrol ediliyor..."
if [ ! -d "$PROJECT_ROOT/node_modules" ]; then
    stop_with_pause "node_modules bulunamadi. Once: npm install veya ./scripts/setup.sh"
fi
ok "node_modules mevcut"

# 3) Build check
step "Build dosyalari kontrol ediliyor..."
if [ ! -f "$PROJECT_ROOT/dist/gateway/index.js" ]; then
    stop_with_pause "Build bulunamadi (dist/gateway/index.js). Once: npm run build veya ./scripts/setup.sh"
fi
ok "Build dosyalari mevcut"

# 4) Port check
CONFIG_PORT=3001
env_port_line=$(grep -E "^PORT=" "$PROJECT_ROOT/.env" 2>/dev/null || true)
if [ -n "$env_port_line" ]; then
    CONFIG_PORT="$(echo "${env_port_line#PORT=}" | tr -d '[:space:]')"
fi

step "Port $CONFIG_PORT kontrol ediliyor..."
if ! test_port_available "$CONFIG_PORT"; then
    proc_info=$(get_process_on_port "$CONFIG_PORT")
    if [ -n "$proc_info" ]; then
        warn "Port $CONFIG_PORT zaten kullaniliyor: $proc_info"
    else
        warn "Port $CONFIG_PORT zaten kullaniliyor"
    fi
    echo ""
    read -rp "Bu sureci kapatip devam etmek istiyor musunuz? (e/H) " confirm
    if [ "$confirm" = "e" ] || [ "$confirm" = "E" ]; then
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

# -- Launch ------------------------------------------------------------
cd "$PROJECT_ROOT"
echo ""
echo -e "${GRAY}Sunucu baslatiliyor (Port: $CONFIG_PORT)...${RESET}"
echo -e "${DARKGRAY}Durdurmak icin Ctrl+C basin${RESET}"
echo ""

# Trap for graceful shutdown message
cleanup() {
    echo ""
    echo -e "${YELLOW}PenceAI durduruldu.${RESET}"
    echo -e "${DARKGRAY}Cikis kodu: $EXIT_CODE${RESET}"
    echo ""
}
trap 'EXIT_CODE=$?; cleanup' EXIT

open_browser() {
    local url="http://localhost:$CONFIG_PORT"
    # Wait a moment for server to actually bind
    sleep 2
    echo -e "${CYAN}Tarayici aciliyor: $url${RESET}"
    if command -v xdg-open &> /dev/null; then
        xdg-open "$url" &> /dev/null
    elif command -v open &> /dev/null; then
        open "$url" &> /dev/null
    elif command -v start &> /dev/null; then
        start "$url" &> /dev/null
    fi
}

# Run browser opener in background
open_browser &

node dist/gateway/index.js
EXIT_CODE=$?
