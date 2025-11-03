# Server Airdrop System - Frontend Development Guide

## Overview

The Server Airdrop system enables Discord-like servers to create and manage token airdrop campaigns. Each server has its own Airdrop Factory (created via Registry), and users within that server can create airdrop campaigns for community members.

## Architecture

### Smart Contract Hierarchy

```
ServerAirdropRegistry (Main Registry)
    ↓ creates Factory clones via EIP-1167
AirdropFactory Clone (one per server, identified by server._id)
    ↓ creates campaigns via direct deployment
MerkleAirdrop Campaigns (one per airdrop campaign)
```

### Key Concepts

1. **Registry**: The main contract that manages factory clones for each server
2. **Factory**: Each server gets its own factory clone that creates airdrop campaigns
3. **Campaign**: Individual airdrop campaigns with Merkle tree-based claim verification
4. **Server ID**: MongoDB `_id` string that uniquely identifies each Discord-like server

## Business Requirements

### Use Cases

1. **Server-Wide Airdrop**: Airdrop tokens to all members in a server
2. **Random Airdrop**: Randomly select users from server members (user-selectable range)
3. **CSV Upload Airdrop**: Upload a CSV file with specific addresses and amounts

### Airdrop Campaign Lifecycle

1. **Campaign Creation**: User creates campaign with token, recipients, and amounts
2. **Funding**: Campaign creator approves and funds the campaign with tokens
3. **Claiming Period**: Recipients can claim their tokens using Merkle proofs (7 days)
4. **Withdrawal**: Campaign owner can withdraw unclaimed tokens after 7 days

### Token Requirements

- Campaign creator must approve tokens for Factory contract
- Campaign creator must have sufficient token balance
- Token decimals must be fetched (e.g., USDT = 6, most ERC20 = 18)

## Smart Contract Functions

### ServerAirdropRegistry

#### `createFactoryForServer(string memory serverId, address owner)`
Creates a factory clone for a server if it doesn't already exist.

**Parameters:**
- `serverId`: MongoDB `_id` string (e.g., "507f1f77bcf86cd799439011")
- `owner`: Address that will own the factory

**Returns:**
- `factory`: Address of the created factory clone

**Events:**
- `FactoryCreated(address indexed factory, string indexed serverId, address indexed owner, ...)`

**Usage:**
```typescript
const tx = await registry.createFactoryForServer(serverId, ownerAddress);
const receipt = await tx.wait();
// Extract factory address from FactoryCreated event
```

#### `getFactoryByServerId(string memory serverId)`
Gets the factory address for a given server ID.

**Parameters:**
- `serverId`: MongoDB `_id` string

**Returns:**
- `factory`: Factory address (or `address(0)` if not exists)

### AirdropFactory

#### `createAirdropAndFund(address token, bytes32 merkleRoot, string calldata metadataURI, uint256 totalAmount)`
Creates a new airdrop campaign and funds it in a single transaction.

**Parameters:**
- `token`: ERC20 token address
- `merkleRoot`: Root of the Merkle tree (generated from claims)
- `metadataURI`: IPFS URI containing campaign metadata and claims
- `totalAmount`: Total amount of tokens to fund (must match sum of all claims)

**Returns:**
- `campaign`: Address of the deployed MerkleAirdrop campaign

**Events:**
- `AirdropCampaignCreated(address indexed campaign, address indexed creator, string indexed serverId, ...)`

**Prerequisites:**
- Token approval: `token.approve(factoryAddress, totalAmount)`
- Sufficient token balance

**Usage:**
```typescript
// 1. Approve tokens first
await token.approve(factoryAddress, totalAmount);

// 2. Create and fund campaign
const tx = await factory.createAirdropAndFund(
  tokenAddress,
  merkleRoot,
  ipfsURI,
  totalAmount
);
```

### MerkleAirdrop

#### `claim(uint256 index, address account, uint256 amount, bytes32[] calldata merkleProof)`
Allows a user to claim their tokens from the campaign.

**Parameters:**
- `index`: Claim index (from IPFS metadata)
- `account`: Claimant's address
- `amount`: Claim amount
- `merkleProof`: Merkle proof (from IPFS metadata)

**Events:**
- `Claimed(uint256 indexed index, address indexed account, uint256 amount)`

**Usage:**
```typescript
// Get claim data from IPFS
const claim = ipfsData.claims[userIndex];

// Claim tokens
await campaign.claim(
  claim.index,
  userAddress,
  claim.amount,
  claim.proof
);
```

#### `isClaimed(uint256 index)`
Checks if a specific claim has already been used.

**Returns:**
- `bool`: True if claimed, false otherwise

#### View Functions
- `token()`: Returns token address
- `merkleRoot()`: Returns Merkle root
- `metadataURI()`: Returns IPFS URI
- `totalAmount()`: Returns total campaign amount
- `claimDeadline()`: Returns claim deadline timestamp
- `unlockTimestamp()`: Returns withdrawal unlock timestamp

## Frontend Integration Workflow

### Step 1: Check/Create Factory

**Check if factory exists:**
```typescript
const factoryAddress = await registry.getFactoryByServerId(serverId);

if (factoryAddress === ethers.ZeroAddress) {
  // Factory doesn't exist, create it
  const tx = await registry.createFactoryForServer(serverId, ownerAddress);
  await tx.wait();
  // Extract factory address from event or query again
}
```

### Step 2: Select Airdrop Type

#### Option A: Airdrop for All Users
```typescript
// Fetch server members
const response = await fetch(`/api/servers/${serverId}/members`);
const members = await response.json().data;

// Extract addresses from members
const claims = members
  .filter(member => member.primary_wallet || member.wallets?.[0])
  .map((member, index) => ({
    index,
    account: member.primary_wallet?.address || member.wallets[0].address,
    amount: calculateAmount(member), // Your logic
  }));
```

#### Option B: Random Airdrop
```typescript
// Fetch all members (same as Option A)
const allMembers = await fetchMembers(serverId);

// Let user select random range (e.g., 10-50 users)
const randomCount = getUserSelectedRandomCount(); // 10-50
const selectedMembers = shuffleArray(allMembers).slice(0, randomCount);

// Generate claims from selected members
const claims = selectedMembers.map((member, index) => ({
  index,
  account: getMemberWallet(member),
  amount: calculateRandomAmount(),
}));
```

#### Option C: CSV Upload
```typescript
// Parse CSV file
const csvData = await parseCSV(uploadedFile);
// CSV format: address,amount

const claims = csvData.map((row, index) => ({
  index,
  account: row.address.toLowerCase(),
  amount: ethers.parseUnits(row.amount, tokenDecimals),
}));
```

### Step 3: User Input Campaign Details

```typescript
interface CampaignDetails {
  name: string;
  tokenAddress: string;
  description: string;
}

// Fetch token info
const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
const tokenName = await token.name();
const tokenDecimals = await token.decimals();
const tokenSymbol = await token.symbol();
```

### Step 4: Generate Merkle Tree and Upload to IPFS

```typescript
import { generateMerkleTree } from './merkleHelpers';

// Generate Merkle tree from claims
const merkleTreeData = generateMerkleTree(claims);
const merkleRoot = merkleTreeData.root;

// Prepare IPFS data structure
const ipfsData = {
  metadata: {
    name: campaignDetails.name,
    description: campaignDetails.description,
    token: tokenAddress,
    merkleRoot: merkleRoot,
    totalAmount: totalAmount.toString(),
    claimDeadline: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60), // 7 days
    unlockTimestamp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60),
    createdAt: Math.floor(Date.now() / 1000),
    version: "1.0.0"
  },
  claims: claims.map((claim, index) => {
    const proof = generateMerkleProof(merkleTreeData, index);
    return {
      index: claim.index,
      account: claim.account,
      amount: claim.amount.toString(),
      proof: proof
    };
  })
};

// Upload to IPFS
const ipfsHash = await uploadToIPFS(ipfsData);
const metadataURI = `ipfs://${ipfsHash}`;
```

### Step 5: Display Preview and Request Approval

```typescript
// Display to user:
// - Campaign name
// - Token name and symbol
// - Total amount (formatted with decimals)
// - Number of recipients
// - Merkle root
// - IPFS hash

// Request token approval
const approvalTx = await token.approve(factoryAddress, totalAmount);
await approvalTx.wait();

// After approval, enable "Create Campaign" button
```

### Step 6: Create Campaign

```typescript
// Create and fund campaign
const createTx = await factory.createAirdropAndFund(
  tokenAddress,
  merkleRoot,
  metadataURI,
  totalAmount
);

const receipt = await createTx.wait();

// Extract campaign address from AirdropCampaignCreated event
const campaignAddress = extractCampaignAddress(receipt.logs);
```

### Step 7: Listen to On-Chain Events (Real-Time Updates)

```typescript
// Listen for new campaigns
factory.on("AirdropCampaignCreated", (campaign, creator, serverId, ...) => {
  // Update UI with new campaign
  updateCampaignsList(campaign, {
    creator,
    serverId,
    // ... other event data
  });
});

// Also listen for claims
campaign.on("Claimed", (index, account, amount) => {
  // Update UI to show claim
  updateClaimStatus(campaign, index, account, amount);
});
```

## The Graph Queries

### Setup

**Endpoint:**
```
https://api.studio.thegraph.com/query/1713799/dehive-airdrop/version/latest
```

**Authentication:**
```typescript
headers: {
  'Authorization': 'Bearer 112c016bdd600a7de3fa8e9379471bf2'
}
```

### Important: Server ID Hashing

⚠️ **Critical**: `serverId` in queries must be the **keccak256 hash** of your server ID string, not the original string.

```typescript
import { keccak256, toUtf8Bytes } from 'ethers';

const serverIdString = "507f1f77bcf86cd799439011"; // Your MongoDB _id
const serverIdHash = keccak256(toUtf8Bytes(serverIdString));
// Use serverIdHash in queries
```

### Query Examples

#### Get All Campaigns for a Server

```typescript
const query = `
  query GetServerCampaigns($serverId: Bytes!) {
    campaigns(where: { serverId: $serverId }) {
      id
      factory {
        id
        serverId
        owner
      }
      creator
      token
      merkleRoot
      metadataURI
      totalAmount
      claimedAmount
      createdAt
      blockNumber
      claims(orderBy: blockTimestamp, orderDirection: desc) {
        id
        user
        index
        amount
        blockTimestamp
        transactionHash
      }
    }
  }
`;

const response = await fetch(GraphEndpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer 112c016bdd600a7de3fa8e9379471bf2'
  },
  body: JSON.stringify({
    query,
    variables: { serverId: serverIdHash }, // Use hashed serverId
    operationName: 'GetServerCampaigns'
  })
});
```

#### Get Factory for a Server

```typescript
const query = `
  query GetFactoryByServerId($serverId: Bytes!) {
    factories(where: { serverId: $serverId }) {
      id
      serverId
      owner
      creator
      createdAt
      campaigns {
        id
        creator
        token
        totalAmount
        claimedAmount
        createdAt
      }
    }
  }
`;
```

#### Get Claims for a Specific User

```typescript
const query = `
  query GetUserClaims($serverId: Bytes!, $user: Bytes!) {
    campaigns(where: { serverId: $serverId }) {
      id
      token
      totalAmount
      claims(where: { user: $user }) {
        id
        index
        amount
        blockTimestamp
        transactionHash
      }
    }
  }
`;
```

## Frontend Helper Functions

### Token Information Helper

```typescript
async function getTokenInfo(tokenAddress: string, provider: ethers.Provider) {
  const token = new ethers.Contract(
    tokenAddress,
    [
      'function name() view returns (string)',
      'function symbol() view returns (string)',
      'function decimals() view returns (uint8)',
      'function balanceOf(address) view returns (uint256)'
    ],
    provider
  );

  const [name, symbol, decimals, balance] = await Promise.all([
    token.name(),
    token.symbol(),
    token.decimals(),
    token.balanceOf(userAddress)
  ]);

  return { name, symbol, decimals, balance };
}
```

### Format Amount with Decimals

```typescript
function formatTokenAmount(amount: bigint, decimals: number): string {
  return ethers.formatUnits(amount, decimals);
}

// Example:
// formatTokenAmount(1000000n, 6) => "1.0" (USDT)
// formatTokenAmount(1000000000000000000n, 18) => "1.0" (standard ERC20)
```

### Check Claim Eligibility

```typescript
async function checkClaimEligibility(
  campaignAddress: string,
  userAddress: string,
  ipfsData: any
) {
  const campaign = new ethers.Contract(campaignAddress, MERKLE_AIRDROP_ABI, provider);

  // Find user's claim in IPFS data
  const userClaim = ipfsData.claims.find(
    claim => claim.account.toLowerCase() === userAddress.toLowerCase()
  );

  if (!userClaim) {
    return { eligible: false, reason: 'Not in airdrop list' };
  }

  // Check if already claimed
  const isClaimed = await campaign.isClaimed(userClaim.index);
  if (isClaimed) {
    return { eligible: false, reason: 'Already claimed' };
  }

  // Check claim deadline
  const claimDeadline = await campaign.claimDeadline();
  const now = Math.floor(Date.now() / 1000);
  if (now > claimDeadline) {
    return { eligible: false, reason: 'Claim period expired' };
  }

  return {
    eligible: true,
    claim: userClaim,
    amount: userClaim.amount,
    proof: userClaim.proof
  };
}
```

### Claim Tokens Helper

```typescript
async function claimTokens(
  campaignAddress: string,
  userAddress: string,
  claimData: any,
  signer: ethers.Signer
) {
  const campaign = new ethers.Contract(
    campaignAddress,
    MERKLE_AIRDROP_ABI,
    signer
  );

  const tx = await campaign.claim(
    claimData.index,
    userAddress,
    claimData.amount,
    claimData.proof
  );

  const receipt = await tx.wait();
  return receipt;
}
```

## IPFS Data Structure

### Complete IPFS Structure Example

```json
{
  "metadata": {
    "name": "USDC Campaign",
    "description": "First stable coin airdrop ever",
    "token": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    "merkleRoot": "0x00e1e5d473d5b132ac29620c03872cf63012d97ff483ea5d1f5423ad7c698589",
    "totalAmount": "700000000",
    "claimDeadline": 1762792851,
    "unlockTimestamp": 1762792851,
    "createdAt": 1762188051,
    "version": "1.0.0"
  },
  "claims": [
    {
      "index": 0,
      "account": "0x09e23052d4a07d38c85c35af34c9e1d0555243ee",
      "amount": "100000000",
      "proof": [
        "0x7335acd67192e45734ee2fd4bdf4294d9cd9044f72908b76d204bb1ecd38c5cb",
        "0x342caa76a5b9e055c8ce320d2fb7cf3ee1229bfe18b1a7e4a295b51c57343588"
      ]
    },
    {
      "index": 1,
      "account": "0x3f1fc384bd71a64cb031983fac059c9e452ad247",
      "amount": "200000000",
      "proof": [
        "0x7971a1898a4903d5b6c99cb16733e8db75e49f0316e588761cc51992773c47f0",
        "0x342caa76a5b9e055c8ce320d2fb7cf3ee1229bfe18b1a7e4a295b51c57343588"
      ]
    }
  ]
}
```

### IPFS Upload Helper

```typescript
async function uploadToIPFS(data: any): Promise<string> {
  // Using your IPFS client (e.g., Pinata, Infura, Web3.Storage)
  const response = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'pinata_api_key': process.env.PINATA_API_KEY,
      'pinata_secret_api_key': process.env.PINATA_SECRET_KEY
    },
    body: JSON.stringify({
      pinataContent: data
    })
  });

  const result = await response.json();
  return result.IpfsHash; // Returns IPFS hash (Qm...)
}
```

## Error Handling

### Common Errors and Solutions

#### 1. Factory Already Exists
```typescript
try {
  await registry.createFactoryForServer(serverId, owner);
} catch (error) {
  if (error.message.includes('factory already exists')) {
    // Factory exists, get it
    const factory = await registry.getFactoryByServerId(serverId);
  }
}
```

#### 2. Insufficient Token Balance
```typescript
const balance = await token.balanceOf(userAddress);
if (balance < totalAmount) {
  throw new Error(`Insufficient balance. Need ${totalAmount}, have ${balance}`);
}
```

#### 3. Token Approval Required
```typescript
const allowance = await token.allowance(userAddress, factoryAddress);
if (allowance < totalAmount) {
  // Request approval
  await token.approve(factoryAddress, totalAmount);
}
```

#### 4. Claim Period Expired
```typescript
const deadline = await campaign.claimDeadline();
const now = Math.floor(Date.now() / 1000);
if (now > deadline) {
  throw new Error('Claim period has expired');
}
```

## Best Practices

### 1. Validate Data Before Submission
- Verify token address is valid ERC20
- Ensure all recipient addresses are valid
- Check amounts don't exceed token balance
- Validate Merkle root before upload

### 2. Handle Gas Estimation
```typescript
try {
  const gasEstimate = await factory.estimateGas.createAirdropAndFund(
    tokenAddress,
    merkleRoot,
    metadataURI,
    totalAmount
  );
  // Show gas estimate to user
} catch (error) {
  // Handle estimation failure
}
```

### 3. Transaction Status Updates
```typescript
// Show pending state
showTransactionPending(tx.hash);

// Wait for confirmation
await tx.wait();

// Update UI
showTransactionSuccess(tx.hash, receipt);
```

### 4. Real-Time Updates
- Listen to contract events for new campaigns
- Use The Graph for historical data
- Poll for claim status updates
- Show live claim statistics

## Contract Addresses

### Sepolia Testnet

```typescript
export const SEPOLIA_ADDRESSES = {
  registry: process.env.REGISTRY_ADDRESS || "0xac2FeCc2Bca3221B6eEf8A92B0dF29fA0BfdAFa2",
  factory: process.env.FACTORY_ADDRESS || "0xAcff01C4509cC6B2BD770F59c3c6F2061E5F0bf0",
  merkleAirdrop: process.env.MERKLE_AIRDROP_ADDRESS || "0x82953eE584b0b5Bbf097810FD538c81646A1e256",
  dummyToken: process.env.DUMMY_TOKEN_ADDRESS || "0x71d0e59ee19A5F944f2e0E3b2fce472567c63115",
};
```

## Complete Frontend Flow Example

```typescript
async function createAirdropCampaign(
  serverId: string,
  campaignDetails: CampaignDetails,
  claims: ClaimData[]
) {
  // 1. Get or create factory
  let factory = await registry.getFactoryByServerId(serverId);
  if (factory === ethers.ZeroAddress) {
    const tx = await registry.createFactoryForServer(serverId, userAddress);
    await tx.wait();
    factory = await registry.getFactoryByServerId(serverId);
  }

  // 2. Generate Merkle tree
  const merkleTreeData = generateMerkleTree(claims);
  const merkleRoot = merkleTreeData.root;

  // 3. Upload to IPFS
  const ipfsData = prepareIPFSData(campaignDetails, claims, merkleTreeData);
  const ipfsHash = await uploadToIPFS(ipfsData);
  const metadataURI = `ipfs://${ipfsHash}`;

  // 4. Get token info
  const token = new ethers.Contract(campaignDetails.tokenAddress, ERC20_ABI, signer);
  const decimals = await token.decimals();
  const totalAmount = claims.reduce((sum, claim) => sum + claim.amount, 0n);

  // 5. Approve tokens
  await token.approve(factory, totalAmount);

  // 6. Create campaign
  const tx = await factory.createAirdropAndFund(
    campaignDetails.tokenAddress,
    merkleRoot,
    metadataURI,
    totalAmount
  );

  const receipt = await tx.wait();
  const campaignAddress = extractCampaignAddress(receipt.logs);

  return campaignAddress;
}
```

## Security Considerations

1. **Always validate addresses**: Ensure all addresses are valid Ethereum addresses
2. **Check token approvals**: Verify approval before creating campaign
3. **Validate Merkle proofs**: Ensure proofs match the Merkle root
4. **Handle reverted transactions**: Always catch and handle transaction failures
5. **Verify claim eligibility**: Check deadline and claim status before allowing claim

## Support

For issues or questions:
- Check contract source code: `contracts/AirdropFactory.sol`, `contracts/MerkleAirdrop.sol`
- Review test files: `test/airdrop/`
- Check The Graph queries: `QUERY_GUIDE.md`
