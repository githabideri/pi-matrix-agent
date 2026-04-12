#!/bin/bash
# smoke-control.sh - Verify the running control plane on the LXC
# Tests: control endpoints, context manifest fields, SSE connection

set -e

# Configuration - can be overridden via env vars
CONTROL_URL="${CONTROL_URL:-http://127.0.0.1:9000}"

echo "=== smoke-control.sh ==="
echo "Testing control plane at: $CONTROL_URL"

# Test 1: Health check
echo ""
echo "Test 1: Health check (/)"
RESPONSE=$(curl -s "$CONTROL_URL/")
if echo "$RESPONSE" | grep -q '"status":"ok"'; then
    echo "✓ Health check passed"
else
    echo "✗ Health check failed: $RESPONSE"
    exit 1
fi

# Test 2: Live rooms endpoint
echo ""
echo "Test 2: Live rooms endpoint (/api/live/rooms)"
RESPONSE=$(curl -s "$CONTROL_URL/api/live/rooms")
if echo "$RESPONSE" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
    echo "✓ Live rooms endpoint returns valid JSON"
    ROOMS=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin)))")
else
    echo "✗ Live rooms endpoint failed: $RESPONSE"
    exit 1
fi

# Extract first room key if any rooms exist
FIRST_ROOM_KEY=$(echo "$ROOMS" | python3 -c "
import json, sys
data = json.load(sys.stdin)
if data:
    print(data[0].get('roomKey', ''))
" 2>/dev/null)

if [ -n "$FIRST_ROOM_KEY" ]; then
    echo "Found room: $FIRST_ROOM_KEY"
    
    # Test 3: Context manifest endpoint
    echo ""
    echo "Test 3: Context manifest endpoint (/api/live/rooms/:roomKey/context)"
    CONTEXT=$(curl -s "$CONTROL_URL/api/live/rooms/$FIRST_ROOM_KEY/context")
    
    # Verify required fields exist
    echo "Verifying required fields..."
    for FIELD in roomId roomKey sessionId relativeSessionPath workingDirectory model isProcessing isStreaming toolNames; do
        if echo "$CONTEXT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
field = sys.argv[1]
if field in data:
    print(f'  ✓ {field}: {data[field]}')
    sys.exit(0)
else:
    print(f'  ✗ {field}: MISSING')
    sys.exit(1)
" "$FIELD" 2>/dev/null; then
            : # Field exists, continue
        else
            echo "✗ Field $FIELD missing from context manifest"
            exit 1
        fi
    done
    echo "✓ Context manifest has all required fields"
    
    # Test 4: Room details endpoint
    echo ""
    echo "Test 4: Room details endpoint (/api/live/rooms/:roomKey)"
    ROOM_DETAILS=$(curl -s "$CONTROL_URL/api/live/rooms/$FIRST_ROOM_KEY")
    if echo "$ROOM_DETAILS" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
        echo "✓ Room details endpoint returns valid JSON"
    else
        echo "✗ Room details endpoint failed: $ROOM_DETAILS"
        exit 1
    fi
    
    # Test 5: Archive endpoint
    echo ""
    echo "Test 5: Archive endpoint (/api/archive/rooms/:roomKey/sessions)"
    ARCHIVE=$(curl -s "$CONTROL_URL/api/archive/rooms/$FIRST_ROOM_KEY/sessions")
    if echo "$ARCHIVE" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
        echo "✓ Archive endpoint returns valid JSON"
    else
        echo "✗ Archive endpoint failed: $ARCHIVE"
        exit 1
    fi
    
    # Test 6: SSE connection (just verify it opens)
    echo ""
    echo "Test 6: SSE endpoint (/api/live/rooms/:roomKey/events)"
    # Try to connect and get at least one event within 2 seconds
    SSE_RESPONSE=$(timeout 2 curl -s "$CONTROL_URL/api/live/rooms/$FIRST_ROOM_KEY/events" 2>/dev/null || true)
    if [ -n "$SSE_RESPONSE" ]; then
        echo "✓ SSE endpoint responds"
    else
        echo "⚠ SSE endpoint may not have events ready (not necessarily a failure)"
    fi
else
    echo "⚠ No live rooms found, skipping room-specific tests"
    echo "  (This is expected if no prompts have been sent yet)"
fi

echo ""
echo "=== smoke-control.sh: ALL TESTS PASSED ==="
exit 0
