# Sepolia Test Script Guide

## Overview

The `testCompleteSystemSepolia.ts` script tests the complete Dehive system on Sepolia testnet using 3 wallets from environment variables.

## Prerequisites

1. **Environment Variables**: Set up the following in your `.env` file or export them:
   ```bash
   PRIVATE_KEY=<owner_private_key>      # Owner/deployer wallet
   PRIVATE_KEY_A=<user_a_private_key>  # Test user A
   PRIVATE_KEY_B=<user_b_private_key>  # Test user B

   # Existing deployed contract addresses
   PROXY_ADDRESS=0x...                 # Deployed proxy address
   MESSAGE_FACET_ADDRESS=0x...         # Deployed message facet address
   PAYMENT_FACET_ADDRESS=0x...        # Deployed payment hub facet address
   ```

2. **Sepolia ETH**: Ensure all 3 wallets have sufficient Sepolia ETH:
   - Owner wallet: At least 0.1 ETH (for deployment and gas)
   - User A: At least 0.05 ETH (for transactions)
   - User B: At least 0.05 ETH (for transactions)

3. **Network Configuration**: Ensure Sepolia network is configured in `hardhat.config.ts`

## Usage

### Basic Usage

```bash
PRIVATE_KEY=<owner_key> \
PRIVATE_KEY_A=<user_a_key> \
PRIVATE_KEY_B=<user_b_key> \
PROXY_ADDRESS=<proxy_address> \
MESSAGE_FACET_ADDRESS=<message_facet_address> \
PAYMENT_FACET_ADDRESS=<payment_facet_address> \
npx hardhat run scripts/testCompleteSystemSepolia.ts --network sepolia
```

### Using .env file

Create a `.env` file in the project root:

```env
PRIVATE_KEY=0x...
PRIVATE_KEY_A=0x...
PRIVATE_KEY_B=0x...

# Existing deployed contract addresses
PROXY_ADDRESS=0x83Eb2fC1925522434C17C6a32eCE67f4620b73C8
MESSAGE_FACET_ADDRESS=0xf31DBE9D0b6e321dAD4F386B96EB7753483989DF
PAYMENT_FACET_ADDRESS=0xD39285c2Fd74974965c759e292F4d40F011B20f5

SEPOLIA_RPC_URL=https://eth-sepolia.public.blastapi.io
ETHERSCAN_API_KEY=your_etherscan_api_key
```

Then run:

```bash
npx hardhat run scripts/testCompleteSystemSepolia.ts --network sepolia
```

## What the Script Tests

### Phase 1: System Connection
- Connects to existing DehiveProxy
- Connects to existing Message Facet
- Connects to existing PaymentHub Facet
- Deploys Airdrop Registry (if needed)
- Deploys Mock ERC20 Token (if needed)
- Verifies all contracts are accessible

### Phase 2: Message System
- Creates conversation between User A and User B
- Deposits funds for relayer messages
- Sends 10 messages (mix of pay-as-you-go and relayer)

### Phase 3: Payment System
- Distributes ERC20 tokens to users
- Sets transaction fee
- Sends 5 native payments
- Sends 5 ERC20 payments

### Phase 4: Airdrop System
- Creates server
- Creates campaign with User A and User B as recipients
- Processes airdrop claims

### Phase 5: Integration Testing
- Sends message after airdrop
- Sends payment with message in conversation

### Phase 6: Admin Operations
- Withdraws accumulated fees
- Tests proxy withdraw function
- Updates pay-as-you-go fee

### Phase 7: Edge Cases
- Zero amount payment (should fail)
- Invalid conversation ID
- Insufficient fee payment (should fail)

## Test Results

The script generates a JSON file with test results in the `deployments/` directory:

```
deployments/completeSystemTest_sepolia_<timestamp>.json
```

The results include:
- Deployment addresses
- Test statistics
- Error logs
- Wallet addresses used

## Troubleshooting

### Insufficient Balance
If you see "insufficient balance" errors:
- Fund the wallets with more Sepolia ETH
- Check wallet balances before running the test

### Transaction Failures
- Ensure all wallets have enough ETH for gas
- Check network connectivity
- Verify private keys are correct

### Contract Deployment Failures
- Ensure owner wallet has sufficient balance
- Check Sepolia RPC endpoint is working
- Verify contract compilation succeeded

## Example Output

```
====================================================================================================
COMPREHENSIVE SYSTEM INTEGRATION TEST - SEPOLIA
Dehive Complete System - Real-World Simulation
====================================================================================================

📋 Test Configuration:
  Network: Sepolia
  Owner/Deployer: 0x...
  User A: 0x...
  User B: 0x...

💰 Wallet Balances:
  Owner: 0.5 ETH
  User A: 0.1 ETH
  User B: 0.1 ETH

...

✅ ALL TESTS PASSED - SYSTEM READY FOR LAUNCH!
```

## Notes

- The script uses the owner wallet as the relayer for testing purposes
- All transactions are real on Sepolia testnet
- Test results are saved automatically
- The script handles errors gracefully and continues testing
