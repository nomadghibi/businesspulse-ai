#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required"
  exit 1
fi

mkdir -p ./backups
STAMP="$(date +%Y%m%d_%H%M%S)"
OUT="./backups/businesspulse_${STAMP}.sql.gz"

pg_dump "$DATABASE_URL" | gzip > "$OUT"
echo "Backup written to $OUT"
