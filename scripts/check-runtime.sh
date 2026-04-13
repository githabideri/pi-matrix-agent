#!/bin/bash
#
# Quick runtime diagnostics for pi-matrix-agent
#
# Usage:
#   ./scripts/check-runtime.sh              # Basic checks
#   ./scripts/check-runtime.sh <roomKey>    # Also check specific room
#

set -e

# Control server defaults
CONTROL_HOST="${CONTROL_HOST:-127.0.0.1}"
CONTROL_PORT="${CONTROL_PORT:-9000}"
CONTROL_URL="http://${CONTROL_HOST}:${CONTROL_PORT}"

echo "=========================================================="
echo "           PI-MATRIX-AGENT RUNTIME CHECK"
echo "=========================================================="
echo ""

# Check 1: CONTROL_PUBLIC_URL environment variable
echo "[1] CONTROL_PUBLIC_URL"
if [ -n "$CONTROL_PUBLIC_URL" ]; then
    echo "    ✓ Set: $CONTROL_PUBLIC_URL"
else
    echo "    ✗ Not set - !control will return fallback URLs"
fi
echo ""

# Check 2: Control server health
echo "[2] Control Server Health ($CONTROL_URL/)"
if response=$(curl -s "$CONTROL_URL/" 2>/dev/null); then
    echo "    ✓ Responding"
    echo "    Response: $response"
else
    echo "    ✗ Not responding - is the bot running?"
fi
echo ""

# Check 3: Live rooms API
echo "[3] Live Rooms API ($CONTROL_URL/api/live/rooms)"
if response=$(curl -s "$CONTROL_URL/api/live/rooms" 2>/dev/null); then
    echo "    ✓ Responding"
    echo "    Response: $response"
else
    echo "    ✗ Not responding"
fi
echo ""

# Check 4: Frontend dist
echo "[4] Frontend Build"
FRONTEND_INDEX="./frontend/operator-ui/dist/index.html"
if [ -f "$FRONTEND_INDEX" ]; then
    echo "    ✓ Built: $FRONTEND_INDEX"
else
    echo "    ✗ Not built - /app/room/:roomKey will not work"
    echo "    To build: cd frontend/operator-ui && npm run build"
fi
echo ""

# Optional: Check specific room if provided
if [ -n "$1" ]; then
    ROOM_KEY="$1"
    
    echo "[5] Room Check (roomKey: $ROOM_KEY)"
    
    # Check EJS fallback route
    echo "    EJS route ($CONTROL_URL/room/$ROOM_KEY):"
    if curl -s -o /dev/null -w "%{http_code}" "$CONTROL_URL/room/$ROOM_KEY" 2>/dev/null | grep -q "200\|302"; then
        echo "      ✓ Responding"
    else
        echo "      ✗ Not responding"
    fi
    
    # Check preview frontend route
    echo "    Preview route ($CONTROL_URL/app/room/$ROOM_KEY):"
    if curl -s -o /dev/null -w "%{http_code}" "$CONTROL_URL/app/room/$ROOM_KEY" 2>/dev/null | grep -q "200"; then
        echo "      ✓ Responding"
    else
        echo "      ✗ Not responding"
    fi
    
    # Check room details API
    echo "    Room API ($CONTROL_URL/api/live/rooms/$ROOM_KEY):"
    if response=$(curl -s "$CONTROL_URL/api/live/rooms/$ROOM_KEY" 2>/dev/null); then
        echo "      ✓ Responding"
        echo "      Response: $response"
    else
        echo "      ✗ Not responding"
    fi
    echo ""
fi

echo "=========================================================="
echo "Check complete."
echo "=========================================================="
