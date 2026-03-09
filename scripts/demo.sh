#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
npx tsx scripts/demo.ts "$@"
