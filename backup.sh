#!/usr/bin/env bash
set -euo pipefail
TIMESTAMP=$(date +%F_%H%M%S)
# Compose が稼働している前提で sqlite のオンラインバックアップを作る
docker compose exec -T app sqlite3 /app/data.sqlite ".backup '/backup/instanttest-${TIMESTAMP}.sqlite'"
echo "Backup saved: ./backups/instanttest-${TIMESTAMP}.sqlite"
