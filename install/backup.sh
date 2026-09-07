#!/usr/bin/env bash
#
# Back up and restore a forinda-cms install.
#
#   ./backup.sh                      write backups/forinda-cms-<timestamp>.sql.gz
#   ./backup.sh restore <file>       restore one
#
# ADR 0011 says export always works, including while suspended, and is never
# paywalled — "we never hold data hostage". This is that promise for a
# self-hoster: one command, no account, no export queue, and the result is a
# plain `pg_dump` that any Postgres can read.
#
# It captures everything that matters: the spec, its whole patch history, and
# the content. Uploaded media is not in Postgres — once the asset store exists
# (ADR 0010), back its bucket up alongside this.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Read from .env so this needs no arguments and cannot drift from compose.
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

DB_USER="${POSTGRES_USER:-forinda}"
DB_NAME="${POSTGRES_DB:-forinda_cms}"
SERVICE="${POSTGRES_SERVICE:-postgres}"
DIR="${BACKUP_DIR:-./backups}"

compose() { docker compose "$@"; }

if [[ "${1:-}" == "restore" ]]; then
  FILE="${2:-}"
  [[ -f "$FILE" ]] || { echo "usage: ./backup.sh restore <file.sql.gz>" >&2; exit 1; }

  # Restoring replaces everything. Asking is the difference between a recovery
  # and an accident — and this is the one command here that can lose data.
  echo "This will REPLACE the contents of database '$DB_NAME'."
  read -r -p "Type the database name to confirm: " typed
  [[ "$typed" == "$DB_NAME" ]] || { echo "aborted." >&2; exit 1; }

  echo "==> stopping the app so nothing writes mid-restore"
  compose stop app >/dev/null

  echo "==> restoring $FILE"
  gunzip -c "$FILE" | compose exec -T "$SERVICE" psql -U "$DB_USER" -d "$DB_NAME" --quiet

  echo "==> starting the app"
  compose start app >/dev/null
  echo "restored."
  exit 0
fi

mkdir -p "$DIR"
OUT="$DIR/forinda-cms-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"

echo "==> dumping $DB_NAME"
# `--clean --if-exists` so the dump restores over an existing database without
# needing it dropped first, which is the situation a restore is usually in.
compose exec -T "$SERVICE" pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists \
  | gzip > "$OUT"

echo "$OUT"
du -h "$OUT" | cut -f1 | sed 's/^/    /'
