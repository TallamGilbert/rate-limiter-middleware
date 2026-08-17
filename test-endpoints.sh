#!/bin/bash
BASE_URL="http://localhost:3000"
PASS=0
FAIL=0
TOTAL=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=========================================${NC}"
echo -e "${BLUE}  Rate Limiter Integration Tests${NC}"
echo -e "${BLUE}=========================================${NC}"
echo ""

if ! curl -s "$BASE_URL/" > /dev/null 2>&1; then
    echo -e "${RED}Error: Test server not running on port 3000${NC}"
    exit 1
fi

test_endpoint() {
    local name=$1
    local expected=$2
    local url=$3
    local extra=$4
    TOTAL=$((TOTAL + 1))
    
    if [ -n "$extra" ]; then
        response=$(curl -s -o /dev/null -w "%{http_code}" $extra "$url" 2>/dev/null)
    else
        response=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null)
    fi
    
    if [ "$response" -eq "$expected" ]; then
        echo -e "${GREEN}✓${NC} $name (Status: $response)"
        PASS=$((PASS+1))
    else
        echo -e "${RED}✗${NC} $name (Expected: $expected, Got: $response)"
        FAIL=$((FAIL+1))
    fi
}

# Test 1: Fixed Window - fresh window
echo -e "${YELLOW}Waiting 12 seconds for clean test windows...${NC}"
sleep 12
echo ""

echo -e "\n${YELLOW}Test 1: Fixed Window Counter (3 requests per 10 seconds)${NC}"
test_endpoint "Request 1 (should pass)" 200 "$BASE_URL/test/fixed-window"
test_endpoint "Request 2 (should pass)" 200 "$BASE_URL/test/fixed-window"
test_endpoint "Request 3 (should pass)" 200 "$BASE_URL/test/fixed-window"
test_endpoint "Request 4 (should be blocked)" 429 "$BASE_URL/test/fixed-window"

# Test 2: Token Bucket - fresh bucket
echo -e "\n${YELLOW}Test 2: Token Bucket (5 token burst)${NC}"
sleep 12
test_endpoint "Burst request 1" 200 "$BASE_URL/test/token-bucket"
test_endpoint "Burst request 2" 200 "$BASE_URL/test/token-bucket"
test_endpoint "Burst request 3" 200 "$BASE_URL/test/token-bucket"
test_endpoint "Burst request 4" 200 "$BASE_URL/test/token-bucket"
test_endpoint "Burst request 5" 200 "$BASE_URL/test/token-bucket"
test_endpoint "Burst request 6 (blocked)" 429 "$BASE_URL/test/token-bucket"

# Test 3: Allowlist
echo -e "\n${YELLOW}Test 3: Allowlist Bypass${NC}"
test_endpoint "Allowlisted request 1" 200 "$BASE_URL/test/allowlist"
test_endpoint "Allowlisted request 2" 200 "$BASE_URL/test/allowlist"
test_endpoint "Allowlisted request 3" 200 "$BASE_URL/test/allowlist"

# Test 4: Headers
echo -e "\n${YELLOW}Test 4: HTTP Headers${NC}"
sleep 12
TOTAL=$((TOTAL + 1))
headers=$(curl -s -I "$BASE_URL/test/headers" 2>/dev/null)
if echo "$headers" | grep -q "X-RateLimit-Remaining"; then
    echo -e "${GREEN}✓${NC} X-RateLimit-Remaining header present"
    PASS=$((PASS+1))
else
    echo -e "${RED}✗${NC} X-RateLimit-Remaining header missing"
    FAIL=$((FAIL+1))
fi

TOTAL=$((TOTAL + 1))
if echo "$headers" | grep -q "X-RateLimit-Reset"; then
    echo -e "${GREEN}✓${NC} X-RateLimit-Reset header present"
    PASS=$((PASS+1))
else
    echo -e "${RED}✗${NC} X-RateLimit-Reset header missing"
    FAIL=$((FAIL+1))
fi

# Test 5: 429 Headers (using existing exhausted limit from Test 1)
echo -e "\n${YELLOW}Test 5: 429 Response Headers${NC}"
TOTAL=$((TOTAL + 1))
response_429=$(curl -s -I "$BASE_URL/test/fixed-window" 2>/dev/null)
if echo "$response_429" | grep -q "Retry-After"; then
    echo -e "${GREEN}✓${NC} Retry-After header present on 429 response"
    PASS=$((PASS+1))
else
    echo -e "${RED}✗${NC} Retry-After header missing"
    FAIL=$((FAIL+1))
fi

# Test 6: Per-Route - fresh windows
echo -e "\n${YELLOW}Test 6: Per-Route Configuration${NC}"
sleep 16
test_endpoint "Strict route - request 1" 200 "$BASE_URL/test/strict"
test_endpoint "Strict route - request 2" 200 "$BASE_URL/test/strict"
test_endpoint "Strict route - request 3 (blocked)" 429 "$BASE_URL/test/strict"
test_endpoint "Generous route - should work" 200 "$BASE_URL/test/generous"

# Test 7: Per-User - fresh window
echo -e "\n${YELLOW}Test 7: Per-User Rate Limiting${NC}"
sleep 12
test_endpoint "Alice request 1" 200 "$BASE_URL/test/user" "-H 'X-User-Id: alice'"
test_endpoint "Alice request 2" 200 "$BASE_URL/test/user" "-H 'X-User-Id: alice'"
test_endpoint "Alice request 3" 200 "$BASE_URL/test/user" "-H 'X-User-Id: alice'"
test_endpoint "Alice request 4 (blocked)" 429 "$BASE_URL/test/user" "-H 'X-User-Id: alice'"
test_endpoint "Bob request 1 (should pass)" 200 "$BASE_URL/test/user" "-H 'X-User-Id: bob'"

# Test 8: Allowlist Runtime
echo -e "\n${YELLOW}Test 8: Allowlist Runtime Updates${NC}"
TOTAL=$((TOTAL + 1))
curl -s -X POST "$BASE_URL/admin/allowlist/add" \
  -H "Content-Type: application/json" \
  -d '{"ip": "10.0.0.99"}' > /dev/null 2>&1
allowlist=$(curl -s "$BASE_URL/admin/allowlist" 2>/dev/null)
if echo "$allowlist" | grep -q "10.0.0.99"; then
    echo -e "${GREEN}✓${NC} IP added to allowlist at runtime"
    PASS=$((PASS+1))
else
    echo -e "${RED}✗${NC} Failed to add IP to allowlist"
    FAIL=$((FAIL+1))
fi

TOTAL=$((TOTAL + 1))
curl -s -X POST "$BASE_URL/admin/allowlist/remove" \
  -H "Content-Type: application/json" \
  -d '{"ip": "10.0.0.99"}' > /dev/null 2>&1
allowlist=$(curl -s "$BASE_URL/admin/allowlist" 2>/dev/null)
if echo "$allowlist" | grep -qv "10.0.0.99" 2>/dev/null; then
    echo -e "${GREEN}✓${NC} IP removed from allowlist at runtime"
    PASS=$((PASS+1))
else
    echo -e "${RED}✗${NC} Failed to remove IP from allowlist"
    FAIL=$((FAIL+1))
fi

# Test 9: Unprotected route
echo -e "\n${YELLOW}Test 9: Unprotected Route${NC}"
test_endpoint "Unlimited request 1" 200 "$BASE_URL/test/unlimited"
test_endpoint "Unlimited request 2" 200 "$BASE_URL/test/unlimited"

# Summary
echo -e "\n${BLUE}=========================================${NC}"
echo -e "${BLUE}  Test Results${NC}"
echo -e "${BLUE}=========================================${NC}"
echo -e "${GREEN}Passed: $PASS${NC}"
echo -e "${RED}Failed: $FAIL${NC}"
echo -e "Total:  $TOTAL"
echo ""

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}🎉 ALL TESTS PASSED!${NC}"
    echo ""
    echo "✅ Fixed Window Counter: Working"
    echo "✅ Token Bucket: Working"
    echo "✅ Allowlist Bypass: Working"
    echo "✅ HTTP Headers: Working"
    echo "✅ 429 Retry-After: Working"
    echo "✅ Per-Route Config: Working"
    echo "✅ Per-User Limits: Working"
    echo "✅ Runtime Allowlist: Working"
    echo "✅ Unprotected Routes: Working"
    exit 0
else
    echo -e "${RED}❌ Some tests failed${NC}"
    exit 1
fi
