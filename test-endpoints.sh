#!/bin/bash

BASE_URL="http://localhost:3000"
PASS=0
FAIL=0

echo "========================================="
echo "  Rate Limiter Integration Tests"
echo "========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

test_endpoint() {
    local name=$1
    local expected_status=$2
    local url=$3
    local headers=$4
    
    if [ -n "$headers" ]; then
        response=$(curl -s -o /dev/null -w "%{http_code}" $headers "$url")
    else
        response=$(curl -s -o /dev/null -w "%{http_code}" "$url")
    fi
    
    if [ "$response" -eq "$expected_status" ]; then
        echo -e "${GREEN}✓${NC} $name (Status: $response)"
        PASS=$((PASS+1))
    else
        echo -e "${RED}✗${NC} $name (Expected: $expected_status, Got: $response)"
        FAIL=$((FAIL+1))
    fi
}

# Test Fixed Window - should allow 3 then block
echo -e "\n${YELLOW}Test 1: Fixed Window Counter (3 req/10sec)${NC}"
test_endpoint "Request 1 (should pass)" 200 "$BASE_URL/test/fixed-window"
test_endpoint "Request 2 (should pass)" 200 "$BASE_URL/test/fixed-window"
test_endpoint "Request 3 (should pass)" 200 "$BASE_URL/test/fixed-window"
test_endpoint "Request 4 (should fail)" 429 "$BASE_URL/test/fixed-window"

# Test Token Bucket - should allow burst of 5 then block
echo -e "\n${YELLOW}Test 2: Token Bucket (burst of 5)${NC}"
test_endpoint "Request 1 (should pass)" 200 "$BASE_URL/test/token-bucket"
test_endpoint "Request 2 (should pass)" 200 "$BASE_URL/test/token-bucket"
test_endpoint "Request 3 (should pass)" 200 "$BASE_URL/test/token-bucket"
test_endpoint "Request 4 (should pass)" 200 "$BASE_URL/test/token-bucket"
test_endpoint "Request 5 (should pass)" 200 "$BASE_URL/test/token-bucket"
test_endpoint "Request 6 (should fail)" 429 "$BASE_URL/test/token-bucket"

# Test Allowlist - localhost should bypass
echo -e "\n${YELLOW}Test 3: Allowlist Bypass${NC}"
test_endpoint "Allowlisted request 1" 200 "$BASE_URL/test/allowlist"
test_endpoint "Allowlisted request 2" 200 "$BASE_URL/test/allowlist"
test_endpoint "Allowlisted request 3" 200 "$BASE_URL/test/allowlist"

# Test Headers
echo -e "\n${YELLOW}Test 4: HTTP Headers${NC}"
headers=$(curl -s -I "$BASE_URL/test/headers")
if echo "$headers" | grep -q "X-RateLimit-Remaining"; then
    echo -e "${GREEN}✓${NC} X-RateLimit-Remaining header present"
    PASS=$((PASS+1))
else
    echo -e "${RED}✗${NC} X-RateLimit-Remaining header missing"
    FAIL=$((FAIL+1))
fi

if echo "$headers" | grep -q "X-RateLimit-Reset"; then
    echo -e "${GREEN}✓${NC} X-RateLimit-Reset header present"
    PASS=$((PASS+1))
else
    echo -e "${RED}✗${NC} X-RateLimit-Reset header missing"
    FAIL=$((FAIL+1))
fi

# Test 429 Response Headers
echo -e "\n${YELLOW}Test 5: 429 Response Headers${NC}"
# Exhaust the limit first
for i in {1..3}; do curl -s "$BASE_URL/test/fixed-window" > /dev/null; done
# Get 429 response
response_429=$(curl -s -I "$BASE_URL/test/fixed-window")
if echo "$response_429" | grep -q "Retry-After"; then
    echo -e "${GREEN}✓${NC} Retry-After header present on 429"
    PASS=$((PASS+1))
else
    echo -e "${RED}✗${NC} Retry-After header missing on 429"
    FAIL=$((FAIL+1))
fi

# Test Per-Route Configuration
echo -e "\n${YELLOW}Test 6: Per-Route Configuration${NC}"
# Strict route (2 requests limit)
test_endpoint "Strict route - request 1" 200 "$BASE_URL/test/strict"
test_endpoint "Strict route - request 2" 200 "$BASE_URL/test/strict"
test_endpoint "Strict route - request 3 (should fail)" 429 "$BASE_URL/test/strict"

# Generous route should still work
test_endpoint "Generous route - still works" 200 "$BASE_URL/test/generous"

# Test Per-User Limits
echo -e "\n${YELLOW}Test 7: Per-User Rate Limiting${NC}"
test_endpoint "User Alice - request 1" 200 "$BASE_URL/test/user" "-H 'X-User-Id: alice'"
test_endpoint "User Alice - request 2" 200 "$BASE_URL/test/user" "-H 'X-User-Id: alice'"
test_endpoint "User Alice - request 3" 200 "$BASE_URL/test/user" "-H 'X-User-Id: alice'"
test_endpoint "User Alice - request 4 (should fail)" 429 "$BASE_URL/test/user" "-H 'X-User-Id: alice'"
test_endpoint "User Bob - request 1 (should pass)" 200 "$BASE_URL/test/user" "-H 'X-User-Id: bob'"

# Test Allowlist Runtime Updates
echo -e "\n${YELLOW}Test 8: Allowlist Runtime Updates${NC}"
# Add test IP to allowlist
curl -s -X POST "$BASE_URL/admin/allowlist/add" \
  -H "Content-Type: application/json" \
  -d '{"ip": "10.0.0.99"}' > /dev/null

# Verify it's added
allowlist=$(curl -s "$BASE_URL/admin/allowlist")
if echo "$allowlist" | grep -q "10.0.0.99"; then
    echo -e "${GREEN}✓${NC} IP added to allowlist at runtime"
    PASS=$((PASS+1))
else
    echo -e "${RED}✗${NC} Failed to add IP to allowlist"
    FAIL=$((FAIL+1))
fi

# Remove test IP
curl -s -X POST "$BASE_URL/admin/allowlist/remove" \
  -H "Content-Type: application/json" \
  -d '{"ip": "10.0.0.99"}' > /dev/null

# Verify it's removed
allowlist=$(curl -s "$BASE_URL/admin/allowlist")
if echo "$allowlist" | grep -qv "10.0.0.99"; then
    echo -e "${GREEN}✓${NC} IP removed from allowlist at runtime"
    PASS=$((PASS+1))
else
    echo -e "${RED}✗${NC} Failed to remove IP from allowlist"
    FAIL=$((FAIL+1))
fi

# Unprotected route should always work
echo -e "\n${YELLOW}Test 9: Unprotected Route${NC}"
test_endpoint "Unlimited request 1" 200 "$BASE_URL/test/unlimited"
test_endpoint "Unlimited request 2" 200 "$BASE_URL/test/unlimited"
test_endpoint "Unlimited request 3" 200 "$BASE_URL/test/unlimited"

# Summary
echo -e "\n========================================="
echo -e "  Test Results"
echo -e "========================================="
echo -e "${GREEN}Passed: $PASS${NC}"
echo -e "${RED}Failed: $FAIL${NC}"
echo -e "Total: $((PASS + FAIL))"
echo ""

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN} All tests passed!${NC}"
    exit 0
else
    echo -e "${RED} Some tests failed${NC}"
    exit 1
fi
