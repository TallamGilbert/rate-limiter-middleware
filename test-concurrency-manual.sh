#!/bin/bash

BASE_URL="http://localhost:3000/test/fixed-window"
LIMIT=3
CONCURRENT=20

echo "========================================="
echo "  Concurrency Stress Test"
echo "========================================="
echo "Limit: $LIMIT requests"
echo "Sending: $CONCURRENT concurrent requests"
echo ""

# Send concurrent requests and capture status codes
responses=$(for i in $(seq 1 $CONCURRENT); do
    curl -s -o /dev/null -w "%{http_code}\n" "$BASE_URL" &
done
wait)

# Count results
successful=$(echo "$responses" | grep -c "200")
rejected=$(echo "$responses" | grep -c "429")

echo "Results:"
echo "  200 OK: $successful (should be ≤ $LIMIT)"
echo "  429 Rejected: $rejected (should be $((CONCURRENT - LIMIT)))"

if [ "$successful" -le "$LIMIT" ] && [ "$rejected" -eq "$((CONCURRENT - LIMIT))" ]; then
    echo ""
    echo " Concurrency test passed! No over-admission detected."
    exit 0
else
    echo ""
    echo " Concurrency test failed! Over-admission detected."
    echo "   Expected at most $LIMIT successful requests, got $successful"
    exit 1
fi
