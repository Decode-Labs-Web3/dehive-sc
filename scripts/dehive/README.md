# DehiveProxy + MessageFacet Scripts

This directory contains scripts for deploying and testing the DehiveProxy and MessageFacet integration.

## Scripts Overview

### 1. `testAllInOne.ts` - All-in-One Test Script
Comprehensive test script that:
- Deploys DehiveProxy and MessageFacet
- Installs MessageFacet into proxy
- Tests all core functionality
- Tests admin functions
- Performs load testing
- Verifies storage isolation

**Usage:**
```bash
# Test on localhost
npx hardhat run scripts/dehive/testAllInOne.ts --network localhost

# Test on hardhat network
npx hardhat run scripts/dehive/testAllInOne.ts
```

### 2. `deploySepolia.ts` - Sepolia Deployment Script
Deploys the complete system to Sepolia testnet:
- Deploys DehiveProxy
- Deploys MessageFacet (standalone)
- Installs MessageFacet into proxy
- Initializes MessageFacet
- Sets relayer address
- Saves deployment information

**Usage:**
```bash
# Deploy to Sepolia (requires .env file with PRIVATE_KEY and SEPOLIA_RPC_URL)
npx hardhat run scripts/dehive/deploySepolia.ts --network sepolia
```

**Prerequisites:**
- `.env` file with:
  - `PRIVATE_KEY` - Private key of deployer account
  - `SEPOLIA_RPC_URL` - Sepolia RPC endpoint (optional, has default)

### 3. Individual Deployment Scripts

#### `deployProxy.ts`
Deploys only the DehiveProxy contract.

**Usage:**
```bash
npx hardhat run scripts/dehive/deployProxy.ts --network <network>
```

#### `deployMessageFacet.ts`
Deploys only the MessageFacet contract (standalone Message).

**Usage:**
```bash
npx hardhat run scripts/dehive/deployMessageFacet.ts --network <network>
```

#### `installMessageFacet.ts`
Installs an already-deployed MessageFacet into an already-deployed DehiveProxy.

**Usage:**
```bash
npx hardhat run scripts/dehive/installMessageFacet.ts --network <network>
```

**Note:** Requires deployment files:
- `deployments/dehiveProxy_<network>.json`
- `deployments/messageFacet_<network>.json`

#### `setupMessage.ts`
Complete setup script that:
- Deploys or loads existing proxy
- Deploys MessageFacet
- Installs MessageFacet into proxy
- Sets relayer address

**Usage:**
```bash
npx hardhat run scripts/dehive/setupMessage.ts --network <network>
```

## Deployment Information

All deployment scripts save information to `deployments/` directory:
- `dehiveProxy_<network>.json` - Proxy deployment info
- `messageFacet_<network>.json` - Facet deployment info
- `messageFacet_installation_<network>.json` - Installation info
- `sepolia_dehiveProxy_messageFacet.json` - Complete Sepolia deployment

## Example: Deploying to Sepolia

1. **Set up environment variables:**
```bash
# .env file
PRIVATE_KEY=your_private_key_here
SEPOLIA_RPC_URL=https://eth-sepolia.public.blastapi.io
```

2. **Deploy to Sepolia:**
```bash
npx hardhat run scripts/dehive/deploySepolia.ts --network sepolia
```

3. **Verify deployment:**
```bash
# Check deployment file
cat deployments/sepolia_dehiveProxy_messageFacet.json
```

4. **Test deployed contracts:**
```bash
# Use the proxy address from deployment file
npx hardhat run scripts/dehive/testAllInOne.ts --network sepolia
```

## Helper Scripts

### `helpers/facetHelpers.ts`
Utility functions for facet management:
- `getFunctionSelectors(abi)` - Extract function selectors from ABI
- `verifyFacetInstallation(proxy, facet, selectors)` - Verify facet is installed
- `getFacetInfo(proxy, facet)` - Get facet information
- `getAllFacets(proxy)` - Get all installed facets

## Testing

Run the all-in-one test:
```bash
npx hardhat run scripts/dehive/testAllInOne.ts --network localhost
```

Or run comprehensive Hardhat tests:
```bash
npx hardhat test
```

## Troubleshooting

### Error: "Only owner can call this function"
- Ensure you're using the deployer account (proxy owner) to call `facetCut()`

### Error: "Message: already initialized"
- The facet has already been initialized. Remove and reinstall the facet, or use a new proxy.

### Error: "Function not found"
- Verify all function selectors are included when installing the facet
- Check that the IMessage interface includes all necessary functions

### Error: Insufficient funds
- Ensure the deployer account has enough ETH for deployment and gas fees
- For Sepolia, you can get testnet ETH from a faucet

## Network Configuration

The scripts work with any network configured in `hardhat.config.ts`:
- `localhost` - Local Hardhat node
- `sepolia` - Sepolia testnet
- `mainnet` - Ethereum mainnet (requires proper setup)
- Other networks as configured

## Contract Addresses

After deployment, you can use:
- **Proxy Address**: Main address to interact with (all function calls go through this)
- **Facet Address**: Implementation contract address (for verification/reference)

All users should interact with the **Proxy Address** - it will automatically route calls to the appropriate facet.
