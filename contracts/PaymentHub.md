# PaymentHub Contract Documentation

## Overview

PaymentHub is a peer-to-peer payment contract that enables users to send native coins (ETH, MATIC, etc.) and ERC-20 tokens within chat conversations. Each payment is linked to a `conversationId` and references off-chain metadata stored on IPFS.

**Key Features:**
- 💸 Native coin transfers (ETH, MATIC, BNB, etc.)
- 🪙 ERC-20 token transfers
- 🔐 EIP-2612 permit support (gasless approvals)
- 💬 Conversation-linked payments
- 📦 IPFS metadata integration
- 🔒 Non-custodial (no fund custody)
- 💰 Optional transaction fees
- 🔄 Dual-mode support (standalone or facet)

## Architecture

### Dual-Mode Operation

PaymentHub supports two deployment modes:

#### 1. Standalone Mode
- Deployed as an independent contract
- Owner set during construction
- Direct function calls
- Separate storage from other contracts

#### 2. Facet Mode (Diamond Pattern)
- Installed into DehiveProxy as a facet
- Uses proxy owner via `IDehiveProxy.owner()`
- Function calls delegated through proxy
- Diamond Storage pattern for upgradability

### Storage Pattern

Uses Diamond Storage to prevent storage collisions:

```solidity
// Storage slot: keccak256("dehive.PaymentHub.storage")
struct PaymentHubStorageStruct {
    bool initialized;
    address owner;
    uint256 transactionFeePercent;  // Basis points (100 = 1%)
    mapping(address => uint256) accumulatedFees;  // token => amount
}
```

## ConversationId

The `conversationId` is a deterministic identifier for chat conversations between two users.

### Computation

```solidity
function computeConversationId(address user1, address user2)
    external
    pure
    returns (uint256 conversationId)
{
    (address smaller, address larger) = user1 < user2
        ? (user1, user2)
        : (user2, user1);
    return uint256(keccak256(abi.encodePacked(smaller, larger)));
}
```

### Properties

- **Deterministic:** Same two addresses always produce the same ID
- **Order-Independent:** `computeConversationId(A, B) == computeConversationId(B, A)`
- **Unique:** Each pair of addresses has a unique conversation ID
- **Consistent:** Matches the Message contract pattern

### Example

```solidity
// User1: 0x1111...
// User2: 0x2222...
uint256 convId = paymentHub.computeConversationId(user1, user2);
// convId: 0x3c4f...  (same regardless of parameter order)
```

## Functions

### Core Payment Functions

#### sendNative()

Send native coins (ETH, MATIC, etc.) to a recipient.

```solidity
function sendNative(
    uint256 conversationId,
    address recipient,
    string memory ipfsCid,
    bytes32 contentHash,
    uint8 mode,
    string memory clientMsgId
) external payable returns (bool success)
```

**Parameters:**
- `conversationId` - Unique identifier for the conversation
- `recipient` - Address receiving the payment
- `ipfsCid` - IPFS CID pointing to off-chain payment metadata
- `contentHash` - Cryptographic hash of the payload for verification
- `mode` - Payment visibility: `0` = public, `1` = secret
- `clientMsgId` - Client-side message ID for UI syncing

**Returns:**
- `success` - `true` if payment succeeded

**Requirements:**
- `msg.value > 0` - Must send some native tokens
- `recipient != address(0)` - Recipient cannot be zero address

**Example:**

```javascript
// Send 1 ETH payment
await paymentHub.sendNative(
  conversationId,
  "0x2222...",  // recipient
  "QmX5Y...",   // IPFS CID
  ethers.id("payment-hash"),
  0,            // public mode
  "msg-001",    // client message ID
  { value: ethers.parseEther("1.0") }
);
```

#### sendERC20()

Send ERC-20 tokens to a recipient.

```solidity
function sendERC20(
    uint256 conversationId,
    address recipient,
    address token,
    uint256 amount,
    string memory ipfsCid,
    bytes32 contentHash,
    uint8 mode,
    string memory clientMsgId
) external returns (bool success)
```

**Parameters:**
- `conversationId` - Unique identifier for the conversation
- `recipient` - Address receiving the tokens
- `token` - ERC-20 token contract address
- `amount` - Amount of tokens to send
- `ipfsCid` - IPFS CID pointing to off-chain metadata
- `contentHash` - Cryptographic hash of the payload
- `mode` - Payment visibility: `0` = public, `1` = secret
- `clientMsgId` - Client-side message ID

**Returns:**
- `success` - `true` if payment succeeded

**Requirements:**
- Sender must have approved PaymentHub to spend `amount` tokens
- `token != address(0)` - Token cannot be zero address
- `recipient != address(0)` - Recipient cannot be zero address
- `amount > 0` - Amount must be greater than zero

**Example:**

```javascript
// First, approve tokens
const token = new ethers.Contract(TOKEN_ADDRESS, ERC20_ABI, signer);
await token.approve(PAYMENTHUB_ADDRESS, amount);

// Then send payment
await paymentHub.sendERC20(
  conversationId,
  "0x2222...",       // recipient
  TOKEN_ADDRESS,     // token contract
  ethers.parseEther("100"),
  "QmX5Y...",        // IPFS CID
  ethers.id("payment-hash"),
  0,                 // public mode
  "msg-002"          // client message ID
);
```

#### sendERC20WithPermit()

Send ERC-20 tokens using EIP-2612 permit for gasless approvals.

```solidity
function sendERC20WithPermit(
    uint256 conversationId,
    address recipient,
    address token,
    uint256 amount,
    string memory ipfsCid,
    bytes32 contentHash,
    uint8 mode,
    string memory clientMsgId,
    uint256 deadline,
    uint8 v,
    bytes32 r,
    bytes32 s
) external returns (bool success)
```

**Additional Parameters:**
- `deadline` - Timestamp when permit expires
- `v, r, s` - Signature components from EIP-2612 permit

**Requirements:**
- Token must support EIP-2612 (IERC20Permit)
- Signature must be valid and not expired
- All requirements from `sendERC20()` apply

**Example:**

```javascript
// Generate permit signature off-chain
const domain = {
  name: await token.name(),
  version: "1",
  chainId: await signer.getChainId(),
  verifyingContract: TOKEN_ADDRESS
};

const types = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" }
  ]
};

const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour
const signature = await signer._signTypedData(domain, types, {
  owner: await signer.getAddress(),
  spender: PAYMENTHUB_ADDRESS,
  value: amount,
  nonce: await token.nonces(await signer.getAddress()),
  deadline
});

const { v, r, s } = ethers.Signature.from(signature);

// Send payment with permit
await paymentHub.sendERC20WithPermit(
  conversationId,
  recipient,
  TOKEN_ADDRESS,
  amount,
  ipfsCid,
  contentHash,
  mode,
  clientMsgId,
  deadline,
  v, r, s
);
```

### Admin Functions

#### setTransactionFee()

Set or update the transaction fee percentage (owner only).

```solidity
function setTransactionFee(uint256 newFeePercent) external
```

**Parameters:**
- `newFeePercent` - Fee in basis points (100 = 1%, max 1000 = 10%)

**Requirements:**
- Caller must be owner
- `newFeePercent <= 1000` (max 10%)

**Example:**

```javascript
// Set 1% fee
await paymentHub.connect(owner).setTransactionFee(100);

// Set 2.5% fee
await paymentHub.connect(owner).setTransactionFee(250);

// Disable fees
await paymentHub.connect(owner).setTransactionFee(0);
```

#### withdrawFees()

Withdraw accumulated fees for a specific token (owner only).

```solidity
function withdrawFees(address token, address recipient) external
```

**Parameters:**
- `token` - Token address (`address(0)` for native tokens)
- `recipient` - Address to receive the withdrawn fees

**Requirements:**
- Caller must be owner
- `recipient != address(0)`
- Must have accumulated fees for the token

**Example:**

```javascript
// Withdraw native token fees (ETH)
await paymentHub.connect(owner).withdrawFees(
  ethers.ZeroAddress,  // native token
  owner.address
);

// Withdraw ERC-20 token fees
await paymentHub.connect(owner).withdrawFees(
  TOKEN_ADDRESS,
  owner.address
);
```

### View Functions

#### transactionFeePercent()

Get the current transaction fee percentage.

```solidity
function transactionFeePercent() external view returns (uint256)
```

**Returns:**
- Current fee in basis points (100 = 1%)

**Example:**

```javascript
const fee = await paymentHub.transactionFeePercent();
console.log(`Current fee: ${Number(fee) / 100}%`);
```

#### accumulatedFees()

Get accumulated fees for a specific token.

```solidity
function accumulatedFees(address token) external view returns (uint256)
```

**Parameters:**
- `token` - Token address (`address(0)` for native tokens)

**Returns:**
- Accumulated fee amount for the token

**Example:**

```javascript
// Get ETH fees
const ethFees = await paymentHub.accumulatedFees(ethers.ZeroAddress);
console.log(`ETH fees: ${ethers.formatEther(ethFees)} ETH`);

// Get ERC-20 fees
const tokenFees = await paymentHub.accumulatedFees(TOKEN_ADDRESS);
console.log(`Token fees: ${ethers.formatEther(tokenFees)} TEST`);
```

#### owner()

Get the contract owner address.

```solidity
function owner() external view returns (address)
```

**Returns:**
- Owner address (works in both standalone and facet modes)

**Example:**

```javascript
const ownerAddr = await paymentHub.owner();
console.log(`Owner: ${ownerAddr}`);
```

## Events

### PaymentSent

Emitted when a payment is successfully sent.

```solidity
event PaymentSent(
    uint256 indexed conversationId,
    address indexed sender,
    address indexed recipient,
    address token,       // address(0) for native
    uint256 amount,
    uint256 fee,
    string ipfsCid,
    bytes32 contentHash,
    uint8 mode,
    string clientMsgId,
    uint256 timestamp
);
```

**Parameters:**
- `conversationId` - Conversation identifier
- `sender` - Payment sender address
- `recipient` - Payment recipient address
- `token` - Token address (`address(0)` for native tokens)
- `amount` - Total payment amount (before fees)
- `fee` - Fee amount deducted
- `ipfsCid` - IPFS CID reference
- `contentHash` - Content verification hash
- `mode` - Payment visibility mode
- `clientMsgId` - Client message ID
- `timestamp` - Block timestamp

**Indexing with The Graph:**

```graphql
type Payment @entity {
  id: ID!
  conversationId: BigInt!
  sender: Bytes!
  recipient: Bytes!
  token: Bytes!
  amount: BigInt!
  fee: BigInt!
  ipfsCid: String!
  contentHash: Bytes!
  mode: Int!
  clientMsgId: String!
  timestamp: BigInt!
  transactionHash: Bytes!
}
```

### TransactionFeeSet

Emitted when the transaction fee is updated.

```solidity
event TransactionFeeSet(
    uint256 newFeePercent,
    uint256 timestamp
);
```

### FeesWithdrawn

Emitted when accumulated fees are withdrawn.

```solidity
event FeesWithdrawn(
    address indexed token,
    uint256 amount,
    address indexed recipient,
    uint256 timestamp
);
```

## Fee Structure

### How Fees Work

1. **Fee Calculation:** Fees are calculated in basis points
   - 100 basis points = 1%
   - 250 basis points = 2.5%
   - 1000 basis points = 10% (maximum)

2. **Fee Deduction:** Fees are deducted from the sender's payment
   ```
   Fee Amount = Payment Amount × (Fee Percent / 10000)
   Recipient Receives = Payment Amount - Fee Amount
   ```

3. **Fee Accumulation:** Fees accumulate per token in contract storage

4. **Fee Withdrawal:** Owner can withdraw fees at any time

### Example

```javascript
// Scenario: 1% fee (100 basis points)
// User sends 100 tokens

Payment Amount: 100 tokens
Fee: 100 × (100 / 10000) = 1 token
Recipient Receives: 100 - 1 = 99 tokens
Accumulated Fees: 1 token (withdrawable by owner)
```

## Security Considerations

### 1. Non-Custodial Design

The contract **never holds user funds**. All transfers happen directly from sender to recipient:

```solidity
// Native transfers
recipient.call{value: amountToSend}("");

// ERC-20 transfers
IERC20(token).safeTransferFrom(msg.sender, recipient, amountToSend);
```

**Exception:** Accumulated transaction fees are held until owner withdrawal.

### 2. Reentrancy Protection

All payment and withdrawal functions use `nonReentrant` modifier from OpenZeppelin:

```solidity
function sendNative(...) external payable nonReentrant returns (bool) {
    // Protected against reentrancy
}
```

### 3. Safe Token Transfers

Uses OpenZeppelin's `SafeERC20` library for all ERC-20 operations:

```solidity
using SafeERC20 for IERC20;

IERC20(token).safeTransferFrom(sender, recipient, amount);
```

This protects against:
- Tokens that don't return `bool` from transfer
- Tokens that revert on failure
- Non-standard token implementations

### 4. Input Validation

All functions validate inputs:
- Zero address checks
- Amount validation (must be > 0)
- Fee limit enforcement (max 10%)
- Recipient validation

### 5. Owner Access Control

Only the owner can:
- Set transaction fees
- Withdraw accumulated fees

Owner determination supports both modes:
```solidity
// Facet mode: Use proxy owner
try IDehiveProxy(address(this)).owner() returns (address proxyOwner) {
    return proxyOwner;
}
// Standalone mode: Use stored owner
catch {
    return ds.owner;
}
```

### 6. Storage Isolation

Diamond Storage prevents storage collisions with proxy or other facets:

```solidity
// Unique storage position
bytes32 constant PAYMENTHUB_STORAGE_POSITION =
    keccak256("dehive.PaymentHub.storage") - 1;
```

## Integration Guide

### Frontend Integration

#### 1. Initialize Contract

```javascript
import { ethers } from "ethers";
import PaymentHubABI from "./abis/PaymentHub.json";

const provider = new ethers.BrowserProvider(window.ethereum);
const signer = await provider.getSigner();

const paymentHub = new ethers.Contract(
  PAYMENTHUB_ADDRESS,
  PaymentHubABI,
  signer
);
```

#### 2. Compute ConversationId

```javascript
// Get conversation ID for chat between two users
const conversationId = await paymentHub.computeConversationId(
  user1Address,
  user2Address
);
```

#### 3. Send Native Payment

```javascript
async function sendEthPayment(recipientAddress, amountEth) {
  const tx = await paymentHub.sendNative(
    conversationId,
    recipientAddress,
    ipfsCid,           // Upload metadata to IPFS first
    contentHash,       // Hash of metadata
    0,                 // Public mode
    generateClientId(), // Unique client message ID
    { value: ethers.parseEther(amountEth) }
  );

  const receipt = await tx.wait();
  console.log("Payment sent:", receipt.hash);
}
```

#### 4. Send ERC-20 Payment

```javascript
async function sendTokenPayment(tokenAddress, recipientAddress, amount) {
  // Step 1: Approve tokens
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
  const approveTx = await token.approve(PAYMENTHUB_ADDRESS, amount);
  await approveTx.wait();

  // Step 2: Send payment
  const tx = await paymentHub.sendERC20(
    conversationId,
    recipientAddress,
    tokenAddress,
    amount,
    ipfsCid,
    contentHash,
    0,
    generateClientId()
  );

  const receipt = await tx.wait();
  console.log("Token payment sent:", receipt.hash);
}
```

#### 5. Listen for Events

```javascript
// Listen for payments in a conversation
paymentHub.on("PaymentSent", (convId, sender, recipient, token, amount, fee, ipfsCid, contentHash, mode, clientMsgId, timestamp) => {
  if (convId.toString() === conversationId.toString()) {
    console.log("New payment received!");
    console.log("Amount:", ethers.formatEther(amount));
    console.log("From:", sender);
    console.log("To:", recipient);

    // Update UI with new payment
    displayPayment({
      sender,
      recipient,
      amount: ethers.formatEther(amount),
      token,
      ipfsCid,
      timestamp: Number(timestamp)
    });
  }
});
```

### Backend Integration

#### 1. Index Events

Use The Graph or ethers.js to index payment events:

```javascript
// Query past payments for a conversation
const filter = paymentHub.filters.PaymentSent(conversationId);
const events = await paymentHub.queryFilter(filter, fromBlock, toBlock);

const payments = events.map(event => ({
  transactionHash: event.transactionHash,
  sender: event.args.sender,
  recipient: event.args.recipient,
  amount: event.args.amount.toString(),
  token: event.args.token,
  ipfsCid: event.args.ipfsCid,
  timestamp: Number(event.args.timestamp)
}));
```

#### 2. Verify Payments

```javascript
// Verify a payment exists on-chain
async function verifyPayment(txHash) {
  const receipt = await provider.getTransactionReceipt(txHash);

  const paymentEvents = receipt.logs
    .filter(log => log.topics[0] === ethers.id("PaymentSent(uint256,address,address,address,uint256,uint256,string,bytes32,uint8,string,uint256)"))
    .map(log => paymentHub.interface.parseLog(log));

  return paymentEvents.length > 0;
}
```

## Testing

Run comprehensive tests:

```bash
# Unit tests (standalone mode)
npx hardhat test test/PaymentHub.test.ts

# Facet tests (proxy integration)
npx hardhat test test/PaymentHubFacet.test.ts

# Integration tests
npx hardhat test test/PaymentHubIntegration.test.ts

# All-in-one comprehensive test
npx hardhat run scripts/payment/testAllInOne.ts --network localhost
```

## Deployment

See `scripts/payment/README.md` for deployment instructions.

## Gas Optimization Tips

1. **Batch Payments:** Send multiple payments in a single transaction using MultiCall
2. **Use Permit:** Save gas with `sendERC20WithPermit()` instead of approve + send
3. **Optimize IPFS CID:** Use shorter CIDs when possible
4. **Client Message ID:** Keep clientMsgId short to save gas

## Upgradeability

When deployed as a facet, PaymentHub can be upgraded:

```solidity
// Deploy new PaymentHub version
PaymentHub newFacet = new PaymentHub(owner);

// Replace old facet with new one
await proxy.facetCut([{
  facetAddress: newFacet.address,
  functionSelectors: selectors,
  action: 1  // Replace
}], address(0), "0x");
```

**Note:** Storage layout must remain compatible across upgrades.

## License

MIT License - See LICENSE file for details.

## Support

For issues or questions:
- GitHub Issues: [dehive-sc repository]
- Documentation: `scripts/payment/README.md`
- Tests: `test/PaymentHub.test.ts`
