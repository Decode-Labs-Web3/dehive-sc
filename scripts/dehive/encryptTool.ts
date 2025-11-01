#!/usr/bin/env node

/**
 * Interactive Encryption Tool for Manual Message Encryption/Decryption
 *
 * This tool allows you to manually encrypt and decrypt messages using
 * the same encryption functions used in the Message contract tests.
 *
 * Usage:
 *   npx ts-node scripts/dehive/encryptTool.ts
 *   or
 *   npx hardhat run scripts/dehive/encryptTool.ts
 *
 * Features:
 *   - Encrypt/decrypt messages
 *   - Encrypt/decrypt conversation keys for addresses
 *   - Generate conversation keys
 *   - Compute conversation IDs
 *   - Validate encryption/decryption
 */

import * as readline from "readline";
import {
  encryptMessage,
  decryptMessage,
  generateConversationKey,
  encryptConversationKeyForAddress,
  decryptConversationKeyForAddress,
} from "../../test/helpers/mockEncryption";
import { computeConversationId } from "../../test/helpers/conversationHelpers";
import { ethers } from "ethers";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

function displayMenu() {
  console.log("\n" + "=".repeat(80));
  console.log("🔐 Interactive Encryption Tool");
  console.log("=".repeat(80));
  console.log("\nOptions:");
  console.log("  1. Encrypt a message");
  console.log("  2. Decrypt a message");
  console.log("  3. Generate conversation key");
  console.log("  4. Encrypt conversation key for an address");
  console.log("  5. Decrypt conversation key for an address");
  console.log("  6. Compute conversation ID from two addresses");
  console.log(
    "  7. Full encryption flow (key generation + message encryption)"
  );
  console.log(
    "  8. Full decryption flow (key decryption + message decryption)"
  );
  console.log("  9. Validate encryption/decryption (round trip test)");
  console.log("  0. Exit");
  console.log("\n" + "=".repeat(80));
}

async function encryptMessageFlow() {
  console.log("\n📝 Encrypt Message");
  console.log("-".repeat(80));

  const message = await question("Enter message to encrypt: ");
  const conversationKey = await question("Enter conversation key (hex): ");

  if (!message || !conversationKey) {
    console.log("❌ Message and conversation key are required");
    return;
  }

  try {
    const encrypted = encryptMessage(message, conversationKey);
    console.log("\n✅ Encryption Result:");
    console.log(`  Original: "${message}"`);
    console.log(`  Encrypted: "${encrypted}"`);
    console.log(`  Key used: ${conversationKey.substring(0, 16)}...`);
  } catch (error: any) {
    console.log(`❌ Encryption failed: ${error.message}`);
  }
}

async function decryptMessageFlow() {
  console.log("\n🔓 Decrypt Message");
  console.log("-".repeat(80));

  const encryptedMessage = await question("Enter encrypted message: ");
  const conversationKey = await question("Enter conversation key (hex): ");

  if (!encryptedMessage || !conversationKey) {
    console.log("❌ Encrypted message and conversation key are required");
    return;
  }

  try {
    const decrypted = decryptMessage(encryptedMessage, conversationKey);
    console.log("\n✅ Decryption Result:");
    console.log(`  Encrypted: "${encryptedMessage}"`);
    console.log(`  Decrypted: "${decrypted}"`);
    console.log(`  Key used: ${conversationKey.substring(0, 16)}...`);
  } catch (error: any) {
    console.log(`❌ Decryption failed: ${error.message}`);
  }
}

async function generateKeyFlow() {
  console.log("\n🔑 Generate Conversation Key");
  console.log("-".repeat(80));

  const useSeed = await question("Use seed for deterministic key? (y/n): ");
  let seed: string | undefined;

  if (useSeed.toLowerCase() === "y") {
    seed = await question("Enter seed: ");
  }

  try {
    const key = generateConversationKey(seed);
    console.log("\n✅ Generated Conversation Key:");
    console.log(`  Key (hex): ${key}`);
    console.log(`  Length: ${key.length} characters (${key.length / 2} bytes)`);
    if (seed) {
      console.log(`  Seed used: "${seed}"`);
      console.log(`  ⚠️  Same seed will always produce the same key`);
    } else {
      console.log(
        `  ⚠️  This is a random key - save it if you need to decrypt later!`
      );
    }
  } catch (error: any) {
    console.log(`❌ Key generation failed: ${error.message}`);
  }
}

async function encryptKeyFlow() {
  console.log("\n🔐 Encrypt Conversation Key for Address");
  console.log("-".repeat(80));

  const conversationKey = await question("Enter conversation key (hex): ");
  const address = await question("Enter Ethereum address: ");

  if (!conversationKey || !address) {
    console.log("❌ Conversation key and address are required");
    return;
  }

  try {
    // Normalize address
    const normalizedAddress = ethers.getAddress(address).toLowerCase();

    const encrypted = encryptConversationKeyForAddress(
      conversationKey,
      normalizedAddress
    );
    console.log("\n✅ Encryption Result:");
    console.log(`  Conversation Key: ${conversationKey.substring(0, 16)}...`);
    console.log(`  Address: ${normalizedAddress}`);
    console.log(`  Encrypted Key (hex): ${encrypted}`);
    console.log(`  Length: ${encrypted.length} characters`);
    console.log(`  \n  💡 Use this encrypted key when creating a conversation`);
    console.log(`     The user at ${normalizedAddress} can decrypt this key`);
  } catch (error: any) {
    console.log(`❌ Encryption failed: ${error.message}`);
  }
}

async function decryptKeyFlow() {
  console.log("\n🔓 Decrypt Conversation Key for Address");
  console.log("-".repeat(80));

  const encryptedKey = await question(
    "Enter encrypted conversation key (hex): "
  );
  const address = await question("Enter your Ethereum address: ");

  if (!encryptedKey || !address) {
    console.log("❌ Encrypted key and address are required");
    return;
  }

  try {
    // Normalize address
    const normalizedAddress = ethers.getAddress(address).toLowerCase();

    // Remove 0x prefix if present
    const keyHex = encryptedKey.startsWith("0x")
      ? encryptedKey.substring(2)
      : encryptedKey;

    const decrypted = decryptConversationKeyForAddress(
      keyHex,
      normalizedAddress
    );
    console.log("\n✅ Decryption Result:");
    console.log(`  Encrypted Key: ${encryptedKey.substring(0, 32)}...`);
    console.log(`  Address: ${normalizedAddress}`);
    console.log(`  Decrypted Key (hex): ${decrypted}`);
    console.log(
      `  Length: ${decrypted.length} characters (${decrypted.length / 2} bytes)`
    );
    console.log(
      `  \n  💡 Use this key to encrypt/decrypt messages in the conversation`
    );
  } catch (error: any) {
    console.log(`❌ Decryption failed: ${error.message}`);
  }
}

async function computeConvIdFlow() {
  console.log("\n💬 Compute Conversation ID");
  console.log("-".repeat(80));

  const address1 = await question("Enter first address: ");
  const address2 = await question("Enter second address: ");

  if (!address1 || !address2) {
    console.log("❌ Both addresses are required");
    return;
  }

  try {
    // Normalize addresses
    const addr1 = ethers.getAddress(address1);
    const addr2 = ethers.getAddress(address2);

    const conversationId = computeConversationId(addr1, addr2);

    console.log("\n✅ Conversation ID:");
    console.log(`  Address 1: ${addr1}`);
    console.log(`  Address 2: ${addr2}`);
    console.log(`  Conversation ID: ${conversationId}`);
    console.log(
      `  (This is deterministic - same addresses always produce same ID)`
    );
  } catch (error: any) {
    console.log(`❌ Computation failed: ${error.message}`);
  }
}

async function fullEncryptionFlow() {
  console.log("\n🚀 Full Encryption Flow");
  console.log("-".repeat(80));
  console.log("This will:");
  console.log("  1. Generate a conversation key");
  console.log("  2. Encrypt it for two addresses");
  console.log("  3. Encrypt a message using the key");
  console.log("-".repeat(80));

  const address1 = await question("\nEnter first address: ");
  const address2 = await question("Enter second address: ");
  const message = await question("Enter message to encrypt: ");
  const useSeed = await question("Use seed for key generation? (y/n): ");

  if (!address1 || !address2 || !message) {
    console.log("❌ Addresses and message are required");
    return;
  }

  try {
    // Normalize addresses
    const addr1 = ethers.getAddress(address1).toLowerCase();
    const addr2 = ethers.getAddress(address2).toLowerCase();

    // Generate key
    let seed: string | undefined;
    if (useSeed.toLowerCase() === "y") {
      seed = await question("Enter seed: ");
    }
    const conversationKey = generateConversationKey(seed);
    console.log(
      `\n✓ Generated conversation key: ${conversationKey.substring(0, 16)}...`
    );

    // Encrypt keys for both addresses
    const encryptedKey1 = encryptConversationKeyForAddress(
      conversationKey,
      addr1
    );
    const encryptedKey2 = encryptConversationKeyForAddress(
      conversationKey,
      addr2
    );
    console.log(`✓ Encrypted key for ${addr1.substring(0, 10)}...`);
    console.log(`✓ Encrypted key for ${addr2.substring(0, 10)}...`);

    // Encrypt message
    const encryptedMessage = encryptMessage(message, conversationKey);
    console.log(`✓ Encrypted message`);

    // Compute conversation ID
    const conversationId = computeConversationId(addr1, addr2);

    console.log("\n" + "=".repeat(80));
    console.log("📋 Complete Encryption Results:");
    console.log("=".repeat(80));
    console.log(`\nAddresses:`);
    console.log(`  Address 1: ${addr1}`);
    console.log(`  Address 2: ${addr2}`);
    console.log(`\nConversation:`);
    console.log(`  Conversation ID: ${conversationId}`);
    console.log(`  Conversation Key: ${conversationKey}`);
    console.log(`\nEncrypted Keys:`);
    console.log(`  For ${addr1}: ${encryptedKey1}`);
    console.log(`  For ${addr2}: ${encryptedKey2}`);
    console.log(`\nMessage:`);
    console.log(`  Original: "${message}"`);
    console.log(`  Encrypted: "${encryptedMessage}"`);
    console.log("\n" + "=".repeat(80));
    console.log("💡 You can now use these values to:");
    console.log("   1. Create conversation on-chain with encrypted keys");
    console.log("   2. Send encrypted message via sendMessage()");
    console.log("=".repeat(80));
  } catch (error: any) {
    console.log(`❌ Encryption flow failed: ${error.message}`);
  }
}

async function fullDecryptionFlow() {
  console.log("\n🔓 Full Decryption Flow");
  console.log("-".repeat(80));
  console.log("This will:");
  console.log("  1. Decrypt conversation key using your address");
  console.log("  2. Decrypt message using the decrypted key");
  console.log("-".repeat(80));

  const encryptedKey = await question(
    "\nEnter encrypted conversation key (hex): "
  );
  const address = await question("Enter your address: ");
  const encryptedMessage = await question("Enter encrypted message: ");

  if (!encryptedKey || !address || !encryptedMessage) {
    console.log(
      "❌ Encrypted key, address, and encrypted message are required"
    );
    return;
  }

  try {
    // Normalize address
    const normalizedAddress = ethers.getAddress(address).toLowerCase();

    // Remove 0x prefix if present
    const keyHex = encryptedKey.startsWith("0x")
      ? encryptedKey.substring(2)
      : encryptedKey;

    // Decrypt conversation key
    const conversationKey = decryptConversationKeyForAddress(
      keyHex,
      normalizedAddress
    );
    console.log(`✓ Decrypted conversation key`);

    // Decrypt message
    const decryptedMessage = decryptMessage(encryptedMessage, conversationKey);

    console.log("\n" + "=".repeat(80));
    console.log("📋 Complete Decryption Results:");
    console.log("=".repeat(80));
    console.log(`\nAddress: ${normalizedAddress}`);
    console.log(`\nKeys:`);
    console.log(`  Encrypted Key: ${encryptedKey.substring(0, 32)}...`);
    console.log(`  Decrypted Key: ${conversationKey.substring(0, 16)}...`);
    console.log(`\nMessage:`);
    console.log(`  Encrypted: "${encryptedMessage}"`);
    console.log(`  Decrypted: "${decryptedMessage}"`);
    console.log("\n" + "=".repeat(80));
    console.log("✅ Message successfully decrypted!");
    console.log("=".repeat(80));
  } catch (error: any) {
    console.log(`❌ Decryption flow failed: ${error.message}`);
  }
}

async function validateFlow() {
  console.log("\n✅ Validate Encryption/Decryption (Round Trip Test)");
  console.log("-".repeat(80));

  const originalMessage = await question("Enter message to test: ");
  const address = await question("Enter address for key encryption test: ");

  if (!originalMessage || !address) {
    console.log("❌ Message and address are required");
    return;
  }

  try {
    // Normalize address
    const normalizedAddress = ethers.getAddress(address).toLowerCase();

    // Generate conversation key
    const conversationKey = generateConversationKey();
    console.log(`\n✓ Generated conversation key`);

    // Test message encryption/decryption
    const encryptedMessage = encryptMessage(originalMessage, conversationKey);
    const decryptedMessage = decryptMessage(encryptedMessage, conversationKey);
    const messageMatch = originalMessage === decryptedMessage;

    // Test key encryption/decryption
    const encryptedKey = encryptConversationKeyForAddress(
      conversationKey,
      normalizedAddress
    );
    const decryptedKey = decryptConversationKeyForAddress(
      encryptedKey,
      normalizedAddress
    );
    const keyMatch = conversationKey === decryptedKey;

    console.log("\n" + "=".repeat(80));
    console.log("📊 Validation Results:");
    console.log("=".repeat(80));
    console.log(`\nMessage Encryption/Decryption:`);
    console.log(`  Original: "${originalMessage}"`);
    console.log(`  Encrypted: "${encryptedMessage}"`);
    console.log(`  Decrypted: "${decryptedMessage}"`);
    console.log(`  Match: ${messageMatch ? "✅ PASS" : "❌ FAIL"}`);

    console.log(`\nKey Encryption/Decryption:`);
    console.log(`  Original Key: ${conversationKey.substring(0, 16)}...`);
    console.log(`  Encrypted Key: ${encryptedKey.substring(0, 32)}...`);
    console.log(`  Decrypted Key: ${decryptedKey.substring(0, 16)}...`);
    console.log(`  Match: ${keyMatch ? "✅ PASS" : "❌ FAIL"}`);

    if (messageMatch && keyMatch) {
      console.log(
        "\n✅ All validations passed! Encryption/Decryption works correctly."
      );
    } else {
      console.log(
        "\n❌ Some validations failed. Check the encryption functions."
      );
    }
    console.log("=".repeat(80));
  } catch (error: any) {
    console.log(`❌ Validation failed: ${error.message}`);
  }
}

async function main() {
  console.log("\n🔐 Interactive Encryption Tool");
  console.log(
    "This tool uses the same encryption functions as the Message contract tests."
  );
  console.log(
    "All encryption is mock/test encryption - NOT for production use!"
  );

  while (true) {
    displayMenu();
    const choice = await question("\nSelect an option: ");

    switch (choice) {
      case "1":
        await encryptMessageFlow();
        break;
      case "2":
        await decryptMessageFlow();
        break;
      case "3":
        await generateKeyFlow();
        break;
      case "4":
        await encryptKeyFlow();
        break;
      case "5":
        await decryptKeyFlow();
        break;
      case "6":
        await computeConvIdFlow();
        break;
      case "7":
        await fullEncryptionFlow();
        break;
      case "8":
        await fullDecryptionFlow();
        break;
      case "9":
        await validateFlow();
        break;
      case "0":
        console.log("\n👋 Goodbye!");
        rl.close();
        process.exit(0);
      default:
        console.log("\n❌ Invalid option. Please try again.");
    }

    await question("\nPress Enter to continue...");
  }
}

main()
  .then(() => {
    rl.close();
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Error:", error);
    rl.close();
    process.exit(1);
  });
