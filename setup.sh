#!/usr/bin/env bash
#
# AI Operations OS — One-command setup
#
# Usage:
#   ./setup.sh           # install, build, seed, start
#   ./setup.sh --reset   # wipe DB first, then install/build/seed/start
#

set -e

# ── Colors ───────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║     AI Operations OS — Setup             ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════╝${RESET}"
echo ""

# ── Check Node.js ────────────────────────────────────────────
if ! command -v node &> /dev/null; then
  echo -e "${RED}Error:${RESET} Node.js is not installed."
  echo "  Install Node.js 18+ from https://nodejs.org"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo -e "${RED}Error:${RESET} Node.js 18+ required. You have $(node -v)."
  exit 1
fi

echo -e "${GREEN}✓${RESET} Node.js $(node -v)"

# ── Install ──────────────────────────────────────────────────
echo -e "\n${CYAN}[1/4]${RESET} Installing dependencies..."
npm install --silent 2>&1 | tail -1
echo -e "${GREEN}✓${RESET} Dependencies installed"

# ── Environment ──────────────────────────────────────────────
if [ ! -f .env ]; then
  cp .env.example .env
  echo -e "${GREEN}✓${RESET} Created .env from .env.example"
else
  echo -e "${DIM}✓ .env already exists${RESET}"
fi

# ── Build ────────────────────────────────────────────────────
echo -e "\n${CYAN}[2/4]${RESET} Building all packages..."
npm run build --silent 2>&1 | tail -1
echo -e "${GREEN}✓${RESET} 12 packages built"

# ── Seed ─────────────────────────────────────────────────────
echo -e "\n${CYAN}[3/4]${RESET} Seeding demo data..."
if [[ "$*" == *"--reset"* ]]; then
  npx tsx scripts/seed.ts --reset 2>&1 | grep -v "^$"
else
  npx tsx scripts/seed.ts 2>&1 | grep -v "^$"
fi
echo -e "${GREEN}✓${RESET} Database seeded"

# ── Read port from .env ────────────────────────────────────────
PORT=$(grep -E '^OPS_PORT=' .env 2>/dev/null | cut -d= -f2 | tr -d ' ')
PORT=${PORT:-3100}

# ── Check for port conflicts ──────────────────────────────────
if lsof -ti:$PORT &>/dev/null; then
  EXISTING_PID=$(lsof -ti:$PORT | head -1)
  echo -e "${YELLOW}⚠${RESET}  Port ${BOLD}$PORT${RESET} is already in use (PID $EXISTING_PID)."
  echo ""
  echo -e "  Options:"
  echo -e "    ${BOLD}1)${RESET} Kill the existing process and continue"
  echo -e "    ${BOLD}2)${RESET} Use a different port"
  echo -e "    ${BOLD}3)${RESET} Abort"
  echo ""
  read -rp "  Choose [1/2/3]: " choice
  case $choice in
    1)
      echo -e "  Stopping process $EXISTING_PID..."
      kill $EXISTING_PID 2>/dev/null
      sleep 1
      # Force kill if still running
      if lsof -ti:$PORT &>/dev/null; then
        kill -9 $(lsof -ti:$PORT) 2>/dev/null
        sleep 1
      fi
      echo -e "  ${GREEN}✓${RESET} Port $PORT freed"
      ;;
    2)
      read -rp "  Enter port number: " NEW_PORT
      if [[ -z "$NEW_PORT" ]]; then
        echo -e "  ${RED}Error:${RESET} No port entered. Aborting."
        exit 1
      fi
      # Update .env
      if grep -q '^OPS_PORT=' .env 2>/dev/null; then
        sed -i '' "s/^OPS_PORT=.*/OPS_PORT=$NEW_PORT/" .env
      else
        echo "OPS_PORT=$NEW_PORT" >> .env
      fi
      PORT=$NEW_PORT
      echo -e "  ${GREEN}✓${RESET} Updated .env to use port $PORT"
      ;;
    *)
      echo -e "  Aborted."
      exit 0
      ;;
  esac
  echo ""
fi

# ── Start ────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}[4/4]${RESET} Starting server..."
echo ""
echo -e "${BOLD}${GREEN}══════════════════════════════════════════${RESET}"
echo -e "${BOLD}  Dashboard:  ${CYAN}http://localhost:$PORT${RESET}"
echo -e "${BOLD}  API:        ${CYAN}http://localhost:$PORT/api${RESET}"
echo -e "${BOLD}  SPARK:      ${CYAN}http://localhost:$PORT/api/spark/awareness${RESET}"
echo -e "${BOLD}${GREEN}══════════════════════════════════════════${RESET}"
echo ""
echo -e "${DIM}Press Ctrl+C to stop${RESET}"
echo ""

cd apps/ops-api && npm start
