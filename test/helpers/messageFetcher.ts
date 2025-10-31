import { ethers, Contract } from "ethers";
import { Message } from "../../typechain-types";

/**
 * Message Fetcher Utilities
 *
 * Utilities for fetching and parsing messages from the blockchain
 */

export interface MessageData {
  conversationId: bigint;
  from: string;
  to: string;
  encryptedMessage: string;
  timestamp: number;
  blockNumber: number;
  transactionHash: string;
}

export interface ConversationSummary {
  conversationId: bigint;
  participant1: string;
  participant2: string;
  createdAt: number;
  messageCount: number;
  lastMessageAt: number;
}

/**
 * Fetches all MessageSent events from the contract
 * @param messageContract The Message contract instance
 * @param fromBlock Optional starting block number (default: 0)
 * @param toBlock Optional ending block number (default: 'latest')
 * @returns Array of parsed message data
 */
export async function fetchAllMessages(
  messageContract: Message | Contract,
  fromBlock: number | string = 0,
  toBlock: number | string = "latest"
): Promise<MessageData[]> {
  const filter = messageContract.filters.MessageSent();
  const events = await messageContract.queryFilter(filter, fromBlock, toBlock);

  const messages: MessageData[] = [];

  for (const event of events) {
    if (event.args) {
      const block = await event.getBlock();
      messages.push({
        conversationId: BigInt(event.args.conversationId.toString()),
        from: event.args.from,
        to: event.args.to,
        encryptedMessage: event.args.encryptedMessage,
        timestamp: block.timestamp,
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash,
      });
    }
  }

  // Sort by block number and transaction index
  messages.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) {
      return a.blockNumber - b.blockNumber;
    }
    return 0; // Same block, assume order is preserved
  });

  return messages;
}

/**
 * Fetches messages for a specific conversation
 * @param messageContract The Message contract instance
 * @param conversationId The conversation ID to filter by
 * @param fromBlock Optional starting block number
 * @param toBlock Optional ending block number
 * @returns Array of messages in the conversation
 */
export async function fetchConversationMessages(
  messageContract: Message | Contract,
  conversationId: bigint | string | number,
  fromBlock: number | string = 0,
  toBlock: number | string = "latest"
): Promise<MessageData[]> {
  const allMessages = await fetchAllMessages(
    messageContract,
    fromBlock,
    toBlock
  );
  const convId = BigInt(conversationId.toString());

  return allMessages.filter((msg) => msg.conversationId === convId);
}

/**
 * Fetches messages sent by a specific address
 * @param messageContract The Message contract instance
 * @param senderAddress The sender address to filter by
 * @param fromBlock Optional starting block number
 * @param toBlock Optional ending block number
 * @returns Array of messages sent by the address
 */
export async function fetchMessagesBySender(
  messageContract: Message | Contract,
  senderAddress: string,
  fromBlock: number | string = 0,
  toBlock: number | string = "latest"
): Promise<MessageData[]> {
  const filter = messageContract.filters.MessageSent(null, senderAddress);
  const events = await messageContract.queryFilter(filter, fromBlock, toBlock);

  const messages: MessageData[] = [];

  for (const event of events) {
    if (event.args) {
      const block = await event.getBlock();
      messages.push({
        conversationId: BigInt(event.args.conversationId.toString()),
        from: event.args.from,
        to: event.args.to,
        encryptedMessage: event.args.encryptedMessage,
        timestamp: block.timestamp,
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash,
      });
    }
  }

  return messages;
}

/**
 * Fetches messages received by a specific address
 * @param messageContract The Message contract instance
 * @param receiverAddress The receiver address to filter by
 * @param fromBlock Optional starting block number
 * @param toBlock Optional ending block number
 * @returns Array of messages received by the address
 */
export async function fetchMessagesByReceiver(
  messageContract: Message | Contract,
  receiverAddress: string,
  fromBlock: number | string = 0,
  toBlock: number | string = "latest"
): Promise<MessageData[]> {
  const filter = messageContract.filters.MessageSent(
    null,
    null,
    receiverAddress
  );
  const events = await messageContract.queryFilter(filter, fromBlock, toBlock);

  const messages: MessageData[] = [];

  for (const event of events) {
    if (event.args) {
      const block = await event.getBlock();
      messages.push({
        conversationId: BigInt(event.args.conversationId.toString()),
        from: event.args.from,
        to: event.args.to,
        encryptedMessage: event.args.encryptedMessage,
        timestamp: block.timestamp,
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash,
      });
    }
  }

  return messages;
}

/**
 * Fetches all conversations created on the contract
 * @param messageContract The Message contract instance
 * @param fromBlock Optional starting block number
 * @param toBlock Optional ending block number
 * @returns Map of conversation IDs to conversation summaries
 */
export async function fetchAllConversations(
  messageContract: Message | Contract,
  fromBlock: number | string = 0,
  toBlock: number | string = "latest"
): Promise<Map<bigint, ConversationSummary>> {
  const filter = messageContract.filters.ConversationCreated();
  const events = await messageContract.queryFilter(filter, fromBlock, toBlock);

  const conversations = new Map<bigint, ConversationSummary>();

  for (const event of events) {
    if (event.args) {
      const conversationId = BigInt(event.args.conversationId.toString());
      const block = await event.getBlock();

      // Get message count for this conversation
      const messages = await fetchConversationMessages(
        messageContract,
        conversationId,
        fromBlock,
        toBlock
      );

      conversations.set(conversationId, {
        conversationId,
        participant1: event.args.smallerAddress,
        participant2: event.args.largerAddress,
        createdAt: block.timestamp,
        messageCount: messages.length,
        lastMessageAt:
          messages.length > 0
            ? messages[messages.length - 1].timestamp
            : block.timestamp,
      });
    }
  }

  return conversations;
}

/**
 * Gets paginated messages with offset and limit
 * @param messages Array of all messages
 * @param offset Number of messages to skip
 * @param limit Maximum number of messages to return
 * @returns Paginated array of messages
 */
export function paginateMessages(
  messages: MessageData[],
  offset: number = 0,
  limit: number = 50
): MessageData[] {
  return messages.slice(offset, offset + limit);
}

/**
 * Filters messages by time range
 * @param messages Array of messages to filter
 * @param startTime Unix timestamp start (inclusive)
 * @param endTime Unix timestamp end (inclusive)
 * @returns Filtered array of messages
 */
export function filterMessagesByTimeRange(
  messages: MessageData[],
  startTime: number,
  endTime: number
): MessageData[] {
  return messages.filter(
    (msg) => msg.timestamp >= startTime && msg.timestamp <= endTime
  );
}
