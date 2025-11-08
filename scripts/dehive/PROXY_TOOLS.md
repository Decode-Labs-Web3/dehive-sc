# DehiveProxy Management Tools

This directory contains tools for managing and verifying the DehiveProxy and its installed facets.

## Overview

The DehiveProxy uses the Diamond pattern, which allows a single proxy contract to delegate function calls to multiple implementation contracts (called "facets"). This provides modularity, upgradability, and bypasses Ethereum's 24KB contract size limit.

## Available Scripts

### 1. `setRelayer.ts` - Set Relayer Address

Sets the relayer address for the Message contract through the DehiveProxy.

**Usage:**
```bash
# Using deployed proxy
npx hardhat run scripts/dehive/setRelayer.ts --network sepolia

# With custom addresses via environment variables
PROXY_ADDRESS=0x41bc86ba44813b2b106e1942cb68cc471714df2d \
NEW_RELAYER_ADDRESS=0xa6911d2f9e2f9be993fd71768ee05876390948e9 \
npx hardhat run scripts/dehive/setRelayer.ts --network sepolia
```

**What it does:**
- Connects to the DehiveProxy at the specified address
- Calls `setRelayer()` function through the proxy
- Verifies the relayer was successfully updated
- Saves transaction details to deployments directory

**Requirements:**
- `PRIVATE_KEY` in .env (must be the proxy owner)
- Proxy address (from `PROXY_ADDRESS` env var or deployment file)
- New relayer address (from `NEW_RELAYER_ADDRESS` env var or uses default)

**Output:**
- Transaction hash
- Block number
- Gas used
- Verification of updated relayer address
- Result saved to `deployments/setRelayer_<network>_<timestamp>.json`

**Example Output:**
```
================================================================================
Set Relayer Address Script
================================================================================

Network: sepolia (Chain ID: 11155111)

✓ Using proxy address from PROXY_ADDRESS env var: 0x41bc86ba44813b2b106e1942cb68cc471714df2d
✓ Using specified relayer address: 0xa6911d2f9e2f9be993fd71768ee05876390948e9

📋 Configuration:
  Owner (caller): 0x09e23052d4a07D38C85C35Af34c9e1d0555243EE
  Proxy Address: 0x41bc86ba44813b2b106e1942cb68cc471714df2d
  New Relayer Address: 0xa6911d2f9e2f9be993fd71768ee05876390948e9

✓ Transaction sent: 0x1234567890abcdef...
✓ Transaction confirmed at block 12345678

✅ Relayer successfully set to 0xa6911d2f9e2f9be993fd71768ee05876390948e9
```

### 2. `verifyProxy.ts` - Verify Proxy Configuration

Comprehensive verification script that checks if the DehiveProxy is correctly configured to delegate calls to the Message contract.

**Usage:**
```bash
# Verify deployed proxy
npx hardhat run scripts/dehive/verifyProxy.ts --network sepolia

# With custom proxy address
PROXY_ADDRESS=0x41bc86ba44813b2b106e1942cb68cc471714df2d \
npx hardhat run scripts/dehive/verifyProxy.ts --network sepolia
```

**What it verifies:**

1. **Facet Installation**
   - Checks if MessageFacet is installed in the proxy
   - Lists all installed facets and their function counts

2. **Function Selector Mapping**
   - Verifies all IMessage functions are correctly mapped
   - Shows which facet handles each function selector
   - Reports any unmapped selectors

3. **Read Operations (View Functions)**
   - Tests `owner()` through proxy
   - Tests `payAsYouGoFee()` through proxy
   - Tests `relayerFee()` through proxy
   - Tests `relayer()` through proxy
   - Tests `funds()` through proxy

4. **Write Operations (State-Changing Functions)**
   - Simulates `setRelayer()` (using staticCall)
   - Simulates `setPayAsYouGoFee()` (using staticCall)
   - Simulates `setRelayerFee()` (using staticCall)
   - Simulates `depositFunds()` (using staticCall)

5. **Storage Architecture**
   - Verifies Diamond Storage pattern implementation
   - Confirms proxy and facet storage separation
   - Checks owner address consistency

**Requirements:**
- `PRIVATE_KEY` in .env
- Proxy address (from `PROXY_ADDRESS` env var or deployment file)

**Output:**
- Detailed test results for each verification step
- Summary of PASS/FAIL/WARN counts
- Results saved to `deployments/proxyVerification_<network>_<timestamp>.json`

**Example Output:**
```
================================================================================
DehiveProxy Verification Script
================================================================================

Network: sepolia (Chain ID: 11155111)

================================================================================
Step 1: Loading Proxy Address
================================================================================

✓ Using proxy address from PROXY_ADDRESS env var: 0x41bc86ba44813b2b106e1942cb68cc471714df2d

================================================================================
Step 3: Verifying Facet Installation
================================================================================

✓ Found 1 installed facet(s)

  Facet 1:
    Address: 0xEd0E195310A1419c309935DCe97fCA507d82DE11
    Function Selectors: 12
    ✓ This is the MessageFacet

================================================================================
Step 4: Verifying Function Selectors
================================================================================

✓ Found 12 expected function selectors from IMessage

Verifying function selector mappings:
  ✓ 0x8da5cb5b -> 0xEd0E1953...
  ✓ 0x19ab453c -> 0xEd0E1953...
  ✓ 0x3f4ba83a -> 0xEd0E1953...
  ...

✅ All 12 function selectors are correctly mapped

================================================================================
Step 5: Verifying Read Operations (View Functions)
================================================================================

Testing view functions through proxy:
  ✓ owner() -> 0x09e23052d4a07D38C85C35Af34c9e1d0555243EE
    ✓ Matches direct proxy.owner() call
  ✓ payAsYouGoFee() -> 0.0000002 ETH
  ✓ relayerFee() -> 0.0000001 ETH
  ✓ relayer() -> 0xa6911d2f9e2f9be993fd71768ee05876390948e9
  ✓ funds(0x09e23052...) -> 0.0 ETH

================================================================================
Verification Summary
================================================================================

📊 Test Results:
  ✅ PASS: 15
  ❌ FAIL: 0
  ⚠️  WARN: 0
  📝 Total: 15

✅ Proxy Verification PASSED!
   The proxy is correctly configured to delegate calls to Message contract.
```

## Diamond Pattern Explained

### How the Proxy Works

1. **Function Routing**: The proxy stores a mapping of function selectors to facet addresses
2. **Delegation**: When a function is called, the proxy looks up which facet handles it and delegates the call
3. **Storage**: Facets use Diamond Storage pattern with namespaced slots to avoid storage collisions
4. **Execution**: Facet code executes in the proxy's context, using the proxy's storage

### Call Flow Example

```
User calls: proxy.sendMessage(conversationId, recipient, encryptedMessage)
    ↓
1. msg.sig = 0x412738c8 (sendMessage selector)
    ↓
2. Proxy looks up: _selectorToFacet[0x412738c8] = 0x1234... (MessageFacet)
    ↓
3. Proxy delegates call to MessageFacet at 0x1234...
    ↓
4. MessageFacet executes using proxy's storage (Diamond Storage)
    ↓
5. Result returned to user
```

## Environment Variables

### Required
- `PRIVATE_KEY`: Private key of the proxy owner (must have owner privileges)

### Optional
- `PROXY_ADDRESS`: Address of the deployed DehiveProxy
  - If not set, scripts will try to load from deployment file
  - Falls back to hardcoded address: `0x41bc86ba44813b2b106e1942cb68cc471714df2d`

- `NEW_RELAYER_ADDRESS`: Address of the new relayer (for setRelayer.ts)
  - If not set, uses default: `0xa6911d2f9e2f9be993fd71768ee05876390948e9`

## Deployment Files

Scripts save results to the `deployments/` directory:

- `setRelayer_<network>_<timestamp>.json`: Transaction details from setRelayer
- `proxyVerification_<network>_<timestamp>.json`: Verification results

**Example setRelayer result:**
```json
{
  "network": "sepolia",
  "chainId": "11155111",
  "proxyAddress": "0x41bc86ba44813b2b106e1942cb68cc471714df2d",
  "newRelayerAddress": "0xa6911d2f9e2f9be993fd71768ee05876390948e9",
  "owner": "0x09e23052d4a07D38C85C35Af34c9e1d0555243EE",
  "transactionHash": "0x1234...",
  "blockNumber": 12345678,
  "gasUsed": "45678",
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

**Example verification result:**
```json
{
  "network": "sepolia",
  "chainId": "11155111",
  "proxyAddress": "0x41bc86ba44813b2b106e1942cb68cc471714df2d",
  "facetAddress": "0xEd0E195310A1419c309935DCe97fCA507d82DE11",
  "tester": "0x09e23052d4a07D38C85C35Af34c9e1d0555243EE",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "summary": {
    "pass": 15,
    "fail": 0,
    "warn": 0,
    "total": 15
  },
  "results": [...]
}
```

## Common Issues

### 1. "Only owner can call this function"
**Solution**: Ensure you're using the proxy owner's private key in `.env`
```bash
# Check who the owner is
npx hardhat run scripts/dehive/verifyProxy.ts --network sepolia

# Then use that owner's private key
PRIVATE_KEY=<owner_private_key> npx hardhat run scripts/dehive/setRelayer.ts --network sepolia
```

### 2. "Function not found"
**Cause**: MessageFacet is not installed or function selectors are not mapped
**Solution**: Run verification script to diagnose:
```bash
npx hardhat run scripts/dehive/verifyProxy.ts --network sepolia
```

### 3. "Proxy address not found"
**Solution**: Set PROXY_ADDRESS environment variable or create deployment file:
```bash
PROXY_ADDRESS=0x41bc86ba44813b2b106e1942cb68cc471714df2d \
npx hardhat run scripts/dehive/setRelayer.ts --network sepolia
```

### 4. "Insufficient funds"
**Solution**: Add more ETH to the owner account
- Get Sepolia ETH from faucets:
  - https://sepoliafaucet.com/
  - https://www.alchemy.com/faucets/ethereum-sepolia

## Integration with Other Scripts

### After Deployment
```bash
# 1. Deploy proxy and facet
npx hardhat run scripts/dehive/deploySepolia.ts --network sepolia

# 2. Verify proxy configuration
npx hardhat run scripts/dehive/verifyProxy.ts --network sepolia

# 3. Set relayer address
npx hardhat run scripts/dehive/setRelayer.ts --network sepolia

# 4. Verify contracts on Etherscan
npx hardhat run scripts/dehive/verifyContracts.ts --network sepolia
```

### Testing Workflow
```bash
# 1. Verify proxy
npx hardhat run scripts/dehive/verifyProxy.ts --network sepolia

# 2. Run comprehensive tests
npx hardhat run scripts/dehive/testSepolia.ts --network sepolia
```

## Security Considerations

1. **Owner Privileges**: Only the proxy owner can:
   - Install/upgrade/remove facets
   - Transfer proxy ownership
   - Call owner-only functions through facets (setRelayer, setFees, etc.)

2. **Relayer Trust**: The relayer address has special privileges:
   - Can send messages on behalf of users (using their deposited funds)
   - Must be a trusted address

3. **Storage Safety**: Diamond Storage pattern ensures:
   - No storage collisions between facets
   - Each facet has its own isolated storage namespace
   - Upgrades don't affect other facets' storage

## Additional Resources

- Diamond Pattern (EIP-2535): https://eips.ethereum.org/EIPS/eip-2535
- DehiveProxy Source: `contracts/DehiveProxy.sol`
- Message Facet Source: `contracts/Message.sol`
- Facet Helpers: `scripts/dehive/helpers/facetHelpers.ts`

## Support

For issues or questions:
1. Check deployment files in `deployments/` directory
2. Run verification script for diagnostics
3. Review contract source code for function requirements
4. Check Etherscan for transaction details (if deployed)
