#!/bin/bash
#
# Canonical startup script for pi-matrix-agent
#
# Usage:
#   ./scripts/run-bot.sh                    # Use defaults from config.json
#   ./scripts/run-bot.sh <config.json>      # Use specific config file
#   CONTROL_PUBLIC_URL=... ./scripts/run-bot.sh  # Override env vars
#
# Environment variables (can be set before running):
#   CONFIG_FILE       - Path to config.json (default: ./config.json)
#   CONTROL_PUBLIC_URL - Public URL for !control command (Tailscale Serve URL)
#   CONTROL_PORT      - Control server port (default: 9000)
#   CONTROL_HOST      - Control server bind host (default: 127.0.0.1)
#

set -e

# Resolve repo root (this script is in scripts/)
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Default config file
CONFIG_FILE="${CONFIG_FILE:-./config.json}"

# Allow overriding config file via argument
if [ -n "$1" ]; then
    CONFIG_FILE="$1"
fi

# Check if config file exists
if [ ! -f "$CONFIG_FILE" ]; then
    echo "ERROR: Config file not found: $CONFIG_FILE"
    echo "Usage: $0 [config.json]"
    echo ""
    echo "Environment variables:"
    echo "  CONFIG_FILE       - Path to config.json"
    echo "  CONTROL_PUBLIC_URL - Public URL for !control command"
    echo "  CONTROL_PORT      - Control server port (default: 9000)"
    echo "  CONTROL_HOST      - Control server bind host (default: 127.0.0.1)"
    exit 1
fi

# Export config file path
export CONFIG_FILE

# Print startup banner
echo ""
echo "=========================================================="
echo "           PI-MATRIX-AGENT STARTUP"
echo "=========================================================="
echo "Repo root:        $REPO_ROOT"
echo "Config file:      $CONFIG_FILE"
echo "CONTROL_PUBLIC_URL: ${CONTROL_PUBLIC_URL:-<not set - will use fallback>}"
echo "CONTROL_PORT:       ${CONTROL_PORT:-9000}"
echo "CONTROL_HOST:       ${CONTROL_HOST:-127.0.0.1}"
echo "=========================================================="
echo ""

# Start the bot
exec node dist/index.js
