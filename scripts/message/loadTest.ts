import { ethers } from "hardhat";
import fs from "fs";
import path from "path";
import { Message } from "../../typechain-types";
import { computeConversationId } from "../../test/helpers/conversationHelpers";
import {
  encryptMessage,
  decryptMessage,
  generateConversationKey,
  encryptConversationKeyForAddress,
} from "../../test/helpers/mockEncryption";
import {
  fetchAllMessages,
  fetchConversationMessages,
} from "../../test/helpers/messageFetcher";
import { generateTestMessages } from "../../test/helpers/testDataGenerator";

/**
 * Load Test Script for Message Contract
 *
 * This script:
 * - Deploys or connects to Message contract
 * - Creates multiple test conversations
 * - Sends 100+ messages programmatically
 * - Fetches and displays all messages
 * - Shows statistics (gas used, messages per conversation, etc.)
 *
 * Usage: npx hardhat run scripts/message/loadTest.ts --network <network>
 */

interface LoadTestStats {
  totalMessages: number;
  directMessages: number;
  relayerMessages: number;
  conversations: number;
  totalGasUsed: bigint;
  averageGasPerMessage: bigint;
  messagesPerConversation: Map<bigint, number>;
  testDuration: number;
}

async function deployOrConnect(): Promise<Message> {
  // Try to load existing deployment
  const network = await ethers.provider.getNetwork();
  const networkName = network.name || "localhost";
  const deploymentFile = path.join(
    __dirname,
    "../../deployments",
    `message_${networkName}.json`
  );

  if (fs.existsSync(deploymentFile)) {
    console.log(`\n✓ Found existing deployment for ${networkName}`);
    const deploymentInfo = JSON.parse(fs.readFileSync(deploymentFile, "utf-8"));
    const MessageFactory = await ethers.getContractFactory("Message");
    return MessageFactory.attach(deploymentInfo.contractAddress) as Message;
  }

  // Deploy new contract
  console.log(`\n⚠ No existing deployment found, deploying new contract...`);
  const [deployer, owner, relayer] = await ethers.getSigners();

  const MessageFactory = await ethers.getContractFactory("Message");
  const messageContract = await MessageFactory.deploy(owner.address);
  await messageContract.waitForDeployment();

  await messageContract.connect(owner).setRelayer(relayer.address);

  const contractAddress = await messageContract.getAddress();
  console.log(`✓ Contract deployed at: ${contractAddress}`);

  return messageContract;
}

async function createConversation(
  messageContract: Message,
  user1: any,
  user2: string
): Promise<{ conversationId: bigint; conversationKey: string }> {
  const conversationKey = generateConversationKey(`${user1.address}-${user2}`);
  const encryptedKeyFor1 = encryptConversationKeyForAddress(
    conversationKey,
    user1.address
  );
  const encryptedKeyFor2 = encryptConversationKeyForAddress(
    conversationKey,
    user2
  );

  const conversationId = await messageContract
    .connect(user1)
    .createConversation.staticCall(
      user2,
      `0x${encryptedKeyFor1}`,
      `0x${encryptedKeyFor2}`
    );

  await messageContract
    .connect(user1)
    .createConversation(
      user2,
      `0x${encryptedKeyFor1}`,
      `0x${encryptedKeyFor2}`
    );

  return { conversationId, conversationKey };
}

async function runLoadTest() {
  console.log("=".repeat(70));
  console.log("Message Contract Load Test");
  console.log("=".repeat(70));

  const startTime = Date.now();
  const stats: LoadTestStats = {
    totalMessages: 0,
    directMessages: 0,
    relayerMessages: 0,
    conversations: 0,
    totalGasUsed: BigInt(0),
    averageGasPerMessage: BigInt(0),
    messagesPerConversation: new Map(),
    testDuration: 0,
  };

  try {
    // Get signers
    const [deployer, owner, user1, user2, user3, user4, relayer] =
      await ethers.getSigners();

    console.log(`\nTest Accounts:`);
    console.log(`  Deployer: ${deployer.address}`);
    console.log(`  Owner: ${owner.address}`);
    console.log(`  User1: ${user1.address}`);
    console.log(`  User2: ${user2.address}`);
    console.log(`  User3: ${user3.address}`);
    console.log(`  User4: ${user4.address}`);
    console.log(`  Relayer: ${relayer.address}`);

    // Deploy or connect to contract
    const messageContract = await deployOrConnect();
    const contractAddress = await messageContract.getAddress();
    console.log(`\n✓ Using contract at: ${contractAddress}`);

    // Get fees
    const payAsYouGoFee = await messageContract.payAsYouGoFee();
    const relayerFee = await messageContract.relayerFee();
    console.log(`\nFees:`);
    console.log(`  Pay-as-You-Go: ${ethers.formatEther(payAsYouGoFee)} ETH`);
    console.log(`  Relayer: ${ethers.formatEther(relayerFee)} ETH`);

    // Create multiple conversations
    console.log(`\n📝 Creating conversations...`);
    const conversationPairs = [
      [user1, user2.address],
      [user1, user3.address],
      [user2, user3.address],
      [user2, user4.address],
    ];

    const conversations: Array<{
      id: bigint;
      key: string;
      sender: any;
      receiver: string;
    }> = [];

    for (const [sender, receiver] of conversationPairs) {
      const { conversationId, conversationKey } = await createConversation(
        messageContract,
        sender,
        receiver
      );

      conversations.push({
        id: conversationId,
        key: conversationKey,
        sender,
        receiver,
      });

      console.log(
        `  ✓ Created conversation ${conversationId.toString()} between ${
          sender.address
        } and ${receiver}`
      );
    }

    stats.conversations = conversations.length;
    console.log(`\n✓ Created ${stats.conversations} conversations`);

    // Deposit funds for relayer messages
    console.log(`\n💰 Depositing funds for relayer messages...`);
    const relayerMessageCount = 50;
    const depositAmount =
      relayerFee * BigInt(relayerMessageCount) + ethers.parseEther("0.001");

    const depositTx = await messageContract
      .connect(user1)
      .depositFunds({ value: depositAmount });
    await depositTx.wait();
    console.log(
      `  ✓ Deposited ${ethers.formatEther(depositAmount)} ETH for user1`
    );

    // Send 100+ messages
    console.log(`\n📨 Sending messages...`);
    const directMessageCount = 60;
    const messagesPerConv = Math.floor(
      directMessageCount / conversations.length
    );

    let messageIndex = 0;

    // Send direct messages
    for (const conv of conversations) {
      const messages = generateTestMessages(messagesPerConv);

      for (const msg of messages) {
        const encryptedMsg = encryptMessage(msg, conv.key);
        const tx = await messageContract
          .connect(conv.sender)
          .sendMessage(conv.id, conv.receiver, encryptedMsg, {
            value: payAsYouGoFee,
          });

        const receipt = await tx.wait();
        stats.totalGasUsed += receipt!.gasUsed;
        stats.directMessages++;
        stats.totalMessages++;
        messageIndex++;

        // Update messages per conversation
        const currentCount = stats.messagesPerConversation.get(conv.id) || 0;
        stats.messagesPerConversation.set(conv.id, currentCount + 1);

        if (messageIndex % 20 === 0) {
          console.log(`  ✓ Sent ${messageIndex} messages...`);
        }
      }
    }

    // Send relayer messages
    console.log(`\n📨 Sending relayer messages...`);
    const firstConversation = conversations[0];
    const relayerMessages = generateTestMessages(relayerMessageCount);

    for (let i = 0; i < relayerMessages.length; i++) {
      const msg = relayerMessages[i];
      const encryptedMsg = encryptMessage(msg, firstConversation.key);

      const tx = await messageContract
        .connect(relayer)
        .sendMessageViaRelayer(
          firstConversation.id,
          user1.address,
          firstConversation.receiver,
          encryptedMsg,
          relayerFee
        );

      const receipt = await tx.wait();
      stats.totalGasUsed += receipt!.gasUsed;
      stats.relayerMessages++;
      stats.totalMessages++;

      const currentCount =
        stats.messagesPerConversation.get(firstConversation.id) || 0;
      stats.messagesPerConversation.set(firstConversation.id, currentCount + 1);

      if ((i + 1) % 20 === 0) {
        console.log(`  ✓ Sent ${i + 1} relayer messages...`);
      }
    }

    // Calculate statistics
    stats.averageGasPerMessage =
      stats.totalMessages > 0
        ? stats.totalGasUsed / BigInt(stats.totalMessages)
        : BigInt(0);
    stats.testDuration = Date.now() - startTime;

    // Fetch all messages
    console.log(`\n📥 Fetching all messages...`);
    const allMessages = await fetchAllMessages(messageContract);
    console.log(`  ✓ Fetched ${allMessages.length} messages`);

    // Verify messages can be decrypted
    console.log(`\n🔐 Verifying message decryption...`);
    let decryptedCount = 0;

    for (const conv of conversations) {
      const convMessages = await fetchConversationMessages(
        messageContract,
        conv.id
      );

      for (const msg of convMessages) {
        try {
          const decrypted = decryptMessage(msg.encryptedMessage, conv.key);
          decryptedCount++;
        } catch (error) {
          console.error(`  ✗ Failed to decrypt message: ${error}`);
        }
      }
    }

    console.log(`  ✓ Decrypted ${decryptedCount} messages`);

    // Print statistics
    console.log("\n" + "=".repeat(70));
    console.log("Load Test Results");
    console.log("=".repeat(70));
    console.log(`Total Messages: ${stats.totalMessages}`);
    console.log(`  Direct Messages: ${stats.directMessages}`);
    console.log(`  Relayer Messages: ${stats.relayerMessages}`);
    console.log(`Conversations: ${stats.conversations}`);
    console.log(`Total Gas Used: ${stats.totalGasUsed.toString()}`);
    console.log(
      `Average Gas Per Message: ${stats.averageGasPerMessage.toString()}`
    );
    console.log(`Test Duration: ${(stats.testDuration / 1000).toFixed(2)}s`);
    console.log("\nMessages per Conversation:");
    for (const [convId, count] of stats.messagesPerConversation.entries()) {
      console.log(`  Conversation ${convId.toString()}: ${count} messages`);
    }
    console.log("=".repeat(70));

    // Save results
    const resultsDir = path.join(__dirname, "../../test-results");
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }

    const resultsFile = path.join(resultsDir, `loadTest_${Date.now()}.json`);
    const results = {
      ...stats,
      totalGasUsed: stats.totalGasUsed.toString(),
      averageGasPerMessage: stats.averageGasPerMessage.toString(),
      messagesPerConversation: Object.fromEntries(
        Array.from(stats.messagesPerConversation.entries()).map(([k, v]) => [
          k.toString(),
          v,
        ])
      ),
    };

    fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
    console.log(`\n✓ Results saved to: ${resultsFile}`);
  } catch (error) {
    console.error("\n❌ Load test failed:");
    console.error(error);
    throw error;
  }
}

runLoadTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
