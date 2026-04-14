#!/bin/bash
# Matrix API Test Script for pi-matrix-agent
#
# Usage: source .env.matrix && ./scripts/matrix-test.sh <command>
#
# Commands:
#   send <message>     - Send a message to the bot
#   status            - Get recent messages from the room
#   wait <seconds>    - Wait for bot to finish processing

set -e

# Load environment
if [ -f .env.matrix ]; then
    source .env.matrix
fi

# Check required env vars
if [ -z "$MATRIX_HOMESERVER" ]; then
    echo "Error: MATRIX_HOMESERVER not set. Source .env.matrix first:"
    echo "  source .env.matrix"
    exit 1
fi

if [ -z "$MATRIX_ACCESS_TOKEN" ]; then
    echo "Error: MATRIX_ACCESS_TOKEN not set. Source .env.matrix first:"
    echo "  source .env.matrix"
    exit 1
fi

if [ -z "$MATRIX_ROOM_ID" ]; then
    echo "Error: MATRIX_ROOM_ID not set. Source .env.matrix first:"
    echo "  source .env.matrix"
    exit 1
fi

# Default values
ROOM_ID="${MATRIX_ROOM_ID:-!ZqbmhmaXDWWgORmNfF:matrixbot.home.macl.at}"
LIMIT="${LIMIT:-10}"

send_message() {
    local message="$1"
    local token="${2:-$MATRIX_ACCESS_TOKEN}"
    
    curl -s -X POST "$MATRIX_HOMESERVER/_matrix/client/r0/rooms/$ROOM_ID/send/m.room.message" \
        -H "Authorization: Bearer $token" \
        -H "Content-Type: application/json" \
        -d "{\"msgtype\":\"m.text\",\"body\":\"$message\"}"
}

get_messages() {
    local limit="${1:-$LIMIT}"
    local token="${2:-$MATRIX_ACCESS_TOKEN}"
    
    curl -s "$MATRIX_HOMESERVER/_matrix/client/r0/rooms/$ROOM_ID/messages?dir=b&limit=$limit" \
        -H "Authorization: Bearer $token"
}

get_messages_pretty() {
    local limit="${1:-$LIMIT}"
    local token="${2:-$MATRIX_ACCESS_TOKEN}"
    
    get_messages "$limit" "$token" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for event in reversed(data.get('chunk', [])):
    content = event.get('content', {})
    sender = event.get('sender', '')
    body = content.get('body', '')
    sender_short = sender.split(':')[-1] if ':' in sender else sender[:15]
    print(f'[{sender_short}] {body}')
    print()
"
}

wait_for_idle() {
    local max_wait="${1:-30}"
    local start=$(date +%s)
    
    while true; do
        local now=$(date +%s)
        local elapsed=$((now - start))
        if [ $elapsed -ge $max_wait ]; then
            echo "Timeout waiting for idle after $max_wait seconds"
            return 1
        fi
        
        local is_processing=$(curl -s "http://127.0.0.1:9000/api/live/rooms/625e66af" | python3 -c "import sys,json; print(json.load(sys.stdin).get('isProcessing', False))" 2>/dev/null || echo "false")
        
        if [ "$is_processing" = "False" ] || [ "$is_processing" = "false" ]; then
            echo "Room is now idle (waited ${elapsed}s)"
            return 0
        fi
        
        sleep 1
    done
}

show_help() {
    echo "Matrix Test Script"
    echo ""
    echo "Usage: source .env.matrix && ./scripts/matrix-test.sh <command>"
    echo ""
    echo "Commands:"
    echo "  send <message>              Send a message to the bot"
    echo "  send-as <user_token> <msg>  Send as different user"
    echo "  status [limit]              Show recent messages"
    echo "  wait [seconds]              Wait for room to be idle"
    echo ""
    echo "Environment variables (set in .env.matrix):"
    echo "  MATRIX_HOMESERVER           Homeserver URL"
    echo "  MATRIX_ACCESS_TOKEN         Access token for @m user"
    echo "  MATRIX_ROOM_ID              Room ID"
    echo ""
    echo "Examples:"
    echo "  ./scripts/matrix-test.sh send '!m -s'"
    echo "  ./scripts/matrix-test.sh status 5"
    echo "  ./scripts/matrix-test.sh wait"
}

# Main
case "${1:-help}" in
    send)
        send_message "$2"
        ;;
    send-as)
        send_message "$3" "$2"
        ;;
    status)
        get_messages_pretty "${2:-$LIMIT}"
        ;;
    wait)
        wait_for_idle "${2:-30}"
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        echo "Unknown command: $1"
        show_help
        exit 1
        ;;
esac
