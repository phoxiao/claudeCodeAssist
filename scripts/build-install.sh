#!/bin/bash

# VS Code Extension Build and Install Script
# This script compiles, packages, and installs the Claude Code Assist extension

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo -e "${YELLOW}=== Claude Code Assist - Build & Install ===${NC}"
echo ""

# Step 1: Install dependencies
echo -e "${YELLOW}[1/4] Installing dependencies...${NC}"
npm install
echo -e "${GREEN}Dependencies installed.${NC}"
echo ""

# Step 2: Compile TypeScript
echo -e "${YELLOW}[2/4] Compiling TypeScript...${NC}"
npm run compile
echo -e "${GREEN}Compilation complete.${NC}"
echo ""

# Step 3: Package extension
echo -e "${YELLOW}[3/4] Packaging extension...${NC}"

# Remove old .vsix files
rm -f *.vsix

npm run package
VSIX_FILE=$(ls -1 *.vsix 2>/dev/null | head -n 1)

if [ -z "$VSIX_FILE" ]; then
    echo -e "${RED}Error: No .vsix file generated${NC}"
    exit 1
fi

echo -e "${GREEN}Package created: ${VSIX_FILE}${NC}"
echo ""

# Step 4: Install extension
echo -e "${YELLOW}[4/4] Installing extension to VS Code...${NC}"

if command -v code &> /dev/null; then
    code --install-extension "$VSIX_FILE" --force
    echo -e "${GREEN}Extension installed successfully!${NC}"
    echo ""
    echo -e "${YELLOW}Please reload VS Code to activate the extension.${NC}"
    echo -e "You can press ${GREEN}Cmd+Shift+P${NC} and run ${GREEN}'Developer: Reload Window'${NC}"
else
    echo -e "${RED}Error: 'code' command not found.${NC}"
    echo -e "Please install the 'code' command by:"
    echo -e "  1. Open VS Code"
    echo -e "  2. Press Cmd+Shift+P"
    echo -e "  3. Run 'Shell Command: Install 'code' command in PATH'"
    echo ""
    echo -e "Or manually install the extension:"
    echo -e "  code --install-extension $VSIX_FILE"
    exit 1
fi

echo ""
echo -e "${GREEN}=== Build and Install Complete ===${NC}"
