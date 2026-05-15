#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required"
  exit 1
fi

if [[ $# -ne 1 ]]; then
  echo "Usage: ./scripts/restore-db.sh <backup.sql.gz>"
  exit 1
fi

IN="$1"
if [[ ! -f "$IN" ]]; then
  echo "Backup file not found: $IN"
  exit 1
fi

gunzip -c "$IN" | psql "$DATABASE_URL"
echo "Restore completed from $IN"
