#!/bin/bash
# check-single-process.sh - Verify exactly one bot process is running
# Fails loudly if duplicate processes exist

set -e

echo "=== check-single-process.sh ==="
echo "Checking for duplicate pi-matrix-agent processes..."

# Count matching processes (excluding grep and bash wrappers)
# Matches both: node dist/index.js and /usr/bin/node .../dist/index.js
PROCESS_COUNT=$(ps aux | grep "dist/index.js" | grep -v grep | grep -v "bash -c" | wc -l)

echo "Found $PROCESS_COUNT matching process(es)"

if [ "$PROCESS_COUNT" -eq 0 ]; then
    echo "⚠ WARNING: No pi-matrix-agent process found!"
    echo "   The bot is not running."
    exit 1
fi

if [ "$PROCESS_COUNT" -eq 1 ]; then
    echo "✓ Exactly one process running (CORRECT)"
    echo ""
    echo "Process details:"
    ps aux | grep "dist/index.js" | grep -v grep
    exit 0
fi

# More than one process
if [ "$PROCESS_COUNT" -gt 1 ]; then
    echo ""
    echo "✗ ERROR: $PROCESS_COUNT processes found! Expected exactly 1."
    echo ""
    echo "Duplicate processes can cause:"
    echo "  - Session state confusion"
    echo "  - Duplicate session creation"
    echo "  - Unpredictable behavior"
    echo ""
    echo "Offending processes:"
    ps aux | grep "dist/index.js" | grep -v grep
    echo ""
    echo "To fix:"
    echo "  1. Kill extra processes: pkill -f 'dist/index.js'"
    echo "  2. Restart via proper entrypoint (systemd or managed script)"
    echo ""
    exit 1
fi
