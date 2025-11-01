/**
 * Mock Encryption Utilities for Testing
 *
 * This module provides simple encryption/decryption utilities for testing purposes.
 * In production, these would be replaced with proper cryptographic functions.
 */

/**
 * Encrypts a message using a simple base64 encoding scheme (for testing only)
 * @param message The plaintext message to encrypt
 * @param key The encryption key (as a string)
 * @returns Encrypted message as a string
 */
export function encryptMessage(message: string, key: string): string {
  // Simple mock encryption: base64 encode with key prefix
  // In production, use proper encryption like AES-256-GCM or similar
  const encoded = Buffer.from(message).toString("base64");
  const keyPrefix = Buffer.from(key.substring(0, 8))
    .toString("base64")
    .substring(0, 8);
  return `${keyPrefix}${encoded}`;
}

/**
 * Decrypts a message encrypted with encryptMessage
 * @param encryptedMessage The encrypted message
 * @param key The decryption key (must match encryption key)
 * @returns Decrypted plaintext message
 */
export function decryptMessage(encryptedMessage: string, key: string): string {
  try {
    // Remove key prefix (first 8 chars after encoding)
    const keyPrefix = Buffer.from(key.substring(0, 8))
      .toString("base64")
      .substring(0, 8);
    if (!encryptedMessage.startsWith(keyPrefix)) {
      throw new Error("Invalid encryption key or corrupted message");
    }

    // Extract encoded message
    const encoded = encryptedMessage.substring(keyPrefix.length);

    // Decode from base64
    const decoded = Buffer.from(encoded, "base64").toString("utf-8");
    return decoded;
  } catch (error) {
    throw new Error(`Decryption failed: ${error}`);
  }
}

/**
 * Generates a mock conversation key for testing
 * @param seed Optional seed for deterministic key generation
 * @returns A conversation key as a hex string
 */
export function generateConversationKey(seed?: string): string {
  // Generate a deterministic key from seed or random
  if (seed) {
    const crypto = require("crypto");
    return crypto.createHash("sha256").update(seed).digest("hex");
  }
  const crypto = require("crypto");
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Encrypts a conversation key for a specific address (mock implementation)
 * @param conversationKey The conversation key to encrypt
 * @param address The address to encrypt for (used as encryption key)
 * @returns Encrypted conversation key as hex string
 */
export function encryptConversationKeyForAddress(
  conversationKey: string,
  address: string
): string {
  // Simple mock: XOR with address hash (for testing only)
  const crypto = require("crypto");
  const addressHash = crypto
    .createHash("sha256")
    .update(address.toLowerCase())
    .digest("hex");

  let encrypted = "";
  for (let i = 0; i < conversationKey.length; i++) {
    const keyChar = conversationKey[i];
    const hashChar = addressHash[i % addressHash.length];
    const encryptedChar = (parseInt(keyChar, 16) ^ parseInt(hashChar, 16))
      .toString(16)
      .padStart(1, "0");
    encrypted += encryptedChar;
  }
  return encrypted;
}

/**
 * Decrypts a conversation key encrypted for a specific address
 * @param encryptedKey The encrypted conversation key
 * @param address The address used for decryption (must match encryption address)
 * @returns Decrypted conversation key
 */
export function decryptConversationKeyForAddress(
  encryptedKey: string,
  address: string
): string {
  // Reverse the XOR operation
  const crypto = require("crypto");
  const addressHash = crypto
    .createHash("sha256")
    .update(address.toLowerCase())
    .digest("hex");

  let decrypted = "";
  for (let i = 0; i < encryptedKey.length; i++) {
    const encChar = encryptedKey[i];
    const hashChar = addressHash[i % addressHash.length];
    const decryptedChar = (parseInt(encChar, 16) ^ parseInt(hashChar, 16))
      .toString(16)
      .padStart(1, "0");
    decrypted += decryptedChar;
  }
  return decrypted;
}
