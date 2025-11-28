# DeHive Smart Contracts

### Decentralized Messaging, Payments, and Airdrop System
*(Solidity 0.8.28 + OpenZeppelin + Diamond Pattern + EIP-1167 Minimal Proxies)*

---

## Overview

The **DeHive Smart Contracts** implement a comprehensive decentralized platform featuring end-to-end encrypted messaging, peer-to-peer payments, and gas-efficient airdrop distribution. The system uses advanced patterns including the Diamond proxy pattern for modularity and EIP-1167 minimal proxies for gas optimization.

### Key Features

**Messaging System:**
- 🔐 **End-to-End Encryption** - Per-conversation encryption keys with per-user encryption
- 💰 **Two-Tier Fee System** - Pay-as-you-go or credit-based relayer system
- 🔑 **Deterministic Conversation IDs** - Consistent conversation addressing
- 📝 **On-Chain Message Storage** - Immutable message records

**Payment System:**
- 💸 **Multi-Token Support** - Native tokens (ETH) and ERC-20 tokens
- 🔓 **Gasless Approvals** - EIP-2612 permit support
- 💼 **Non-Custodial** - Direct peer-to-peer transfers
- 📊 **Fee Management** - Configurable transaction fees

**Airdrop System:**
- 🌳 **Merkle Tree Verification** - Efficient on-chain eligibility checks
- ⚡ **Gas Optimization** - EIP-1167 minimal proxy pattern (~95% gas savings)
- 🔒 **Security First** - 7-day withdrawal lock prevents rug pulls
- 📦 **IPFS Integration** - Decentralized metadata storage

**Infrastructure:**
- 💎 **Diamond Pattern** - Modular, upgradeable proxy system
- 🔄 **Dual-Mode Operation** - Standalone or facet mode
- 🛡️ **Battle-Tested** - Built with OpenZeppelin libraries

---

## System Architecture

### High-Level Architecture

The DeHive system consists of several interconnected modules:

```
┌─────────────────────────────────────────────────────────────┐
│                    DehiveProxy (Diamond)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Message    │  │ PaymentHub   │  │  (Future)    │      │
│  │    Facet     │  │    Facet     │  │   Facets     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                            │
                            │
        ┌───────────────────┴───────────────────┐
        │                                         │
┌───────────────────┐              ┌──────────────────────────┐
│  Airdrop System   │              │   Server Airdrop Registry │
│                   │              │                           │
│  ┌─────────────┐  │              │  ┌─────────────────────┐ │
│  │   Factory   │  │              │  │  Factory Clones     │ │
│  └──────┬──────┘  │              │  │  (per server)       │ │
│         │         │              │  └─────────────────────┘ │
│  ┌──────▼──────┐  │              └──────────────────────────┘
│  │   Merkle    │  │
│  │  Airdrop    │  │
│  │  Clones     │  │
│  └─────────────┘  │
└───────────────────┘
```

### Diamond Proxy Pattern

The **DehiveProxy** implements the Diamond pattern (EIP-2535), allowing multiple facets to be installed in a single proxy contract:

**Benefits:**
- **Modularity**: Each feature (Message, PaymentHub) is a separate facet
- **Upgradeability**: Individual facets can be upgraded without affecting others
- **Size Limits**: Bypasses Ethereum's 24KB contract size limit
- **Gas Efficiency**: Only deploy what you need, when you need it

**How It Works:**
1. Proxy stores a mapping: `functionSelector => facetAddress`
2. When a function is called, proxy looks up which facet handles it
3. Proxy delegates the call to the appropriate facet using `delegatecall`
4. Facet executes the function using the proxy's storage

### Dual-Mode Operation

Contracts support two deployment modes:

**Standalone Mode:**
- Deployed as regular contracts
- Uses constructor for initialization
- Has its own owner storage

**Facet Mode:**
- Installed in DehiveProxy
- Uses `init()` function for initialization
- Uses proxy owner via `IDehiveProxy` interface

---

## Core Contracts

### 1. Message Contract

**Purpose:** End-to-end encrypted messaging with two-tier fee system

**Key Features:**
- Deterministic conversation IDs: `keccak256(abi.encodePacked(smallerAddress, largerAddress))`
- Per-conversation encryption keys encrypted per-user
- Two payment models:
  - **Pay-as-you-go**: Direct message sending with higher fees
  - **Credit-based**: Deposit funds, relayer sends with lower fees
- On-chain message storage with encrypted content

**Core Functions:**
```solidity
// Create a new conversation
function createConversation(
    address to,
    bytes encryptedConversationKeyForSender,
    bytes encryptedConversationKeyForReceiver
) external returns (uint256 conversationId);

// Send a message (pay-as-you-go)
function sendMessage(
    uint256 conversationId,
    address to,
    string encryptedMessage
) external payable returns (bool);

// Send message via relayer (credit-based)
function sendMessageViaRelayer(
    uint256 conversationId,
    address from,
    address to,
    string encryptedMessage,
    uint256 feeAmount
) external returns (bool);

// Deposit funds for relayer usage
function depositFunds() external payable;
```

**View Functions:**
```solidity
function conversations(uint256 conversationId) external view returns (
    address smallerAddress,
    address largerAddress,
    bytes encryptedConversationKeyForSmallerAddress,
    bytes encryptedConversationKeyForLargerAddress,
    uint256 createdAt
);

function getMyEncryptedConversationKeys(uint256 conversationId)
    external view returns (bytes encryptedConversationKeyForMe);

function funds(address user) external view returns (uint256);
```

**Events:**
- `ConversationCreated` - New conversation established
- `MessageSent` - Message sent in conversation
- `FundsDeposited` - User deposited credits
- `FeeCharged` - Fee deducted from user balance
- `RelayerSet` - Relayer address updated
- `PayAsYouGoFeeSet` - Pay-as-you-go fee updated
- `RelayerFeeSet` - Relayer fee updated

### 2. PaymentHub Contract

**Purpose:** Peer-to-peer payments with native and ERC-20 token support

**Key Features:**
- Native token (ETH) payments
- ERC-20 token payments with standard approval
- EIP-2612 permit support for gasless approvals
- Configurable transaction fees (0-10%)
- Non-custodial direct transfers
- IPFS metadata linking

**Core Functions:**
```solidity
// Send native tokens
function sendNative(
    uint256 conversationId,
    address recipient,
    string ipfsCid,
    bytes32 contentHash,
    uint8 mode,
    string clientMsgId
) external payable returns (bool);

// Send ERC-20 tokens
function sendERC20(
    uint256 conversationId,
    address recipient,
    address token,
    uint256 amount,
    string ipfsCid,
    bytes32 contentHash,
    uint8 mode,
    string clientMsgId
) external returns (bool);

// Send ERC-20 with permit (gasless approval)
function sendERC20WithPermit(
    uint256 conversationId,
    address recipient,
    address token,
    uint256 amount,
    string ipfsCid,
    bytes32 contentHash,
    uint8 mode,
    string clientMsgId,
    uint256 deadline,
    uint8 v,
    bytes32 r,
    bytes32 s
) external returns (bool);
```

**View Functions:**
```solidity
function computeConversationId(address user1, address user2)
    external pure returns (uint256 conversationId);

function transactionFeePercent() external view returns (uint256);

function accumulatedFees(address token) external view returns (uint256);
```

**Events:**
- `PaymentSent` - Payment transaction completed
- `TransactionFeeSet` - Transaction fee updated
- `FeesWithdrawn` - Owner withdrew accumulated fees

### 3. DehiveProxy Contract

**Purpose:** Diamond pattern proxy for modular, upgradeable system

**Key Features:**
- Function selector routing to facets
- Facet management (add, upgrade, remove)
- Owner-based access control
- Storage isolation per facet

**Core Functions:**
```solidity
// Manage facets
function facetCut(
    FacetCutStruct[] calldata _facetCuts,
    address _init,
    bytes calldata _calldata
) external;

// Query facet information
function facetAddress(bytes4 _functionSelector)
    external view returns (address);

function facetAddresses() external view returns (address[] memory);

function facetFunctionSelectors(address _facet)
    external view returns (bytes4[] memory);
```

### 4. Airdrop System

#### AirdropFactory Contract

**Purpose:** Factory for deploying gas-efficient airdrop campaigns

**Key Features:**
- EIP-1167 minimal proxy deployment
- Batch deployment and funding
- Deterministic address support

**Core Functions:**
```solidity
function createAirdropAndFund(
    address token,
    bytes32 merkleRoot,
    string calldata metadataURI,
    uint256 totalAmount
) external returns (address);

function createDeterministicAirdropAndFund(
    bytes32 salt,
    address token,
    bytes32 merkleRoot,
    string calldata metadataURI,
    uint256 totalAmount
) external returns (address);
```

#### MerkleAirdrop Contract

**Purpose:** Individual airdrop campaign with Merkle proof verification

**Key Features:**
- Merkle proof verification
- Bitmap-based claim tracking
- 7-day withdrawal lock
- Time-locked withdrawals

**Core Functions:**
```solidity
function initialize(
    address token_,
    address owner_,
    bytes32 merkleRoot_,
    string memory metadataURI_,
    uint256 totalAmount_
) external;

function claim(
    uint256 index,
    address account,
    uint256 amount,
    bytes32[] calldata merkleProof
) external;

function withdrawRemaining() external;
```

#### ServerAirdropRegistry Contract

**Purpose:** Registry managing factory clones per server

**Key Features:**
- One factory clone per server (MongoDB server ID)
- EIP-1167 clone pattern
- Factory enumeration

**Core Functions:**
```solidity
function createFactoryForServer(
    string calldata serverId,
    address owner
) external returns (address factory);
```

---

## Project Structure

```
dehive-sc/
├── contracts/
│   ├── Message.sol                    # Messaging contract
│   ├── PaymentHub.sol                 # Payment contract
│   ├── DehiveProxy.sol                # Diamond proxy
│   ├── AirdropFactory.sol             # Airdrop factory
│   ├── MerkleAirdrop.sol              # Airdrop implementation
│   ├── ServerAirdropRegistry.sol      # Server registry
│   ├── interfaces/
│   │   ├── IMessage.sol
│   │   ├── IPaymentHub.sol
│   │   ├── DehiveProxy.sol
│   │   ├── IAirdropFactory.sol
│   │   ├── IMerkleAirdrop.sol
│   │   └── IServerAirdropRegistry.sol
│   ├── libraries/
│   │   ├── MessageStorage.sol         # Storage library for Message
│   │   └── PaymentHubStorage.sol      # Storage library for PaymentHub
│   └── mocks/
│       └── MockERC20.sol               # Testing token
├── scripts/
│   ├── deploy-sepolia.ts              # Sepolia deployment
│   ├── create-airdrop-sepolia.ts      # Create test airdrop
│   ├── claim-airdrop.ts               # Claim tokens
│   ├── deployAndTest.ts               # Deploy and test flow
│   ├── generateTestData.ts            # Generate test data
│   └── view-transaction-logs.ts       # Debug transaction logs
├── test/
│   ├── Message.test.ts                # Message contract tests
│   ├── MessageEdgeCases.test.ts       # Message edge cases
│   ├── MessageFacet.test.ts           # Message as facet tests
│   ├── MessageLoad.test.ts            # Message load tests
│   ├── PaymentHub.test.ts             # PaymentHub tests
│   ├── PaymentHubFacet.test.ts        # PaymentHub as facet tests
│   ├── PaymentHubIntegration.test.ts  # PaymentHub integration tests
│   ├── airdrop/
│   │   ├── AirdropFactory.test.ts
│   │   ├── MerkleAirdrop.test.ts
│   │   ├── AirdropRegistry.test.ts
│   │   ├── AirdropEdgeCases.test.ts
│   │   ├── AirdropIntegration.test.ts
│   │   └── AirdropLoad.test.ts
│   └── helpers/
│       ├── conversationHelpers.ts
│       ├── messageFetcher.ts
│       ├── mockEncryption.ts
│       └── testDataGenerator.ts
├── deployments/                       # Deployment artifacts
├── test-data/                         # Test data files
├── artifacts/                         # Compiled contracts
├── cache/                            # Hardhat cache
├── typechain-types/                  # TypeScript types
└── hardhat.config.ts                 # Hardhat configuration
```

---

## Prerequisites

- **Node.js 18+** - Required for Hardhat
- **npm or yarn** - Package manager
- **Sepolia ETH** - For testnet deployment
- **Etherscan API Key** - For contract verification (optional)

---

## Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/Pasonnn/ac-capstone-project.git
   cd ac-capstone-project/dehive-sc
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```

4. **Configure environment variables**
   ```bash
   # Private Keys (NEVER commit these!)
   PRIVATE_KEY=your_private_key_here

   # Network Configuration
   SEPOLIA_RPC_URL=https://eth-sepolia.public.blastapi.io
   ETHERSCAN_API_KEY=your_etherscan_api_key

   # IPFS Configuration (optional)
   IPFS_POST_URL=
   IPFS_GET_URL=
   ```

---

## Available Scripts

### Compilation & Testing
```bash
npm run compile         # Compile all contracts
npm run test           # Run all tests
npm run test:flow      # Run comprehensive airdrop flow tests
```

### Deployment
```bash
npm run deploy:sepolia # Deploy to Sepolia testnet
npm run create:airdrop # Create test airdrop
npm run claim:airdrop  # Claim tokens from airdrop
```

### Development
```bash
npm run clean          # Clean artifacts and cache
npm run generate:data  # Generate test data
npm run deploy:demo    # Deploy to local network
```

---

## Contract Details

### Message Contract

**Initialization:**
```solidity
// Standalone mode
constructor(address owner)

// Facet mode
function init(address owner) external
```

**Configuration:**
- Default pay-as-you-go fee: `0.0000002 ether`
- Default relayer fee: `0.0000001 ether`
- Owner can update fees and relayer address

**Conversation ID Calculation:**
```solidity
// Deterministic conversation ID
function computeConversationId(address user1, address user2)
    public pure returns (uint256) {
    (address smaller, address larger) = user1 < user2
        ? (user1, user2)
        : (user2, user1);
    return uint256(keccak256(abi.encodePacked(smaller, larger)));
}
```

### PaymentHub Contract

**Initialization:**
```solidity
// Standalone mode
constructor(address _owner)

// Facet mode
function init(address _owner) external
```

**Fee Structure:**
- Transaction fee: 0-10% (configurable in basis points)
- Maximum fee: 1000 basis points (10%)
- Fees accumulated per token
- Owner can withdraw accumulated fees

**Payment Modes:**
- `0`: ERC-20 token payment
- `1`: Native token payment

### DehiveProxy Contract

**Facet Management:**
```solidity
struct FacetCutStruct {
    address facetAddress;
    bytes4[] functionSelectors;
    FacetCutAction action; // Add, Replace, Remove
}

function facetCut(
    FacetCutStruct[] calldata _facetCuts,
    address _init,
    bytes calldata _calldata
) external
```

**Access Control:**
- Only owner can manage facets
- Ownership can be transferred
- Owner can withdraw funds from proxy

### Airdrop System

See the existing airdrop documentation in this README for detailed information about the airdrop contracts.

---

## Testing

### Test Coverage

The test suite covers all contracts with comprehensive testing:

**Message Contract:**
- ✅ Conversation creation
- ✅ Message sending (pay-as-you-go)
- ✅ Relayer-based messaging
- ✅ Fee management
- ✅ Edge cases and error handling
- ✅ Load testing
- ✅ Facet mode testing

**PaymentHub Contract:**
- ✅ Native token payments
- ✅ ERC-20 token payments
- ✅ Permit-based payments
- ✅ Fee calculation
- ✅ Integration tests
- ✅ Facet mode testing

**Airdrop System:**
- ✅ Factory deployment
- ✅ Merkle proof verification
- ✅ Token claiming
- ✅ Double-claim prevention
- ✅ Withdrawal locking
- ✅ Edge cases and load testing

### Running Tests

```bash
# Run all tests
npm run test

# Run specific test file
npx hardhat test test/Message.test.ts
npx hardhat test test/PaymentHub.test.ts
npx hardhat test test/airdrop/MerkleAirdrop.test.ts

# Run with gas reporting
REPORT_GAS=true npm run test

# Run with coverage
npx hardhat coverage
```

---

## Security Considerations

### Built-in Security Features

**1. Access Control**
- Owner-only functions properly protected
- Relayer-only functions for credit-based messaging
- Reentrancy guards on payment functions

**2. Input Validation**
- All parameters validated
- Zero address checks
- Amount validation
- Deadline validation for permits

**3. Encryption & Privacy**
- Per-conversation encryption keys
- Per-user key encryption
- Deterministic conversation IDs

**4. Merkle Proof Verification**
- Cryptographic verification prevents unauthorized claims
- Efficient on-chain verification
- No central authority required

**5. Time-Locked Withdrawals**
- 7-day lock prevents immediate rug pulls
- Transparent withdrawal timeline

**6. OpenZeppelin Integration**
- Battle-tested security libraries
- Standardized implementations
- Regular security updates

### Security Best Practices

- **Access Control** - Owner-only functions properly protected
- **Input Validation** - All parameters validated
- **Reentrancy Protection** - Safe external calls with ReentrancyGuard
- **Gas Optimization** - Efficient storage patterns
- **Safe Math** - Solidity 0.8+ built-in overflow protection
- **SafeERC20** - Safe token transfers

---

## Gas Optimization

### Diamond Pattern Benefits

- **Modular Deployment**: Only deploy needed facets
- **Shared Storage**: Single proxy storage for all facets
- **Upgradeability**: Upgrade individual facets without full redeployment

### EIP-1167 Minimal Proxy Pattern

**Benefits:**
- **Low Deployment Cost**: ~45,000 gas vs ~2,000,000 gas (~95% savings)
- **Standardized Interface**: Consistent airdrop behavior
- **Upgradeable Logic**: Implementation can be updated
- **Gas Efficient**: Minimal proxy overhead

### Storage Optimization

**Bitmap for Claims:**
- **Efficient Storage**: 1 bit per claim vs 1 slot per claim
- **Gas Savings**: ~20,000 gas per claim
- **Scalable**: Supports unlimited claims

**Library Storage Pattern:**
- Message and PaymentHub use library storage
- Prevents storage collisions in facet mode
- Efficient storage access

---

## Deployment Information

### Sepolia Testnet Deployment

**Network:** Ethereum Sepolia Testnet
**Chain ID:** 11155111
**RPC URL:** https://eth-sepolia.public.blastapi.io

**Contract Addresses:**
- **DehiveProxy**: `0x83Eb2fC1925522434C17C6a32eCE67f4620b73C8`
- **Message Facet**: Check deployment artifacts
- **PaymentHub Facet**: Check deployment artifacts
- **AirdropFactory**: `0x83c3860EcD9981f582434Ed67036db90D5375032`
- **ServerAirdropRegistry**: `0x387D6D818F0cafF8a98E9EFecB75694246cF8D92`

**Deployment Blocks:**
- DehiveProxy: 9535551
- ServerAirdropRegistry: 9552434

### Etherscan Links

- **DehiveProxy**: [View on Etherscan](https://sepolia.etherscan.io/address/0x83Eb2fC1925522434C17C6a32eCE67f4620b73C8)
- **AirdropFactory**: [View on Etherscan](https://sepolia.etherscan.io/address/0x83c3860EcD9981f582434Ed67036db90D5375032)
- **ServerAirdropRegistry**: [View on Etherscan](https://sepolia.etherscan.io/address/0x387D6D818F0cafF8a98E9EFecB75694246cF8D92)

---

## Development Workflow

### Local Development

1. **Start Local Node**
   ```bash
   npx hardhat node
   ```

2. **Deploy to Local Network**
   ```bash
   npm run deploy:demo
   ```

3. **Run Tests**
   ```bash
   npm run test
   ```

### Testnet Deployment

1. **Configure Environment**
   ```bash
   # Set up .env with testnet credentials
   ```

2. **Deploy Contracts**
   ```bash
   npm run deploy:sepolia
   ```

3. **Verify on Etherscan**
   ```bash
   npx hardhat verify --network sepolia <CONTRACT_ADDRESS>
   ```

### Production Deployment

1. **Mainnet Configuration**
   ```bash
   # Update hardhat.config.ts for mainnet
   ```

2. **Deploy to Mainnet**
   ```bash
   npx hardhat run scripts/deploy-mainnet.ts --network mainnet
   ```

3. **Verify Contracts**
   ```bash
   npx hardhat verify --network mainnet <CONTRACT_ADDRESS>
   ```

---

## Gas Analysis

### Deployment Costs

| Contract | Gas Cost | USD (20 gwei) |
|----------|----------|---------------|
| **DehiveProxy** | ~1,500,000 | ~$30 |
| **Message Facet** | ~2,000,000 | ~$40 |
| **PaymentHub Facet** | ~1,800,000 | ~$36 |
| **MerkleAirdrop** | ~2,000,000 | ~$40 |
| **AirdropFactory** | ~1,500,000 | ~$30 |
| **Airdrop Clone** | ~45,000 | ~$0.90 |

### Transaction Costs

| Operation | Gas Cost | USD (20 gwei) |
|-----------|----------|---------------|
| **Create Conversation** | ~120,000 | ~$2.40 |
| **Send Message (pay-as-you-go)** | ~80,000 | ~$1.60 |
| **Send Message (relayer)** | ~60,000 | ~$1.20 |
| **Send Native Payment** | ~70,000 | ~$1.40 |
| **Send ERC-20 Payment** | ~90,000 | ~$1.80 |
| **Create Airdrop** | ~200,000 | ~$4 |
| **Claim Tokens** | ~80,000 | ~$1.60 |

---

## Troubleshooting

### Common Issues

**1. Deployment Failures**
- Check private key and RPC URL
- Ensure sufficient ETH for gas
- Verify network configuration

**2. Test Failures**
- Run `npm run clean` and recompile
- Check test data and parameters
- Verify contract addresses

**3. Gas Estimation Issues**
- Check network congestion
- Increase gas limit if needed
- Verify contract state

**4. Facet Installation Issues**
- Verify function selectors are unique
- Check facet address is correct
- Ensure init function is correct

### Getting Help

- **GitHub Issues:** [Create an issue](https://github.com/Pasonnn/ac-capstone-project/issues)
- **Email:** pason.dev@gmail.com
- **Documentation:** Check the main project README

---

## License

MIT © 2025 Pason.Dev

---

## Acknowledgments

- **OpenZeppelin** - Battle-tested smart contract libraries
- **Hardhat** - Ethereum development environment
- **EIP-2535** - Diamond pattern standard
- **EIP-1167** - Minimal proxy standard
- **Ethereum Foundation** - Core protocol development
