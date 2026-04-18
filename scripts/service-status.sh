#!/bin/bash
#
# service-status.sh - Check pi-matrix-agent service status and health
#
# Usage:
#   ./scripts/service-status.sh           # Full status check
#   ./scripts/service-status.sh systemd   # Check systemd unit only
#   ./scripts/service-status.sh process   # Check running process only
#   ./scripts/service-status.sh env       # Check environment variables
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_section() { echo -e "\n${BLUE}=== $1 ===${NC}"; }
print_ok() { echo -e "${GREEN}✓ $1${NC}"; }
print_warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
print_error() { echo -e "${RED}✗ $1${NC}"; }
print_info() { echo -e "  $1"; }

action="${1:-full}"

check_systemd_status() {
    print_section "Systemd Service Status"
    
    if systemctl is-active pi-matrix-agent >/dev/null 2>&1; then
        print_ok "Service is active"
        
        # Get service details
        echo ""
        systemctl status pi-matrix-agent --no-pager -l 2>/dev/null | tail -20
    else
        print_error "Service is NOT active"
        
        # Try to get last error
        echo ""
        print_info "Last 10 log lines:"
        journalctl -u pi-matrix-agent -n 10 --no-pager 2>/dev/null || print_info "  No logs found"
    fi
}

check_process_status() {
    print_section "Running Process"
    
    # Count processes
    PROCESS_COUNT=$(ps aux | grep "node.*dist/index.js" | grep -v grep | wc -l)
    
    if [ "$PROCESS_COUNT" -eq 0 ]; then
        print_error "No pi-matrix-agent process running"
    elif [ "$PROCESS_COUNT" -eq 1 ]; then
        print_ok "Exactly one process running"
        ps aux | grep "node.*dist/index.js" | grep -v grep | awk '{print "  PID:"$2" USER:"$1" CMD:"$11"..."}'
    else
        print_error "$PROCESS_COUNT processes running (expected 1)!"
        ps aux | grep "node.*dist/index.js" | grep -v grep
    fi
    
    # Check if process is owned by systemd
    print_info ""
    if pgrep -f "node.*dist/index.js" >/dev/null 2>&1; then
        PID=$(pgrep -f "node.*dist/index.js" | head -1)
        PARENT=$(ps -o ppid= -p "$PID" 2>/dev/null || echo "unknown")
        print_info "Process PID: $PID"
        print_info "Parent PID:  $PARENT"
        
        if [ "$PARENT" = "1" ]; then
            print_ok "Process is direct child of init (systemd-managed)"
        else
            print_warn "Process may not be systemd-managed (parent PID: $PARENT)"
        fi
    fi
}

check_environment() {
    print_section "Environment Variables"
    
    # Check if env file exists
    if [ -f "/etc/pi-matrix-agent/env.conf" ]; then
        print_ok "Environment file exists: /etc/pi-matrix-agent/env.conf"
        
        # Show key variables (filter out secrets)
        echo ""
        print_info "Contents (sensitive values hidden):"
        grep -v "accessToken\|ApiKey" /etc/pi-matrix-agent/env.conf | grep -v "^#" | grep "=" | while read line; do
            key=$(echo "$line" | cut -d'=' -f1)
            value=$(echo "$line" | cut -d'=' -f2-)
            if [ "$key" = "CONTROL_PUBLIC_URL" ]; then
                print_info "  $key=$value"
            else
                print_info "  $key=[set]"
            fi
        done
    else
        print_error "Environment file NOT found: /etc/pi-matrix-agent/env.conf"
        print_info "  Run: sudo ./scripts/install-service.sh"
    fi
    
    # Check running process environment
    print_info ""
    if pgrep -f "node.*dist/index.js" >/dev/null 2>&1; then
        PID=$(pgrep -f "node.*dist/index.js" | head -1)
        print_info "Running process (PID $PID) environment:"
        
        if [ -r "/proc/$PID/environ" ]; then
            for var in CONTROL_PUBLIC_URL CONTROL_PORT CONTROL_HOST CONFIG_FILE; do
                value=$(cat /proc/$PID/environ 2>/dev/null | tr '\0' '\n' | grep "^${var}=" | cut -d'=' -f2- || echo "")
                if [ -n "$value" ]; then
                    print_info "  $var=$value"
                else
                    print_warn "  $var=NOT SET"
                fi
            done
        else
            print_info "  Cannot read process environment (permission denied)"
        fi
    fi
}

check_control_url() {
    print_section "Control Public URL"
    
    # Check env file
    if [ -f "/etc/pi-matrix-agent/env.conf" ]; then
        CONFIG_VALUE=$(grep "^CONTROL_PUBLIC_URL=" /etc/pi-matrix-agent/env.conf 2>/dev/null | cut -d'=' -f2- | tr -d '"')
        if [ -n "$CONFIG_VALUE" ]; then
            print_ok "Configured in env.conf: $CONFIG_VALUE"
        else
            print_warn "Not configured in env.conf"
        fi
    fi
    
    # Check running process
    if pgrep -f "node.*dist/index.js" >/dev/null 2>&1; then
        PID=$(pgrep -f "node.*dist/index.js" | head -1)
        RUNTIME_VALUE=$(cat /proc/$PID/environ 2>/dev/null | tr '\0' '\n' | grep "^CONTROL_PUBLIC_URL=" | cut -d'=' -f2- || echo "")
        
        if [ -n "$RUNTIME_VALUE" ]; then
            print_ok "Running process has: $RUNTIME_VALUE"
            
            # Compare with config
            if [ -n "$CONFIG_VALUE" ] && [ "$CONFIG_VALUE" = "$RUNTIME_VALUE" ]; then
                print_ok "✓ Config and runtime match"
            elif [ -n "$CONFIG_VALUE" ]; then
                print_warn "⚠ Config ($CONFIG_VALUE) differs from runtime ($RUNTIME_VALUE)"
            fi
        else
            print_error "✗ Running process does NOT have CONTROL_PUBLIC_URL set!"
            print_info "  !control will return localhost URLs."
            print_info "  Fix: Update /etc/pi-matrix-agent/env.conf and run:"
            print_info "  sudo systemctl restart pi-matrix-agent"
        fi
    fi
}

check_listeners() {
    print_section "Network Listeners"
    
    # Check control port
    if ss -tlnp 2>/dev/null | grep -q ":9000"; then
        print_ok "Control server listening on port 9000"
        ss -tlnp 2>/dev/null | grep ":9000" | head -1
    else
        print_error "Control server NOT listening on port 9000"
    fi
}

check_tailscale_serve() {
    print_section "Tailscale Serve"
    
    if command -v tailscale >/dev/null 2>&1; then
        if tailscale serve status 2>/dev/null | grep -q "running"; then
            print_ok "Tailscale Serve is running"
            tailscale serve status 2>/dev/null | head -5
        else
            print_warn "Tailscale Serve is NOT running"
            print_info "  Start with: sudo ./scripts/setup-serve.sh 9000 127.0.0.1"
        fi
    else
        print_info "Tailscale not installed (skipping check)"
    fi
}

check_model_config() {
    print_section "Model Configuration"
    
    SETTINGS_FILE="/root/.pi-matrix-agent/agent/settings.json"
    MODELS_FILE="/root/.pi-matrix-agent/agent/models.json"
    
    if [ -f "$SETTINGS_FILE" ]; then
        print_ok "Settings file exists: $SETTINGS_FILE"
        
        # Read current model settings using grep/sed
        DEFAULT_PROVIDER=$(grep -o '"defaultProvider"[[:space:]]*:[[:space:]]*"[^"]*"' "$SETTINGS_FILE" 2>/dev/null | sed 's/.*:.*"\([^"]*\)"/\1/')
        DEFAULT_MODEL=$(grep -o '"defaultModel"[[:space:]]*:[[:space:]]*"[^"]*"' "$SETTINGS_FILE" 2>/dev/null | sed 's/.*:.*"\([^"]*\)"/\1/')
        
        if [ -n "$DEFAULT_PROVIDER" ]; then
            print_info "  Default Provider: $DEFAULT_PROVIDER"
        fi
        if [ -n "$DEFAULT_MODEL" ]; then
            print_info "  Default Model:    $DEFAULT_MODEL"
        fi
        
        # Determine profile name
        if [[ "$DEFAULT_PROVIDER" == *"qwen27"* ]]; then
            print_info "  Profile:        qwen27"
            print_info "  Model Name:     Qwen3.5 27B Opus"
        elif [[ "$DEFAULT_PROVIDER" == *"qwen36"* ]]; then
            print_info "  Profile:        qwen36"
            print_info "  Model Name:     Qwen3.6 35B A3B"
        fi
    else
        print_error "Settings file NOT found: $SETTINGS_FILE"
    fi
    
    print_info ""
    print_info "  To switch models: sudo ./scripts/model-switch.sh <qwen27|qwen36>"
    print_info "  To view status:   ./scripts/model-status.sh"
}

case "$action" in
    systemd)
        check_systemd_status
        ;;
    process)
        check_process_status
        ;;
    env)
        check_environment
        ;;
    control-url)
        check_control_url
        ;;
    model)
        check_model_config
        ;;
    full|*)
        echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
        echo -e "${BLUE}║         pi-matrix-agent Service Status Check           ║${NC}"
        echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"
        
        check_systemd_status
        check_process_status
        check_environment
        check_control_url
        check_model_config
        check_listeners
        check_tailscale_serve
        
        echo ""
        print_section "Quick Commands"
        print_info "  Start/Restart service:  sudo systemctl restart pi-matrix-agent"
        print_info "  View logs:              journalctl -u pi-matrix-agent -f"
        print_info "  Service status:         systemctl status pi-matrix-agent"
        print_info "  Kill manual processes:  pkill -f 'node dist/index.js'"
        ;;
esac
