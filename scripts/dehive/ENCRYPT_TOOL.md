# Interactive Encryption Tool

## Overview

The `encryptTool.ts` script provides an interactive command-line interface for manually encrypting and decrypting messages using the same encryption functions used in the Message contract tests.

## Features

- ✅ **Encrypt Messages**: Encrypt plaintext messages using conversation keys
- ✅ **Decrypt Messages**: Decrypt encrypted messages using conversation keys
- ✅ **Generate Keys**: Generate conversation keys (random or deterministic from seed)
- ✅ **Encrypt Keys for Addresses**: Encrypt conversation keys for specific Ethereum addresses
- ✅ **Decrypt Keys for Addresses**: Decrypt conversation keys using your address
- ✅ **Compute Conversation IDs**: Calculate deterministic conversation IDs from two addresses
- ✅ **Full Encryption Flow**: Complete workflow from key generation to message encryption
- ✅ **Full Decryption Flow**: Complete workflow from key decryption to message decryption
- ✅ **Validation**: Round-trip test to verify encryption/decryption works correctly

## Usage

### Run the Tool

```bash
# Option 1: Using Hardhat
npx hardhat run scripts/dehive/encryptTool.ts

# Option 2: Using ts-node directly
npx ts-node scripts/dehive/encryptTool.ts
```

### Interactive Menu

The tool displays a menu with numbered options:

```
================================================================================
🔐 Interactive Encryption Tool
================================================================================

Options:
  1. Encrypt a message
  2. Decrypt a message
  3. Generate conversation key
  4. Encrypt conversation key for an address
  5. Decrypt conversation key for an address
  6. Compute conversation ID from two addresses
  7. Full encryption flow (key generation + message encryption)
  8. Full decryption flow (key decryption + message decryption)
  9. Validate encryption/decryption (round trip test)
  0. Exit
```

## Examples

### Example 1: Encrypt a Message

```
1. Select option: 1
2. Enter message to encrypt: Hello, World!
3. Enter conversation key (hex): abc123...
```

**Output:**
```
✅ Encryption Result:
  Original: "Hello, World!"
  Encrypted: "YWJjMTIz...base64..."
  Key used: abc123...
```

### Example 2: Full Encryption Flow

```
1. Select option: 7
2. Enter first address: 0x1234...
3. Enter second address: 0x5678...
4. Enter message to encrypt: Secret message
5. Use seed for key generation? (y/n): n
```

**Output:**
```
📋 Complete Encryption Results:
Addresses:
  Address 1: 0x1234...
  Address 2: 0x5678...
Conversation:
  Conversation ID: 123456...
  Conversation Key: abc123...
Encrypted Keys:
  For 0x1234...: def456...
  For 0x5678...: ghi789...
Message:
  Original: "Secret message"
  Encrypted: "YWJjMTIz..."
```

### Example 3: Decrypt a Message

```
1. Select option: 8
2. Enter encrypted conversation key (hex): def456...
3. Enter your address: 0x1234...
4. Enter encrypted message: YWJjMTIz...
```

**Output:**
```
✅ Message successfully decrypted!
📋 Complete Decryption Results:
Address: 0x1234...
Keys:
  Encrypted Key: def456...
  Decrypted Key: abc123...
Message:
  Encrypted: "YWJjMTIz..."
  Decrypted: "Secret message"
```

## Address Normalization

The tool automatically normalizes Ethereum addresses to lowercase to match your database storage format:

- ✅ Input: `0x1234...` (checksummed) → Normalized: `0x1234...` (lowercase)
- ✅ Input: `0x1234...` (mixed case) → Normalized: `0x1234...` (lowercase)
- ✅ Input: `0x1234...` (lowercase) → Normalized: `0x1234...` (lowercase)

This ensures:
- Consistent encryption/decryption regardless of input format
- Compatibility with your database (lowercase addresses)
- Correct conversation ID computation

## Important Notes

### ⚠️ Mock Encryption Only

This tool uses **mock/test encryption functions**:
- Not suitable for production use
- Uses simple XOR/base64 encoding for testing
- For production, use proper cryptographic libraries (AES-256-GCM, etc.)

### 🔑 Key Management

- **Random keys**: Generated keys are random - save them if you need to decrypt later!
- **Seed-based keys**: Using a seed produces deterministic keys (same seed = same key)
- **Key format**: All keys are hex strings (remove `0x` prefix if needed)

### 📝 Best Practices

1. **Always normalize addresses**: The tool does this automatically
2. **Save conversation keys**: If using random keys, save them securely
3. **Use seeds for testing**: Deterministic keys make testing easier
4. **Validate before use**: Use option 9 to verify encryption/decryption works

## Troubleshooting

### Error: "Invalid encryption key or corrupted message"
- Ensure you're using the correct conversation key
- Check that the encrypted message is complete (not truncated)

### Error: "Decryption failed"
- Verify the encrypted key matches the address used for encryption
- Ensure addresses are normalized correctly (tool does this automatically)
- Check that the encrypted key format is correct (hex string)

### Error: "Invalid address"
- Ensure addresses are valid Ethereum addresses
- Check format: should start with `0x` followed by 40 hex characters
- Example: `0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0`

## Integration with Contract

After using this tool:

1. **Create Conversation on-chain**:
   ```solidity
   createConversation(
     recipient,
     0x{encryptedKeyForSender},    // From tool option 4
     0x{encryptedKeyForReceiver}   // From tool option 4
   )
   ```

2. **Send Encrypted Message**:
   ```solidity
   sendMessage(
     conversationId,                // From tool option 6
     recipient,
     "{encryptedMessage}"           // From tool option 1 or 7
   )
   ```

3. **Decrypt Received Messages**:
   - Retrieve encrypted conversation key from contract (via `getMyEncryptedConversationKeys`)
   - Use tool option 5 to decrypt the key
   - Use tool option 2 to decrypt messages using the decrypted key
