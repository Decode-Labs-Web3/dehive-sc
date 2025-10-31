/**
 * Test Data Generator Utilities
 *
 * Utilities for generating test messages and conversation data
 */

/**
 * Generates a random message for testing
 * @param index Optional index to create deterministic messages
 * @returns A random test message string
 */
export function generateTestMessage(index?: number): string {
  const messages = [
    "Hello! How are you?",
    "This is a test message.",
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
    "Testing the messaging system with various message lengths.",
    "Short msg",
    "This is a longer message that contains more words and should test how the system handles messages with different lengths and content. It includes punctuation, spaces, and various characters.",
    "1234567890",
    "Special chars: !@#$%^&*()",
    "Unicode test: 你好 世界 🌍",
    "Multi-line message\nLine 2\nLine 3",
  ];

  if (index !== undefined) {
    return messages[index % messages.length] + ` [${index}]`;
  }

  // Return random message
  return messages[Math.floor(Math.random() * messages.length)];
}

/**
 * Generates multiple test messages
 * @param count Number of messages to generate
 * @param prefix Optional prefix for each message
 * @returns Array of test messages
 */
export function generateTestMessages(count: number, prefix?: string): string[] {
  const messages: string[] = [];
  for (let i = 0; i < count; i++) {
    const msg = generateTestMessage(i);
    messages.push(prefix ? `${prefix} ${msg}` : msg);
  }
  return messages;
}

/**
 * Creates conversation participant pairs for testing
 * @param addresses Array of addresses to pair
 * @returns Array of [address1, address2] pairs
 */
export function createConversationPairs(
  addresses: string[]
): [string, string][] {
  const pairs: [string, string][] = [];

  for (let i = 0; i < addresses.length; i++) {
    for (let j = i + 1; j < addresses.length; j++) {
      pairs.push([addresses[i], addresses[j]]);
    }
  }

  return pairs;
}

/**
 * Generates mock encrypted conversation keys for two addresses
 * @param address1 First address
 * @param address2 Second address
 * @returns Object with encrypted keys for both addresses
 */
export function generateMockEncryptedKeys(
  address1: string,
  address2: string
): {
  encryptedKeyFor1: string;
  encryptedKeyFor2: string;
} {
  // Simple mock: use address hashes as keys
  const crypto = require("crypto");
  const key1 = crypto
    .createHash("sha256")
    .update(address1 + "key1")
    .digest("hex");
  const key2 = crypto
    .createHash("sha256")
    .update(address2 + "key2")
    .digest("hex");

  return {
    encryptedKeyFor1: key1,
    encryptedKeyFor2: key2,
  };
}

/**
 * Creates test conversation data
 * @param address1 First participant
 * @param address2 Second participant
 * @returns Object with conversation data ready for contract interaction
 */
export function createTestConversationData(address1: string, address2: string) {
  const { encryptedKeyFor1, encryptedKeyFor2 } = generateMockEncryptedKeys(
    address1,
    address2
  );

  return {
    participant1: address1,
    participant2: address2,
    encryptedKeyFor1: `0x${encryptedKeyFor1}`,
    encryptedKeyFor2: `0x${encryptedKeyFor2}`,
  };
}

/**
 * Generates a batch of test messages with timing information
 * @param count Number of messages
 * @param baseTimestamp Base timestamp (messages will be spaced 1 second apart)
 * @returns Array of messages with timestamps
 */
export function generateTimedMessages(
  count: number,
  baseTimestamp: number = Date.now()
): Array<{ message: string; timestamp: number }> {
  const messages: Array<{ message: string; timestamp: number }> = [];

  for (let i = 0; i < count; i++) {
    messages.push({
      message: generateTestMessage(i),
      timestamp: baseTimestamp + i,
    });
  }

  return messages;
}
