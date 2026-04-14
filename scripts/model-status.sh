#!/usr/bin/env bash
# Model status script for pi-matrix-agent
# Shows the currently configured default model/provider for the bot

set -e

BOT_AGENT_DIR="/root/.pi-matrix-agent/agent"
SETTINGS_FILE="${BOT_AGENT_DIR}/settings.json"
MODELS_FILE="${BOT_AGENT_DIR}/models.json"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if config files exist
if [[ ! -f "$SETTINGS_FILE" ]]; then
    echo -e "${RED}ERROR: Settings file not found: ${SETTINGS_FILE}${NC}"
    exit 1
fi

if [[ ! -f "$MODELS_FILE" ]]; then
    echo -e "${RED}ERROR: Models file not found: ${MODELS_FILE}${NC}"
    exit 1
fi

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}   PI-MATRIX-AGENT MODEL STATUS${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Read current settings using grep/sed
DEFAULT_PROVIDER=$(grep -o '"defaultProvider"[[:space:]]*:[[:space:]]*"[^"]*"' "$SETTINGS_FILE" | sed 's/.*:.*"\([^"]*\)"/\1/')
DEFAULT_MODEL=$(grep -o '"defaultModel"[[:space:]]*:[[:space:]]*"[^"]*"' "$SETTINGS_FILE" | sed 's/.*:.*"\([^"]*\)"/\1/')

# Output current configuration
echo -e "Current Default Provider: ${GREEN}${DEFAULT_PROVIDER}${NC}"
echo -e "Current Default Model ID: ${GREEN}${DEFAULT_MODEL}${NC}"
echo ""

# Show available profiles
echo -e "${BLUE}Available Model Profiles:${NC}"
echo ""

# Gemma4 profile info
GEMMA4_PROVIDER="llama-cpp-gemma4"
GEMMA4_MODEL="gemma-4-26B-A4B-it-UD-Q4_K_M.gguf"
GEMMA4_NAME="Gemma4 26B A4B"
echo -e "  ${YELLOW}gemma4${NC}"
echo -e "    Provider: $GEMMA4_PROVIDER"
echo -e "    Model:    $GEMMA4_MODEL"
echo -e "    Name:     $GEMMA4_NAME"
echo ""

# Qwen27 profile info
QWEN27_PROVIDER="llama-cpp-qwen27"
QWEN27_MODEL="Qwen3.5-27B-Claude-4.6-Opus-Reasoning-Distilled.i1-Q4_K_M.gguf"
QWEN27_NAME="Qwen3.5 27B Opus"
echo -e "  ${YELLOW}qwen27${NC}"
echo -e "    Provider: $QWEN27_PROVIDER"
echo -e "    Model:    $QWEN27_MODEL"
echo -e "    Name:     $QWEN27_NAME"
echo ""

# Show which profile is active
if [[ "$DEFAULT_PROVIDER" == "$GEMMA4_PROVIDER" ]]; then
    echo -e "${GREEN}✓ Active Profile: gemma4${NC}"
elif [[ "$DEFAULT_PROVIDER" == "$QWEN27_PROVIDER" ]]; then
    echo -e "${GREEN}✓ Active Profile: qwen27${NC}"
else
    echo -e "${YELLOW}? Active Profile: unknown ($DEFAULT_PROVIDER)${NC}"
fi

echo ""
echo -e "${BLUE}----------------------------------------${NC}"
echo -e "${BLUE}Systemd Service Status:${NC}"
echo -e "${BLUE}----------------------------------------${NC}"

# Check systemd service status
if systemctl is-active --quiet pi-matrix-agent 2>/dev/null; then
    echo -e "Service: ${GREEN}active (running)${NC}"
else
    echo -e "Service: ${RED}inactive${NC}"
fi

# Show latest log line if service is running
if systemctl is-active --quiet pi-matrix-agent 2>/dev/null; then
    echo ""
    echo "Latest log entries:"
    journalctl -u pi-matrix-agent -n 5 --no-pager 2>/dev/null || echo "(unable to read logs)"
fi

echo ""
echo -e "${BLUE}========================================${NC}"
echo ""
echo "To switch models, use: ./scripts/model-switch.sh <gemma4|qwen27>"
echo ""
