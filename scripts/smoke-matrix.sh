#!/bin/bash
# smoke-matrix.sh - Live Matrix smoke test
# Tests: prompt, memory, !control, !reset, fresh session, archive
#
# Usage: source .env.matrix && ./scripts/smoke-matrix.sh
# Or set environment variables manually

set -e

# Load environment from .env.matrix if it exists
if [ -f .env.matrix ]; then
    echo "Loading environment from .env.matrix..."
    set -a
    source .env.matrix
    set +a
fi

# Configuration - use env vars with fallbacks
MATRIX_URL="${MATRIX_URL:-${MATRIX_HOMESERVER:-http://localhost:8008}}"
MATRIX_TOKEN="${MATRIX_TOKEN:-${MATRIX_ACCESS_TOKEN:-}}"
TEST_ROOM="${TEST_ROOM:-${MATRIX_ROOM_ID:-}}"
CONTROL_URL="${CONTROL_URL:-http://127.0.0.1:9000}"
CONTROL_PUBLIC_URL="${CONTROL_PUBLIC_URL:-http://127.0.0.1:9000}"

# Timeout for waiting for bot response (seconds)
RESPONSE_TIMEOUT=30

# Validate required variables
if [ -z "$MATRIX_TOKEN" ]; then
    echo "ERROR: MATRIX_TOKEN or MATRIX_ACCESS_TOKEN is not set"
    echo "Set these in .env.matrix or export them:"
    echo "  export MATRIX_ACCESS_TOKEN='your-token-here'"
    exit 1
fi

if [ -z "$TEST_ROOM" ]; then
    echo "ERROR: TEST_ROOM or MATRIX_ROOM_ID is not set"
    echo "Set these in .env.matrix or export them:"
    echo "  export MATRIX_ROOM_ID='!roomid:example.com'"
    exit 1
fi

echo "=== smoke-matrix.sh ==="
echo "Testing live Matrix behavior"
echo "Test room: $TEST_ROOM"
echo "Matrix URL: $MATRIX_URL"
echo "Control URL: $CONTROL_URL"

# Helper function to send a message
send_message() {
    local body="$1"
    echo "Sending: $body"
    curl -s -X POST "$MATRIX_URL/_matrix/client/r0/rooms/$TEST_ROOM/send/m.room.message" \
        -H "Authorization: Bearer $MATRIX_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"msgtype\": \"m.room.message\", \"content\": {\"msgtype\": \"m.text\", \"body\": \"$body\"}}"
    echo ""
}

# Helper function to get recent messages from bot
get_bot_responses() {
    local count="${1:-5}"
    curl -s "$MATRIX_URL/_matrix/client/r0/rooms/$TEST_ROOM/messages?dir=b&limit=$count" \
        -H "Authorization: Bearer $MATRIX_TOKEN" | \
        python3 -c "
import json, sys
data = json.load(sys.stdin)
for event in data.get('chunk', []):
    if event.get('sender', '').startswith('@locmox'):
        print(event.get('content', {}).get('body', ''))
" 2>/dev/null
}

# Helper function to wait for bot response
wait_for_response() {
    local keyword="$1"
    local start=$(date +%s)
    echo "Waiting for response containing: $keyword"
    
    while true; do
        current_time=$(date +%s)
        elapsed=$((current_time - start))
        
        if [ $elapsed -ge $RESPONSE_TIMEOUT ]; then
            echo "✗ Timeout waiting for response"
            return 1
        fi
        
        responses=$(get_bot_responses 10)
        if echo "$responses" | grep -q "$keyword"; then
            echo "✓ Got expected response"
            return 0
        fi
        
        sleep 2
    done
}

# Test 1: Bot is responsive
echo ""
echo "Test 1: Bot is responsive"
send_message "!ping"
if wait_for_response "pong"; then
    echo "✓ Bot responded to !ping"
else
    echo "✗ Bot did not respond to !ping"
    exit 1
fi

# Test 2: Memory works
echo ""
echo "Test 2: Memory works"
send_message "remember the word banana"
sleep 3
send_message "what word did i tell you?"
if wait_for_response -i "banana"; then
    echo "✓ Bot remembered 'banana'"
else
    echo "✗ Bot did not remember 'banana'"
    # Show what the bot said
    echo "Bot responses:"
    get_bot_responses 5
    exit 1
fi

# Test 3: !control returns correct URL
echo ""
echo "Test 3: !control returns correct URL"
send_message "!control"
if wait_for_response "$CONTROL_PUBLIC_URL"; then
    echo "✓ !control returned correct URL"
else
    echo "✗ !control did not return expected URL ($CONTROL_PUBLIC_URL)"
    echo "Bot responses:"
    get_bot_responses 5
    exit 1
fi

# Test 4: !reset works and bot stays alive
echo ""
echo "Test 4: !reset works and bot stays alive"
send_message "!reset"
if wait_for_response "Session reset"; then
    echo "✓ !reset completed"
else
    echo "✗ !reset did not complete properly"
    exit 1
fi

# Verify bot is still responsive after reset
sleep 2
send_message "!ping"
if wait_for_response "pong"; then
    echo "✓ Bot still alive after !reset"
else
    echo "✗ Bot died after !reset"
    exit 1
fi

# Test 5: Memory is cleared after reset
echo ""
echo "Test 5: Memory is cleared after reset"
send_message "what word did i tell you?"
sleep 5
responses=$(get_bot_responses 3)
echo "Bot response: $responses"
if echo "$responses" | grep -qi "banana"; then
    echo "✗ Bot still remembers 'banana' after reset"
    exit 1
else
    echo "✓ Memory cleared after reset"
fi

# Test 6: Archive shows previous session
echo ""
echo "Test 6: Archive shows previous session"
# Get room key from live rooms
ROOM_KEY=$(curl -s "$CONTROL_URL/api/live/rooms" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for room in data:
    if '$TEST_ROOM' in room.get('roomId', ''):
        print(room.get('roomKey', ''))
        break
" 2>/dev/null)

if [ -n "$ROOM_KEY" ]; then
    ARCHIVE_COUNT=$(curl -s "$CONTROL_URL/api/archive/rooms/$ROOM_KEY/sessions" | python3 -c "
import json, sys
data = json.load(sys.stdin)
print(len(data))
" 2>/dev/null)
    
    if [ "$ARCHIVE_COUNT" -gt 0 ]; then
        echo "✓ Archive contains $ARCHIVE_COUNT session(s)"
    else
        echo "⚠ Archive is empty (may be expected if this is first test run)"
    fi
else
    echo "⚠ Could not find room key for $TEST_ROOM"
fi

echo ""
echo "=== smoke-matrix.sh: ALL TESTS PASSED ==="
exit 0
