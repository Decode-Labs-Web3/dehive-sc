import { ethers, Signer } from "hardhat";
import { Message } from "../../typechain-types";
import {
  generateConversationKey,
  encryptConversationKeyForAddress,
} from "./mockEncryption";

/**
 * Conversation Helper Utilities
 *
 * Utilities for generating conversation IDs and managing conversations in tests
 */

/**
 * Computes the conversation ID for two addresses (deterministic)
 * This matches the on-chain computation in the Message contract
 *
 * @param address1 First address
 * @param address2 Second address
 * @returns The conversation ID as a BigInt
 */
export function computeConversationId(
  address1: string,
  address2: string
): bigint {
  // Order addresses deterministically (smaller first)
  const smallerAddress =
    address1.toLowerCase() < address2.toLowerCase() ? address1 : address2;
  const largerAddress =
    address1.toLowerCase() < address2.toLowerCase() ? address2 : address1;

  // Compute conversation ID: keccak256(abi.encodePacked(smallerAddress, largerAddress))
  const packed = ethers.solidityPacked(
    ["address", "address"],
    [smallerAddress, largerAddress]
  );
  const hash = ethers.keccak256(packed);

  // Convert to BigInt for consistency
  return BigInt(hash);
}

/**
 * Gets the ordered addresses for a conversation (smaller address first)
 * @param address1 First address
 * @param address2 Second address
 * @returns Object with smallerAddress and largerAddress
 */
export function getOrderedAddresses(
  address1: string,
  address2: string
): {
  smallerAddress: string;
  largerAddress: string;
} {
  const addr1Lower = address1.toLowerCase();
  const addr2Lower = address2.toLowerCase();

  return addr1Lower < addr2Lower
    ? { smallerAddress: address1, largerAddress: address2 }
    : { smallerAddress: address2, largerAddress: address1 };
}

/**
 * Checks if an address is the smaller address in a conversation pair
 * @param address The address to check
 * @param otherAddress The other address in the pair
 * @returns True if address is the smaller address
 */
export function isSmallerAddress(
  address: string,
  otherAddress: string
): boolean {
  return address.toLowerCase() < otherAddress.toLowerCase();
}

/**
 * Validates that a conversation ID matches the expected computation
 * @param conversationId The conversation ID to validate
 * @param address1 First address in the conversation
 * @param address2 Second address in the conversation
 * @returns True if the conversation ID is valid
 */
export function validateConversationId(
  conversationId: bigint | string | number,
  address1: string,
  address2: string
): boolean {
  const expectedId = computeConversationId(address1, address2);
  const actualId = BigInt(conversationId.toString());
  return expectedId === actualId;
}

/**
 * Creates a conversation data structure for testing
 * @param address1 First participant address
 * @param address2 Second participant address
 * @param encryptedKeyFor1 Encrypted key for address1
 * @param encryptedKeyFor2 Encrypted key for address2
 * @returns Conversation data structure
 */
export function createConversationData(
  address1: string,
  address2: string,
  encryptedKeyFor1: string,
  encryptedKeyFor2: string
) {
  const { smallerAddress, largerAddress } = getOrderedAddresses(
    address1,
    address2
  );

  return {
    smallerAddress,
    largerAddress,
    conversationId: computeConversationId(address1, address2),
    encryptedKeyForSmaller: isSmallerAddress(address1, address2)
      ? encryptedKeyFor1
      : encryptedKeyFor2,
    encryptedKeyForLarger: isSmallerAddress(address1, address2)
      ? encryptedKeyFor2
      : encryptedKeyFor1,
  };
}

/**
 * Simulates creating a conversation on-chain
 * @param messageContract The Message contract instance
 * @param sender The signer who will create the conversation
 * @param recipientAddress The address of the recipient
 * @param seed Optional seed for generating the conversation key
 * @returns Object with conversationId and conversationKey
 */
export async function simulateCreateConversation(
  messageContract: Message,
  sender: Signer,
  recipientAddress: string,
  seed: string = "default-seed"
): Promise<{ conversationId: bigint; conversationKey: string }> {
  const conversationKey = generateConversationKey(seed);
  const encryptedKeyForSender = encryptConversationKeyForAddress(
    conversationKey,
    await sender.getAddress()
  );
  const encryptedKeyForRecipient = encryptConversationKeyForAddress(
    conversationKey,
    recipientAddress
  );

  const conversationId = await messageContract
    .connect(sender)
    .createConversation.staticCall(
      recipientAddress,
      `0x${encryptedKeyForSender}`,
      `0x${encryptedKeyForRecipient}`
    );

  await messageContract
    .connect(sender)
    .createConversation(
      recipientAddress,
      `0x${encryptedKeyForSender}`,
      `0x${encryptedKeyForRecipient}`
    );

  return { conversationId, conversationKey };
}
