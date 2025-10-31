import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { Message } from "../typechain-types";
import {
  computeConversationId,
  createConversationData,
} from "./helpers/conversationHelpers";
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
} from "./helpers/messageFetcher";

describe("Message Contract - Basic Functionality", function () {
  // Fixture for deploying the Message contract
  async function deployMessageContract() {
    const [owner, user1, user2, user3, relayer] = await ethers.getSigners();

    const MessageFactory = await ethers.getContractFactory("Message");
    const messageContract = await MessageFactory.deploy(owner.address);

    // Set relayer
    await messageContract.connect(owner).setRelayer(relayer.address);

    return {
      owner,
      user1,
      user2,
      user3,
      relayer,
      messageContract,
    };
  }

  describe("Contract Deployment", function () {
    it("Should deploy with correct owner", async function () {
      const { owner, messageContract } = await loadFixture(
        deployMessageContract
      );
      expect(await messageContract.owner()).to.equal(owner.address);
    });

    it("Should have correct initial fees", async function () {
      const { messageContract } = await loadFixture(deployMessageContract);
      const payAsYouGoFee = await messageContract.payAsYouGoFee();
      const relayerFee = await messageContract.relayerFee();

      expect(payAsYouGoFee).to.equal(ethers.parseEther("0.0000002"));
      expect(relayerFee).to.equal(ethers.parseEther("0.0000001"));
    });

    it("Should set relayer correctly", async function () {
      const { owner, relayer, messageContract } = await loadFixture(
        deployMessageContract
      );

      expect(await messageContract.relayer()).to.equal(relayer.address);

      await expect(messageContract.connect(owner).setRelayer(relayer.address))
        .to.emit(messageContract, "RelayerSet")
        .withArgs(relayer.address, await ethers.provider.getBlockNumber());
    });
  });

  describe("Conversation Creation", function () {
    it("Should create a conversation between two users", async function () {
      const { user1, user2, messageContract } = await loadFixture(
        deployMessageContract
      );

      // Generate conversation key and encrypt for both users
      const conversationKey = generateConversationKey("test-seed");
      const encryptedKeyFor1 = encryptConversationKeyForAddress(
        conversationKey,
        user1.address
      );
      const encryptedKeyFor2 = encryptConversationKeyForAddress(
        conversationKey,
        user2.address
      );

      const tx = await messageContract
        .connect(user1)
        .createConversation(
          user2.address,
          `0x${encryptedKeyFor1}`,
          `0x${encryptedKeyFor2}`
        );

      const receipt = await tx.wait();

      // Verify event emission
      await expect(tx).to.emit(messageContract, "ConversationCreated");

      // Compute expected conversation ID
      const expectedConvId = computeConversationId(
        user1.address,
        user2.address
      );

      // Verify conversation data
      const conv = await messageContract.conversations(expectedConvId);
      expect(conv.smallerAddress).to.be.properAddress;
      expect(conv.largerAddress).to.be.properAddress;
      expect(conv.createdAt).to.be.gt(0);
    });

    it("Should return the same conversation ID regardless of who creates it", async function () {
      const { user1, user2, messageContract } = await loadFixture(
        deployMessageContract
      );

      const conversationKey = generateConversationKey("test-seed");
      const encryptedKeyFor1 = encryptConversationKeyForAddress(
        conversationKey,
        user1.address
      );
      const encryptedKeyFor2 = encryptConversationKeyForAddress(
        conversationKey,
        user2.address
      );

      // User1 creates conversation
      const tx1 = await messageContract
        .connect(user1)
        .createConversation(
          user2.address,
          `0x${encryptedKeyFor1}`,
          `0x${encryptedKeyFor2}`
        );
      const receipt1 = await tx1.wait();
      const convId1 = await messageContract
        .connect(user1)
        .createConversation.staticCall(
          user2.address,
          `0x${encryptedKeyFor1}`,
          `0x${encryptedKeyFor2}`
        );

      // Verify conversation ID is deterministic
      const expectedConvId = computeConversationId(
        user1.address,
        user2.address
      );
      expect(convId1).to.equal(expectedConvId);
    });

    it("Should allow users to retrieve their encrypted conversation key", async function () {
      const { user1, user2, messageContract } = await loadFixture(
        deployMessageContract
      );

      const conversationKey = generateConversationKey("test-seed");
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

      // User1 retrieves their key
      const retrievedKey = await messageContract
        .connect(user1)
        .getMyEncryptedConversationKeys(convId);

      // Verify key can be decrypted
      const decryptedKey = decryptConversationKeyForAddress(
        retrievedKey.substring(2), // Remove 0x prefix
        user1.address
      );
      expect(decryptedKey).to.equal(conversationKey);
    });
  });

  describe("Direct Message Sending (Pay-as-You-Go)", function () {
    it("Should send a message directly with correct fee payment", async function () {
      const { user1, user2, messageContract } = await loadFixture(
        deployMessageContract
      );

      // Create conversation first
      const conversationKey = generateConversationKey("test-seed");
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

      // Send message
      const payAsYouGoFee = await messageContract.payAsYouGoFee();
      const message = "Hello, this is a test message!";
      const encryptedMsg = encryptMessage(message, conversationKey);

      await expect(
        messageContract
          .connect(user1)
          .sendMessage(convId, user2.address, encryptedMsg, {
            value: payAsYouGoFee,
          })
      )
        .to.emit(messageContract, "MessageSent")
        .withArgs(convId, user1.address, user2.address, encryptedMsg)
        .and.to.emit(messageContract, "FeeCharged")
        .withArgs(
          payAsYouGoFee,
          user1.address,
          await ethers.provider.getBlockNumber()
        );
    });

    it("Should refund excess payment", async function () {
      const { user1, user2, messageContract } = await loadFixture(
        deployMessageContract
      );

      // Create conversation
      const conversationKey = generateConversationKey("test-seed");
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
      const excessAmount = ethers.parseEther("0.001");
      const totalPayment = payAsYouGoFee + excessAmount;

      const balanceBefore = await ethers.provider.getBalance(user1.address);

      const tx = await messageContract
        .connect(user1)
        .sendMessage(convId, user2.address, "test", { value: totalPayment });

      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const balanceAfter = await ethers.provider.getBalance(user1.address);

      // Balance should be reduced by fee + gas, excess should be refunded
      const expectedBalance = balanceBefore - payAsYouGoFee - gasUsed;
      expect(balanceAfter).to.be.closeTo(
        expectedBalance,
        ethers.parseEther("0.0001")
      );
    });

    it("Should fail if insufficient fee is paid", async function () {
      const { user1, user2, messageContract } = await loadFixture(
        deployMessageContract
      );

      // Create conversation
      const conversationKey = generateConversationKey("test-seed");
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

      const insufficientFee = ethers.parseEther("0.0000001");

      await expect(
        messageContract
          .connect(user1)
          .sendMessage(convId, user2.address, "test", {
            value: insufficientFee,
          })
      ).to.be.revertedWith("Message: insufficient fee payment");
    });
  });

  describe("Relayer Message Sending (Credit-Based)", function () {
    it("Should deposit funds successfully", async function () {
      const { user1, messageContract } = await loadFixture(
        deployMessageContract
      );

      const depositAmount = ethers.parseEther("0.01");

      await expect(
        messageContract.connect(user1).depositFunds({ value: depositAmount })
      )
        .to.emit(messageContract, "FundsDeposited")
        .withArgs(
          depositAmount,
          user1.address,
          await ethers.provider.getBlockNumber()
        );

      const balance = await messageContract.funds(user1.address);
      expect(balance).to.equal(depositAmount);
    });

    it("Should send message via relayer with deposited funds", async function () {
      const { user1, user2, relayer, messageContract } = await loadFixture(
        deployMessageContract
      );

      // Create conversation
      const conversationKey = generateConversationKey("test-seed");
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

      // Deposit funds
      const depositAmount = ethers.parseEther("0.01");
      await messageContract
        .connect(user1)
        .depositFunds({ value: depositAmount });

      // Send message via relayer
      const relayerFee = await messageContract.relayerFee();
      const message = "Hello via relayer!";
      const encryptedMsg = encryptMessage(message, conversationKey);

      await expect(
        messageContract
          .connect(relayer)
          .sendMessageViaRelayer(
            convId,
            user1.address,
            user2.address,
            encryptedMsg,
            relayerFee
          )
      )
        .to.emit(messageContract, "MessageSent")
        .withArgs(convId, user1.address, user2.address, encryptedMsg)
        .and.to.emit(messageContract, "FeeCharged")
        .withArgs(
          relayerFee,
          user1.address,
          await ethers.provider.getBlockNumber()
        );

      // Verify funds were deducted
      const remainingBalance = await messageContract.funds(user1.address);
      expect(remainingBalance).to.equal(depositAmount - relayerFee);
    });

    it("Should fail if user has insufficient funds", async function () {
      const { user1, user2, relayer, messageContract } = await loadFixture(
        deployMessageContract
      );

      // Create conversation
      const conversationKey = generateConversationKey("test-seed");
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

      // Deposit insufficient funds
      const smallDeposit = ethers.parseEther("0.00000005"); // Less than relayerFee
      await messageContract
        .connect(user1)
        .depositFunds({ value: smallDeposit });

      const relayerFee = await messageContract.relayerFee();

      await expect(
        messageContract
          .connect(relayer)
          .sendMessageViaRelayer(
            convId,
            user1.address,
            user2.address,
            "test",
            relayerFee
          )
      ).to.be.revertedWith(
        "Message: user does not have enough funds to pay the fee"
      );
    });
  });

  describe("Fee Configuration", function () {
    it("Should update pay-as-you-go fee", async function () {
      const { owner, messageContract } = await loadFixture(
        deployMessageContract
      );

      const newFee = ethers.parseEther("0.000001");

      await expect(messageContract.connect(owner).setPayAsYouGoFee(newFee))
        .to.emit(messageContract, "PayAsYouGoFeeSet")
        .withArgs(newFee, await ethers.provider.getBlockNumber());

      const updatedFee = await messageContract.payAsYouGoFee();
      expect(updatedFee).to.equal(newFee);
    });

    it("Should update relayer fee", async function () {
      const { owner, messageContract } = await loadFixture(
        deployMessageContract
      );

      const newFee = ethers.parseEther("0.0000005");

      await expect(messageContract.connect(owner).setRelayerFee(newFee))
        .to.emit(messageContract, "RelayerFeeSet")
        .withArgs(newFee, await ethers.provider.getBlockNumber());

      const updatedFee = await messageContract.relayerFee();
      expect(updatedFee).to.equal(newFee);
    });
  });

  describe("Message Fetching", function () {
    it("Should fetch all messages from contract", async function () {
      const { user1, user2, user3, messageContract } = await loadFixture(
        deployMessageContract
      );

      // Create multiple conversations and send messages
      const conversationKey = generateConversationKey("test-seed");
      const encryptedKeyFor1 = encryptConversationKeyForAddress(
        conversationKey,
        user1.address
      );
      const encryptedKeyFor2 = encryptConversationKeyForAddress(
        conversationKey,
        user2.address
      );
      const encryptedKeyFor3 = encryptConversationKeyForAddress(
        conversationKey,
        user3.address
      );

      // Create conversation between user1 and user2
      const convId12 = await messageContract
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

      // Send messages
      const payAsYouGoFee = await messageContract.payAsYouGoFee();
      const msg1 = "Message 1";
      const msg2 = "Message 2";

      await messageContract
        .connect(user1)
        .sendMessage(
          convId12,
          user2.address,
          encryptMessage(msg1, conversationKey),
          {
            value: payAsYouGoFee,
          }
        );

      await messageContract
        .connect(user2)
        .sendMessage(
          convId12,
          user1.address,
          encryptMessage(msg2, conversationKey),
          {
            value: payAsYouGoFee,
          }
        );

      // Fetch all messages
      const allMessages = await fetchAllMessages(messageContract);
      expect(allMessages.length).to.be.at.least(2);

      // Verify messages can be decrypted
      const decryptedMsg1 = decryptMessage(
        allMessages[0].encryptedMessage,
        conversationKey
      );
      expect([msg1, msg2]).to.include(decryptedMsg1);
    });

    it("Should fetch messages for a specific conversation", async function () {
      const { user1, user2, user3, messageContract } = await loadFixture(
        deployMessageContract
      );

      // Create two conversations
      const convKey12 = generateConversationKey("conv12");
      const convKey13 = generateConversationKey("conv13");

      const encryptedKeyFor1_12 = encryptConversationKeyForAddress(
        convKey12,
        user1.address
      );
      const encryptedKeyFor2_12 = encryptConversationKeyForAddress(
        convKey12,
        user2.address
      );
      const encryptedKeyFor1_13 = encryptConversationKeyForAddress(
        convKey13,
        user1.address
      );
      const encryptedKeyFor3_13 = encryptConversationKeyForAddress(
        convKey13,
        user3.address
      );

      const convId12 = await messageContract
        .connect(user1)
        .createConversation.staticCall(
          user2.address,
          `0x${encryptedKeyFor1_12}`,
          `0x${encryptedKeyFor2_12}`
        );

      const convId13 = await messageContract
        .connect(user1)
        .createConversation.staticCall(
          user3.address,
          `0x${encryptedKeyFor1_13}`,
          `0x${encryptedKeyFor3_13}`
        );

      await messageContract
        .connect(user1)
        .createConversation(
          user2.address,
          `0x${encryptedKeyFor1_12}`,
          `0x${encryptedKeyFor2_12}`
        );

      await messageContract
        .connect(user1)
        .createConversation(
          user3.address,
          `0x${encryptedKeyFor1_13}`,
          `0x${encryptedKeyFor3_13}`
        );

      // Send messages to both conversations
      const payAsYouGoFee = await messageContract.payAsYouGoFee();

      await messageContract
        .connect(user1)
        .sendMessage(
          convId12,
          user2.address,
          encryptMessage("Msg to user2", convKey12),
          {
            value: payAsYouGoFee,
          }
        );

      await messageContract
        .connect(user1)
        .sendMessage(
          convId13,
          user3.address,
          encryptMessage("Msg to user3", convKey13),
          {
            value: payAsYouGoFee,
          }
        );

      // Fetch messages for conversation 12 only
      const conv12Messages = await fetchConversationMessages(
        messageContract,
        convId12
      );
      expect(conv12Messages.length).to.equal(1);
      expect(
        decryptMessage(conv12Messages[0].encryptedMessage, convKey12)
      ).to.equal("Msg to user2");
    });
  });
});
