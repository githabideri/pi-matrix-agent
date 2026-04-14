#!/usr/bin/env bash
# Model switch script for pi-matrix-agent
# Switches the default model profile for the bot
#
# Usage:
#   ./scripts/model-switch.sh gemma4
#   ./scripts/model-switch.sh qwen27
#   ./scripts/model-switch.sh --status

set -e

# Configuration
BOT_AGENT_DIR="/root/.pi-matrix-agent/agent"
SETTINGS_FILE="${BOT_AGENT_DIR}/settings.json"
MODELS_FILE="${BOT_AGENT_DIR}/models.json"
SERVICE_NAME="pi-matrix-agent"

# Profile definitions
declare -A PROFILES
PROFILES[gemma4_provider]="llama-cpp-gemma4"
PROFILES[gemma4_model]="gemma-4-26B-A4B-it-UD-Q4_K_M.gguf"
PROFILES[gemma4_name]="Gemma4 26B A4B"
PROFILES[qwen27_provider]="llama-cpp-qwen27"
PROFILES[qwen27_model]="Qwen3.5-27B-Claude-4.6-Opus-Reasoning-Distilled.i1-Q4_K_M.gguf"
PROFILES[qwen27_name]="Qwen3.5 27B Opus"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
if [[ "$1" == "--help" || "$1" == "-h" ]]; then
    echo "Usage: $0 <profile>"
    echo ""
    echo "Profiles:"
    echo "  gemma4  - Gemma4 26B A4B (on port 8081)"
    echo "  qwen27  - Qwen3.5 27B Opus (on port 8080)"
    echo ""
    echo "Options:"
    echo "  --status  Show current model configuration (alias for model-status.sh)"
    echo "  --dry-run Show what would change without applying"
    echo ""
    echo "Example:"
    echo "  $0 gemma4     # Switch to Gemma4 and restart service"
    echo "  $0 qwen27     # Switch to Qwen27 and restart service"
    exit 0
fi

if [[ "$1" == "--status" ]]; then
    # Delegate to model-status.sh
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    exec "${SCRIPT_DIR}/model-status.sh"
    exit 0
fi

DRY_RUN=false
if [[ "$1" == "--dry-run" ]]; then
    DRY_RUN=true
    PROFILE="$2"
else
    PROFILE="$1"
fi

# Validate profile
if [[ -z "$PROFILE" ]]; then
    echo -e "${RED}ERROR: No profile specified${NC}"
    echo ""
    echo "Usage: $0 <gemma4|qwen27>"
    echo "       $0 --status"
    exit 1
fi

# Get profile name (handle --dry-run case)
if [[ "$DRY_RUN" == true ]]; then
    if [[ -z "$PROFILE" ]]; then
        echo -e "${RED}ERROR: Profile required with --dry-run${NC}"
        exit 1
    fi
else
    case "$PROFILE" in
        gemma4|qwen27)
            ;;
        *)
            echo -e "${RED}ERROR: Unknown profile '$PROFILE'${NC}"
            echo ""
            echo "Available profiles:"
            echo "  gemma4  - Gemma4 26B A4B"
            echo "  qwen27  - Qwen3.5 27B Opus"
            exit 1
            ;;
    esac
fi

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}   PI-MATRIX-AGENT MODEL SWITCH${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check config files exist
if [[ ! -f "$SETTINGS_FILE" ]]; then
    echo -e "${RED}ERROR: Settings file not found: ${SETTINGS_FILE}${NC}"
    exit 1
fi

if [[ ! -f "$MODELS_FILE" ]]; then
    echo -e "${RED}ERROR: Models file not found: ${MODELS_FILE}${NC}"
    exit 1
fi

# Get current settings using grep/sed
CURRENT_PROVIDER=$(grep -o '"defaultProvider"[[:space:]]*:[[:space:]]*"[^"]*"' "$SETTINGS_FILE" | sed 's/.*:.*"\([^"]*\)"/\1/')
CURRENT_MODEL=$(grep -o '"defaultModel"[[:space:]]*:[[:space:]]*"[^"]*"' "$SETTINGS_FILE" | sed 's/.*:.*"\([^"]*\)"/\1/')

# Get target values
TARGET_PROVIDER="${PROFILES[${PROFILE}_provider]}"
TARGET_MODEL="${PROFILES[${PROFILE}_model]}"
TARGET_NAME="${PROFILES[${PROFILE}_name]}"

echo -e "${YELLOW}Current Configuration:${NC}"
echo -e "  Provider: $CURRENT_PROVIDER"
echo -e "  Model:    $CURRENT_MODEL"
echo ""

echo -e "${YELLOW}Target Configuration (${GREEN}${PROFILE}${YELLOW}):${NC}"
echo -e "  Provider: $TARGET_PROVIDER"
echo -e "  Model:    $TARGET_MODEL"
echo -e "  Name:     $TARGET_NAME"
echo ""

# Check if already on target
if [[ "$CURRENT_PROVIDER" == "$TARGET_PROVIDER" && "$CURRENT_MODEL" == "$TARGET_MODEL" ]]; then
    echo -e "${GREEN}Already using ${PROFILE} profile. No change needed.${NC}"
    echo ""
    echo "To verify, run: $0 --status"
    exit 0
fi

# Dry-run mode
if [[ "$DRY_RUN" == true ]]; then
    echo -e "${BLUE}--- DRY RUN ---${NC}"
    echo "Would update ${SETTINGS_FILE}:"
    echo "  defaultProvider: $CURRENT_PROVIDER -> $TARGET_PROVIDER"
    echo "  defaultModel:    $CURRENT_MODEL -> $TARGET_MODEL"
    echo ""
    echo "No changes were made."
    exit 0
fi

# Validate target exists in models.json
if ! grep -q "\"$TARGET_PROVIDER\"" "$MODELS_FILE"; then
    echo -e "${RED}ERROR: Provider '$TARGET_PROVIDER' not found in models.json${NC}"
    exit 1
fi

if ! grep -q "\"$TARGET_MODEL\"" "$MODELS_FILE"; then
    echo -e "${RED}ERROR: Model '$TARGET_MODEL' not found in models.json${NC}"
    exit 1
fi

# Backup current settings
echo -e "${YELLOW}Creating backup of current settings...${NC}"
BACKUP_FILE="${SETTINGS_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
cp "$SETTINGS_FILE" "$BACKUP_FILE"
echo -e "  Backup: $GREEN${BACKUP_FILE}${NC}"
echo ""

# Update settings.json using sed
echo -e "${YELLOW}Updating settings.json...${NC}"

# Create temp file and apply changes
TMP_FILE="${SETTINGS_FILE}.tmp"
cp "$SETTINGS_FILE" "$TMP_FILE"

# Update defaultProvider
sed -i "s/\"defaultProvider\"[[:space:]]*:[[:space:]]*\"[^\"]*\"/\"defaultProvider\": \"$TARGET_PROVIDER\"/" "$TMP_FILE"

# Update defaultModel
sed -i "s/\"defaultModel\"[[:space:]]*:[[:space:]]*\"[^\"]*\"/\"defaultModel\": \"$TARGET_MODEL\"/" "$TMP_FILE"

# Move temp file to final location
mv "$TMP_FILE" "$SETTINGS_FILE"

echo -e "  defaultProvider: $GREEN$TARGET_PROVIDER${NC}"
echo -e "  defaultModel:    $GREEN$TARGET_MODEL${NC}"
echo ""

# Verify the update
NEW_PROVIDER=$(grep -o '"defaultProvider"[[:space:]]*:[[:space:]]*"[^"]*"' "$SETTINGS_FILE" | sed 's/.*:.*"\([^"]*\)"/\1/')
NEW_MODEL=$(grep -o '"defaultModel"[[:space:]]*:[[:space:]]*"[^"]*"' "$SETTINGS_FILE" | sed 's/.*:.*"\([^"]*\)"/\1/')

if [[ "$NEW_PROVIDER" != "$TARGET_PROVIDER" || "$NEW_MODEL" != "$TARGET_MODEL" ]]; then
    echo -e "${RED}ERROR: Failed to update settings correctly${NC}"
    echo -e "Restoring from backup..."
    cp "$BACKUP_FILE" "$SETTINGS_FILE"
    exit 1
fi
echo -e "${GREEN}✓ Settings updated and verified${NC}"
echo ""

# Restart systemd service
echo -e "${YELLOW}Restarting systemd service...${NC}"
echo ""

# Check if service is running
if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    echo "Stopping $SERVICE_NAME..."
    systemctl stop "$SERVICE_NAME" 2>/dev/null || echo "  (service may not have been running)"
    
    # Wait for clean stop
    sleep 2
    
    echo "Starting $SERVICE_NAME..."
    if systemctl start "$SERVICE_NAME" 2>/dev/null; then
        echo -e "  $GREEN✓ Service started${NC}"
        
        # Wait for service to be ready
        echo ""
        echo -e "${YELLOW}Waiting for service to be ready...${NC}"
        sleep 3
        
        # Verify service is running
        if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
            echo -e "  $GREEN✓ Service is active${NC}"
        else
            echo -e "  $YELLOW⚠ Service may have failed to start${NC}"
            echo "  Check logs with: journalctl -u $SERVICE_NAME -n 20"
        fi
    else
        echo -e "  $RED✗ Failed to start service${NC}"
        echo "  Check logs with: journalctl -u $SERVICE_NAME -n 20"
    fi
else
    echo -e "  $YELLOW⚠ Service $SERVICE_NAME is not currently running${NC}"
    echo "  Starting it now..."
    if systemctl start "$SERVICE_NAME" 2>/dev/null; then
        echo -e "  $GREEN✓ Service started${NC}"
    else
        echo -e "  $YELLOW⚠ Could not start service (may need manual start)${NC}"
    fi
fi

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}Switch complete!${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "Now using: $GREEN${PROFILE}${NC} ($TARGET_NAME)"
echo ""
echo "To verify, run:"
echo "  $0 --status"
echo ""

# Show brief service status
if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    echo -e "Service Status: $GREENactive${NC}"
else
    echo -e "Service Status: $REDinactive${NC}"
fi
