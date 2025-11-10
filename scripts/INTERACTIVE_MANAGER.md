# Interactive Proxy Manager

## Overview

The `interactiveProxyManager.ts` script provides an interactive terminal interface to read and manage the state of your Dehive proxy system. It allows you to:

- **Read** all state from Message and PaymentHub facets through the proxy
- **View** current settings (fees, relayer, owner, accumulated fees, etc.)
- **Change** settings interactively (fees, relayer, etc.)

## Prerequisites

1. **Environment Variables**: Set up the following in your `.env` file:
   ```bash
   PRIVATE_KEY=<owner_private_key>      # Owner wallet (must be proxy owner)
   PROXY_ADDRESS=0x...                  # Deployed proxy address
   MESSAGE_FACET_ADDRESS=0x...          # (Optional, not used but can be set)
   PAYMENT_FACET_ADDRESS=0x...          # (Optional, not used but can be set)
   ```

2. **Network Configuration**: Ensure your target network is configured in `hardhat.config.ts`

## Usage

### Basic Usage

```bash
npx hardhat run scripts/interactiveProxyManager.ts --network sepolia
```

### Using .env file

Create a `.env` file in the project root:

```env
PRIVATE_KEY=0x...
PROXY_ADDRESS=0x83Eb2fC1925522434C17C6a32eCE67f4620b73C8
MESSAGE_FACET_ADDRESS=0xf31DBE9D0b6e321dAD4F386B96EB7753483989DF
PAYMENT_FACET_ADDRESS=0xD39285c2Fd74974965c759e292F4d40F011B20f5

SEPOLIA_RPC_URL=https://eth-sepolia.public.blastapi.io
```

Then run:

```bash
npx hardhat run scripts/interactiveProxyManager.ts --network sepolia
```

## Features

### 1. Read System State
Displays all current state:
- **Proxy**: Address and owner
- **Message Facet**: Owner, pay-as-you-go fee, relayer fee, relayer address
- **PaymentHub Facet**: Owner, transaction fee percentage, accumulated native fees

### 2. Update Message Pay-as-You-Go Fee
Change the fee for direct message sending (pay-as-you-go model).

**Example:**
```
Current Pay-as-You-Go Fee: 0.0001 ETH
Enter new fee in ETH (e.g., 0.0001): 0.0002
```

### 3. Update Message Relayer Fee
Change the fee for relayer-based message sending (credit model).

**Example:**
```
Current Relayer Fee: 0.00001 ETH
Enter new relayer fee in ETH (e.g., 0.00001): 0.00002
```

### 4. Update Message Relayer Address
Change the relayer address authorized to send messages via relayer.

**Example:**
```
Current Relayer: 0x1234...
Enter new relayer address: 0x5678...
```

### 5. Update PaymentHub Transaction Fee
Change the transaction fee percentage for payments (in basis points).

**Example:**
```
Current Transaction Fee: 100 bps (1.00%)
Enter new fee in basis points (100 = 1%, max 1000 = 10%): 200
```

### 6. Withdraw PaymentHub Fees (Native)
Withdraw accumulated native token fees from the PaymentHub.

**Example:**
```
Accumulated Native Fees: 0.05 ETH
Withdraw 0.05 ETH? (yes/no): yes
```

### 7. Withdraw PaymentHub Fees (ERC-20)
Withdraw accumulated ERC-20 token fees from the PaymentHub.

**Example:**
```
Enter ERC-20 token address: 0x1234...
Accumulated ERC-20 Fees: 1000.0 tokens
Withdraw 1000.0 tokens? (yes/no): yes
```

### 8. Check User Funds
Check the deposited funds balance for a specific user (Message facet).

**Example:**
```
Enter user address to check funds: 0x1234...
💰 Funds for 0x1234...: 0.01 ETH
```

### 9. Exit
Exit the interactive manager.

## Menu Options

```
📋 MAIN MENU:
  1. Refresh state
  2. Update Message Pay-as-You-Go Fee
  3. Update Message Relayer Fee
  4. Update Message Relayer Address
  5. Update PaymentHub Transaction Fee
  6. Withdraw PaymentHub Fees (Native)
  7. Withdraw PaymentHub Fees (ERC-20)
  8. Check user funds (Message)
  9. Exit
```

## Example Session

```
================================================================================
🔧 INTERACTIVE PROXY MANAGER
================================================================================

📋 Configuration:
  Network: sepolia
  Proxy: 0x83Eb2fC1925522434C17C6a32eCE67f4620b73C8
  Signer: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

🔗 Connecting to contracts...
✅ Connected to contracts

📖 Reading system state...

================================================================================
📊 CURRENT SYSTEM STATE
================================================================================

🔷 PROXY CONTRACT:
  Address: 0x83Eb2fC1925522434C17C6a32eCE67f4620b73C8
  Owner: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

💬 MESSAGE FACET:
  Owner: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
  Pay-as-You-Go Fee: 0.0001 ETH
  Relayer Fee: 0.00001 ETH
  Relayer: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8

💰 PAYMENT HUB FACET:
  Owner: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
  Transaction Fee: 100 bps (1.00%)
  Accumulated Fees (Native): 0.02 ETH

================================================================================

📋 MAIN MENU:
  1. Refresh state
  2. Update Message Pay-as-You-Go Fee
  3. Update Message Relayer Fee
  4. Update Message Relayer Address
  5. Update PaymentHub Transaction Fee
  6. Withdraw PaymentHub Fees
  7. Check user funds (Message)
  8. Exit

Select an option (1-9):
```

## Security Notes

- **Owner Only**: Most write operations require the contract owner. Ensure `PRIVATE_KEY` is the owner's private key.
- **Network**: Make sure you're connected to the correct network (testnet vs mainnet).
- **Verification**: Always verify transaction hashes on block explorers after making changes.

## Troubleshooting

### Error: "caller is not the owner"
- Ensure `PRIVATE_KEY` in `.env` matches the proxy owner address
- Check that the signer address matches the owner address shown in the state

### Error: "Invalid address format"
- Ensure addresses are valid Ethereum addresses (0x followed by 40 hex characters)
- Check for typos in addresses

### Error: "Fee cannot exceed 1000 basis points"
- PaymentHub transaction fee is limited to 10% (1000 basis points)
- Use a value between 0 and 1000

### Error: "No fees to withdraw"
- There are no accumulated fees to withdraw
- Check the accumulated fees value in the state display

## Tips

- Use option 1 (Refresh state) after making changes to see updated values
- Always verify transaction hashes on block explorers
- For testnets, use faucets to ensure you have enough ETH for gas
- Keep your `.env` file secure and never commit it to version control
