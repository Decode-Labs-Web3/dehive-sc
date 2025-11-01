# Sepolia Test Script Usage Guide

## Overview

The `testSepolia.ts` script provides comprehensive testing of the DehiveProxy + MessageFacet integration on Sepolia testnet, simulating real frontend interactions.

## Prerequisites

### 1. Environment Variables

Create or update your `.env` file with:

```bash
# Relayer private key (proxy owner)
PRIVATE_KEY=your_relayer_private_key_here

# User A private key
PRIVATE_KEY_A=your_user_a_private_key_here

# User B private key
PRIVATE_KEY_B=your_user_b_private_key_here

# Sepolia RPC URL (optional, has default)
SEPOLIA_RPC_URL=https://eth-sepolia.public.blastapi.io
```

### 2. Deployed Proxy Address

The script needs the proxy address. It will:
1. First check `PROXY_ADDRESS` environment variable
2. If not found, load from `deployments/sepolia_dehiveProxy_messageFacet.json`
3. If neither exists, it will throw an error

You can also set it manually:
```bash
export PROXY_ADDRESS=0xYourProxyAddress
```

### 3. Account Balances

Ensure all accounts have sufficient Sepolia ETH:
- **Relayer/Proxy Owner**: At least 0.01 ETH (for gas + admin functions)
- **User A**: At least 0.02 ETH (for deposits + message fees)
- **User B**: At least 0.01 ETH (for message fees)

Get Sepolia ETH from faucets:
- https://sepoliafaucet.com/
- https://www.alchemy.com/faucets/ethereum-sepolia
- https://faucet.quicknode.com/ethereum/sepolia

## Usage

### Basic Usage

```bash
npx hardhat run scripts/dehive/testSepolia.ts --network sepolia
```

### With Custom Proxy Address

```bash
PROXY_ADDRESS=0xYourProxyAddress npx hardhat run scripts/dehive/testSepolia.ts --network sepolia
```

## What the Script Tests

### 1. Conversation Creation
- Creates conversation between User A and User B
- Creates conversation between User A and Relayer
- Verifies conversation IDs are deterministic

### 2. Message Sending (Pay-as-You-Go)
- User A sends message to User B (direct payment)
- User B sends message back to User A (direct payment)
- Verifies fees are charged correctly

### 3. Fund Deposits
- User A deposits ETH for credit-based messaging
- Verifies balance is tracked correctly

### 4. Relayer Messaging
- User A sends messages via relayer (using deposited funds)
- Verifies fees are deducted from user balance
- Tests multiple relayer messages

### 5. Conversation Key Retrieval
- User A retrieves their encrypted conversation key
- User B retrieves their encrypted conversation key
- Verifies keys can decrypt messages correctly

### 6. Message Fetching from Blockchain
- Fetches all messages from blockchain
- Fetches conversation-specific messages
- Decrypts and displays messages

### 7. Admin Functions (with Reset)
- Tests `setPayAsYouGoFee()` (if relayer is proxy owner)
- Tests `setRelayerFee()` (if relayer is proxy owner)
- Tests `setRelayer()` (if relayer is proxy owner)
- **Automatically resets all fees to original values**

### 8. Final Verification
- Verifies all fees are reset to defaults
- Verifies final balances
- Displays test summary

## Test Output

The script provides detailed output for each test:
- ✅ Success indicators
- Transaction hashes
- Block numbers
- Balances and fees
- Error messages (if any)

At the end, it displays a comprehensive summary:
- Number of conversations created
- Number of messages sent
- Number of relayer messages
- Number of deposits made
- Number of admin functions tested
- Any errors encountered

## Test Results

Test results are saved to:
```
deployments/sepolia_test_results_<timestamp>.json
```

This file contains:
- Network information
- Proxy address
- Test results summary
- Timestamp of test run

## Important Notes

### Fee Reset
- The script **automatically resets fees** to original values after testing
- If admin functions are tested, fees are guaranteed to be reset
- Even if errors occur, the script attempts to reset fees in the catch block

### Gas Costs
- The script performs multiple transactions
- Ensure accounts have sufficient ETH for:
  - Gas fees (varies based on network conditions)
  - Message fees (if using pay-as-you-go)
  - Deposits (if testing deposit functionality)

### Error Handling
- The script catches errors and continues testing
- If admin function tests fail, other tests continue
- Errors are collected and displayed at the end

## Troubleshooting

### Error: "Missing private keys in .env file"
- Ensure `PRIVATE_KEY`, `PRIVATE_KEY_A`, and `PRIVATE_KEY_B` are set in `.env`

### Error: "Proxy address not found"
- Set `PROXY_ADDRESS` env var, or
- Ensure `deployments/sepolia_dehiveProxy_messageFacet.json` exists
- Deploy the proxy first using `deploySepolia.ts`

### Error: "Insufficient funds"
- Add more Sepolia ETH to the accounts
- Use a faucet to get testnet ETH

### Error: "Cannot test admin functions - relayer is not proxy owner"
- This is expected if relayer is not the proxy owner
- Admin function tests will be skipped
- Other tests continue normally

### Error: "Transaction failed"
- Check account balances
- Check network connectivity
- Verify proxy address is correct
- Check if proxy has the facet installed

## Example Output

```
================================================================================
DehiveProxy + MessageFacet - Sepolia Test Script
================================================================================

Network: sepolia (Chain ID: 11155111)

✓ Loaded proxy address from deployment file: 0x...

📋 Test Accounts:
  Relayer: 0x...
  User A: 0x...
  User B: 0x...

💰 Account Balances:
  Relayer: 0.5 ETH
  User A: 0.3 ETH
  User B: 0.2 ETH

...

================================================================================
Test Summary
================================================================================
Network: sepolia (Chain ID: 11155111)
Proxy Address: 0x...

📊 Test Results:
  ✓ Conversations Created: 2
  ✓ Messages Sent (Pay-as-You-Go): 2
  ✓ Messages Sent (via Relayer): 2
  ✓ Deposits Made: 1
  ✓ Admin Functions Tested: 3
  ❌ Errors: 0

================================================================================
✅ All Tests Completed Successfully!
================================================================================
```

## Next Steps

After successful testing:
1. Review test results in the generated JSON file
2. Verify all transactions on Sepolia explorer
3. Use the proxy address for frontend integration
4. Keep the test results file for reference
