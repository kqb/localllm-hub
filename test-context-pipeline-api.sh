#!/bin/bash

# Test script for context-pipeline API endpoints
set -e

BASE_URL="http://127.0.0.1:3847"

echo "=== Testing Context Pipeline API Endpoints ==="
echo ""

echo "1. Testing /api/context-pipeline/enrich with weather query..."
RESPONSE=$(curl -s -X POST "$BASE_URL/api/context-pipeline/enrich" \
  -H "Content-Type: application/json" \
  -d '{"message": "What is the weather like?", "sessionId": "test-session-1"}')

echo "   Route: $(echo "$RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data['routeSuggestion']['route'])")"
echo "   Clawdbot Model: $(echo "$RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data['routeSuggestion']['clawdbotModel'])")"
echo "   RAG Results: $(echo "$RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data['metadata']['ragResultCount'])")"
echo "   Assembly Time: $(echo "$RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data['metadata']['assemblyTimeMs'])")"
echo ""

echo "2. Testing /api/context-pipeline/enrich with planning task..."
RESPONSE=$(curl -s -X POST "$BASE_URL/api/context-pipeline/enrich" \
  -H "Content-Type: application/json" \
  -d '{"message": "Create a comprehensive architecture plan for this system", "sessionId": "test-planning"}')

echo "   Route: $(echo "$RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data['routeSuggestion']['route'])")"
echo "   Clawdbot Model: $(echo "$RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data['routeSuggestion']['clawdbotModel'])")"
echo ""

echo "3. Testing /api/context-pipeline/enrich with coding task..."
RESPONSE=$(curl -s -X POST "$BASE_URL/api/context-pipeline/enrich" \
  -H "Content-Type: application/json" \
  -d '{"message": "Fix the bug in login.js", "sessionId": "test-coding"}')

echo "   Route: $(echo "$RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data['routeSuggestion']['route'])")"
echo "   Clawdbot Model: $(echo "$RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data['routeSuggestion']['clawdbotModel'])")"
echo ""

echo "4. Testing /api/context-pipeline/enrich with local task..."
RESPONSE=$(curl -s -X POST "$BASE_URL/api/context-pipeline/enrich" \
  -H "Content-Type: application/json" \
  -d '{"message": "List all files", "sessionId": "test-local"}')

echo "   Route: $(echo "$RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data['routeSuggestion']['route'])")"
echo "   Clawdbot Model: $(echo "$RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data['routeSuggestion']['clawdbotModel'])")"
echo ""

echo "5. Testing /api/context-pipeline/persist..."
RESPONSE=$(curl -s -X POST "$BASE_URL/api/context-pipeline/persist" \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "test-session-1", "userMessage": "What is the weather?", "assistantMessage": "The weather is sunny today.", "model": "claude-sonnet-4-5"}')

STATUS=$(echo "$RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data['status'])")
echo "   Status: $STATUS"
echo ""

echo "6. Testing error handling (missing message)..."
RESPONSE=$(curl -s -X POST "$BASE_URL/api/context-pipeline/enrich" \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "test-session-1"}')

HAS_ERROR=$(echo "$RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print('error' in data)")
echo "   Error returned: $HAS_ERROR"
echo ""

echo "=== All tests passed! ==="
