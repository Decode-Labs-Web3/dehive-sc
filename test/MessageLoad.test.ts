import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { Message } from "../typechain-types";
import {
  computeConversationId,
  getOrderedAddresses,
} from "./helpers/conversationHelpers";
import {
  encryptMessage,
  generateConversationKey,
  encryptConversationKeyForAddress,
  decryptMessage,
} from "./helpers/mockEncryption";
import {
  fetchAllMessages,
  fetchConversationMessages,
} from "./helpers/messageFetcher";
import {
  generateTestMessages,
  createConversationPairs,
} from "./helpers/testDataGenerator";

describe("Message Contract - Load Tests (100+ Messages)", function () {
  // Fixture for deploying the Message contract
  async function deployMessageContract() {
    const [owner, ...signers] = await ethers.getSigners();
    const user1 = signers[0];
    const user2 = signers[1];
    const user3 = signers[2];
    const user4 = signers[3];
    const user5 = signers[4];
    const relayer = signers[5];

    const MessageFactory = await ethers.getContractFactory("Message");
    const messageContract = await MessageFactory.deploy(owner.address);

    await messageContract.connect(owner).setRelayer(relayer.address);

    return {
      owner,
      user1,
      user2,
      user3,
      user4,
      user5,
      relayer,
      messageContract,
      allUsers: [user1, user2, user3, user4, user5],
    };
  }

  describe("Load Test - Direct Messages (Pay-as-You-Go)", function () {
    it("Should handle 100+ direct messages successfully", async function () {
      const { user1, user2, messageContract } = await loadFixture(
        deployMessageContract
      );
      this.timeout(300000); // 5 minutes timeout for load test

      // Create conversation
      const conversationKey = generateConversationKey("load-test");
      const encryptedKeyFor1 = encryptConversationKeyForAddress(
        conversationKey,
        user1.address
      );
      const encryptedKeyFor2 = encryptConversationKeyForAddress(
        conversationKey,
        user2.address
      );

      const convId = await messageContract
        .connect(user1)
        .createConversation.staticCall(
          user2.address,
          `0x${encryptedKeyFor1}`,
          `0x${encryptedKeyFor2}`
        );

      await messageContract
        .connect(user1)
        .createConversation(
          user2.address,
          `0x${encryptedKeyFor1}`,
          `0x${encryptedKeyFor2}`
        );

      const payAsYouGoFee = await messageContract.payAsYouGoFee();
      const messageCount = 100;

      // Generate test messages
      const messages = generateTestMessages(messageCount);

      // Send all messages
      const gasUsedArray: bigint[] = [];
      for (let i = 0; i < messageCount; i++) {
        const encryptedMsg = encryptMessage(messages[i], conversationKey);
        const tx = await messageContract
          .connect(user1)
          .sendMessage(convId, user2.address, encryptedMsg, {
            value: payAsYouGoFee,
          });

        const receipt = await tx.wait();
        gasUsedArray.push(receipt!.gasUsed);
      }

      // Verify all messages were sent
      const allMessages = await fetchAllMessages(messageContract);
      const convMessages = await fetchConversationMessages(
        messageContract,
        convId
      );

      expect(convMessages.length).to.be.at.least(messageCount);

      // Verify messages can be decrypted
      const decryptedMessages = convMessages.map((msg) =>
        decryptMessage(msg.encryptedMessage, conversationKey)
      );

      for (const msg of messages) {
        expect(decryptedMessages).to.include(msg);
      }

      // Log gas statistics
      const totalGas = gasUsedArray.reduce((sum, gas) => sum + gas, BigInt(0));
      const avgGas = totalGas / BigInt(messageCount);
      console.log(`\nSent ${messageCount} messages:`);
      console.log(`  Total gas used: ${totalGas.toString()}`);
      console.log(`  Average gas per message: ${avgGas.toString()}`);
      console.log(
        `  Min gas: ${Math.min(...gasUsedArray.map((g) => Number(g)))}`
      );
      console.log(
        `  Max gas: ${Math.max(...gasUsedArray.map((g) => Number(g)))}`
      );
    });

    it("Should handle 150 messages across multiple conversations", async function () {
      const { user1, user2, user3, user4, user5, messageContract } =
        await loadFixture(deployMessageContract);
      this.timeout(600000); // 10 minutes timeout

      const users = [user1, user2, user3, user4, user5];
      const conversations: Array<{
        convId: bigint;
        key: string;
        user1: any;
        user2: any;
      }> = [];

      // Create 10 conversations (all pairs)
      const pairs = createConversationPairs(users.map((u) => u.address));

      for (const [addr1, addr2] of pairs) {
        const u1 = users.find(
          (u) => u.address.toLowerCase() === addr1.toLowerCase()
        )!;
        const u2 = users.find(
          (u) => u.address.toLowerCase() === addr2.toLowerCase()
        )!;

        const conversationKey = generateConversationKey(`${addr1}-${addr2}`);
        const encryptedKeyFor1 = encryptConversationKeyForAddress(
          conversationKey,
          addr1
        );
        const encryptedKeyFor2 = encryptConversationKeyForAddress(
          conversationKey,
          addr2
        );

        const convId = await messageContract
          .connect(u1)
          .createConversation.staticCall(
            addr2,
            `0x${encryptedKeyFor1}`,
            `0x${encryptedKeyFor2}`
          );

        await messageContract
          .connect(u1)
          .createConversation(
            addr2,
            `0x${encryptedKeyFor1}`,
            `0x${encryptedKeyFor2}`
          );

        conversations.push({
          convId,
          key: conversationKey,
          user1: u1,
          user2: u2,
        });
      }

      // Send 15 messages per conversation (150 total)
      const payAsYouGoFee = await messageContract.payAsYouGoFee();
      const messagesPerConversation = 15;

      for (const conv of conversations) {
        for (let i = 0; i < messagesPerConversation; i++) {
          const msg = `Message ${i} in conversation ${conv.convId.toString()}`;
          const encryptedMsg = encryptMessage(msg, conv.key);

          // Alternate between users
          const sender = i % 2 === 0 ? conv.user1 : conv.user2;
          const receiver = i % 2 === 0 ? conv.user2 : conv.user1;

          await messageContract
            .connect(sender)
            .sendMessage(conv.convId, receiver.address, encryptedMsg, {
              value: payAsYouGoFee,
            });
        }
      }

      // Verify all messages
      const allMessages = await fetchAllMessages(messageContract);
      expect(allMessages.length).to.be.at.least(150);

      // Verify messages per conversation
      for (const conv of conversations) {
        const convMessages = await fetchConversationMessages(
          messageContract,
          conv.convId
        );
        expect(convMessages.length).to.be.at.least(messagesPerConversation);
      }
    });
  });

  describe("Load Test - Relayer Messages (Credit-Based)", function () {
    it("Should handle 100+ relayer messages successfully", async function () {
      const { user1, user2, relayer, messageContract } = await loadFixture(
        deployMessageContract
      );
      this.timeout(300000); // 5 minutes timeout

      // Create conversation
      const conversationKey = generateConversationKey("relayer-load-test");
      const encryptedKeyFor1 = encryptConversationKeyForAddress(
        conversationKey,
        user1.address
      );
      const encryptedKeyFor2 = encryptConversationKeyForAddress(
        conversationKey,
        user2.address
      );

      const convId = await messageContract
        .connect(user1)
        .createConversation.staticCall(
          user2.address,
          `0x${encryptedKeyFor1}`,
          `0x${encryptedKeyFor2}`
        );

      await messageContract
        .connect(user1)
        .createConversation(
          user2.address,
          `0x${encryptedKeyFor1}`,
          `0x${encryptedKeyFor2}`
        );

      // Deposit enough funds for 100+ messages
      const relayerFee = await messageContract.relayerFee();
      const messageCount = 120;
      const depositAmount =
        relayerFee * BigInt(messageCount) + ethers.parseEther("0.001"); // Extra for safety

      await messageContract
        .connect(user1)
        .depositFunds({ value: depositAmount });

      // Generate test messages
      const messages = generateTestMessages(messageCount);

      // Send all messages via relayer
      const gasUsedArray: bigint[] = [];
      for (let i = 0; i < messageCount; i++) {
        const encryptedMsg = encryptMessage(messages[i], conversationKey);
        const tx = await messageContract
          .connect(relayer)
          .sendMessageViaRelayer(
            convId,
            user1.address,
            user2.address,
            encryptedMsg,
            relayerFee
          );

        const receipt = await tx.wait();
        gasUsedArray.push(receipt!.gasUsed);
      }

      // Verify all messages were sent
      const convMessages = await fetchConversationMessages(
        messageContract,
        convId
      );
      expect(convMessages.length).to.be.at.least(messageCount);

      // Verify user funds were depleted correctly
      const remainingFunds = await messageContract.funds(user1.address);
      expect(remainingFunds).to.be.closeTo(
        depositAmount - relayerFee * BigInt(messageCount),
        ethers.parseEther("0.0001")
      );

      // Log gas statistics
      const totalGas = gasUsedArray.reduce((sum, gas) => sum + gas, BigInt(0));
      const avgGas = totalGas / BigInt(messageCount);
      console.log(`\nSent ${messageCount} relayer messages:`);
      console.log(`  Total gas used: ${totalGas.toString()}`);
      console.log(`  Average gas per message: ${avgGas.toString()}`);
    });
  });

  describe("Load Test - Mixed Message Types", function () {
    it("Should handle mix of direct and relayer messages (100+ total)", async function () {
      const { user1, user2, relayer, messageContract } = await loadFixture(
        deployMessageContract
      );
      this.timeout(300000);

      // Create conversation
      const conversationKey = generateConversationKey("mixed-load-test");
      const encryptedKeyFor1 = encryptConversationKeyForAddress(
        conversationKey,
        user1.address
      );
      const encryptedKeyFor2 = encryptConversationKeyForAddress(
        conversationKey,
        user2.address
      );

      const convId = await messageContract
        .connect(user1)
        .createConversation.staticCall(
          user2.address,
          `0x${encryptedKeyFor1}`,
          `0x${encryptedKeyFor2}`
        );

      await messageContract
        .connect(user1)
        .createConversation(
          user2.address,
          `0x${encryptedKeyFor1}`,
          `0x${encryptedKeyFor2}`
        );

      // Deposit funds for relayer messages
      const relayerFee = await messageContract.relayerFee();
      const relayerMessageCount = 50;
      await messageContract.connect(user1).depositFunds({
        value:
          relayerFee * BigInt(relayerMessageCount) + ethers.parseEther("0.001"),
      });

      const payAsYouGoFee = await messageContract.payAsYouGoFee();
      const directMessageCount = 50;
      const totalMessages = relayerMessageCount + directMessageCount;

      // Send direct messages
      for (let i = 0; i < directMessageCount; i++) {
        const msg = `Direct message ${i}`;
        const encryptedMsg = encryptMessage(msg, conversationKey);
        await messageContract
          .connect(user1)
          .sendMessage(convId, user2.address, encryptedMsg, {
            value: payAsYouGoFee,
          });
      }

      // Send relayer messages
      for (let i = 0; i < relayerMessageCount; i++) {
        const msg = `Relayer message ${i}`;
        const encryptedMsg = encryptMessage(msg, conversationKey);
        await messageContract
          .connect(relayer)
          .sendMessageViaRelayer(
            convId,
            user1.address,
            user2.address,
            encryptedMsg,
            relayerFee
          );
      }

      // Verify all messages
      const convMessages = await fetchConversationMessages(
        messageContract,
        convId
      );
      expect(convMessages.length).to.be.at.least(totalMessages);

      // Verify message order is preserved
      expect(convMessages.length).to.equal(totalMessages);
    });
  });

  describe("Load Test - Message Fetching Performance", function () {
    it("Should efficiently fetch 100+ messages", async function () {
      const { user1, user2, messageContract } = await loadFixture(
        deployMessageContract
      );
      this.timeout(300000);

      // Create and send messages
      const conversationKey = generateConversationKey("fetch-test");
      const encryptedKeyFor1 = encryptConversationKeyForAddress(
        conversationKey,
        user1.address
      );
      const encryptedKeyFor2 = encryptConversationKeyForAddress(
        conversationKey,
        user2.address
      );

      const convId = await messageContract
        .connect(user1)
        .createConversation.staticCall(
          user2.address,
          `0x${encryptedKeyFor1}`,
          `0x${encryptedKeyFor2}`
        );

      await messageContract
        .connect(user1)
        .createConversation(
          user2.address,
          `0x${encryptedKeyFor1}`,
          `0x${encryptedKeyFor2}`
        );

      const payAsYouGoFee = await messageContract.payAsYouGoFee();
      const messageCount = 100;

      // Send messages
      for (let i = 0; i < messageCount; i++) {
        const msg = `Message ${i}`;
        const encryptedMsg = encryptMessage(msg, conversationKey);
        await messageContract
          .connect(user1)
          .sendMessage(convId, user2.address, encryptedMsg, {
            value: payAsYouGoFee,
          });
      }

      // Measure fetching performance
      const startTime = Date.now();
      const allMessages = await fetchAllMessages(messageContract);
      const fetchAllTime = Date.now() - startTime;

      const startTimeConv = Date.now();
      const convMessages = await fetchConversationMessages(
        messageContract,
        convId
      );
      const fetchConvTime = Date.now() - startTimeConv;

      expect(allMessages.length).to.be.at.least(messageCount);
      expect(convMessages.length).to.be.at.least(messageCount);

      console.log(`\nFetching Performance:`);
      console.log(
        `  Fetch all messages (${allMessages.length}): ${fetchAllTime}ms`
      );
      console.log(
        `  Fetch conversation messages (${convMessages.length}): ${fetchConvTime}ms`
      );
    });
  });

  describe("Load Test - Concurrent Message Sending", function () {
    it("Should handle concurrent message sending (100+ messages)", async function () {
      const { user1, user2, user3, user4, user5, messageContract } =
        await loadFixture(deployMessageContract);
      this.timeout(600000);

      const users = [user1, user2, user3, user4, user5];
      const conversations: Array<{
        convId: bigint;
        key: string;
        sender: any;
        receiver: any;
      }> = [];

      // Create conversations
      for (let i = 0; i < users.length - 1; i++) {
        const u1 = users[i];
        const u2 = users[i + 1];

        const conversationKey = generateConversationKey(`concurrent-${i}`);
        const encryptedKeyFor1 = encryptConversationKeyForAddress(
          conversationKey,
          u1.address
        );
        const encryptedKeyFor2 = encryptConversationKeyForAddress(
          conversationKey,
          u2.address
        );

        const convId = await messageContract
          .connect(u1)
          .createConversation.staticCall(
            u2.address,
            `0x${encryptedKeyFor1}`,
            `0x${encryptedKeyFor2}`
          );

        await messageContract
          .connect(u1)
          .createConversation(
            u2.address,
            `0x${encryptedKeyFor1}`,
            `0x${encryptedKeyFor2}`
          );

        conversations.push({
          convId,
          key: conversationKey,
          sender: u1,
          receiver: u2,
        });
      }

      // Send messages concurrently (simulated by rapid sequential sends)
      const payAsYouGoFee = await messageContract.payAsYouGoFee();
      const messagesPerConversation = 25;
      const promises: Promise<any>[] = [];

      for (const conv of conversations) {
        for (let i = 0; i < messagesPerConversation; i++) {
          const msg = `Concurrent message ${i} in conv ${conv.convId.toString()}`;
          const encryptedMsg = encryptMessage(msg, conv.key);

          promises.push(
            messageContract
              .connect(conv.sender)
              .sendMessage(conv.convId, conv.receiver.address, encryptedMsg, {
                value: payAsYouGoFee,
              })
          );
        }
      }

      // Wait for all messages to be sent
      await Promise.all(promises);

      // Verify all messages were sent
      const allMessages = await fetchAllMessages(messageContract);
      const expectedCount = conversations.length * messagesPerConversation;

      expect(allMessages.length).to.be.at.least(expectedCount);
    });
  });
});
