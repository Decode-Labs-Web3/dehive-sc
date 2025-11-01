# Etherscan Contract Verification Guide

## Overview

This guide explains how to verify all deployed contracts on Etherscan using the verification script.

## Prerequisites

1. **Etherscan API Key**: You need an Etherscan API key
   - Get one from: https://etherscan.io/apis
   - Add to `.env` file: `ETHERSCAN_API_KEY=your_api_key_here`

2. **Deployment Information**:
   - Deployment file: `deployments/sepolia_dehiveProxy_messageFacet.json`
   - OR provide addresses via environment variables:
     - `PROXY_ADDRESS=0x...`
     - `FACET_ADDRESS=0x...`

3. **Compiled Contracts**:
   - Run `npx hardhat compile` before verification
   - Ensure all contracts are compiled successfully

## Usage

### Basic Verification

```bash
# Verify all contracts on Sepolia
npx hardhat run scripts/dehive/verifyContracts.ts --network sepolia

# Verify on Mainnet (if deployed)
npx hardhat run scripts/dehive/verifyContracts.ts --network mainnet
```

### What Gets Verified

The script verifies:

1. **MessageFacet (Message.sol)**
   - Address: From deployment file or `FACET_ADDRESS` env var
   - Constructor Arguments: Owner address (from deployment file)
   - Libraries: MessageStorage (if deployed separately)

2. **DehiveProxy (DehiveProxy.sol)**
   - Address: From deployment file or `PROXY_ADDRESS` env var
   - Constructor Arguments: None (empty constructor)
   - Libraries: None

### Manual Address Specification

If you don't have a deployment file, you can specify addresses manually:

```bash
# Set environment variables
export PROXY_ADDRESS=0x41BC86bA44813b2B106E1942CB68cc471714df2D
export FACET_ADDRESS=0xEd0E195310A1419c309935DCe97fCA507d82DE11

# Run verification
npx hardhat run scripts/dehive/verifyContracts.ts --network sepolia
```

### Verification with Libraries

If you've deployed libraries separately (e.g., MessageStorage), update the script:

```typescript
await run("verify:verify", {
  address: facetAddress,
  constructorArguments: [owner],
  libraries: {
    MessageStorage: "0x...", // Add library address if deployed separately
  },
});
```

## Expected Output

```
================================================================================
Etherscan Contract Verification Script
================================================================================

Network: sepolia (Chain ID: 11155111)
✓ Etherscan API Key found

✓ Loaded deployment info from: deployments/sepolia_dehiveProxy_messageFacet.json

================================================================================
Verifying MessageFacet (Message.sol)
================================================================================
Address: 0xEd0E195310A1419c309935DCe97fCA507d82DE11
Constructor Arguments:
  Owner: 0x09e23052d4a07D38C85C35Af34c9e1d0555243EE
✅ MessageFacet verified successfully

================================================================================
Verifying DehiveProxy
================================================================================
Address: 0x41BC86bA44813b2B106E1942CB68cc471714df2D
✅ DehiveProxy verified successfully

================================================================================
Verification Summary
================================================================================

📊 Results:
  ✅ Successful: 2
  ⏭️  Skipped (already verified): 0
  ❌ Failed: 0
  Total: 2

🔗 Etherscan Links (Sepolia):
  MessageFacet: https://sepolia.etherscan.io/address/0xEd0E195310A1419c309935DCe97fCA507d82DE11#code
  DehiveProxy: https://sepolia.etherscan.io/address/0x41BC86bA44813b2B106E1942CB68cc471714df2D#code

✅ All Contract Verifications Completed Successfully!
```

## Troubleshooting

### Error: "ETHERSCAN_API_KEY not found"
- Add your API key to `.env` file: `ETHERSCAN_API_KEY=your_key_here`
- Ensure `.env` file is in the project root

### Error: "Contract is already verified"
- This is normal if you've verified before
- The script will skip already-verified contracts

### Error: "Unable to verify contract"
- Check that the contract bytecode matches compiled bytecode
- Ensure constructor arguments are correct
- Verify the contract address is correct

### Error: "No deployment info found"
- Create deployment file, OR
- Set `PROXY_ADDRESS` and `FACET_ADDRESS` environment variables

### Library Linking Issues
If you see library linking errors:
1. Check if MessageStorage was deployed separately
2. If yes, add its address to the `libraries` object in the script
3. If no, libraries should be compiled inline (default)

## Verification Results

The script saves verification results to:
```
deployments/verification_results_<network>_<timestamp>.json
```

This file contains:
- Network information
- Verification status for each contract
- Deployment info used
- Timestamp of verification

## Important Notes

1. **Wait Time**: After deployment, wait a few minutes before verifying
2. **Network**: Ensure you're verifying on the correct network
3. **API Key**: Different networks may require different API keys:
   - Sepolia: `ETHERSCAN_API_KEY`
   - Polygon: `POLYGONSCAN_API_KEY`
   - BSC: `BSCSCAN_API_KEY`

## Next Steps

After successful verification:
1. Visit Etherscan to view verified contracts
2. Share contract addresses with your team
3. Use verified contracts in your frontend application
4. Contracts are now readable and auditable on Etherscan
