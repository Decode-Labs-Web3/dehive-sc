# Unified Deployment Script

## Overview

The `deployAll.ts` script provides a unified deployment solution for the complete DeHive system:
- **DehiveProxy**: The Diamond proxy contract
- **Message Facet**: Messaging functionality
- **PaymentHub Facet**: Payment functionality

The script intelligently checks for existing deployments first, verifies they work, and only deploys new contracts if needed.

## Features

### Smart Deployment Detection
- Checks deployment files for existing contracts
- Verifies contracts exist on-chain and are accessible
- Tests basic read operations to confirm functionality
- Only deploys missing or inaccessible contracts

### Conflict Handling
- Detects already-installed function selectors
- Filters out conflicting selectors (e.g., `init` and `owner` shared between facets)
- Installs only available selectors
- Logs conflicts clearly

### Comprehensive Verification
- Tests read functions through proxy for both facets
- Tests write functions through proxy (if owner)
- Verifies facet installation status
- Confirms all function selectors are properly routed

## Usage

### Basic Usage

```bash
# Deploy to any network
npx hardhat run scripts/deployAll.ts --network sepolia
npx hardhat run scripts/deployAll.ts --network localhost
npx hardhat run scripts/deployAll.ts --network mainnet
```

### With Environment Variables

```bash
# Use existing proxy address
PROXY_ADDRESS=0x41BC86bA44813b2B106E1942CB68cc471714df2D \
npx hardhat run scripts/deployAll.ts --network sepolia

# Use existing PaymentHub facet address
PAYMENTHUB_FACET_ADDRESS=0xe9278ad4cC74535287c1da991Eb0705D7c36a1d6 \
npx hardhat run scripts/deployAll.ts --network sepolia
```

## What the Script Does

### Step 1: Check/Deploy Proxy
- Checks `deployments/<network>_dehiveProxy_messageFacet.json` for existing proxy
- Checks `PROXY_ADDRESS` environment variable
- Verifies proxy is accessible on-chain
- Deploys new proxy only if not found or not accessible

### Step 2: Check/Deploy Message Facet
- Checks deployment file for existing Message facet
- Verifies facet is accessible on-chain
- Deploys new Message facet only if not found or not accessible
- Checks if facet is installed in proxy
- Installs facet if not installed (with all function selectors)

### Step 3: Check/Deploy PaymentHub Facet
- Checks `deployments/<network>_paymentHubFacet.json` for existing PaymentHub facet
- Checks `PAYMENTHUB_FACET_ADDRESS` environment variable
- Verifies facet is accessible on-chain
- Deploys new PaymentHub facet only if not found or not accessible
- Checks for selector conflicts before installation
- Installs only available selectors (filters out conflicts)

### Step 4: Set Relayer (if needed)
- Checks if relayer is set for Message facet
- Sets relayer address if not set or different from deployer
- Skips if relayer is already correctly set

### Step 5: Verify Read/Write Access
- Tests Message facet read functions: `payAsYouGoFee()`, `relayerFee()`, `owner()`
- Tests Message facet write functions: `setRelayer()` (if owner)
- Tests PaymentHub facet read functions: `transactionFeePercent()`, `owner()`, `accumulatedFees()`
- Tests PaymentHub facet write functions: `setTransactionFee()` (if owner)
- Logs verification results

### Step 6: Save Deployment Information
- Saves comprehensive deployment info to `deployments/<network>_deployAll_<timestamp>.json`
- Includes all addresses, transaction hashes, block numbers, and verification results

## Deployment Information

The script saves deployment information to:
```
deployments/<network>_deployAll_<timestamp>.json
```

**Example deployment file structure:**
```json
{
  "network": "sepolia",
  "chainId": "11155111",
  "proxyAddress": "0x41BC86bA44813b2B106E1942CB68cc471714df2D",
  "messageFacetAddress": "0xEd0E195310A1419c309935DCe97fCA507d82DE11",
  "paymentHubFacetAddress": "0xe9278ad4cC74535287c1da991Eb0705D7c36a1d6",
  "owner": "0x09e23052d4a07D38C85C35Af34c9e1d0555243EE",
  "deployer": "0x09e23052d4a07D38C85C35Af34c9e1d0555243EE",
  "relayer": "0x09e23052d4a07D38C85C35Af34c9e1d0555243EE",
  "messageSelectors": ["0x8da5cb5b", "0x19ab453c", ...],
  "paymentHubSelectors": ["0x0c8f5e00", "0xfcf66664", ...],
  "paymentHubConflicts": ["0x19ab453c", "0x8da5cb5b"],
  "verificationResults": {
    "messageRead": true,
    "messageWrite": true,
    "paymentHubRead": true,
    "paymentHubWrite": true
  },
  "transactionHashes": {
    "proxyDeployment": "0x...",
    "messageFacetDeployment": "0x...",
    "messageFacetInstallation": "0x...",
    "paymentHubFacetDeployment": "0x...",
    "paymentHubFacetInstallation": "0x...",
    "relayerSetup": "0x..."
  },
  "blockNumbers": {
    "proxyDeployment": 9589600,
    "messageFacetDeployment": 9589601,
    "messageFacetInstallation": 9589602,
    "paymentHubFacetDeployment": 9589623,
    "paymentHubFacetInstallation": 9589624,
    "relayerSetup": 9589603
  }
}
```

## Example Output

```
================================================================================
Unified Deployment: DehiveProxy + Message + PaymentHub
================================================================================

Network: sepolia (Chain ID: 11155111)

Deployer: 0x09e23052d4a07D38C85C35Af34c9e1d0555243EE
Owner: 0x09e23052d4a07D38C85C35Af34c9e1d0555243EE
Relayer: 0x09e23052d4a07D38C85C35Af34c9e1d0555243EE

💰 Deployer Balance: 7.010081888780410793 ETH

================================================================================
Step 1: Checking/Deploying DehiveProxy
================================================================================
✓ Found existing proxy deployment: 0x41BC86bA44813b2B106E1942CB68cc471714df2D
✓ Proxy is accessible, owner: 0x09e23052d4a07D38C85C35Af34c9e1d0555243EE
✓ Proxy owner: 0x09e23052d4a07D38C85C35Af34c9e1d0555243EE

================================================================================
Step 2: Checking/Deploying Message Facet
================================================================================
✓ Found existing Message facet deployment: 0xEd0E195310A1419c309935DCe97fCA507d82DE11
✓ Message facet is accessible
✓ Message facet is already installed in proxy

================================================================================
Step 3: Checking/Deploying PaymentHub Facet
================================================================================
✓ Found existing PaymentHub facet deployment: 0xe9278ad4cC74535287c1da991Eb0705D7c36a1d6
✓ PaymentHub facet is accessible
⚠️  PaymentHub facet is not installed in proxy, installing...
✓ Found 10 PaymentHub function selectors
⚠️  Selector 0x19ab453c already installed in facet: 0xEd0E195310A1419c309935DCe97fCA507d82DE11
⚠️  Selector 0x8da5cb5b already installed in facet: 0xEd0E195310A1419c309935DCe97fCA507d82DE11

📊 Selector Status:
  ✅ Available to install: 8
  ⚠️  Already installed: 2

⚠️  Warning: 2 selector(s) are already installed.
   Will install only the 8 available selectors.

Installing PaymentHub facet into proxy...
✓ PaymentHub facet installed into proxy
✓ Transaction: 0x39ec1c80faa641d6de43b64d1b7619a3705165e4e08fc54341362288e096901b
✓ Block number: 9589624

================================================================================
Step 4: Setting Relayer Address (if needed)
================================================================================
✓ Relayer already set to: 0x09e23052d4a07D38C85C35Af34c9e1d0555243EE

================================================================================
Step 5: Verifying Read/Write Access Through Proxy
================================================================================

5.1 Testing Message Facet Read Access...
  ✓ payAsYouGoFee(): 0.0000002 ETH
  ✓ relayerFee(): 0.0000001 ETH
  ✓ owner(): 0x09e23052d4a07D38C85C35Af34c9e1d0555243EE

5.2 Testing Message Facet Write Access...
  ✓ Relayer already set, write access confirmed

5.3 Testing PaymentHub Facet Read Access...
  ✓ transactionFeePercent(): 0 basis points
  ✓ owner(): 0x09e23052d4a07D38C85C35Af34c9e1d0555243EE
  ✓ accumulatedFees(native): 0.0 ETH

5.4 Testing PaymentHub Facet Write Access...
  ✓ setTransactionFee() callable through proxy

================================================================================
Deployment Summary
================================================================================
Network: sepolia (Chain ID: 11155111)

📦 Contracts:
  DehiveProxy: 0x41BC86bA44813b2B106E1942CB68cc471714df2D
  Message Facet: 0xEd0E195310A1419c309935DCe97fCA507d82DE11
  PaymentHub Facet: 0xe9278ad4cC74535287c1da991Eb0705D7c36a1d6

👤 Roles:
  Proxy Owner: 0x09e23052d4a07D38C85C35Af34c9e1d0555243EE
  Deployer: 0x09e23052d4a07D38C85C35Af34c9e1d0555243EE
  Relayer: 0x09e23052d4a07D38C85C35Af34c9e1d0555243EE

🔧 Configuration:
  Message Selectors: 15
  PaymentHub Selectors: 10
  PaymentHub Conflicts: 2

✅ Verification Results:
  Message Read: ✅
  Message Write: ✅
  PaymentHub Read: ✅
  PaymentHub Write: ✅

✅ Unified Deployment Completed Successfully!
```

## Prerequisites

### Environment Variables
- `PRIVATE_KEY`: Private key of deployer account (must be proxy owner)
- `PROXY_ADDRESS`: (Optional) Address of existing proxy
- `PAYMENTHUB_FACET_ADDRESS`: (Optional) Address of existing PaymentHub facet

### Account Balance
- Minimum recommended: 0.01 ETH
- For mainnet: 0.1+ ETH recommended

### Network Configuration
Ensure your `hardhat.config.ts` includes the target network configuration.

## Troubleshooting

### Error: "Proxy exists but is not accessible"
**Cause**: Contract address exists but contract is not deployed or bytecode doesn't match

**Solution**: The script will automatically deploy a new proxy. If you want to use a specific proxy, ensure it's correctly deployed and accessible.

### Error: "Facet exists but is not accessible"
**Cause**: Facet address exists but contract is not deployed

**Solution**: The script will automatically deploy a new facet. Check the deployment file if you want to verify the address.

### Error: "Function selector already exists"
**Cause**: Trying to install a selector that's already installed in another facet

**Solution**: The script automatically handles this by filtering out conflicting selectors. This is normal behavior when both facets share common functions like `init` and `owner`.

### Error: "Only owner can call this function"
**Cause**: Deployer is not the proxy owner

**Solution**: Ensure you're using the proxy owner's private key in `.env`:
```bash
PRIVATE_KEY=<proxy_owner_private_key>
```

### Error: "Insufficient funds"
**Solution**: Add more ETH to the deployer account. For testnets, use faucets:
- Sepolia: https://sepoliafaucet.com/
- Alchemy Sepolia: https://www.alchemy.com/faucets/ethereum-sepolia

## Verification

After deployment, verify contracts on Etherscan:

```bash
# Verify Message facet
npx hardhat verify --network sepolia <MESSAGE_FACET_ADDRESS> <OWNER_ADDRESS>

# Verify PaymentHub facet
npx hardhat verify --network sepolia <PAYMENTHUB_FACET_ADDRESS> <OWNER_ADDRESS>

# Verify Proxy (no constructor args)
npx hardhat verify --network sepolia <PROXY_ADDRESS>
```

## Integration

After successful deployment, use the proxy address to interact with both facets:

```typescript
// Connect to proxy as Message interface
const MessageFactory = await ethers.getContractFactory("Message");
const message = MessageFactory.attach(proxyAddress) as Message;

// Connect to proxy as PaymentHub interface
const PaymentHubFactory = await ethers.getContractFactory("PaymentHub");
const paymentHub = PaymentHubFactory.attach(proxyAddress) as PaymentHub;

// Use both through the same proxy address
await message.sendMessage(conversationId, recipient, encryptedMessage, {
  value: payAsYouGoFee
});

await paymentHub.sendNative(
  conversationId,
  recipient,
  ipfsCid,
  contentHash,
  0,
  clientMsgId,
  { value: ethers.parseEther("1.0") }
);
```

## Next Steps

1. **Verify contracts on Etherscan** (see Verification section above)
2. **Test functionality** using the verification scripts:
   - `scripts/dehive/verifyProxy.ts` - Verify Message facet
   - `scripts/payment/verifyProxyPaymentHub.ts` - Verify PaymentHub facet
3. **Use proxy address** in your frontend/backend applications
4. **Monitor events** for both Message and PaymentHub through the proxy address

## Related Scripts

- `scripts/dehive/deploySepolia.ts` - Deploy only Message facet
- `scripts/payment/deployPaymentHubFacet.ts` - Deploy only PaymentHub facet
- `scripts/dehive/verifyProxy.ts` - Verify Message facet through proxy
- `scripts/payment/verifyProxyPaymentHub.ts` - Verify PaymentHub facet through proxy
- `scripts/payment/checkProxyState.ts` - Check proxy state before installation

## Security Notes

1. **Owner Control**: Only the proxy owner can install/upgrade/remove facets
2. **Relayer Trust**: The relayer address has special privileges for Message facet
3. **Storage Safety**: Diamond Storage pattern ensures no storage collisions
4. **Non-Custodial**: PaymentHub never holds user funds (except accumulated fees)
