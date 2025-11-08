# PaymentHub Deployment & Testing Scripts

This directory contains scripts for deploying and testing the PaymentHub contract in both standalone and facet modes.

## 📁 Files

- `deployPaymentHub.ts` - Deploy PaymentHub in standalone mode
- `deployPaymentHubFacet.ts` - Deploy PaymentHub as a facet in DehiveProxy
- `testAllInOne.ts` - Comprehensive all-in-one test script

## 🚀 Quick Start

### 1. Deploy PaymentHub (Standalone)

Deploy PaymentHub as an independent contract:

```bash
npx hardhat run scripts/payment/deployPaymentHub.ts --network localhost
```

**What it does:**
- Deploys PaymentHub contract with specified owner
- Initializes with 0% transaction fee
- Saves deployment info to `deployments/paymentHub_<network>.json`

**Environment Variables:**
- None required (uses first two signers as deployer and owner)

### 2. Deploy PaymentHub (Facet Mode)

Deploy PaymentHub and install it as a facet in DehiveProxy:

```bash
# Set proxy address (required)
export PROXY_ADDRESS=0x1234567890abcdef...

# Deploy and install
npx hardhat run scripts/payment/deployPaymentHubFacet.ts --network localhost
```

**What it does:**
- Loads existing DehiveProxy address
- Deploys PaymentHub contract
- Installs PaymentHub as a facet using `facetCut()`
- Initializes PaymentHub through proxy with proxy owner
- Saves deployment info to `deployments/<network>_paymentHubFacet.json`

**Environment Variables:**
- `PROXY_ADDRESS` - Address of deployed DehiveProxy (optional if deployment file exists)

**Note:** The deployer must be the proxy owner to install the facet.

### 3. Run Comprehensive Tests

Run all-in-one test suite covering both standalone and facet modes:

```bash
npx hardhat run scripts/payment/testAllInOne.ts --network localhost
```

**What it tests:**
- ✅ Standalone mode: Native payments, ERC-20 payments, fees, withdrawals
- ✅ Facet mode: Native payments, ERC-20 payments through proxy
- ✅ Load testing: 50 mixed payments (native + ERC-20)
- ✅ Storage isolation between standalone and facet
- ✅ ConversationId consistency and determinism
- ✅ Dual-mode owner resolution

**Test Results:**
- Saves detailed results to `deployments/paymentHub_testResults_<network>_<timestamp>.json`
- Displays comprehensive summary in console

## 📋 Test Script Details

### testAllInOne.ts

The comprehensive test script performs the following steps:

#### Step 1: Deploy Mock ERC20 Token
- Deploys MockERC20 with 1,000,000 TEST tokens
- Distributes 10,000 tokens to each test user

#### Step 2: Deploy Standalone PaymentHub
- Deploys PaymentHub in standalone mode
- Tests owner initialization
- Verifies transaction fee (default 0%)

#### Step 3: Deploy DehiveProxy & PaymentHub Facet
- Deploys DehiveProxy
- Deploys PaymentHub facet
- Installs facet into proxy using Diamond pattern
- Initializes through proxy

#### Step 4: Test Standalone Mode
- **Native Payments:** Send ETH between users
- **ERC-20 Payments:** Transfer TEST tokens with approval
- **Fee Management:** Set 1% fee, verify fee accumulation
- **Fee Withdrawal:** Owner withdraws accumulated fees

#### Step 5: Test Facet Mode (Through Proxy)
- **Native Payments:** Send ETH through proxy
- **ERC-20 Payments:** Transfer tokens through proxy
- **Fee Management:** Set 2% fee through proxy
- **Fee Accumulation:** Verify separate fee tracking

#### Step 6: Load Testing
- Sends 50 payments (25 native + 25 ERC-20)
- Tests alternating between 4 different users
- Verifies all payments succeed
- Tracks performance and gas usage

#### Step 7: Storage Isolation
- Verifies standalone and facet have separate storage
- Confirms different fee settings
- Validates different owners

#### Step 8: ConversationId Consistency
- Tests conversationId computation matches between modes
- Verifies order-independence (user1→user2 == user2→user1)
- Confirms deterministic behavior

### Test Results Format

```json
{
  "network": "localhost",
  "timestamp": "2025-11-08T...",
  "deployments": {
    "mockToken": "0x...",
    "standalone": "0x...",
    "proxy": "0x...",
    "facet": "0x..."
  },
  "results": {
    "standaloneTests": {
      "nativePayments": 2,
      "erc20Payments": 1,
      "feeUpdates": 1,
      "feeWithdrawals": 1
    },
    "facetTests": {
      "nativePayments": 2,
      "erc20Payments": 1,
      "feeUpdates": 1
    },
    "loadTests": {
      "totalPayments": 50,
      "nativePayments": 25,
      "erc20Payments": 25
    },
    "errors": []
  }
}
```

## 🔧 Configuration

### Network Configuration

Make sure your `hardhat.config.ts` includes the target network:

```typescript
networks: {
  localhost: {
    url: "http://127.0.0.1:8545"
  },
  sepolia: {
    url: process.env.SEPOLIA_RPC_URL,
    accounts: [process.env.PRIVATE_KEY]
  }
}
```

### Test Accounts

The test script uses 6 accounts:
- **Account 0:** Deployer
- **Account 1:** Owner
- **Accounts 2-5:** Test users (user1, user2, user3, user4)

For local testing, ensure your Hardhat node has at least 6 funded accounts.

## 📊 Example Output

### Successful Test Run

```
================================================================================
All-in-One Test: PaymentHub
================================================================================

📋 Test Configuration:
  Deployer: 0x...
  Owner: 0x...
  User1: 0x...
  User2: 0x...

================================================================================
Step 1: Deploying Mock ERC20 Token
================================================================================
✓ MockERC20 deployed at: 0x...
✓ Tokens distributed to users

================================================================================
Step 4: Testing Standalone Mode
================================================================================

4.1 Testing Native Payments (Standalone)...
  ✓ Native payment sent: 1.0 ETH

4.2 Testing ERC-20 Payments (Standalone)...
  ✓ ERC-20 payment sent: 100.0 TEST

4.3 Testing Transaction Fee Management (Standalone)...
  ✓ Transaction fee set to: 100 basis points (1%)
  ✓ Payment with fee: 10.0 ETH
  ✓ Recipient received: 9.9 ETH
  ✓ Fee accumulated: 0.1 ETH

================================================================================
Test Summary
================================================================================

📦 Deployments:
  MockERC20: 0x...
  PaymentHub (Standalone): 0x...
  DehiveProxy: 0x...
  PaymentHub (Facet): 0x...

📊 Standalone Mode Tests:
  ✓ Native Payments: 2
  ✓ ERC-20 Payments: 1
  ✓ Fee Updates: 1
  ✓ Fee Withdrawals: 1

📊 Facet Mode Tests:
  ✓ Native Payments: 2
  ✓ ERC-20 Payments: 1
  ✓ Fee Updates: 1

📊 Load Tests:
  ✓ Total Payments: 50
  ✓ Native Payments: 25
  ✓ ERC-20 Payments: 25

📊 Errors:
  ✅ No errors encountered

================================================================================
✅ All-in-One Test Completed Successfully!
================================================================================
```

## 🛠️ Troubleshooting

### Issue: "Proxy address not found"

**Solution:** Either:
1. Set `PROXY_ADDRESS` environment variable:
   ```bash
   export PROXY_ADDRESS=0x1234...
   ```
2. Or ensure deployment file exists:
   ```
   deployments/sepolia_dehiveProxy_messageFacet.json
   ```

### Issue: "Facet installation may fail"

**Cause:** Deployer is not the proxy owner

**Solution:** Use the proxy owner account to deploy:
```bash
export PRIVATE_KEY=<proxy_owner_private_key>
npx hardhat run scripts/payment/deployPaymentHubFacet.ts --network sepolia
```

### Issue: "Insufficient funds"

**Solution:** Ensure deployer has enough ETH:
- Minimum recommended: 0.01 ETH
- For mainnet: 0.1+ ETH recommended

### Issue: "Token transfer failed"

**Cause:** Insufficient token approval

**Solution:** The test script handles approvals automatically. If using manually:
```solidity
token.approve(paymentHubAddress, amount);
```

## 📝 Next Steps After Deployment

### 1. Verify Contracts on Etherscan

**Standalone:**
```bash
npx hardhat verify --network sepolia <PaymentHub_ADDRESS> <OWNER_ADDRESS>
```

**Facet:**
```bash
npx hardhat verify --network sepolia <FACET_ADDRESS> <DEPLOYER_ADDRESS>
```

### 2. Set Transaction Fee (Optional)

```typescript
// Connect to deployed contract
const paymentHub = await ethers.getContractAt("PaymentHub", address);

// Set 1% fee (100 basis points)
await paymentHub.setTransactionFee(100);
```

### 3. Integrate with Frontend

```typescript
// Initialize PaymentHub
const paymentHub = new ethers.Contract(
  PAYMENTHUB_ADDRESS,
  PaymentHubABI,
  signer
);

// Send native payment
await paymentHub.sendNative(
  conversationId,
  recipientAddress,
  ipfsCid,
  contentHash,
  0, // mode: public
  clientMsgId,
  { value: ethers.parseEther("1.0") }
);

// Send ERC-20 payment
const token = new ethers.Contract(TOKEN_ADDRESS, ERC20_ABI, signer);
await token.approve(PAYMENTHUB_ADDRESS, amount);
await paymentHub.sendERC20(
  conversationId,
  recipientAddress,
  TOKEN_ADDRESS,
  amount,
  ipfsCid,
  contentHash,
  0,
  clientMsgId
);
```

### 4. Index Events with The Graph

Listen for `PaymentSent` events to build payment history:

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
}
```

## 📚 Additional Resources

- **Contract Documentation:** `contracts/PaymentHub.md`
- **Interface Definition:** `contracts/interfaces/IPaymentHub.sol`
- **Unit Tests:** `test/PaymentHub.test.ts`
- **Facet Tests:** `test/PaymentHubFacet.test.ts`
- **Integration Tests:** `test/PaymentHubIntegration.test.ts`

## ⚠️ Security Notes

1. **Owner Control:** Only the owner can set fees and withdraw funds
2. **Non-Custodial:** Contract never holds user funds (except accumulated fees)
3. **Fee Limit:** Maximum transaction fee is 10% (1000 basis points)
4. **Reentrancy Protection:** All payment functions use `nonReentrant` modifier
5. **Safe Transfers:** Uses OpenZeppelin's SafeERC20 library

## 🤝 Support

For issues or questions:
1. Check the troubleshooting section above
2. Review the test output for specific error messages
3. Examine deployment files in `deployments/` directory
4. Consult contract documentation in `contracts/PaymentHub.md`
