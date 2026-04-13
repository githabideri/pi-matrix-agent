#!/bin/bash
# Ensure a test room exists for UI smoke tests
#
# Usage: ./scripts/ensure-ui-test-room.sh
#
# Environment:
#   TEST_MATRIX_ROOM_ID - Matrix room ID to use for UI tests (required)
#   CONTROL_SERVER_URL  - Control server URL (default: http://127.0.0.1:9000)
#
# Output:
#   Writes roomKey to /tmp/pi-matrix-agent-ui-test-roomkey
#   Exits 0 on success, 1 on failure

set -e

# Configuration
CONTROL_SERVER_URL="${CONTROL_SERVER_URL:-http://127.0.0.1:9000}"
OUTPUT_FILE="/tmp/pi-matrix-agent-ui-test-roomkey"
MAX_WAIT_SECONDS=30

# Validate environment
if [ -z "$TEST_MATRIX_ROOM_ID" ]; then
    echo "ERROR: TEST_MATRIX_ROOM_ID is not set"
    echo ""
    echo "Set the Matrix room ID to use for UI tests:"
    echo "  export TEST_MATRIX_ROOM_ID='!roomid:example.com'"
    echo ""
    echo "Then send a message to that room to create a session."
    exit 1
fi

echo "Ensuring test room exists: $TEST_MATRIX_ROOM_ID"

# Wait for control server to be available
echo "Waiting for control server at $CONTROL_SERVER_URL..."
for i in $(seq 1 10); do
    if curl -s "$CONTROL_SERVER_URL/" > /dev/null 2>&1; then
        echo "Control server is available"
        break
    fi
    if [ $i -eq 10 ]; then
        echo "ERROR: Control server not available at $CONTROL_SERVER_URL"
        exit 1
    fi
    sleep 1
done

# Check if room already exists
echo "Checking for existing room..."
ROOM_JSON=$(curl -s "$CONTROL_SERVER_URL/api/live/rooms" 2>/dev/null || echo "[]")

# Try to find our room
ROOM_KEY=$(echo "$ROOM_JSON" | jq -r --arg room_id "$TEST_MATRIX_ROOM_ID" \
    '.[] | select(.roomId == $room_id) | .roomKey' | head -1)

if [ -n "$ROOM_KEY" ] && [ "$ROOM_KEY" != "null" ]; then
    echo "Found existing room: $TEST_MATRIX_ROOM_ID -> $ROOM_KEY"
    echo "$ROOM_KEY" > "$OUTPUT_FILE"
    echo "Room key written to $OUTPUT_FILE"
    exit 0
fi

# Room doesn't exist - wait for it to be created
echo "Room not found. Waiting for Matrix message to create session..."
echo "Send a message to room $TEST_MATRIX_ROOM_ID now"
echo "Waiting up to $MAX_WAIT_SECONDS seconds..."

START_TIME=$(date +%s)
while true; do
    CURRENT_TIME=$(date +%s)
    ELAPSED=$((CURRENT_TIME - START_TIME))
    
    if [ $ELAPSED -ge $MAX_WAIT_SECONDS ]; then
        echo ""
        echo "ERROR: Timeout waiting for room $TEST_MATRIX_ROOM_ID"
        echo ""
        echo "Make sure you've sent a message to the room."
        echo "You can set TEST_MATRIX_ROOM_ID to your test room:"
        echo "  export TEST_MATRIX_ROOM_ID='$TEST_MATRIX_ROOM_ID'"
        echo ""
        echo "Then send a message like 'test' to the bot in that room."
        exit 1
    fi
    
    # Poll for room
    ROOM_JSON=$(curl -s "$CONTROL_SERVER_URL/api/live/rooms" 2>/dev/null || echo "[]")
    ROOM_KEY=$(echo "$ROOM_JSON" | jq -r --arg room_id "$TEST_MATRIX_ROOM_ID" \
        '.[] | select(.roomId == $room_id) | .roomKey' | head -1)
    
    if [ -n "$ROOM_KEY" ] && [ "$ROOM_KEY" != "null" ]; then
        echo ""
        echo "Room created: $TEST_MATRIX_ROOM_ID -> $ROOM_KEY"
        echo "$ROOM_KEY" > "$OUTPUT_FILE"
        echo "Room key written to $OUTPUT_FILE"
        exit 0
    fi
    
    echo -n "."
    sleep 1
done
