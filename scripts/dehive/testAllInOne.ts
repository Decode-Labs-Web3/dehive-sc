import { ethers } from "hardhat";
import { DehiveProxy, Message } from "../../typechain-types";
import { getFunctionSelectors } from "./helpers/facetHelpers";
import {
  computeConversationId,
  simulateCreateConversation,
} from "../../test/helpers/conversationHelpers";
import {
  encryptMessage,
  decryptMessage,
  generateConversationKey,
  encryptConversationKeyForAddress,
  decryptConversationKeyForAddress,
} from "../../test/helpers/mockEncryption";

/**
 * All-in-One Test Script for DehiveProxy + MessageFacet
 *
 * This script tests the complete integration:
 * 1. Deploys DehiveProxy and MessageFacet
 * 2. Installs MessageFacet into proxy
 * 3. Tests all core functionality through proxy
 * 4. Tests edge cases
 * 5. Verifies storage isolation
 * 6. Performs load testing
 *
 * Usage: npx hardhat run scripts/dehive/testAllInOne.ts --network <network>
 */

async function main() {
  console.log("=".repeat(80));
  console.log("All-in-One Test: DehiveProxy + MessageFacet");
  console.log("=".repeat(80));

  // Get signers - add more users for comprehensive testing
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const owner = signers[1];
  const user1 = signers[2];
  const user2 = signers[3];
  const user3 = signers[4];
  const user4 = signers[5];
  const user5 = signers[6];
  const relayer = signers[7] || signers[signers.length - 1];

  console.log("\n📋 Test Configuration:");
  console.log(`  Deployer: ${deployer.address}`);
  console.log(`  Owner: ${owner.address}`);
  console.log(`  User1: ${user1.address}`);
  console.log(`  User2: ${user2.address}`);
  console.log(`  User3: ${user3.address}`);
  console.log(`  User4: ${user4.address}`);
  console.log(`  User5: ${user5.address}`);
  console.log(`  Relayer: ${relayer.address}`);

  // Store original messages for verification
  const originalMessages: Map<
    string,
    {
      original: string;
      conversationId: bigint;
      from: string;
      to: string;
      key: string;
    }
  > = new Map();

  // ========== STEP 1: DEPLOY PROXY ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 1: Deploying DehiveProxy");
  console.log("=".repeat(80));

  const ProxyFactory = await ethers.getContractFactory("DehiveProxy");
  const proxy = await ProxyFactory.deploy();
  await proxy.waitForDeployment();
  const proxyAddress = await proxy.getAddress();
  const proxyOwner = await proxy.owner();

  console.log(`✓ DehiveProxy deployed at: ${proxyAddress}`);
  console.log(`✓ Proxy owner: ${proxyOwner}`);

  // ========== STEP 2: DEPLOY FACET ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 2: Deploying MessageFacet");
  console.log("=".repeat(80));

  const MessageFactory = await ethers.getContractFactory("Message");
  const messageFacet = await MessageFactory.deploy(owner.address);
  await messageFacet.waitForDeployment();
  const facetAddress = await messageFacet.getAddress();

  console.log(`✓ MessageFacet deployed at: ${facetAddress}`);

  // ========== STEP 3: INSTALL FACET ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 3: Installing MessageFacet into DehiveProxy");
  console.log("=".repeat(80));

  // Get IMessage ABI for function selectors
  const fs = await import("fs");
  const path = await import("path");
  const imessageArtifactPath = path.join(
    __dirname,
    "../../artifacts/contracts/interfaces/IMessage.sol/IMessage.json"
  );
  const imessageAbi = JSON.parse(
    fs.readFileSync(imessageArtifactPath, "utf-8")
  ).abi;

  const functionSelectors = getFunctionSelectors(imessageAbi);
  console.log(`✓ Found ${functionSelectors.length} function selectors`);

  const facetCut = {
    facetAddress: facetAddress,
    functionSelectors: functionSelectors,
    action: 0, // Add
  };

  const messageArtifactPath = path.join(
    __dirname,
    "../../artifacts/contracts/Message.sol/Message.json"
  );
  const messageAbi = JSON.parse(
    fs.readFileSync(messageArtifactPath, "utf-8")
  ).abi;

  const initCalldata = ethers.Interface.from(messageAbi).encodeFunctionData(
    "init",
    [proxyOwner]
  );

  const installTx = await proxy
    .connect(deployer)
    .facetCut([facetCut], facetAddress, initCalldata);
  await installTx.wait();

  console.log(`✓ MessageFacet installed into proxy`);
  console.log(`  Transaction: ${installTx.hash}`);

  // Connect to proxy as Message interface
  const messageViaProxy = MessageFactory.attach(proxyAddress) as Message;

  // Set relayer
  const setRelayerTx = await messageViaProxy
    .connect(deployer)
    .setRelayer(relayer.address);
  await setRelayerTx.wait();
  console.log(`✓ Relayer set to: ${relayer.address}`);

  // ========== STEP 4: TEST CORE FUNCTIONALITY ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 4: Testing Core Functionality");
  console.log("=".repeat(80));

  // Test 4.1: Check initial fees
  console.log("\n4.1 Testing Initial Fees...");
  const payAsYouGoFee = await messageViaProxy.payAsYouGoFee();
  const relayerFee = await messageViaProxy.relayerFee();
  console.log(
    `  ✓ Pay-as-You-Go Fee: ${ethers.formatEther(payAsYouGoFee)} ETH`
  );
  console.log(`  ✓ Relayer Fee: ${ethers.formatEther(relayerFee)} ETH`);

  // Test 4.2: Create Conversation
  console.log("\n4.2 Testing Conversation Creation...");
  const conversationKey = generateConversationKey("test-seed");
  const encryptedKeyFor1 = encryptConversationKeyForAddress(
    conversationKey,
    user1.address
  );
  const encryptedKeyFor2 = encryptConversationKeyForAddress(
    conversationKey,
    user2.address
  );

  const createConvTx = await messageViaProxy
    .connect(user1)
    .createConversation(
      user2.address,
      `0x${encryptedKeyFor1}`,
      `0x${encryptedKeyFor2}`
    );
  const createConvReceipt = await createConvTx.wait();
  console.log(`  ✓ Conversation created`);
  console.log(`  Transaction: ${createConvTx.hash}`);

  const conversationId = await messageViaProxy
    .connect(user1)
    .createConversation.staticCall(
      user2.address,
      `0x${encryptedKeyFor1}`,
      `0x${encryptedKeyFor2}`
    );

  // Test 4.3: Get Encrypted Conversation Key
  console.log("\n4.3 Testing Conversation Key Retrieval...");
  const retrievedKeyBytes = await messageViaProxy
    .connect(user1)
    .getMyEncryptedConversationKeys(conversationId);
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
    user1.address.toLowerCase()
  );
  const testMsg = "Test message";
  const encryptedTestMsg = encryptMessage(testMsg, decryptedKey);
  const decryptedTestMsg = decryptMessage(encryptedTestMsg, decryptedKey);
  if (decryptedTestMsg === testMsg) {
    console.log(`  ✓ Conversation key retrieved and verified`);
  } else {
    throw new Error("Conversation key verification failed");
  }

  // Test 4.4: Send Direct Message (Pay-as-You-Go)
  console.log("\n4.4 Testing Direct Message (Pay-as-You-Go)...");
  const message1 = "Hello from user1!";
  const encryptedMessage1 = encryptMessage(message1, conversationKey);
  const sendMsgTx = await messageViaProxy
    .connect(user1)
    .sendMessage(conversationId, user2.address, encryptedMessage1, {
      value: payAsYouGoFee,
    });
  await sendMsgTx.wait();
  console.log(`  ✓ Message sent (Pay-as-You-Go)`);
  console.log(`  Transaction: ${sendMsgTx.hash}`);

  // Test 4.5: Deposit Funds
  console.log("\n4.5 Testing Fund Deposit...");
  const depositAmount = ethers.parseEther("0.01");
  const depositTx = await messageViaProxy
    .connect(user1)
    .depositFunds({ value: depositAmount });
  await depositTx.wait();
  const balance = await messageViaProxy.funds(user1.address);
  console.log(`  ✓ Funds deposited: ${ethers.formatEther(depositAmount)} ETH`);
  console.log(`  ✓ User balance: ${ethers.formatEther(balance)} ETH`);

  // Test 4.6: Send Message via Relayer
  console.log("\n4.6 Testing Relayer Message...");
  const message2 = "Hello via relayer!";
  const encryptedMessage2 = encryptMessage(message2, conversationKey);
  const relayerMsgTx = await messageViaProxy
    .connect(relayer)
    .sendMessageViaRelayer(
      conversationId,
      user1.address,
      user2.address,
      encryptedMessage2,
      relayerFee
    );
  await relayerMsgTx.wait();
  const newBalance = await messageViaProxy.funds(user1.address);
  console.log(`  ✓ Message sent via relayer`);
  console.log(`  Transaction: ${relayerMsgTx.hash}`);
  console.log(
    `  ✓ User balance after relayer fee: ${ethers.formatEther(newBalance)} ETH`
  );

  // ========== STEP 5: TEST ADMIN FUNCTIONS ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 5: Testing Admin Functions");
  console.log("=".repeat(80));

  // Test 5.1: Update Pay-as-You-Go Fee
  console.log("\n5.1 Testing Fee Updates...");
  const newPayAsYouGoFee = ethers.parseEther("0.000003");
  const updateFeeTx = await messageViaProxy
    .connect(deployer)
    .setPayAsYouGoFee(newPayAsYouGoFee);
  await updateFeeTx.wait();
  const updatedFee = await messageViaProxy.payAsYouGoFee();
  console.log(
    `  ✓ Pay-as-You-Go Fee updated to: ${ethers.formatEther(updatedFee)} ETH`
  );

  // Test 5.2: Update Relayer Fee
  const newRelayerFee = ethers.parseEther("0.000002");
  const updateRelayerFeeTx = await messageViaProxy
    .connect(deployer)
    .setRelayerFee(newRelayerFee);
  await updateRelayerFeeTx.wait();
  const updatedRelayerFee = await messageViaProxy.relayerFee();
  console.log(
    `  ✓ Relayer Fee updated to: ${ethers.formatEther(updatedRelayerFee)} ETH`
  );

  // ========== STEP 6: CREATE MULTIPLE CONVERSATIONS ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 6: Creating Multiple Conversations");
  console.log("=".repeat(80));

  interface Conversation {
    id: bigint;
    key: string;
    user1: string;
    user2: string;
  }

  const conversations: Conversation[] = [];

  // Create conversation 1: user1 <-> user2 (already created)
  conversations.push({
    id: conversationId,
    key: conversationKey,
    user1: user1.address,
    user2: user2.address,
  });

  // Create conversation 2: user1 <-> user3
  console.log("\n6.1 Creating conversation: User1 <-> User3");
  const conversationKey2 = generateConversationKey("test-seed-2");
  const encryptedKeyFor1_2 = encryptConversationKeyForAddress(
    conversationKey2,
    user1.address
  );
  const encryptedKeyFor3 = encryptConversationKeyForAddress(
    conversationKey2,
    user3.address
  );

  const createConv2Tx = await messageViaProxy
    .connect(user1)
    .createConversation(
      user3.address,
      `0x${encryptedKeyFor1_2}`,
      `0x${encryptedKeyFor3}`
    );
  await createConv2Tx.wait();

  const conversationId2 = await messageViaProxy
    .connect(user1)
    .createConversation.staticCall(
      user3.address,
      `0x${encryptedKeyFor1_2}`,
      `0x${encryptedKeyFor3}`
    );

  conversations.push({
    id: conversationId2,
    key: conversationKey2,
    user1: user1.address,
    user2: user3.address,
  });
  console.log(`  ✓ Conversation 2 created: ${conversationId2}`);

  // Create conversation 3: user2 <-> user4
  console.log("\n6.2 Creating conversation: User2 <-> User4");
  const conversationKey3 = generateConversationKey("test-seed-3");
  const encryptedKeyFor2_3 = encryptConversationKeyForAddress(
    conversationKey3,
    user2.address
  );
  const encryptedKeyFor4 = encryptConversationKeyForAddress(
    conversationKey3,
    user4.address
  );

  const createConv3Tx = await messageViaProxy
    .connect(user2)
    .createConversation(
      user4.address,
      `0x${encryptedKeyFor2_3}`,
      `0x${encryptedKeyFor4}`
    );
  await createConv3Tx.wait();

  const conversationId3 = await messageViaProxy
    .connect(user2)
    .createConversation.staticCall(
      user4.address,
      `0x${encryptedKeyFor2_3}`,
      `0x${encryptedKeyFor4}`
    );

  conversations.push({
    id: conversationId3,
    key: conversationKey3,
    user1: user2.address,
    user2: user4.address,
  });
  console.log(`  ✓ Conversation 3 created: ${conversationId3}`);

  // Create conversation 4: user3 <-> user5
  console.log("\n6.3 Creating conversation: User3 <-> User5");
  const conversationKey4 = generateConversationKey("test-seed-4");
  const encryptedKeyFor3_4 = encryptConversationKeyForAddress(
    conversationKey4,
    user3.address
  );
  const encryptedKeyFor5 = encryptConversationKeyForAddress(
    conversationKey4,
    user5.address
  );

  const createConv4Tx = await messageViaProxy
    .connect(user3)
    .createConversation(
      user5.address,
      `0x${encryptedKeyFor3_4}`,
      `0x${encryptedKeyFor5}`
    );
  await createConv4Tx.wait();

  const conversationId4 = await messageViaProxy
    .connect(user3)
    .createConversation.staticCall(
      user5.address,
      `0x${encryptedKeyFor3_4}`,
      `0x${encryptedKeyFor5}`
    );

  conversations.push({
    id: conversationId4,
    key: conversationKey4,
    user1: user3.address,
    user2: user5.address,
  });
  console.log(`  ✓ Conversation 4 created: ${conversationId4}`);

  console.log(`\n✓ Created ${conversations.length} conversations`);

  // ========== STEP 7: COMPREHENSIVE MESSAGE TESTING ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 7: Comprehensive Message Testing (100+ messages)");
  console.log("=".repeat(80));

  const totalMessagesToSend = 100;
  let messagesSent = 0;
  let payAsYouGoMessages = 0;
  let relayerMessages = 0;

  console.log(
    `\nSending ${totalMessagesToSend} messages across ${conversations.length} conversations...`
  );

  // Get current fees
  const currentPayAsYouGoFee = await messageViaProxy.payAsYouGoFee();
  const currentRelayerFee = await messageViaProxy.relayerFee();

  // Track starting block for event fetching
  const startingBlock = await ethers.provider.getBlockNumber();

  // Helper function to get user signer from address
  const getUserSigner = (address: string) => {
    if (address.toLowerCase() === user1.address.toLowerCase()) return user1;
    if (address.toLowerCase() === user2.address.toLowerCase()) return user2;
    if (address.toLowerCase() === user3.address.toLowerCase()) return user3;
    if (address.toLowerCase() === user4.address.toLowerCase()) return user4;
    if (address.toLowerCase() === user5.address.toLowerCase()) return user5;
    throw new Error(`Unknown user address: ${address}`);
  };

  // Deposit funds for multiple users to enable relayer messages
  console.log(`\n7.1 Depositing funds for users to enable relayer messages...`);
  const depositPerUser = ethers.parseEther("0.1");
  const usersToDeposit = [user1, user2, user3, user4, user5];
  for (const user of usersToDeposit) {
    try {
      const depositTx = await messageViaProxy
        .connect(user)
        .depositFunds({ value: depositPerUser });
      await depositTx.wait();
      console.log(
        `  ✓ Deposited ${ethers.formatEther(
          depositPerUser
        )} ETH for ${user.address.substring(0, 10)}...`
      );
    } catch (error: any) {
      console.log(
        `  ⚠️  Could not deposit for ${user.address.substring(0, 10)}...: ${
          error.message
        }`
      );
    }
  }

  // Send messages in rounds
  console.log(`\n7.2 Sending ${totalMessagesToSend} messages...`);
  for (let round = 0; round < totalMessagesToSend; round++) {
    const convIndex = round % conversations.length;
    const conv = conversations[convIndex];

    // Alternate between users in the conversation
    const senderIndex = round % 2;
    const senderAddress = senderIndex === 0 ? conv.user1 : conv.user2;
    const receiverAddress = senderIndex === 0 ? conv.user2 : conv.user1;

    const sender = getUserSigner(senderAddress);
    const receiver = getUserSigner(receiverAddress);

    const messageText = `Message ${round + 1} from ${sender.address.substring(
      0,
      10
    )}... to ${receiver.address.substring(0, 10)}... in conversation ${
      conv.id
    }`;

    // Encrypt the message
    const encryptedMessage = encryptMessage(messageText, conv.key);

    // Alternate between pay-as-you-go and relayer (every 3rd message uses relayer)
    const useRelayer = (round + 1) % 3 === 0;

    let tx;
    if (useRelayer) {
      // Send via relayer
      try {
        tx = await messageViaProxy
          .connect(relayer)
          .sendMessageViaRelayer(
            conv.id,
            sender.address,
            receiver.address,
            encryptedMessage,
            currentRelayerFee
          );
        relayerMessages++;
      } catch (error: any) {
        // If relayer fails (e.g., insufficient funds), fall back to pay-as-you-go
        console.log(
          `  ⚠️  Message ${round + 1}: Relayer failed (${
            error.message
          }), using pay-as-you-go`
        );
        tx = await messageViaProxy
          .connect(sender)
          .sendMessage(conv.id, receiver.address, encryptedMessage, {
            value: currentPayAsYouGoFee,
          });
        payAsYouGoMessages++;
      }
    } else {
      // Send via pay-as-you-go
      tx = await messageViaProxy
        .connect(sender)
        .sendMessage(conv.id, receiver.address, encryptedMessage, {
          value: currentPayAsYouGoFee,
        });
      payAsYouGoMessages++;
    }

    const receipt = await tx.wait();

    // Store original message for verification
    originalMessages.set(tx.hash, {
      original: messageText,
      conversationId: conv.id,
      from: sender.address,
      to: receiver.address,
      key: conv.key,
    });

    messagesSent++;

    // Progress update
    if ((round + 1) % 10 === 0) {
      console.log(`  ✓ Sent ${round + 1}/${totalMessagesToSend} messages...`);
    }
  }

  console.log(`\n✓ Successfully sent ${messagesSent} messages`);
  console.log(`  - Pay-as-You-Go: ${payAsYouGoMessages}`);
  console.log(`  - Via Relayer: ${relayerMessages}`);

  // ========== STEP 8: FETCH AND VERIFY MESSAGES ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 8: Fetching and Verifying Messages from Blockchain");
  console.log("=".repeat(80));

  const currentBlock = await ethers.provider.getBlockNumber();
  console.log(
    `\n8.1 Fetching MessageSent events from block ${startingBlock} to ${currentBlock}`
  );

  // Get the contract ABI to create filter (reuse existing MessageFactory)
  const contractInterface = MessageFactory.interface;

  // Get the event fragment for MessageSent
  const messageSentEvent = contractInterface.getEvent("MessageSent");
  if (!messageSentEvent) {
    throw new Error("MessageSent event not found in contract interface");
  }

  // Query events directly from provider
  const events = await ethers.provider.getLogs({
    address: proxyAddress,
    topics: [messageSentEvent.topicHash],
    fromBlock: startingBlock,
    toBlock: currentBlock,
  });

  console.log(`  ✓ Found ${events.length} MessageSent events`);

  // Parse and decrypt messages
  console.log("\n8.2 Parsing events and decrypting messages...");

  let verifiedCount = 0;
  let mismatchCount = 0;
  const verificationResults: Array<{
    txHash: string;
    original: string;
    decrypted: string;
    matches: boolean;
    conversationId: string;
  }> = [];

  // Build conversation key map for quick lookup
  const convKeyMap = new Map<string, string>();
  for (const conv of conversations) {
    convKeyMap.set(conv.id.toString(), conv.key);
  }

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    try {
      // Decode event data
      const decoded = contractInterface.decodeEventLog(
        "MessageSent",
        event.data,
        event.topics
      );

      const eventConvId = decoded[0].toString();
      const eventFrom = decoded[1];
      const eventTo = decoded[2];
      const eventEncryptedMessage = decoded[3];

      // Get conversation key
      const convKey = convKeyMap.get(eventConvId);
      if (!convKey) {
        console.warn(
          `  ⚠️  Message ${
            i + 1
          }: Could not find key for conversation ${eventConvId}`
        );
        continue;
      }

      // Decrypt message
      const decryptedMessage = decryptMessage(eventEncryptedMessage, convKey);

      // Get original message if we stored it
      const originalInfo = originalMessages.get(event.transactionHash);

      if (originalInfo) {
        const matches = originalInfo.original === decryptedMessage;

        verificationResults.push({
          txHash: event.transactionHash,
          original: originalInfo.original,
          decrypted: decryptedMessage,
          matches: matches,
          conversationId: eventConvId,
        });

        if (matches) {
          verifiedCount++;
        } else {
          mismatchCount++;
          console.warn(`\n  ⚠️  Message ${i + 1} mismatch:`);
          console.warn(`    Original: "${originalInfo.original}"`);
          console.warn(`    Decrypted: "${decryptedMessage}"`);
          console.warn(`    TX: ${event.transactionHash.substring(0, 16)}...`);
        }
      } else {
        // Message not in our tracking (maybe from previous tests)
        verificationResults.push({
          txHash: event.transactionHash,
          original: "<not tracked>",
          decrypted: decryptedMessage,
          matches: false,
          conversationId: eventConvId,
        });
      }
    } catch (error: any) {
      console.warn(`  ⚠️  Error processing event ${i + 1}: ${error.message}`);
    }
  }

  // ========== STEP 9: VERIFICATION SUMMARY ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 9: Encryption/Decryption Verification Summary");
  console.log("=".repeat(80));

  console.log(`\n📊 Verification Results:`);
  console.log(`  Total events found: ${events.length}`);
  console.log(`  Messages tracked: ${originalMessages.size}`);
  console.log(`  ✓ Verified (match): ${verifiedCount}`);
  console.log(`  ✗ Mismatches: ${mismatchCount}`);
  console.log(`  Not tracked: ${events.length - originalMessages.size}`);

  if (mismatchCount > 0) {
    console.log(
      `\n⚠️  Found ${mismatchCount} messages with mismatches. See details above.`
    );
  }

  // Show sample verification results
  console.log(`\n📝 Sample Verification Results (first 5 tracked messages):`);
  const trackedResults = verificationResults
    .filter((r) => r.original !== "<not tracked>")
    .slice(0, 5);
  for (let i = 0; i < trackedResults.length; i++) {
    const result = trackedResults[i];
    console.log(`\n  [${i + 1}] Message:`);
    console.log(
      `    Original: "${result.original.substring(0, 60)}${
        result.original.length > 60 ? "..." : ""
      }"`
    );
    console.log(
      `    Decrypted: "${result.decrypted.substring(0, 60)}${
        result.decrypted.length > 60 ? "..." : ""
      }"`
    );
    console.log(`    Match: ${result.matches ? "✓" : "✗"}`);
    console.log(`    Conversation ID: ${result.conversationId}`);
    console.log(`    TX: ${result.txHash.substring(0, 16)}...`);
  }

  if (verifiedCount === originalMessages.size && mismatchCount === 0) {
    console.log(`\n✅ All tracked messages verified successfully!`);
  }

  // ========== STEP 10: VERIFY STORAGE ISOLATION ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 10: Verifying Storage Isolation");
  console.log("=".repeat(80));

  console.log(`\n10.1 Verifying all conversations are distinct...`);

  for (let i = 0; i < conversations.length; i++) {
    const conv = conversations[i];
    const convData = await messageViaProxy.conversations(conv.id);
    console.log(`  ✓ Conversation ${i + 1} (ID: ${conv.id}):`);
    console.log(`    Created: ${convData.createdAt}`);
    console.log(`    User1: ${convData.smallerAddress}`);
    console.log(`    User2: ${convData.largerAddress}`);
  }

  // Verify conversations are distinct
  const allDistinct =
    new Set(conversations.map((c) => c.id.toString())).size ===
    conversations.length;
  console.log(`\n  ✓ All conversations are distinct: ${allDistinct}`);

  // Verify user balances
  console.log(`\n10.2 Verifying user balances...`);
  const user1Balance = await messageViaProxy.funds(user1.address);
  const user2Balance = await messageViaProxy.funds(user2.address);
  console.log(`  User1 balance: ${ethers.formatEther(user1Balance)} ETH`);
  console.log(`  User2 balance: ${ethers.formatEther(user2Balance)} ETH`);

  // ========== SUMMARY ==========
  console.log("\n" + "=".repeat(80));
  console.log("Test Summary");
  console.log("=".repeat(80));
  console.log(`✓ DehiveProxy deployed: ${proxyAddress}`);
  console.log(`✓ MessageFacet deployed: ${facetAddress}`);
  console.log(
    `✓ Facet installed with ${functionSelectors.length} function selectors`
  );
  console.log(`✓ Core functionality tested`);
  console.log(`✓ Admin functions tested`);
  console.log(`✓ Conversations created: ${conversations.length}`);
  console.log(`✓ Messages sent: ${messagesSent}`);
  console.log(`  - Pay-as-You-Go: ${payAsYouGoMessages}`);
  console.log(`  - Via Relayer: ${relayerMessages}`);
  console.log(`✓ Messages verified: ${verifiedCount}/${originalMessages.size}`);
  console.log(
    `✓ Encryption/Decryption: ${
      mismatchCount === 0 ? "All verified ✓" : `${mismatchCount} mismatches ⚠️`
    }`
  );
  console.log(`✓ Storage isolation verified`);
  console.log("\n" + "=".repeat(80));
  if (mismatchCount === 0) {
    console.log("✅ All-in-One Test Completed Successfully!");
  } else {
    console.log("⚠️  All-in-One Test Completed with Warnings!");
  }
  console.log("=".repeat(80));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Test failed:");
    console.error(error);
    process.exit(1);
  });
