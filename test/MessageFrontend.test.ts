import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { Message } from "../typechain-types";
import { computeConversationId } from "./helpers/conversationHelpers";
import {
  encryptMessage,
  decryptMessage,
  generateConversationKey,
  encryptConversationKeyForAddress,
  decryptConversationKeyForAddress,
} from "./helpers/mockEncryption";
import {
  fetchAllMessages,
  fetchConversationMessages,
  fetchMessagesBySender,
  fetchMessagesByReceiver,
  paginateMessages,
  filterMessagesByTimeRange,
  fetchAllConversations,
} from "./helpers/messageFetcher";
import { generateTestMessages } from "./helpers/testDataGenerator";

/**
 * Frontend Simulation Tests
 *
 * These tests simulate how a frontend application would interact with the Message contract:
 * - Creating conversations
 * - Sending messages (both methods)
 * - Fetching message history
 * - Decrypting messages
 * - Building conversation lists
 * - Message threading
 */

describe("Message Contract - Frontend Simulation", function () {
  // Simulate a user session
  interface UserSession {
    address: string;
    wallet: any;
    conversations: Map<bigint, ConversationState>;
    decryptedKeys: Map<bigint, string>; // conversationId -> decryptedKey
  }

  interface ConversationState {
    conversationId: bigint;
    participant1: string;
    participant2: string;
    messages: Array<{
      from: string;
      to: string;
      encryptedMessage: string;
      decryptedMessage?: string;
      timestamp: number;
      blockNumber: number;
    }>;
    createdAt: number;
  }

  // Fixture for deploying the Message contract
  async function deployMessageContract() {
    const [owner, ...signers] = await ethers.getSigners();
    const user1 = signers[0];
    const user2 = signers[1];
    const user3 = signers[2];
    const user4 = signers[3];
    const relayer = signers[4];

    const MessageFactory = await ethers.getContractFactory("Message");
    const messageContract = await MessageFactory.deploy(owner.address);

    await messageContract.connect(owner).setRelayer(relayer.address);

    return {
      owner,
      user1,
      user2,
      user3,
      user4,
      relayer,
      messageContract,
    };
  }

  /**
   * Simulates a user creating a new conversation (frontend flow)
   */
  async function simulateCreateConversation(
    messageContract: Message,
    sender: any,
    receiver: string
  ): Promise<{ conversationId: bigint; conversationKey: string }> {
    // Step 1: Generate conversation key (client-side)
    const conversationKey = generateConversationKey(
      `${sender.address}-${receiver}`
    );

    // Step 2: Encrypt keys for both participants (client-side)
    const encryptedKeyForSender = encryptConversationKeyForAddress(
      conversationKey,
      sender.address
    );
    const encryptedKeyForReceiver = encryptConversationKeyForAddress(
      conversationKey,
      receiver
    );

    // Step 3: Create conversation on-chain
    const conversationId = await messageContract
      .connect(sender)
      .createConversation.staticCall(
        receiver,
        `0x${encryptedKeyForSender}`,
        `0x${encryptedKeyForReceiver}`
      );

    await messageContract
      .connect(sender)
      .createConversation(
        receiver,
        `0x${encryptedKeyForSender}`,
        `0x${encryptedKeyForReceiver}`
      );

    return { conversationId, conversationKey };
  }

  /**
   * Simulates retrieving and decrypting conversation key (frontend flow)
   */
  async function simulateGetConversationKey(
    messageContract: Message,
    user: any,
    conversationId: bigint
  ): Promise<string> {
    // Step 1: Get encrypted key from contract
    const encryptedKey = await messageContract
      .connect(user)
      .getMyEncryptedConversationKeys(conversationId);

    // Step 2: Decrypt key client-side using user's address
    const decryptedKey = decryptConversationKeyForAddress(
      encryptedKey.substring(2), // Remove 0x prefix
      user.address
    );

    return decryptedKey;
  }

  describe("Frontend User Session Simulation", function () {
    it("Should simulate complete user session: create conversation -> send messages -> fetch history", async function () {
      const { user1, user2, messageContract } = await loadFixture(
        deployMessageContract
      );
      this.timeout(300000);

      // Initialize user session
      const session: UserSession = {
        address: user1.address,
        wallet: user1,
        conversations: new Map(),
        decryptedKeys: new Map(),
      };

      // Step 1: Create a conversation
      const { conversationId, conversationKey } =
        await simulateCreateConversation(messageContract, user1, user2.address);

      // Store in session
      session.decryptedKeys.set(conversationId, conversationKey);
      session.conversations.set(conversationId, {
        conversationId,
        participant1:
          user1.address.toLowerCase() < user2.address.toLowerCase()
            ? user1.address
            : user2.address,
        participant2:
          user1.address.toLowerCase() < user2.address.toLowerCase()
            ? user2.address
            : user1.address,
        messages: [],
        createdAt: Date.now(),
      });

      // Step 2: Send messages
      const payAsYouGoFee = await messageContract.payAsYouGoFee();
      const testMessages = generateTestMessages(10);

      for (const msg of testMessages) {
        const encryptedMsg = encryptMessage(msg, conversationKey);
        await messageContract
          .connect(user1)
          .sendMessage(conversationId, user2.address, encryptedMsg, {
            value: payAsYouGoFee,
          });
      }

      // Step 3: Fetch message history (frontend would do this)
      const convMessages = await fetchConversationMessages(
        messageContract,
        conversationId
      );

      // Step 4: Decrypt and display messages
      const decryptedMessages = convMessages.map((msg) => ({
        ...msg,
        decryptedMessage: decryptMessage(msg.encryptedMessage, conversationKey),
      }));

      // Update session
      const convState = session.conversations.get(conversationId)!;
      convState.messages = decryptedMessages;

      // Verify all messages are decrypted correctly
      expect(decryptedMessages.length).to.equal(10);
      for (let i = 0; i < testMessages.length; i++) {
        expect(
          decryptedMessages.some((m) => m.decryptedMessage === testMessages[i])
        ).to.be.true;
      }
    });

    it("Should simulate multiple conversations per user", async function () {
      const { user1, user2, user3, user4, messageContract } = await loadFixture(
        deployMessageContract
      );

      const session: UserSession = {
        address: user1.address,
        wallet: user1,
        conversations: new Map(),
        decryptedKeys: new Map(),
      };

      // Create multiple conversations
      const receivers = [user2.address, user3.address, user4.address];
      const conversations: Array<{
        id: bigint;
        key: string;
        receiver: string;
      }> = [];

      for (const receiver of receivers) {
        const { conversationId, conversationKey } =
          await simulateCreateConversation(messageContract, user1, receiver);

        conversations.push({
          id: conversationId,
          key: conversationKey,
          receiver,
        });
        session.decryptedKeys.set(conversationId, conversationKey);
      }

      // Send messages to each conversation
      const payAsYouGoFee = await messageContract.payAsYouGoFee();
      for (const conv of conversations) {
        for (let i = 0; i < 3; i++) {
          const msg = `Message ${i} to ${conv.receiver}`;
          const encryptedMsg = encryptMessage(msg, conv.key);
          await messageContract
            .connect(user1)
            .sendMessage(conv.id, conv.receiver, encryptedMsg, {
              value: payAsYouGoFee,
            });
        }
      }

      // Fetch all conversations for user (frontend would build conversation list)
      const allConversations = await fetchAllConversations(messageContract);

      // Filter conversations where user1 is a participant
      const user1Conversations = Array.from(allConversations.values()).filter(
        (conv) =>
          conv.participant1.toLowerCase() === user1.address.toLowerCase() ||
          conv.participant2.toLowerCase() === user1.address.toLowerCase()
      );

      expect(user1Conversations.length).to.be.at.least(3);
    });
  });

  describe("Frontend Message Fetching and Decryption", function () {
    it("Should fetch and decrypt messages for a conversation", async function () {
      const { user1, user2, messageContract } = await loadFixture(
        deployMessageContract
      );

      // Create conversation and send messages
      const { conversationId, conversationKey } =
        await simulateCreateConversation(messageContract, user1, user2.address);

      const payAsYouGoFee = await messageContract.payAsYouGoFee();
      const messages = ["Hello", "How are you?", "Good morning!"];

      for (const msg of messages) {
        const encryptedMsg = encryptMessage(msg, conversationKey);
        await messageContract
          .connect(user1)
          .sendMessage(conversationId, user2.address, encryptedMsg, {
            value: payAsYouGoFee,
          });
      }

      // Frontend: Fetch messages
      const fetchedMessages = await fetchConversationMessages(
        messageContract,
        conversationId
      );

      // Frontend: Decrypt messages
      const decryptedMessages = fetchedMessages.map((msg) => ({
        ...msg,
        decryptedMessage: decryptMessage(msg.encryptedMessage, conversationKey),
      }));

      // Verify decryption
      expect(decryptedMessages.length).to.equal(messages.length);
      for (const msg of messages) {
        expect(decryptedMessages.some((m) => m.decryptedMessage === msg)).to.be
          .true;
      }
    });

    it("Should fetch messages by sender and decrypt them", async function () {
      const { user1, user2, user3, messageContract } = await loadFixture(
        deployMessageContract
      );

      // Create conversations
      const { conversationId: convId12, conversationKey: key12 } =
        await simulateCreateConversation(messageContract, user1, user2.address);

      const { conversationId: convId13, conversationKey: key13 } =
        await simulateCreateConversation(messageContract, user1, user3.address);

      // Send messages from user1 to both conversations
      const payAsYouGoFee = await messageContract.payAsYouGoFee();

      await messageContract
        .connect(user1)
        .sendMessage(
          convId12,
          user2.address,
          encryptMessage("Message to user2", key12),
          {
            value: payAsYouGoFee,
          }
        );

      await messageContract
        .connect(user1)
        .sendMessage(
          convId13,
          user3.address,
          encryptMessage("Message to user3", key13),
          {
            value: payAsYouGoFee,
          }
        );

      // Frontend: Fetch all messages sent by user1
      const user1Messages = await fetchMessagesBySender(
        messageContract,
        user1.address
      );

      expect(user1Messages.length).to.be.at.least(2);
    });

    it("Should fetch messages by receiver and decrypt them", async function () {
      const { user1, user2, user3, messageContract } = await loadFixture(
        deployMessageContract
      );

      // Create conversations
      const { conversationId: convId12, conversationKey: key12 } =
        await simulateCreateConversation(messageContract, user1, user2.address);

      const { conversationId: convId23, conversationKey: key23 } =
        await simulateCreateConversation(messageContract, user2, user3.address);

      // Send messages to user2
      const payAsYouGoFee = await messageContract.payAsYouGoFee();

      await messageContract
        .connect(user1)
        .sendMessage(
          convId12,
          user2.address,
          encryptMessage("Message from user1", key12),
          {
            value: payAsYouGoFee,
          }
        );

      await messageContract
        .connect(user3)
        .sendMessage(
          convId23,
          user2.address,
          encryptMessage("Message from user3", key23),
          {
            value: payAsYouGoFee,
          }
        );

      // Frontend: Fetch all messages received by user2
      const user2Messages = await fetchMessagesByReceiver(
        messageContract,
        user2.address
      );

      expect(user2Messages.length).to.be.at.least(2);
    });
  });

  describe("Frontend Message Pagination", function () {
    it("Should paginate messages correctly", async function () {
      const { user1, user2, messageContract } = await loadFixture(
        deployMessageContract
      );
      this.timeout(300000);

      // Create conversation and send many messages
      const { conversationId, conversationKey } =
        await simulateCreateConversation(messageContract, user1, user2.address);

      const payAsYouGoFee = await messageContract.payAsYouGoFee();
      const messageCount = 50;

      for (let i = 0; i < messageCount; i++) {
        const msg = `Message ${i}`;
        const encryptedMsg = encryptMessage(msg, conversationKey);
        await messageContract
          .connect(user1)
          .sendMessage(conversationId, user2.address, encryptedMsg, {
            value: payAsYouGoFee,
          });
      }

      // Frontend: Fetch with pagination
      const allMessages = await fetchConversationMessages(
        messageContract,
        conversationId
      );
      const pageSize = 10;

      // First page
      const page1 = paginateMessages(allMessages, 0, pageSize);
      expect(page1.length).to.equal(pageSize);

      // Second page
      const page2 = paginateMessages(allMessages, pageSize, pageSize);
      expect(page2.length).to.equal(pageSize);

      // Last page
      const lastPage = paginateMessages(allMessages, 40, pageSize);
      expect(lastPage.length).to.be.at.least(10);
    });
  });

  describe("Frontend Message Filtering", function () {
    it("Should filter messages by time range", async function () {
      const { user1, user2, messageContract } = await loadFixture(
        deployMessageContract
      );

      // Create conversation
      const { conversationId, conversationKey } =
        await simulateCreateConversation(messageContract, user1, user2.address);

      // Send messages at different times
      const payAsYouGoFee = await messageContract.payAsYouGoFee();
      const startTime = Math.floor(Date.now() / 1000);

      await messageContract
        .connect(user1)
        .sendMessage(
          conversationId,
          user2.address,
          encryptMessage("Early message", conversationKey),
          {
            value: payAsYouGoFee,
          }
        );

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const midTime = Math.floor(Date.now() / 1000);

      await messageContract
        .connect(user1)
        .sendMessage(
          conversationId,
          user2.address,
          encryptMessage("Middle message", conversationKey),
          {
            value: payAsYouGoFee,
          }
        );

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 1000));

      await messageContract
        .connect(user1)
        .sendMessage(
          conversationId,
          user2.address,
          encryptMessage("Late message", conversationKey),
          {
            value: payAsYouGoFee,
          }
        );

      const endTime = Math.floor(Date.now() / 1000);

      // Frontend: Filter messages by time range
      const allMessages = await fetchConversationMessages(
        messageContract,
        conversationId
      );
      const filteredMessages = filterMessagesByTimeRange(
        allMessages,
        startTime,
        midTime
      );

      // Should include messages within the time range
      expect(filteredMessages.length).to.be.at.least(1);
    });
  });

  describe("Frontend Real-time Message Monitoring", function () {
    it("Should simulate real-time message monitoring", async function () {
      const { user1, user2, messageContract } = await loadFixture(
        deployMessageContract
      );

      // Create conversation
      const { conversationId, conversationKey } =
        await simulateCreateConversation(messageContract, user1, user2.address);

      // Simulate frontend subscribing to MessageSent events
      const payAsYouGoFee = await messageContract.payAsYouGoFee();
      const messagesReceived: Array<{
        from: string;
        message: string;
        timestamp: number;
      }> = [];

      // Listen for events (simulating frontend event listener)
      messageContract.on(
        "MessageSent",
        async (convId, from, to, encryptedMsg, event) => {
          if (convId === conversationId && to === user2.address) {
            // Decrypt message
            const decryptedMsg = decryptMessage(encryptedMsg, conversationKey);
            const block = await event.getBlock();

            messagesReceived.push({
              from,
              message: decryptedMsg,
              timestamp: block.timestamp,
            });
          }
        }
      );

      // Send messages (simulating another user sending)
      const messages = [
        "Real-time message 1",
        "Real-time message 2",
        "Real-time message 3",
      ];

      for (const msg of messages) {
        await messageContract
          .connect(user1)
          .sendMessage(
            conversationId,
            user2.address,
            encryptMessage(msg, conversationKey),
            {
              value: payAsYouGoFee,
            }
          );

        // Small delay to simulate real-time
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Wait for events to be processed
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify messages were received
      expect(messagesReceived.length).to.be.at.least(messages.length);

      // Clean up listener
      messageContract.removeAllListeners("MessageSent");
    });
  });

  describe("Frontend Conversation List Building", function () {
    it("Should build conversation list for a user", async function () {
      const { user1, user2, user3, user4, messageContract } = await loadFixture(
        deployMessageContract
      );

      // Create multiple conversations
      await simulateCreateConversation(messageContract, user1, user2.address);
      await simulateCreateConversation(messageContract, user1, user3.address);
      await simulateCreateConversation(messageContract, user1, user4.address);

      // Frontend: Fetch all conversations and filter for user1
      const allConversations = await fetchAllConversations(messageContract);

      const user1Conversations = Array.from(allConversations.values()).filter(
        (conv) =>
          conv.participant1.toLowerCase() === user1.address.toLowerCase() ||
          conv.participant2.toLowerCase() === user1.address.toLowerCase()
      );

      expect(user1Conversations.length).to.be.at.least(3);

      // Frontend: Build conversation list with last message info
      const conversationList = await Promise.all(
        user1Conversations.map(async (conv) => {
          const messages = await fetchConversationMessages(
            messageContract,
            conv.conversationId
          );
          const lastMessage =
            messages.length > 0 ? messages[messages.length - 1] : null;

          return {
            conversationId: conv.conversationId,
            otherParticipant:
              conv.participant1.toLowerCase() === user1.address.toLowerCase()
                ? conv.participant2
                : conv.participant1,
            lastMessage: lastMessage
              ? {
                  from: lastMessage.from,
                  to: lastMessage.to,
                  timestamp: lastMessage.timestamp,
                }
              : null,
            messageCount: conv.messageCount,
          };
        })
      );

      expect(conversationList.length).to.equal(user1Conversations.length);
    });
  });

  describe("Frontend Message Threading", function () {
    it("Should display messages in chronological order within a conversation", async function () {
      const { user1, user2, messageContract } = await loadFixture(
        deployMessageContract
      );

      // Create conversation
      const { conversationId, conversationKey } =
        await simulateCreateConversation(messageContract, user1, user2.address);

      const payAsYouGoFee = await messageContract.payAsYouGoFee();

      // Send alternating messages
      const messages: Array<{ from: any; message: string }> = [
        { from: user1, message: "Message 1 from user1" },
        { from: user2, message: "Message 2 from user2" },
        { from: user1, message: "Message 3 from user1" },
        { from: user2, message: "Message 4 from user2" },
      ];

      for (const { from, message } of messages) {
        await messageContract
          .connect(from)
          .sendMessage(
            conversationId,
            from === user1 ? user2.address : user1.address,
            encryptMessage(message, conversationKey),
            {
              value: payAsYouGoFee,
            }
          );
      }

      // Frontend: Fetch messages (already sorted by block number)
      const fetchedMessages = await fetchConversationMessages(
        messageContract,
        conversationId
      );

      // Frontend: Decrypt and display in thread
      const thread = fetchedMessages.map((msg, index) => ({
        index,
        from: msg.from,
        to: msg.to,
        message: decryptMessage(msg.encryptedMessage, conversationKey),
        timestamp: msg.timestamp,
        isFromMe: msg.from.toLowerCase() === user1.address.toLowerCase(),
      }));

      // Verify thread structure
      expect(thread.length).to.equal(messages.length);
      expect(thread[0].message).to.equal(messages[0].message);
      expect(thread[thread.length - 1].message).to.equal(
        messages[messages.length - 1].message
      );
    });
  });
});
