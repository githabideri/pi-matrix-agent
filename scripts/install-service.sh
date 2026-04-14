#!/bin/bash
#
# install-service.sh - Install/update pi-matrix-agent systemd service
#
# Usage:
#   ./scripts/install-service.sh           # Install/update service
#   ./scripts/install-service.sh install   # Install service
#   ./scripts/install-service.sh update    # Update service (reinstall + restart)
#   ./scripts/install-service.sh uninstall # Remove service
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
print_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    print_error "This script must be run as root (sudo)"
    exit 1
fi

# Determine repo root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

SERVICE_FILE="$REPO_ROOT/deploy/systemd/pi-matrix-agent.service"
ENV_EXAMPLE="$REPO_ROOT/deploy/systemd/env.conf.example"
ENV_FILE="/etc/pi-matrix-agent/env.conf"
SYSTEMD_DIR="/etc/systemd/system"

action="${1:-install}"

case "$action" in
    install)
        print_info "Installing pi-matrix-agent service..."
        
        # Check service file exists
        if [ ! -f "$SERVICE_FILE" ]; then
            print_error "Service file not found: $SERVICE_FILE"
            exit 1
        fi
        
        # Check env file exists
        if [ ! -f "$ENV_FILE" ]; then
            print_warn "Environment file not found: $ENV_FILE"
            print_warn ""
            print_warn "============================================================================"
            print_warn "Environment file is REQUIRED before the service can run."
            print_warn "============================================================================"
            print_warn ""
            print_warn "NEXT STEPS:"
            print_warn "  1. Create the environment file:"
            print_warn "     mkdir -p /etc/pi-matrix-agent"
            print_warn "     cp $ENV_EXAMPLE $ENV_FILE"
            print_warn ""
            print_warn "  2. Edit and configure the environment file:"
            print_warn "     nano $ENV_FILE"
            print_warn ""
            print_warn "     Required: Set CONFIG_FILE and CONTROL_PUBLIC_URL"
            print_warn ""
            print_warn "  3. Re-run this script to install the service:"
            print_warn "     $0"
            print_warn ""
            print_warn "============================================================================"
            exit 1
        fi
        
        # Copy service file
        cp "$SERVICE_FILE" "$SYSTEMD_DIR/pi-matrix-agent.service"
        print_info "Copied service file to $SYSTEMD_DIR/pi-matrix-agent.service"
        
        # Reload systemd
        systemctl daemon-reload
        print_info "Reloaded systemd daemon"
        
        # Enable service
        systemctl enable pi-matrix-agent
        print_info "Enabled pi-matrix-agent to start on boot"
        
        print_info ""
        print_info "Service installed successfully!"
        print_info ""
        print_info "To start the service:"
        print_info "  systemctl start pi-matrix-agent"
        print_info ""
        print_info "To check status:"
        print_info "  systemctl status pi-matrix-agent"
        print_info ""
        print_info "To view logs:"
        print_info "  journalctl -u pi-matrix-agent -f"
        ;;
        
    update)
        print_info "Updating pi-matrix-agent service..."
        
        # Stop service
        print_info "Stopping service..."
        systemctl stop pi-matrix-agent 2>/dev/null || true
        
        # Reinstall
        if [ -f "$SERVICE_FILE" ]; then
            cp "$SERVICE_FILE" "$SYSTEMD_DIR/pi-matrix-agent.service"
            print_info "Updated service file"
        fi
        
        # Reload systemd
        systemctl daemon-reload
        print_info "Reloaded systemd daemon"
        
        # Restart service
        print_info "Starting service..."
        systemctl start pi-matrix-agent
        
        print_info ""
        print_info "Service updated successfully!"
        print_info "Check status: systemctl status pi-matrix-agent"
        ;;
        
    uninstall)
        print_info "Uninstalling pi-matrix-agent service..."
        
        # Stop service
        systemctl stop pi-matrix-agent 2>/dev/null || true
        
        # Disable service
        systemctl disable pi-matrix-agent 2>/dev/null || true
        
        # Remove service file
        rm -f "$SYSTEMD_DIR/pi-matrix-agent.service"
        
        # Reload systemd
        systemctl daemon-reload
        
        print_info "Service uninstalled"
        print_info "Environment file preserved at: $ENV_FILE"
        ;;
        
    *)
        echo "Usage: $0 {install|update|uninstall}"
        exit 1
        ;;
esac
