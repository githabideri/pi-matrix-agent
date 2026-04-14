#!/bin/bash
#
# Set up Tailscale Serve for the control server
#
# Usage:
#   ./scripts/setup-serve.sh [port] [host]
#
# Defaults:
#   port: 9000 (or CONTROL_PORT env var)
#   host: 127.0.0.1 (or CONTROL_HOST env var)
#

set -e

CONTROL_PORT="${CONTROL_PORT:-${1:-9000}}"
CONTROL_HOST="${CONTROL_HOST:-${2:-127.0.0.1}}"

echo "=========================================================="
echo "       TAILSCALE SERVE SETUP"
echo "=========================================================="
echo ""
echo "Configuration:"
echo "  Target host: ${CONTROL_HOST}"
echo "  Target port: ${CONTROL_PORT}"
echo ""

# Check if tailscaled is running
if ! pgrep -x "tailscaled" > /dev/null 2>&1; then
    echo "❌ ERROR: tailscaled is not running"
    echo "Start Tailscale first: sudo tailscale up"
    exit 1
fi

echo "Setting up Tailscale Serve..."
echo ""

# Reset any existing Serve configuration
echo "Resetting existing Serve configuration..."
sudo tailscale serve reset 2>/dev/null || true
echo ""

# Set up Serve to proxy to the control server
echo "Configuring Serve to proxy to http://${CONTROL_HOST}:${CONTROL_PORT}..."
sudo tailscale serve --bg "http://${CONTROL_HOST}:${CONTROL_PORT}"
echo ""

# Wait a moment for configuration to take effect
sleep 2

# Verify configuration
echo "Verifying configuration..."
echo ""

tailscale serve status

echo ""
echo "=========================================================="
echo "       SETUP COMPLETE"
echo "=========================================================="
echo ""
echo "Tailscale Serve is now configured to proxy to:"
echo "  http://${CONTROL_HOST}:${CONTROL_PORT}"
echo ""
echo "To get your public URL:"
echo "  tailscale status --json | grep DNSName"
echo ""
echo "Example public URL:"
echo "  https://<your-hostname>.<tailnet>.ts.net/spike?room=<roomKey>"
echo ""
echo "To verify external access:"
echo "  ./scripts/check-serve.sh"

