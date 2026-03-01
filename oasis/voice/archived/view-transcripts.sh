#!/bin/bash
# View voice transcripts from the curator workspace

TRANSCRIPT_DIR="$HOME/.openclaw/workspace-curator/transcripts/voice"

case "${1:-list}" in
  list)
    echo "=== All Voice Transcripts ==="
    find "$TRANSCRIPT_DIR" -name "*.json" -type f | sort
    echo ""
    echo "Total: $(find "$TRANSCRIPT_DIR" -name "*.json" -type f | wc -l | tr -d ' ') transcripts"
    ;;

  latest)
    LATEST=$(find "$TRANSCRIPT_DIR" -name "*.json" -type f | sort | tail -1)
    if [ -n "$LATEST" ]; then
      echo "=== Latest Transcript ==="
      echo "File: $LATEST"
      echo ""
      cat "$LATEST" | jq '.'
    else
      echo "No transcripts found"
    fi
    ;;

  today)
    TODAY=$(date +%Y/%m/%d)
    TODAY_DIR="$TRANSCRIPT_DIR/$TODAY"
    if [ -d "$TODAY_DIR" ]; then
      echo "=== Today's Transcripts ($TODAY) ==="
      find "$TODAY_DIR" -name "*.json" -type f | sort
      echo ""
      echo "Total today: $(find "$TODAY_DIR" -name "*.json" -type f | wc -l | tr -d ' ') transcripts"
    else
      echo "No transcripts for today yet"
    fi
    ;;

  watch)
    echo "=== Watching for new transcripts (Ctrl+C to stop) ==="
    watch -n 5 "find '$TRANSCRIPT_DIR' -name '*.json' -type f -mmin -10 | sort | tail -5"
    ;;

  *)
    echo "Usage: $0 {list|latest|today|watch}"
    echo ""
    echo "Commands:"
    echo "  list   - List all transcripts"
    echo "  latest - Show the most recent transcript"
    echo "  today  - Show today's transcripts"
    echo "  watch  - Watch for new transcripts (updates every 5 seconds)"
    exit 1
    ;;
esac
