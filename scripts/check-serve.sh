#!/bin/bash
#
# Check Tailscale Serve status and diagnose common issues
#

set -e

CONTROL_PORT="${CONTROL_PORT:-9000}"
CONTROL_HOST="${CONTROL_HOST:-127.0.0.1}"

echo "=========================================================="
echo "       TAILSCALE SERVE DIAGNOSTIC"
echo "=========================================================="
echo ""

# Check if Tailscale is running
if ! pgrep -x "tailscaled" > /dev/null 2>&1; then
    echo "❌ FAIL: tailscaled is not running"
    exit 1
fi
echo "✅ PASS: tailscaled is running"

# Check if control server is listening
if ! ss -tlnp | grep -q "${CONTROL_HOST}:${CONTROL_PORT}"; then
    echo "❌ FAIL: Control server not listening on ${CONTROL_HOST}:${CONTROL_PORT}"
    exit 1
fi
echo "✅ PASS: Control server listening on ${CONTROL_HOST}:${CONTROL_PORT}"

# Check if Serve is configured
SERVE_STATUS=$(tailscale serve status 2>&1)
if ! echo "$SERVE_STATUS" | grep -q "proxy"; then
    echo "❌ FAIL: Tailscale Serve is not configured"
    echo ""
    echo "To set up Serve:"
    echo "  sudo tailscale serve --bg ${CONTROL_HOST}:${CONTROL_PORT}"
    exit 1
fi
echo "✅ PASS: Tailscale Serve is configured"
echo ""
echo "Current Serve configuration:"
echo "$SERVE_STATUS"

# Check if target port matches
if ! echo "$SERVE_STATUS" | grep -q "${CONTROL_PORT}"; then
    echo ""
    echo "⚠️  WARN: Serve target port doesn't match control server port (${CONTROL_PORT})"
    exit 1
fi
echo ""
echo "✅ PASS: Serve target port matches control server port"

# Check if control server is reachable locally
if ! curl -s "http://${CONTROL_HOST}:${CONTROL_PORT}/" > /dev/null 2>&1; then
    echo ""
    echo "❌ FAIL: Control server not reachable locally"
    exit 1
fi
echo "✅ PASS: Control server reachable locally"

# Check if /spike is reachable locally
if ! curl -s "http://${CONTROL_HOST}:${CONTROL_PORT}/spike" | grep -q "Assistant UI Spike"; then
    echo ""
    echo "❌ FAIL: /spike endpoint not working correctly"
    exit 1
fi
echo "✅ PASS: /spike endpoint working"

# Get MagicDNS hostname
MAGICDNS=$(tailscale status --json 2>/dev/null | grep -o '"DNSName": *"[^"]*"' | head -1 | cut -d'"' -f4 | sed 's/\.$//')
if [ -z "$MAGICDNS" ]; then
    echo ""
    echo "⚠️  WARN: Could not determine MagicDNS hostname"
else
    echo ""
    echo "MagicDNS hostname: ${MAGICDNS}"
    echo "Public URL: https://${MAGICDNS}/spike?room=<roomKey>"
fi

echo ""
echo "=========================================================="
echo "       ALL CHECKS PASSED"
echo "=========================================================="
echo ""
echo "External access URL:"
echo "  https://${MAGICDNS:-<unknown>}/spike?room=<roomKey>"

