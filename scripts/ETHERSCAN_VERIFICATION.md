# Etherscan Verification Guide for Diamond Proxy

## Overview

This guide explains how to verify the DehiveProxy and all facets on Etherscan. **Important**: Diamond proxies don't work with Etherscan's automatic proxy detection, so each contract must be verified separately.

## The Issue

When you try to verify the proxy contract on Etherscan, you may see this message:

```
A corresponding implementation contract was unfortunately not detected for the proxy address
```

**This is expected behavior** for Diamond proxies. Etherscan's automatic proxy detection only works with standard EIP-1967 proxies, not Diamond proxies.

## Solution

For Diamond proxies, you need to verify each contract separately:

1. **DehiveProxy** - The proxy contract itself (no constructor args)
2. **Message Facet** - The Message implementation (with constructor args)
3. **PaymentHub Facet** - The PaymentHub implementation (with constructor args)

## Quick Verification

Use the automated verification script:

```bash
npx hardhat run scripts/verifyAllOnEtherscan.ts --network sepolia
```

This script will:
- Load deployment information from deployment files
- Verify the proxy contract (no constructor args)
- Verify the Message facet (with owner address as constructor arg)
- Verify the PaymentHub facet (with owner address as constructor arg)
- Provide Etherscan links for all verified contracts

## Manual Verification

If you prefer to verify manually, use these commands:

### 1. Verify DehiveProxy

```bash
npx hardhat verify --network sepolia <PROXY_ADDRESS>
```

**No constructor arguments** - DehiveProxy has an empty constructor.

### 2. Verify Message Facet

```bash
npx hardhat verify --network sepolia <MESSAGE_FACET_ADDRESS> <OWNER_ADDRESS>
```

**Constructor argument**: Owner address (the proxy owner).

### 3. Verify PaymentHub Facet

```bash
npx hardhat verify --network sepolia <PAYMENTHUB_FACET_ADDRESS> <OWNER_ADDRESS>
```

**Constructor argument**: Owner address (the proxy owner).

## Finding Addresses

### From Deployment Files

Check the `deployments/` directory:

```bash
# Latest unified deployment
cat deployments/sepolia_deployAll_*.json | jq '.proxyAddress, .messageFacetAddress, .paymentHubFacetAddress'

# Or individual deployment files
cat deployments/sepolia_dehiveProxy_messageFacet.json | jq '.proxyAddress, .facetAddress'
cat deployments/sepolia_paymentHubFacet.json | jq '.facetAddress'
```

### From Environment Variables

```bash
# Set in .env or export before running
export PROXY_ADDRESS=0x41bc86ba44813b2b106e1942cb68cc471714df2d
export MESSAGE_FACET_ADDRESS=0xEd0E195310A1419c309935DCe97fCA507d82DE11
export PAYMENTHUB_FACET_ADDRESS=0xe9278ad4cC74535287c1da991Eb0705D7c36a1d6
```

### From Etherscan

1. Go to the proxy contract on Etherscan
2. Check the "Contract" tab
3. Look for "Read Contract" functions:
   - `facetAddresses()` - Returns all facet addresses
   - `facetFunctionSelectors(address)` - Returns selectors for a facet

## Finding Owner Address

The owner address is needed for facet verification (constructor argument):

### From Deployment File

```bash
cat deployments/sepolia_deployAll_*.json | jq '.owner'
```

### From Proxy Contract

```bash
# Using hardhat console
npx hardhat console --network sepolia
> const proxy = await ethers.getContractAt("DehiveProxy", "<PROXY_ADDRESS>")
> await proxy.owner()
```

### From Etherscan

1. Go to the proxy contract on Etherscan
2. Click "Read Contract"
3. Call `owner()` function
4. Copy the returned address

## Verification Status

After verification, you can check the status on Etherscan:

### Proxy Contract

- **Status**: ✅ Verified (but shows "No implementation detected" - this is normal)
- **Link**: `https://sepolia.etherscan.io/address/<PROXY_ADDRESS>#code`
- **Note**: Etherscan won't show the implementation because Diamond proxies don't use EIP-1967

### Facet Contracts

- **Status**: ✅ Verified
- **Links**:
  - Message: `https://sepolia.etherscan.io/address/<MESSAGE_FACET_ADDRESS>#code`
  - PaymentHub: `https://sepolia.etherscan.io/address/<PAYMENTHUB_FACET_ADDRESS>#code`

## Understanding Diamond Proxy Verification

### Why Etherscan Can't Auto-Detect

Etherscan's automatic proxy detection looks for:
- EIP-1967 storage slots (`_IMPLEMENTATION_SLOT`)
- Standard proxy patterns (like OpenZeppelin's TransparentProxy)

Diamond proxies use:
- Custom storage mapping (`_selectorToFacet`)
- Multiple implementation contracts (facets)
- Different routing mechanism

### How It Works

1. **Proxy Contract**: Routes function calls to facets
2. **Facet Contracts**: Implement the actual functionality
3. **Storage**: Shared via Diamond Storage pattern

### What Users See

- **Proxy Address**: Shows verified proxy code, but no implementation link
- **Facet Addresses**: Each facet is verified separately
- **Function Calls**: Users can still interact with the proxy address directly

## Troubleshooting

### Error: "Contract source code already verified"

**Solution**: The contract is already verified. This is fine - you can skip it.

### Error: "Constructor arguments provided do not match"

**Solution**: Check the owner address. It must match the address used during deployment.

### Error: "Contract not found"

**Solution**:
1. Ensure the contract is deployed
2. Check the address is correct
3. Verify you're on the correct network

### Error: "Failed to verify"

**Solution**:
1. Check ETHERSCAN_API_KEY is set in `.env`
2. Ensure contracts are compiled (`npx hardhat compile`)
3. Try verifying manually with exact constructor args

## Best Practices

1. **Verify Immediately After Deployment**: Easier to remember constructor args
2. **Save Deployment Info**: Keep deployment files for reference
3. **Verify All Contracts**: Don't skip facet verification
4. **Document Owner Address**: Keep track of the owner address used

## Example Workflow

```bash
# 1. Deploy all contracts
npx hardhat run scripts/deployAll.ts --network sepolia

# 2. Verify all contracts
npx hardhat run scripts/verifyAllOnEtherscan.ts --network sepolia

# 3. Check verification status on Etherscan
# - Proxy: https://sepolia.etherscan.io/address/<PROXY_ADDRESS>#code
# - Message: https://sepolia.etherscan.io/address/<MESSAGE_FACET_ADDRESS>#code
# - PaymentHub: https://sepolia.etherscan.io/address/<PAYMENTHUB_FACET_ADDRESS>#code
```

## Related Scripts

- `scripts/verifyAllOnEtherscan.ts` - Automated verification for all contracts
- `scripts/payment/verifyPaymentHub.ts` - Verify only PaymentHub facet
- `scripts/dehive/verifyProxy.ts` - Verify proxy functionality (not Etherscan)

## Additional Resources

- [Etherscan Verification Guide](https://docs.etherscan.io/contract-verification)
- [Hardhat Verify Plugin](https://hardhat.org/hardhat-runner/plugins/nomicfoundation-hardhat-verify)
- [Diamond Standard (EIP-2535)](https://eips.ethereum.org/EIPS/eip-2535)
