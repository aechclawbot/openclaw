#!/bin/bash
# Check for new speaker candidates and send Telegram notification

OPENCLAW_DIR="$HOME/.openclaw"
CANDIDATES_DIR="$OPENCLAW_DIR/unknown-speakers/candidates"
NOTIFIED_FILE="$OPENCLAW_DIR/.speaker-candidates-notified"

# Count pending candidates
PENDING=$(find "$CANDIDATES_DIR" -name "*.json" -type f -exec jq -r 'select(.status=="pending_review") | .speaker_id' {} \; 2>/dev/null | wc -l | tr -d ' ')

if [ "$PENDING" -eq 0 ]; then
    exit 0
fi

# Check if we've already notified
if [ -f "$NOTIFIED_FILE" ]; then
    LAST_NOTIFIED=$(cat "$NOTIFIED_FILE")
    if [ "$LAST_NOTIFIED" = "$PENDING" ]; then
        # Same count, already notified
        exit 0
    fi
fi

# New candidates detected - send notification
MESSAGE="🎤 New Speaker Detected!

Found $PENDING unknown speaker(s) with enough samples to create profiles.

Review and assign names:
  cd ~/openclaw
  source ~/.openclaw/voice-venv/bin/activate
  python scripts/voice/review_candidates.py"

# Send to Telegram via OpenClaw
TELEGRAM_CHAT_ID="${MASTER_TELEGRAM_USER_ID:-7955595068}"

curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -H "Content-Type: application/json" \
    -d "{\"chat_id\": \"$TELEGRAM_CHAT_ID\", \"text\": \"$MESSAGE\"}" \
    > /dev/null 2>&1

# Update notified count
echo "$PENDING" > "$NOTIFIED_FILE"

echo "Notification sent: $PENDING new candidate(s)"
