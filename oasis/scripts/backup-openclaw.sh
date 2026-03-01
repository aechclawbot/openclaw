#!/usr/bin/env bash
# Backs up ~/.openclaw to a timestamped tarball synced via Google Drive.
# Usage: ./backup-openclaw.sh [backup_dir]
#
# Cron (daily at 3am):
#   0 3 * * * /Users/oasis/openclaw/backup-openclaw.sh >> /tmp/openclaw-backup.log 2>&1

set -euo pipefail

OPENCLAW_DIR="${HOME}/.openclaw"
BACKUP_DIR="${1:-/Users/oasis/Library/CloudStorage/GoogleDrive-aech.clawbot@gmail.com/.shortcut-targets-by-id/1XPKf8bAq0qbOL7AmAPspViT82YUf_h8V/The Oasis - Personal AI Agent Framework/Oasis-Backups}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/openclaw-backup-${TIMESTAMP}.tar.gz"
MAX_BACKUPS=7

# Verify Google Drive is mounted
if [ ! -d "${BACKUP_DIR}" ]; then
  echo "[$(date)] ERROR: Backup dir not found (Google Drive not mounted?): ${BACKUP_DIR}" >&2
  exit 1
fi

tar -czf "${BACKUP_FILE}" \
  --exclude '*.DS_Store' \
  --exclude '*.jsonl.deleted.*' \
  --exclude 'node_modules' \
  -C "$(dirname "${OPENCLAW_DIR}")" \
  "$(basename "${OPENCLAW_DIR}")"

echo "[$(date)] Backup created: ${BACKUP_FILE} ($(du -h "${BACKUP_FILE}" | cut -f1))"

# Prune old backups, keep most recent MAX_BACKUPS
ls -1t "${BACKUP_DIR}"/openclaw-backup-*.tar.gz 2>/dev/null | tail -n +$((MAX_BACKUPS + 1)) | while read -r old; do
  rm -f "${old}"
  echo "[$(date)] Pruned old backup: ${old}"
done
