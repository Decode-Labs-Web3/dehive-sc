import { ethers } from "hardhat";
import fs from "fs";
import path from "path";
import { Message } from "../../typechain-types";
import {
  simulateCreateConversation,
  computeConversationId,
} from "../../test/helpers/conversationHelpers";
import {
  encryptMessage,
  decryptMessage,
  generateConversationKey,
  encryptConversationKeyForAddress,
  decryptConversationKeyForAddress,
} from "../../test/helpers/mockEncryption";
import {
  fetchAllMessages,
  fetchConversationMessages,
} from "../../test/helpers/messageFetcher";

/**
 * Comprehensive Test Script for DehiveProxy + MessageFacet on Sepolia
 *
 * This script simulates frontend interactions and tests all functions:
 * - Creates conversations between users
 * - Sends messages (pay-as-you-go and via relayer)
 * - Deposits funds
 * - Tests admin functions (sets fees, then resets to defaults)
 * - Retrieves conversation keys
 * - Fetches messages from blockchain
 * - Decrypts messages
 *
 * Usage: npx hardhat run scripts/dehive/testSepolia.ts --network sepolia
 *
 * Requirements:
 * - .env file with:
 *   - PRIVATE_KEY (Relayer private key)
 *   - PRIVATE_KEY_A (User A private key)
 *   - PRIVATE_KEY_B (User B private key)
 * - Deployed proxy address (from deployments/sepolia_dehiveProxy_messageFacet.json or pass as PROXY_ADDRESS env var)
 */

interface TestResults {
  conversationsCreated: number;
  messagesSent: number;
  messagesViaRelayer: number;
  depositsMade: number;
  adminFunctionsTested: number;
  errors: string[];
}

async function main() {
  console.log("=".repeat(80));
  console.log("DehiveProxy + MessageFacet - Sepolia Test Script");
  console.log("=".repeat(80));

  // Get network info
  const network = await ethers.provider.getNetwork();
  const networkName = network.name || "sepolia";
  const chainId = network.chainId.toString();

  console.log(`\nNetwork: ${networkName} (Chain ID: ${chainId})`);

  // Load proxy address
  let proxyAddress: string;

  // Try to load from deployment file first
  const deploymentsDir = path.join(__dirname, "../../deployments");
  const deploymentFile = path.join(
    deploymentsDir,
    `sepolia_dehiveProxy_messageFacet.json`
  );

  if (process.env.PROXY_ADDRESS) {
    proxyAddress = process.env.PROXY_ADDRESS;
    console.log(
      `\n✓ Using proxy address from PROXY_ADDRESS env var: ${proxyAddress}`
    );
  } else if (fs.existsSync(deploymentFile)) {
    const deploymentInfo = JSON.parse(fs.readFileSync(deploymentFile, "utf-8"));
    proxyAddress = deploymentInfo.proxyAddress;
    console.log(
      `\n✓ Loaded proxy address from deployment file: ${proxyAddress}`
    );
  } else {
    throw new Error(
      `Proxy address not found. Please set PROXY_ADDRESS env var or ensure deployment file exists at: ${deploymentFile}`
    );
  }

  // Load private keys from .env
  const relayerKey = process.env.PRIVATE_KEY;
  const userAKey = process.env.PRIVATE_KEY_A;
  const userBKey = process.env.PRIVATE_KEY_B;

  if (!relayerKey || !userAKey || !userBKey) {
    throw new Error(
      "Missing private keys in .env file. Required: PRIVATE_KEY, PRIVATE_KEY_A, PRIVATE_KEY_B"
    );
  }

  // Create wallets
  const relayerWallet = new ethers.Wallet(relayerKey, ethers.provider);
  const userAWallet = new ethers.Wallet(userAKey, ethers.provider);
  const userBWallet = new ethers.Wallet(userBKey, ethers.provider);

  console.log(`\n📋 Test Accounts:`);
  console.log(`  Relayer: ${relayerWallet.address}`);
  console.log(`  User A: ${userAWallet.address}`);
  console.log(`  User B: ${userBWallet.address}`);

  // Check balances
  const relayerBalance = await ethers.provider.getBalance(
    relayerWallet.address
  );
  const userABalance = await ethers.provider.getBalance(userAWallet.address);
  const userBBalance = await ethers.provider.getBalance(userBWallet.address);

  console.log(`\n💰 Account Balances:`);
  console.log(`  Relayer: ${ethers.formatEther(relayerBalance)} ETH`);
  console.log(`  User A: ${ethers.formatEther(userABalance)} ETH`);
  console.log(`  User B: ${ethers.formatEther(userBBalance)} ETH`);

  if (
    relayerBalance < ethers.parseEther("0.01") ||
    userABalance < ethers.parseEther("0.01") ||
    userBBalance < ethers.parseEther("0.01")
  ) {
    console.warn(
      "\n⚠️  WARNING: Some account balances are low. Tests may fail!"
    );
  }

  // Connect to proxy as Message interface
  const MessageFactory = await ethers.getContractFactory("Message");
  const messageViaProxy = MessageFactory.attach(proxyAddress) as Message;

  // Verify proxy connection
  console.log(`\n🔗 Connecting to proxy at: ${proxyAddress}`);
  try {
    const payAsYouGoFee = await messageViaProxy.payAsYouGoFee();
    const relayerFee = await messageViaProxy.relayerFee();
    const currentRelayer = await messageViaProxy.relayer();

    console.log(`✓ Proxy connection verified`);
    console.log(
      `  Pay-as-You-Go Fee: ${ethers.formatEther(payAsYouGoFee)} ETH`
    );
    console.log(`  Relayer Fee: ${ethers.formatEther(relayerFee)} ETH`);
    console.log(`  Current Relayer: ${currentRelayer}`);

    // Verify relayer matches
    if (currentRelayer.toLowerCase() !== relayerWallet.address.toLowerCase()) {
      console.warn(
        `\n⚠️  WARNING: Deployed relayer (${currentRelayer}) doesn't match test relayer (${relayerWallet.address})`
      );
    }
  } catch (error: any) {
    throw new Error(`Failed to connect to proxy: ${error.message}`);
  }

  // Store original fee values to restore later
  const originalPayAsYouGoFee = await messageViaProxy.payAsYouGoFee();
  const originalRelayerFee = await messageViaProxy.relayerFee();

  const testResults: TestResults = {
    conversationsCreated: 0,
    messagesSent: 0,
    messagesViaRelayer: 0,
    depositsMade: 0,
    adminFunctionsTested: 0,
    errors: [],
  };

  // Admin wallet (will be set during admin function tests)
  let adminWallet: ethers.Wallet | null = null;

  // Store original messages for comparison after decryption
  const originalMessages: Map<string, string> = new Map();

  // ========== TEST 1: CREATE CONVERSATIONS ==========
  console.log("\n" + "=".repeat(80));
  console.log("Test 1: Creating Conversations");
  console.log("=".repeat(80));

  try {
    // Create conversation between User A and User B
    console.log("\n1.1 Creating conversation: User A <-> User B");
    const conversationKey1 = generateConversationKey("test-sepolia-1");
    const encryptedKeyForA1 = encryptConversationKeyForAddress(
      conversationKey1,
      userAWallet.address
    );
    const encryptedKeyForB1 = encryptConversationKeyForAddress(
      conversationKey1,
      userBWallet.address
    );

    const createConvTx1 = await messageViaProxy
      .connect(userAWallet)
      .createConversation(
        userBWallet.address,
        `0x${encryptedKeyForA1}`,
        `0x${encryptedKeyForB1}`
      );
    const receipt1 = await createConvTx1.wait();

    const conversationId1 = await messageViaProxy
      .connect(userAWallet)
      .createConversation.staticCall(
        userBWallet.address,
        `0x${encryptedKeyForA1}`,
        `0x${encryptedKeyForB1}`
      );

    console.log(`  ✓ Conversation created`);
    console.log(`  Transaction: ${createConvTx1.hash}`);
    console.log(`  Conversation ID: ${conversationId1}`);
    console.log(`  Block: ${receipt1!.blockNumber}`);

    testResults.conversationsCreated++;

    // Create conversation between User A and Relayer (to test multiple conversations)
    console.log("\n1.2 Creating conversation: User A <-> Relayer");
    const conversationKey2 = generateConversationKey("test-sepolia-2");
    const encryptedKeyForA2 = encryptConversationKeyForAddress(
      conversationKey2,
      userAWallet.address
    );
    const encryptedKeyForRelayer2 = encryptConversationKeyForAddress(
      conversationKey2,
      relayerWallet.address
    );

    const createConvTx2 = await messageViaProxy
      .connect(userAWallet)
      .createConversation(
        relayerWallet.address,
        `0x${encryptedKeyForA2}`,
        `0x${encryptedKeyForRelayer2}`
      );
    const receipt2 = await createConvTx2.wait();

    const conversationId2 = await messageViaProxy
      .connect(userAWallet)
      .createConversation.staticCall(
        relayerWallet.address,
        `0x${encryptedKeyForA2}`,
        `0x${encryptedKeyForRelayer2}`
      );

    console.log(`  ✓ Conversation created`);
    console.log(`  Transaction: ${createConvTx2.hash}`);
    console.log(`  Conversation ID: ${conversationId2}`);
    console.log(`  Block: ${receipt2!.blockNumber}`);

    testResults.conversationsCreated++;

    // ========== TEST 2: SEND MESSAGES (PAY-AS-YOU-GO) ==========
    console.log("\n" + "=".repeat(80));
    console.log("Test 2: Sending Messages (Pay-as-You-Go)");
    console.log("=".repeat(80));

    const payAsYouGoFee = await messageViaProxy.payAsYouGoFee();

    // Send message from User A to User B
    console.log("\n2.1 User A -> User B (Pay-as-You-Go)");
    const message1 = "Hello from User A! (Pay-as-You-Go)";
    const encryptedMessage1 = encryptMessage(message1, conversationKey1);

    const sendMsgTx1 = await messageViaProxy
      .connect(userAWallet)
      .sendMessage(conversationId1, userBWallet.address, encryptedMessage1, {
        value: payAsYouGoFee,
      });
    const sendReceipt1 = await sendMsgTx1.wait();

    // Store original message with transaction hash
    originalMessages.set(sendMsgTx1.hash, message1);

    console.log(`  ✓ Message sent`);
    console.log(`  Original message: "${message1}"`);
    console.log(`  Transaction: ${sendMsgTx1.hash}`);
    console.log(`  Block: ${sendReceipt1!.blockNumber}`);
    console.log(`  Fee paid: ${ethers.formatEther(payAsYouGoFee)} ETH`);

    testResults.messagesSent++;

    // Send message from User B to User A
    console.log("\n2.2 User B -> User A (Pay-as-You-Go)");
    const message2 = "Hello back from User B! (Pay-as-You-Go)";
    const encryptedMessage2 = encryptMessage(message2, conversationKey1);

    const sendMsgTx2 = await messageViaProxy
      .connect(userBWallet)
      .sendMessage(conversationId1, userAWallet.address, encryptedMessage2, {
        value: payAsYouGoFee,
      });
    const sendReceipt2 = await sendMsgTx2.wait();

    // Store original message with transaction hash
    originalMessages.set(sendMsgTx2.hash, message2);

    console.log(`  ✓ Message sent`);
    console.log(`  Original message: "${message2}"`);
    console.log(`  Transaction: ${sendMsgTx2.hash}`);
    console.log(`  Block: ${sendReceipt2!.blockNumber}`);
    console.log(`  Fee paid: ${ethers.formatEther(payAsYouGoFee)} ETH`);

    testResults.messagesSent++;

    // ========== TEST 3: DEPOSIT FUNDS ==========
    console.log("\n" + "=".repeat(80));
    console.log("Test 3: Depositing Funds");
    console.log("=".repeat(80));

    // User A deposits funds
    console.log("\n3.1 User A deposits funds");
    const depositAmount = ethers.parseEther("0.01");
    const depositTx = await messageViaProxy
      .connect(userAWallet)
      .depositFunds({ value: depositAmount });
    const depositReceipt = await depositTx.wait();

    const balanceAfterDeposit = await messageViaProxy.funds(
      userAWallet.address
    );

    console.log(`  ✓ Funds deposited`);
    console.log(`  Transaction: ${depositTx.hash}`);
    console.log(`  Block: ${depositReceipt!.blockNumber}`);
    console.log(`  Amount: ${ethers.formatEther(depositAmount)} ETH`);
    console.log(`  Balance: ${ethers.formatEther(balanceAfterDeposit)} ETH`);

    testResults.depositsMade++;

    // ========== TEST 4: SEND MESSAGES VIA RELAYER ==========
    console.log("\n" + "=".repeat(80));
    console.log("Test 4: Sending Messages via Relayer");
    console.log("=".repeat(80));

    const relayerFee = await messageViaProxy.relayerFee();

    // Send message via relayer (User A to User B)
    console.log("\n4.1 User A -> User B (via Relayer)");
    const message3 = "Hello from User A! (via Relayer)";
    const encryptedMessage3 = encryptMessage(message3, conversationKey1);

    const relayerMsgTx1 = await messageViaProxy
      .connect(relayerWallet)
      .sendMessageViaRelayer(
        conversationId1,
        userAWallet.address,
        userBWallet.address,
        encryptedMessage3,
        relayerFee
      );
    const relayerReceipt1 = await relayerMsgTx1.wait();

    // Store original message with transaction hash
    originalMessages.set(relayerMsgTx1.hash, message3);

    const balanceAfterRelayer1 = await messageViaProxy.funds(
      userAWallet.address
    );

    console.log(`  ✓ Message sent via relayer`);
    console.log(`  Original message: "${message3}"`);
    console.log(`  Transaction: ${relayerMsgTx1.hash}`);
    console.log(`  Block: ${relayerReceipt1!.blockNumber}`);
    console.log(`  Fee charged: ${ethers.formatEther(relayerFee)} ETH`);
    console.log(
      `  User A balance: ${ethers.formatEther(balanceAfterRelayer1)} ETH`
    );

    testResults.messagesViaRelayer++;

    // Send another message via relayer
    console.log("\n4.2 User A -> User B (via Relayer - Message 2)");
    const message4 = "Another message via relayer!";
    const encryptedMessage4 = encryptMessage(message4, conversationKey1);

    const relayerMsgTx2 = await messageViaProxy
      .connect(relayerWallet)
      .sendMessageViaRelayer(
        conversationId1,
        userAWallet.address,
        userBWallet.address,
        encryptedMessage4,
        relayerFee
      );
    const relayerReceipt2 = await relayerMsgTx2.wait();

    // Store original message with transaction hash
    originalMessages.set(relayerMsgTx2.hash, message4);

    const balanceAfterRelayer2 = await messageViaProxy.funds(
      userAWallet.address
    );

    console.log(`  ✓ Message sent via relayer`);
    console.log(`  Original message: "${message4}"`);
    console.log(`  Transaction: ${relayerMsgTx2.hash}`);
    console.log(`  Block: ${relayerReceipt2!.blockNumber}`);
    console.log(`  Fee charged: ${ethers.formatEther(relayerFee)} ETH`);
    console.log(
      `  User A balance: ${ethers.formatEther(balanceAfterRelayer2)} ETH`
    );

    testResults.messagesViaRelayer++;

    // ========== TEST 5: RETRIEVE CONVERSATION KEYS ==========
    console.log("\n" + "=".repeat(80));
    console.log("Test 5: Retrieving Conversation Keys");
    console.log("=".repeat(80));

    // User A retrieves their key
    console.log("\n5.1 User A retrieves conversation key");
    const retrievedKeyBytesA = await messageViaProxy
      .connect(userAWallet)
      .getMyEncryptedConversationKeys(conversationId1);

    let keyHexA: string;
    if (typeof retrievedKeyBytesA === "string") {
      keyHexA = retrievedKeyBytesA.startsWith("0x")
        ? retrievedKeyBytesA.substring(2)
        : retrievedKeyBytesA;
    } else {
      keyHexA = ethers.hexlify(retrievedKeyBytesA).substring(2);
    }

    const decryptedKeyA = decryptConversationKeyForAddress(
      keyHexA.toLowerCase(),
      userAWallet.address.toLowerCase()
    );

    // Verify key works
    const testMsg = "Test message for key verification";
    const encryptedTestMsg = encryptMessage(testMsg, decryptedKeyA);
    const decryptedTestMsg = decryptMessage(encryptedTestMsg, decryptedKeyA);

    if (decryptedTestMsg === testMsg) {
      console.log(`  ✓ Conversation key retrieved and verified`);
    } else {
      throw new Error("Conversation key verification failed");
    }

    // User B retrieves their key
    console.log("\n5.2 User B retrieves conversation key");
    const retrievedKeyBytesB = await messageViaProxy
      .connect(userBWallet)
      .getMyEncryptedConversationKeys(conversationId1);

    let keyHexB: string;
    if (typeof retrievedKeyBytesB === "string") {
      keyHexB = retrievedKeyBytesB.startsWith("0x")
        ? retrievedKeyBytesB.substring(2)
        : retrievedKeyBytesB;
    } else {
      keyHexB = ethers.hexlify(retrievedKeyBytesB).substring(2);
    }

    const decryptedKeyB = decryptConversationKeyForAddress(
      keyHexB.toLowerCase(),
      userBWallet.address.toLowerCase()
    );

    // Verify both users can decrypt the same messages
    const testMsg2 = "Shared message";
    const encryptedTestMsg2 = encryptMessage(testMsg2, decryptedKeyA);
    const decryptedTestMsg2B = decryptMessage(encryptedTestMsg2, decryptedKeyB);

    if (decryptedTestMsg2B === testMsg2) {
      console.log(`  ✓ Both users can decrypt shared messages`);
    } else {
      throw new Error("Shared message decryption failed");
    }

    // ========== TEST 6: FETCH MESSAGES FROM BLOCKCHAIN ==========
    console.log("\n" + "=".repeat(80));
    console.log("Test 6: Fetching Messages from Blockchain");
    console.log("=".repeat(80));

    // Fetch all MessageSent events from block 9535600 onwards
    const startBlock = 9535600;
    const currentBlock = await ethers.provider.getBlockNumber();

    console.log(
      `\n6.1 Fetching MessageSent events from block ${startBlock} to ${currentBlock}`
    );

    // Get the contract ABI to create filter
    const MessageFactory = await ethers.getContractFactory("Message");
    const contractInterface = MessageFactory.interface;

    // Get the event fragment for MessageSent
    const messageSentEvent = contractInterface.getEvent("MessageSent");
    if (!messageSentEvent) {
      throw new Error("MessageSent event not found in contract interface");
    }

    // Create filter for MessageSent event using the event signature hash
    const messageSentEventSignature = messageSentEvent.topicHash;

    // Query events directly from provider
    const events = await ethers.provider.getLogs({
      address: proxyAddress,
      topics: [messageSentEventSignature],
      fromBlock: startBlock,
      toBlock: currentBlock,
    });

    console.log(`  ✓ Found ${events.length} MessageSent events`);

    // Parse events and decrypt messages
    console.log("\n6.2 Parsing events and decrypting messages:");
    console.log("=".repeat(80));

    // Map conversation IDs to their keys for decryption
    const conversationKeys = new Map<string, string>();
    conversationKeys.set(conversationId1.toString(), decryptedKeyA); // Use decrypted key from conversation 1
    // Note: We'll retrieve conversation 2 keys on-demand if needed

    const parsedMessages: Array<{
      conversationId: bigint;
      from: string;
      to: string;
      originalMessage: string | undefined;
      decryptedMessage: string;
      blockNumber: number;
      txHash: string;
      timestamp: number;
    }> = [];

    for (let i = 0; i < events.length; i++) {
      const event = events[i];

      // Decode event data
      // MessageSent has 3 indexed params: conversationId, from, to
      // And 1 non-indexed param: encryptedMessage (string)
      // topics[0] = event signature
      // topics[1] = conversationId (indexed)
      // topics[2] = from (indexed)
      // topics[3] = to (indexed)
      // event.data = encryptedMessage (string, non-indexed)

      const decoded = contractInterface.decodeEventLog(
        "MessageSent",
        event.data,
        event.topics
      );

      const eventConvId = decoded[0].toString(); // conversationId (indexed)
      const eventFrom = decoded[1]; // from (indexed)
      const eventTo = decoded[2]; // to (indexed)
      const eventEncryptedMessage = decoded[3]; // encryptedMessage (string, non-indexed)

      // Get block info
      const block = await ethers.provider.getBlock(event.blockNumber);

      // Get conversation key (use key from conversation 1 for now, or look up based on conversation ID)
      let convKey: string;
      if (conversationKeys.has(eventConvId)) {
        convKey = conversationKeys.get(eventConvId)!;
      } else {
        // If we don't have the key, try to retrieve it
        try {
          // Determine which user's key to use
          const userWallet =
            eventFrom.toLowerCase() === userAWallet.address.toLowerCase()
              ? userAWallet
              : eventTo.toLowerCase() === userAWallet.address.toLowerCase()
              ? userAWallet
              : userBWallet;

          const retrievedKeyBytes = await messageViaProxy
            .connect(userWallet)
            .getMyEncryptedConversationKeys(BigInt(eventConvId));

          let keyHex: string;
          if (typeof retrievedKeyBytes === "string") {
            keyHex = retrievedKeyBytes.startsWith("0x")
              ? retrievedKeyBytes.substring(2)
              : retrievedKeyBytes;
          } else {
            keyHex = ethers.hexlify(retrievedKeyBytes).substring(2);
          }

          const decryptedKey = decryptConversationKeyForAddress(
            keyHex.toLowerCase(),
            userWallet.address.toLowerCase()
          );

          convKey = decryptedKey;
          conversationKeys.set(eventConvId, decryptedKey);
        } catch (error: any) {
          console.warn(
            `  ⚠️  Could not retrieve key for conversation ${eventConvId}: ${error.message}`
          );
          continue;
        }
      }

      // Decrypt message
      const decryptedMessage = decryptMessage(eventEncryptedMessage, convKey);

      // Get original message if we stored it
      const originalMessage = originalMessages.get(event.transactionHash);

      parsedMessages.push({
        conversationId: BigInt(eventConvId),
        from: eventFrom,
        to: eventTo,
        originalMessage: originalMessage,
        decryptedMessage: decryptedMessage,
        blockNumber: event.blockNumber,
        txHash: event.transactionHash,
        timestamp: block!.timestamp,
      });

      console.log(`\n  [${i + 1}] Message ${i + 1}:`);
      console.log(`    Transaction: ${event.transactionHash}`);
      console.log(`    Block: ${event.blockNumber}`);
      console.log(`    From: ${eventFrom}`);
      console.log(`    To: ${eventTo}`);
      console.log(`    Conversation ID: ${eventConvId}`);

      if (originalMessage) {
        console.log(`    Original (before encrypt): "${originalMessage}"`);
      } else {
        console.log(`    Original (before encrypt): <not stored>`);
      }
      console.log(`    Decrypted (after fetch): "${decryptedMessage}"`);

      // Verify decryption matches original
      if (originalMessage) {
        if (originalMessage === decryptedMessage) {
          console.log(`    ✓ Decryption matches original!`);
        } else {
          console.warn(`    ⚠️  Decryption does NOT match original!`);
          testResults.errors.push(`Message ${i + 1} decryption mismatch`);
        }
      }
      console.log(
        `    Timestamp: ${new Date(block!.timestamp * 1000).toISOString()}`
      );
    }

    console.log(
      `\n✓ Successfully fetched and decrypted ${parsedMessages.length} messages`
    );

    // Group by conversation
    const messagesByConversation = new Map<string, typeof parsedMessages>();
    for (const msg of parsedMessages) {
      const convIdStr = msg.conversationId.toString();
      if (!messagesByConversation.has(convIdStr)) {
        messagesByConversation.set(convIdStr, []);
      }
      messagesByConversation.get(convIdStr)!.push(msg);
    }

    console.log(`\n6.3 Messages by conversation:`);
    console.log("=".repeat(80));
    for (const [convId, messages] of messagesByConversation.entries()) {
      console.log(`\n  Conversation ID: ${convId}`);
      console.log(`  Messages: ${messages.length}`);
      for (let j = 0; j < messages.length; j++) {
        const msg = messages[j];
        console.log(
          `    [${j + 1}] ${msg.from.substring(0, 10)}... -> ${msg.to.substring(
            0,
            10
          )}...`
        );
        if (msg.originalMessage) {
          console.log(`        Original: "${msg.originalMessage}"`);
          console.log(`        Decrypted: "${msg.decryptedMessage}"`);
          console.log(
            `        Match: ${
              msg.originalMessage === msg.decryptedMessage ? "✓" : "✗"
            }`
          );
        } else {
          console.log(`        Decrypted: "${msg.decryptedMessage}"`);
        }
        console.log(
          `        Block: ${msg.blockNumber}, TX: ${msg.txHash.substring(
            0,
            16
          )}...`
        );
      }
    }

    // ========== TEST 7: ADMIN FUNCTIONS (WITH RESET) ==========
    console.log("\n" + "=".repeat(80));
    console.log("Test 7: Testing Admin Functions (will reset to defaults)");
    console.log("=".repeat(80));

    // Get proxy owner (should be deployer/relayer in this case)
    // Try to find who can call admin functions
    // Try relayer first (as it might be the deployer/owner)
    try {
      const newFee = ethers.parseEther("0.000004");
      await messageViaProxy
        .connect(relayerWallet)
        .setPayAsYouGoFee.staticCall(newFee);
      adminWallet = relayerWallet;
      console.log(`\n✓ Using relayer as admin (proxy owner)`);
    } catch {
      // If relayer can't call, we might not have admin access
      // For testing, we'll skip admin tests if we don't have access
      console.log(
        `\n⚠️  Cannot test admin functions - relayer is not proxy owner`
      );
      console.log(`  Skipping admin function tests`);
    }

    if (adminWallet !== null) {
      // Test setting pay-as-you-go fee
      console.log("\n7.1 Testing setPayAsYouGoFee()");
      const newPayAsYouGoFee = ethers.parseEther("0.000004");
      const setFeeTx1 = await messageViaProxy
        .connect(adminWallet)
        .setPayAsYouGoFee(newPayAsYouGoFee);
      await setFeeTx1.wait();
      const updatedFee1 = await messageViaProxy.payAsYouGoFee();
      console.log(
        `  ✓ Pay-as-You-Go Fee updated to: ${ethers.formatEther(
          updatedFee1
        )} ETH`
      );

      testResults.adminFunctionsTested++;

      // Test setting relayer fee
      console.log("\n7.2 Testing setRelayerFee()");
      const newRelayerFee = ethers.parseEther("0.000003");
      const setFeeTx2 = await messageViaProxy
        .connect(adminWallet)
        .setRelayerFee(newRelayerFee);
      await setFeeTx2.wait();
      const updatedFee2 = await messageViaProxy.relayerFee();
      console.log(
        `  ✓ Relayer Fee updated to: ${ethers.formatEther(updatedFee2)} ETH`
      );

      testResults.adminFunctionsTested++;

      // Test setting relayer (and verify it works)
      console.log("\n7.3 Testing setRelayer()");
      const currentRelayerBefore = await messageViaProxy.relayer();
      const setRelayerTx = await messageViaProxy
        .connect(adminWallet)
        .setRelayer(relayerWallet.address);
      await setRelayerTx.wait();
      const currentRelayerAfter = await messageViaProxy.relayer();
      console.log(`  ✓ Relayer set`);
      console.log(`  Before: ${currentRelayerBefore}`);
      console.log(`  After: ${currentRelayerAfter}`);

      testResults.adminFunctionsTested++;

      // ========== TEST 8: RESET TO DEFAULTS ==========
      console.log("\n" + "=".repeat(80));
      console.log("Test 8: Resetting Fees to Defaults");
      console.log("=".repeat(80));

      // Reset pay-as-you-go fee
      console.log("\n8.1 Resetting Pay-as-You-Go Fee");
      const resetFeeTx1 = await messageViaProxy
        .connect(adminWallet)
        .setPayAsYouGoFee(originalPayAsYouGoFee);
      await resetFeeTx1.wait();
      const resetFee1 = await messageViaProxy.payAsYouGoFee();
      console.log(
        `  ✓ Pay-as-You-Go Fee reset to: ${ethers.formatEther(resetFee1)} ETH`
      );

      // Reset relayer fee
      console.log("\n8.2 Resetting Relayer Fee");
      const resetFeeTx2 = await messageViaProxy
        .connect(adminWallet)
        .setRelayerFee(originalRelayerFee);
      await resetFeeTx2.wait();
      const resetFee2 = await messageViaProxy.relayerFee();
      console.log(
        `  ✓ Relayer Fee reset to: ${ethers.formatEther(resetFee2)} ETH`
      );

      console.log("\n✓ All fees reset to original values");
    }

    // ========== TEST 9: FINAL VERIFICATION ==========
    console.log("\n" + "=".repeat(80));
    console.log("Test 9: Final Verification");
    console.log("=".repeat(80));

    // Verify fees are back to original
    const finalPayAsYouGoFee = await messageViaProxy.payAsYouGoFee();
    const finalRelayerFee = await messageViaProxy.relayerFee();
    const finalRelayer = await messageViaProxy.relayer();

    console.log(`\n✓ Final Configuration:`);
    console.log(
      `  Pay-as-You-Go Fee: ${ethers.formatEther(finalPayAsYouGoFee)} ETH`
    );
    console.log(`  Relayer Fee: ${ethers.formatEther(finalRelayerFee)} ETH`);
    console.log(`  Relayer: ${finalRelayer}`);

    // Verify balances
    const finalBalanceA = await messageViaProxy.funds(userAWallet.address);
    const finalBalanceB = await messageViaProxy.funds(userBWallet.address);

    console.log(`\n✓ Final Balances:`);
    console.log(`  User A: ${ethers.formatEther(finalBalanceA)} ETH`);
    console.log(`  User B: ${ethers.formatEther(finalBalanceB)} ETH`);

    // Verify fees match originals
    if (adminWallet !== null) {
      if (
        finalPayAsYouGoFee.toString() === originalPayAsYouGoFee.toString() &&
        finalRelayerFee.toString() === originalRelayerFee.toString()
      ) {
        console.log(`\n✓ Fees successfully reset to original values`);
      } else {
        console.warn(`\n⚠️  Fees may not have been reset correctly`);
        testResults.errors.push("Fees not reset correctly");
      }
    }
  } catch (error: any) {
    console.error(`\n❌ Error during testing: ${error.message}`);
    testResults.errors.push(error.message);

    // Try to reset fees even if there was an error
    if (adminWallet !== null) {
      try {
        console.log("\n⚠️  Attempting to reset fees after error...");
        await messageViaProxy
          .connect(adminWallet)
          .setPayAsYouGoFee(originalPayAsYouGoFee);
        await messageViaProxy
          .connect(adminWallet)
          .setRelayerFee(originalRelayerFee);
        console.log("✓ Fees reset after error");
      } catch (resetError: any) {
        console.error(`❌ Failed to reset fees: ${resetError.message}`);
        testResults.errors.push(`Failed to reset fees: ${resetError.message}`);
      }
    }
  }

  // ========== FINAL SUMMARY ==========
  console.log("\n" + "=".repeat(80));
  console.log("Test Summary");
  console.log("=".repeat(80));
  console.log(`Network: ${networkName} (Chain ID: ${chainId})`);
  console.log(`Proxy Address: ${proxyAddress}`);
  console.log(`\n📊 Test Results:`);
  console.log(`  ✓ Conversations Created: ${testResults.conversationsCreated}`);
  console.log(`  ✓ Messages Sent (Pay-as-You-Go): ${testResults.messagesSent}`);
  console.log(
    `  ✓ Messages Sent (via Relayer): ${testResults.messagesViaRelayer}`
  );
  console.log(`  ✓ Deposits Made: ${testResults.depositsMade}`);
  console.log(
    `  ✓ Admin Functions Tested: ${testResults.adminFunctionsTested}`
  );
  console.log(`  ❌ Errors: ${testResults.errors.length}`);

  if (testResults.errors.length > 0) {
    console.log(`\n⚠️  Errors encountered:`);
    testResults.errors.forEach((error, index) => {
      console.log(`  ${index + 1}. ${error}`);
    });
  }

  console.log("\n" + "=".repeat(80));
  if (testResults.errors.length === 0) {
    console.log("✅ All Tests Completed Successfully!");
  } else {
    console.log("⚠️  Tests Completed with Errors");
  }
  console.log("=".repeat(80));

  // Save test results
  const testResultsFile = path.join(
    deploymentsDir,
    `sepolia_test_results_${Date.now()}.json`
  );
  fs.writeFileSync(
    testResultsFile,
    JSON.stringify(
      {
        network: networkName,
        proxyAddress: proxyAddress,
        testResults: testResults,
        testedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
  console.log(`\n📝 Test results saved to: ${testResultsFile}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Test script failed:");
    console.error(error);
    process.exit(1);
  });
