#!/bin/bash

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=========================================${NC}"
echo -e "${BLUE}  Rate Limiter Complete Test Suite${NC}"
echo -e "${BLUE}=========================================${NC}"
echo ""

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}Shutting down test server...${NC}"
    if [ -n "$SERVER_PID" ]; then
        kill $SERVER_PID 2>/dev/null
        wait $SERVER_PID 2>/dev/null
    fi
    echo -e "${GREEN}Test server stopped.${NC}"
}

# Set trap to cleanup on exit
trap cleanup EXIT INT TERM

# Step 1: Run unit tests
echo -e "${YELLOW}[1/3] Running Unit Tests...${NC}"
npx vitest run --reporter=verbose
UNIT_EXIT=$?

if [ $UNIT_EXIT -ne 0 ]; then
    echo -e "${RED} Unit tests failed${NC}"
    exit 1
fi
echo -e "${GREEN} Unit tests passed${NC}"
echo ""

# Step 2: Start test server in background
echo -e "${YELLOW}[2/3] Starting test server...${NC}"
npx tsx test-manual.ts &
SERVER_PID=$!

# Wait for server to be ready
echo -n "Waiting for server to start"
for i in {1..30}; do
    if curl -s http://localhost:3000/ > /dev/null 2>&1; then
        echo ""
        echo -e "${GREEN} Server started successfully${NC}"
        break
    fi
    echo -n "."
    sleep 0.5
done

# Check if server actually started
if ! curl -s http://localhost:3000/ > /dev/null 2>&1; then
    echo ""
    echo -e "${RED} Server failed to start${NC}"
    exit 1
fi

# Step 3: Run integration tests
echo ""
echo -e "${YELLOW}[3/3] Running Integration Tests...${NC}"
sleep 1  # Give server a moment to fully initialize
./test-endpoints.sh
INTEGRATION_EXIT=$?

if [ $INTEGRATION_EXIT -ne 0 ]; then
    echo -e "${RED} Integration tests failed${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}=========================================${NC}"
echo -e "${GREEN}   All Tests Passed!${NC}"
echo -e "${BLUE}=========================================${NC}"
echo ""
echo "Summary:"
echo "  Unit Tests"
echo "   Integration Tests"
echo "   Concurrency Tests (included in integration)"
exit 0
