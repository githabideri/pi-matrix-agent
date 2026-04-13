#!/bin/bash
# smoke-local.sh - Fast regression check without live Matrix or Tailscale
# Verifies: app boots, API exists, basic endpoints respond

set -e

echo "=== smoke-local.sh ==="
echo "Testing: app boots, API exists, basic endpoints respond"

# Configuration
TEMP_PORT=9100
TEMP_CONFIG="/tmp/pi-matrix-smoke-test-config.json"
TEMP_STORAGE="/tmp/pi-matrix-smoke-storage"
SESSION_DIR="/tmp/pi-matrix-smoke-sessions"
WORKING_DIR="/tmp/pi-matrix-smoke-working"

# Cleanup function
cleanup() {
    echo "Cleaning up..."
    # Kill temp process if exists
    if [ -n "$TEMP_PID" ] && kill -0 "$TEMP_PID" 2>/dev/null; then
        kill "$TEMP_PID" 2>/dev/null || true
        wait "$TEMP_PID" 2>/dev/null || true
    fi
    # Remove temp files
    rm -f "$TEMP_CONFIG"
    rm -rf "$TEMP_STORAGE" "$SESSION_DIR" "$WORKING_DIR"
}

trap cleanup EXIT

# Create temp config
echo "Creating temp config..."
mkdir -p "$WORKING_DIR"
cat > "$TEMP_CONFIG" <<EOF
{
  "homeserverUrl": "http://127.0.0.1:9999",
  "accessToken": "smoke-test-token",
  "allowedRoomIds": ["!test:localhost"],
  "allowedUserIds": ["@test:localhost"],
  "botUserId": "@smoke-test:localhost",
  "storageFile": "$TEMP_STORAGE/matrix.db",
  "sessionBaseDir": "$SESSION_DIR",
  "workingDirectory": "$WORKING_DIR"
}
EOF

# Create temp directories
mkdir -p "$TEMP_STORAGE" "$SESSION_DIR"

# Start app on temp port (control-only mode, no Matrix)
echo "Starting app on port $TEMP_PORT..."
cd "$(dirname "$0")/.."
ENABLE_MATRIX=false CONTROL_PORT="$TEMP_PORT" CONFIG_FILE="$TEMP_CONFIG" node dist/index.js > /tmp/smoke-local.log 2>&1 &
TEMP_PID=$!

# Wait for app to start
echo "Waiting for app to start..."
for i in {1..30}; do
    if curl -s "http://127.0.0.1:$TEMP_PORT/" > /dev/null 2>&1; then
        echo "App started successfully"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "ERROR: App failed to start within 30 seconds"
        exit 1
    fi
    sleep 1
done

# Test 1: Health check
echo ""
echo "Test 1: Health check (/)"
RESPONSE=$(curl -s "http://127.0.0.1:$TEMP_PORT/")
if echo "$RESPONSE" | grep -q '"status":"ok"'; then
    echo "✓ Health check passed"
else
    echo "✗ Health check failed: $RESPONSE"
    exit 1
fi

# Test 2: Live rooms endpoint
echo ""
echo "Test 2: Live rooms endpoint (/api/live/rooms)"
RESPONSE=$(curl -s "http://127.0.0.1:$TEMP_PORT/api/live/rooms")
if echo "$RESPONSE" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
    echo "✓ Live rooms endpoint returns valid JSON"
else
    echo "✗ Live rooms endpoint failed: $RESPONSE"
    exit 1
fi

# Test 3: Room not found returns 404
echo ""
echo "Test 3: Room not found returns 404"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$TEMP_PORT/api/live/rooms/nonexistent")
if [ "$HTTP_CODE" = "404" ]; then
    echo "✓ 404 returned for non-existent room"
else
    echo "✗ Expected 404, got $HTTP_CODE"
    exit 1
fi

# Test 4: Archive endpoint returns empty array for non-existent room
echo ""
echo "Test 4: Archive endpoint returns empty array for non-existent room"
RESPONSE=$(curl -s "http://127.0.0.1:$TEMP_PORT/api/archive/rooms/nonexistent/sessions")
if [ "$RESPONSE" = "[]" ]; then
    echo "✓ Empty array returned for non-existent archive"
else
    echo "✗ Expected [], got: $RESPONSE"
    exit 1
fi

echo ""
echo "=== smoke-local.sh: ALL TESTS PASSED ==="
exit 0
