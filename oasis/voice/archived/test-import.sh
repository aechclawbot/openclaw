#!/bin/bash
# Quick test script for audio import system
# Tests validation, conversion, and processing on a small batch

set -e

echo "🧪 Audio Import Test Suite"
echo "=========================="
echo ""

# Activate venv
source ~/.openclaw/voice-venv/bin/activate

# Test 1: Dependency check
echo "Test 1: Checking dependencies..."
if ! command -v ffmpeg &> /dev/null; then
    echo "❌ ffmpeg not found"
    exit 1
fi
if ! command -v ffprobe &> /dev/null; then
    echo "❌ ffprobe not found"
    exit 1
fi
echo "✅ Dependencies OK"
echo ""

# Test 2: Validate script syntax
echo "Test 2: Validating Python syntax..."
python3 -m py_compile scripts/voice/import-audio.py
echo "✅ Syntax OK"
echo ""

# Test 3: Process 1 file with nice
echo "Test 3: Processing 1 file (this will take a few minutes)..."
echo "  - Running with nice level 15"
echo "  - Real-time progress enabled"
echo "  - Output: /tmp/audio-import-test-$(date +%s).log"
echo ""

nice -n 15 python -u scripts/voice/import-audio.py --max 1 --nice 5 2>&1 | tee "/tmp/audio-import-test-$(date +%s).log"

echo ""
echo "✅ Test complete!"
echo ""
echo "Check output files:"
echo "  - Transcripts: ~/.openclaw/workspace-curator/transcripts/voice/imported/"
echo "  - Logs: /tmp/audio-import-test-*.log"
