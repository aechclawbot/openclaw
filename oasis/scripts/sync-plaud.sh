#!/bin/bash
SOURCE="/Users/oasis/Library/CloudStorage/GoogleDrive-aech.clawbot@gmail.com/My Drive/The Oasis - Personal AI Agent Framework/00_The_Library/Plaud Transcripts"
DEST="$HOME/.openclaw/workspace-curator/transcripts/raw"

rsync -av --ignore-existing "$SOURCE/" "$DEST/"
