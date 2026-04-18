#!/bin/bash
# ci-local.sh - Run the same checks as the CI pipeline locally
#
# This script runs the standard quality gates:
# 1. Install dependencies (fresh)
# 2. Run tests
# 3. Run type check and lint
# 4. Build
#
# Usage:
#   ./scripts/ci-local.sh
#   npm run ci:local
#
# To run with npm cache (faster):
#   ./scripts/ci-local.sh --skip-install

set -e

SKIP_INSTALL=0

# Parse arguments
for arg in "$@"; do
    case $arg in
        --skip-install)
            SKIP_INSTALL=1
            shift
            ;;
    esac
done

echo "========================================"
echo "   Local CI - Quality Gates"
echo "========================================"
echo ""

# Step 1: Install dependencies
if [ $SKIP_INSTALL -eq 0 ]; then
    echo "Step 1/4: Installing dependencies (npm ci)..."
    npm ci
    echo "✓ Dependencies installed"
    echo ""
else
    echo "Step 1/4: Skipping dependency install (--skip-install)"
    echo ""
fi

# Step 2: Run tests
echo "Step 2/4: Running tests..."
npm test
echo "✓ Tests passed"
echo ""

# Step 3: Run type check and lint
echo "Step 3/4: Running type check and lint..."
npm run check
echo "✓ Type check and lint passed"
echo ""

# Step 4: Build
echo "Step 4/4: Building..."
npm run build
echo "✓ Build succeeded"
echo ""

echo "========================================"
echo "   All quality gates passed!"
echo "========================================"
