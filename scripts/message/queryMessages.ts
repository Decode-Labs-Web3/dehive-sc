import { ethers } from "hardhat";
import fs from "fs";
import path from "path";
import { Message } from "../../typechain-types";
import { computeConversationId } from "../../test/helpers/conversationHelpers";
import {
  decryptMessage,
  decryptConversationKeyForAddress,
} from "../../test/helpers/mockEncryption";
import {
  fetchAllMessages,
  fetchConversationMessages,
  fetchMessagesBySender,
  fetchMessagesByReceiver,
  paginateMessages,
  filterMessagesByTimeRange,
  fetchAllConversations,
  MessageData,
  ConversationSummary,
} from "../../test/helpers/messageFetcher";

/**
 * Message Query Script
 *
 * This script queries messages from the Message contract:
 * - Query messages by conversation ID
 * - Query messages by sender/receiver
 * - Filter by time range
 * - Export message history
 * - Decrypt and display messages
 *
 * Usage: npx hardhat run scripts/message/queryMessages.ts --network <network>
 *        [--conversation-id <id>]
 *        [--sender <address>]
 *        [--receiver <address>]
 *        [--from-time <timestamp>]
 *        [--to-time <timestamp>]
 *        [--export <filename>]
 */

interface QueryOptions {
  conversationId?: string;
  sender?: string;
  receiver?: string;
  fromTime?: number;
  toTime?: number;
  exportFile?: string;
  decrypt?: boolean;
  limit?: number;
  offset?: number;
}

async function loadDeployment(): Promise<string> {
  const network = await ethers.provider.getNetwork();
  const networkName = network.name || "localhost";
  const deploymentFile = path.join(
    __dirname,
    "../../deployments",
    `message_${networkName}.json`
  );

  if (!fs.existsSync(deploymentFile)) {
    throw new Error(`No deployment found for network: ${networkName}`);
  }

  const deploymentInfo = JSON.parse(fs.readFileSync(deploymentFile, "utf-8"));
  return deploymentInfo.contractAddress;
}

async function getConversationKey(
  messageContract: Message,
  user: any,
  conversationId: bigint
): Promise<string> {
  try {
    const encryptedKey = await messageContract
      .connect(user)
      .getMyEncryptedConversationKeys(conversationId);

    const decryptedKey = decryptConversationKeyForAddress(
      encryptedKey.substring(2),
      user.address
    );

    return decryptedKey;
  } catch (error) {
    console.warn(`⚠ Could not decrypt conversation key: ${error}`);
    return "";
  }
}

async function displayMessages(
  messages: MessageData[],
  conversationKey?: string,
  limit?: number,
  offset?: number
): Promise<void> {
  let displayMessages = messages;

  // Apply pagination
  if (offset !== undefined || limit !== undefined) {
    displayMessages = paginateMessages(messages, offset || 0, limit || 50);
  }

  console.log(
    `\n📋 Messages (showing ${displayMessages.length} of ${messages.length}):\n`
  );
  console.log("=".repeat(80));

  if (displayMessages.length === 0) {
    console.log("No messages found.");
    return;
  }

  for (const msg of displayMessages) {
    const date = new Date(msg.timestamp * 1000);

    console.log(`Conversation ID: ${msg.conversationId.toString()}`);
    console.log(`From: ${msg.from}`);
    console.log(`To: ${msg.to}`);

    if (conversationKey) {
      try {
        const decrypted = decryptMessage(msg.encryptedMessage, conversationKey);
        console.log(`Message: ${decrypted}`);
      } catch (error) {
        console.log(`Message: [Encrypted - decryption failed]`);
        console.log(`Encrypted: ${msg.encryptedMessage.substring(0, 50)}...`);
      }
    } else {
      console.log(`Message: [Encrypted]`);
      console.log(`Encrypted: ${msg.encryptedMessage.substring(0, 50)}...`);
    }

    console.log(`Time: ${date.toLocaleString()}`);
    console.log(`Block: ${msg.blockNumber}`);
    console.log(`Tx Hash: ${msg.transactionHash}`);
    console.log("-".repeat(80));
  }
}

async function exportMessages(
  messages: MessageData[],
  filename: string
): Promise<void> {
  const exportData = messages.map((msg) => ({
    conversationId: msg.conversationId.toString(),
    from: msg.from,
    to: msg.to,
    encryptedMessage: msg.encryptedMessage,
    timestamp: msg.timestamp,
    blockNumber: msg.blockNumber,
    transactionHash: msg.transactionHash,
    date: new Date(msg.timestamp * 1000).toISOString(),
  }));

  const exportDir = path.join(__dirname, "../../exports");
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  const exportFile = path.join(exportDir, filename);
  fs.writeFileSync(exportFile, JSON.stringify(exportData, null, 2));

  console.log(`\n✓ Exported ${messages.length} messages to: ${exportFile}`);
}

async function queryMessages(options: QueryOptions): Promise<void> {
  console.log("=".repeat(80));
  console.log("Message Query Tool");
  console.log("=".repeat(80));

  // Load contract
  const contractAddress = await loadDeployment();
  console.log(`\n✓ Contract address: ${contractAddress}`);

  const MessageFactory = await ethers.getContractFactory("Message");
  const messageContract = MessageFactory.attach(contractAddress) as Message;

  // Get signers
  const [user] = await ethers.getSigners();
  console.log(`✓ Query user: ${user.address}`);

  let messages: MessageData[] = [];
  let conversationKey: string | undefined;

  // Query messages based on options
  if (options.conversationId) {
    console.log(
      `\n📝 Querying messages for conversation: ${options.conversationId}`
    );
    const convId = BigInt(options.conversationId);
    messages = await fetchConversationMessages(messageContract, convId);

    // Try to get conversation key for decryption
    try {
      conversationKey = await getConversationKey(messageContract, user, convId);
      if (conversationKey) {
        console.log("✓ Conversation key retrieved (decryption enabled)");
      }
    } catch (error) {
      console.log(
        "⚠ Could not retrieve conversation key (decryption disabled)"
      );
    }
  } else if (options.sender) {
    console.log(`\n📝 Querying messages from sender: ${options.sender}`);
    messages = await fetchMessagesBySender(messageContract, options.sender);
  } else if (options.receiver) {
    console.log(`\n📝 Querying messages to receiver: ${options.receiver}`);
    messages = await fetchMessagesByReceiver(messageContract, options.receiver);
  } else {
    console.log(`\n📝 Querying all messages...`);
    messages = await fetchAllMessages(messageContract);
  }

  // Apply time filter if specified
  if (options.fromTime || options.toTime) {
    const fromTime = options.fromTime || 0;
    const toTime = options.toTime || Math.floor(Date.now() / 1000);
    messages = filterMessagesByTimeRange(messages, fromTime, toTime);
    console.log(
      `✓ Filtered by time range: ${new Date(
        fromTime * 1000
      ).toLocaleString()} to ${new Date(toTime * 1000).toLocaleString()}`
    );
  }

  // Sort messages by timestamp
  messages.sort((a, b) => a.timestamp - b.timestamp);

  console.log(`\n✓ Found ${messages.length} message(s)`);

  // Display messages
  if (options.decrypt && conversationKey) {
    await displayMessages(
      messages,
      conversationKey,
      options.limit,
      options.offset
    );
  } else {
    await displayMessages(messages, undefined, options.limit, options.offset);
  }

  // Export if requested
  if (options.exportFile) {
    await exportMessages(messages, options.exportFile);
  }

  // Display statistics
  console.log("\n" + "=".repeat(80));
  console.log("Statistics:");
  console.log("=".repeat(80));
  console.log(`Total Messages: ${messages.length}`);

  if (messages.length > 0) {
    const uniqueConversations = new Set(
      messages.map((m) => m.conversationId.toString())
    );
    const uniqueSenders = new Set(messages.map((m) => m.from));
    const uniqueReceivers = new Set(messages.map((m) => m.to));

    console.log(`Unique Conversations: ${uniqueConversations.size}`);
    console.log(`Unique Senders: ${uniqueSenders.size}`);
    console.log(`Unique Receivers: ${uniqueReceivers.size}`);

    const timeSpan =
      messages[messages.length - 1].timestamp - messages[0].timestamp;
    console.log(`Time Span: ${(timeSpan / 3600).toFixed(2)} hours`);
  }

  console.log("=".repeat(80));
}

// Parse command line arguments
const args = process.argv.slice(2);
const options: QueryOptions = {};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];

  switch (arg) {
    case "--conversation-id":
      options.conversationId = args[++i];
      break;
    case "--sender":
      options.sender = args[++i];
      break;
    case "--receiver":
      options.receiver = args[++i];
      break;
    case "--from-time":
      options.fromTime = parseInt(args[++i]);
      break;
    case "--to-time":
      options.toTime = parseInt(args[++i]);
      break;
    case "--export":
      options.exportFile = args[++i];
      break;
    case "--decrypt":
      options.decrypt = true;
      break;
    case "--limit":
      options.limit = parseInt(args[++i]);
      break;
    case "--offset":
      options.offset = parseInt(args[++i]);
      break;
  }
}

queryMessages(options)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Query failed:");
    console.error(error);
    process.exit(1);
  });
