#!/bin/bash

# Run All Airdrop Tests
# This script runs all test files in the test/airdrop/ directory

set -e

echo "======================================"
echo "Running All Airdrop Tests"
echo "======================================"
echo ""

# Get the directory of this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Count test files
TEST_FILES=$(find "$SCRIPT_DIR" -name "*.test.ts" -type f | wc -l)
echo "Found $TEST_FILES test file(s)"
echo ""

# Run each test file
for test_file in "$SCRIPT_DIR"/*.test.ts; do
    if [ -f "$test_file" ]; then
        filename=$(basename "$test_file")
        echo "--------------------------------------"
        echo "Running: $filename"
        echo "--------------------------------------"
        npx hardhat test "$test_file" || {
            echo "❌ Test failed: $filename"
            exit 1
        }
        echo "✅ Test passed: $filename"
        echo ""
    fi
done

echo "======================================"
echo "All Airdrop Tests Passed! ✅"
echo "======================================"
