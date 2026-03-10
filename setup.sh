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

# ── Start ────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}[4/4]${RESET} Starting server..."
echo ""
echo -e "${BOLD}${GREEN}══════════════════════════════════════════${RESET}"
echo -e "${BOLD}  Dashboard:  ${CYAN}http://localhost:3100${RESET}"
echo -e "${BOLD}  API:        ${CYAN}http://localhost:3100/api${RESET}"
echo -e "${BOLD}  SPARK:      ${CYAN}http://localhost:3100/api/spark/awareness${RESET}"
echo -e "${BOLD}${GREEN}══════════════════════════════════════════${RESET}"
echo ""
echo -e "${DIM}Press Ctrl+C to stop${RESET}"
echo ""

cd apps/ops-api && npm start
