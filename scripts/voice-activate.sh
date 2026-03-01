#!/bin/bash
# Quick activation script for OpenClaw Voice System

# Activate virtual environment
source ~/.openclaw/voice-venv/bin/activate

# Pull HF_TOKEN from macOS Keychain (same pattern as oasis-up.sh)
if [ -z "$HF_TOKEN" ]; then
    HF_TOKEN=$(security find-generic-password -s openclaw -a HF_TOKEN -w 2>/dev/null) || true
    if [ -n "$HF_TOKEN" ]; then
        export HF_TOKEN
        echo "  HF_TOKEN loaded from Keychain"
    else
        echo "⚠️  HF_TOKEN not found in Keychain!"
        echo ""
        echo "Store it with:"
        echo "  security add-generic-password -U -s openclaw -a HF_TOKEN -w 'hf_your_token_here'"
        echo ""
        echo "Get token from: https://huggingface.co/settings/tokens"
        echo "Accept license: https://huggingface.co/pyannote/speaker-diarization-3.1"
        echo ""
    fi
fi

# Change to openclaw directory
cd ~/openclaw

echo "✅ OpenClaw Voice System Activated"
echo ""
echo "Available commands:"
echo "  python scripts/voice/enroll_speaker.py <name>  - Enroll a speaker"
echo "  python scripts/voice/listen.py                - Start listening"
echo ""
echo "Current directory: $(pwd)"
echo "Python: $(python --version)"
echo "Virtual env: $(which python)"
