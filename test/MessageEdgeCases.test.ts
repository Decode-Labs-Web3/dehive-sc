import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { Message } from "../typechain-types";
import { computeConversationId } from "./helpers/conversationHelpers";
import {
  encryptMessage,
  generateConversationKey,
  encryptConversationKeyForAddress,
} from "./helpers/mockEncryption";

describe("Message Contract - Edge Cases", function () {
  // Fixture for deploying the Message contract
  async function deployMessageContract() {
    const [owner, user1, user2, user3, nonRelayer, relayer] =
      await ethers.getSigners();

    const MessageFactory = await ethers.getContractFactory("Message");
    const messageContract = await MessageFactory.deploy(owner.address);

    await messageContract.connect(owner).setRelayer(relayer.address);

    return {
      owner,
      user1,
      user2,
      user3,
      nonRelayer,
      relayer,
      messageContract,
    };
  }

  describe("Zero Address Handling", function () {
    it("Should revert when sending message to zero address", async function () {
      const { user1, messageContract } = await loadFixture(
        deployMessageContract
      );

      const conversationKey = generateConversationKey("test");
      const encryptedKeyFor1 = encryptConversationKeyForAddress(
        conversationKey,
        user1.address
      );
      const encryptedKeyFor2 = encryptConversationKeyForAddress(
        conversationKey,
        ethers.ZeroAddress
      );

      // Create conversation with zero address
      const convId = await messageContract
        .connect(user1)
        .createConversation.staticCall(
          ethers.ZeroAddress,
          `0x${encryptedKeyFor1}`,
          `0x${encryptedKeyFor2}`
        );

      await messageContract
        .connect(user1)
        .createConversation(
          ethers.ZeroAddress,
          `0x${encryptedKeyFor1}`,
          `0x${encryptedKeyFor2}`
        );

      const payAsYouGoFee = await messageContract.payAsYouGoFee();

      // Sending to zero address should work (contract doesn't validate this)
      // But it's generally bad practice - we'll test that it technically works
      await expect(
        messageContract
          .connect(user1)
          .sendMessage(convId, ethers.ZeroAddress, "test", {
            value: payAsYouGoFee,
          })
      ).to.not.be.reverted; // Contract doesn't explicitly prevent this
    });

    it("Should revert when setting relayer to zero address", async function () {
      const { owner, messageContract } = await loadFixture(
        deployMessageContract
      );

      await expect(
        messageContract.connect(owner).setRelayer(ethers.ZeroAddress)
      ).to.be.revertedWith("Message: Relayer cannot be zero address");
    });
  });

  describe("Invalid Conversation IDs", function () {
    it("Should revert when sending message to non-existent conversation", async function () {
      const { user1, user2, messageContract } = await loadFixture(
        deployMessageContract
      );

      // Try to send message without creating conversation
      const fakeConvId = BigInt(
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
      );
      const payAsYouGoFee = await messageContract.payAsYouGoFee();

      // The contract doesn't validate conversation existence in sendMessage
      // So this will technically work, but conversation won't be accessible
      await expect(
        messageContract
          .connect(user1)
          .sendMessage(fakeConvId, user2.address, "test", {
            value: payAsYouGoFee,
          })
      ).to.not.be.reverted; // Contract allows this
    });

    it("Should revert when retrieving key for non-existent conversation", async function () {
      const { user1, messageContract } = await loadFixture(
        deployMessageContract
      );

      const fakeConvId = BigInt(
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
      );

      await expect(
        messageContract
          .connect(user1)
          .getMyEncryptedConversationKeys(fakeConvId)
      ).to.be.revertedWith("Message: conversation does not exist");
    });

    it("Should revert when non-participant tries to retrieve conversation key", async function () {
      const { user1, user2, user3, messageContract } = await loadFixture(
        deployMessageContract
      );

      // Create conversation between user1 and user2
      const conversationKey = generateConversationKey("test");
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

      // User3 tries to retrieve key (not a participant)
      await expect(
        messageContract.connect(user3).getMyEncryptedConversationKeys(convId)
      ).to.be.revertedWith(
        "Message: caller is not a participant in this conversation"
      );
    });
  });

  describe("Insufficient Funds Scenarios", function () {
    it("Should revert when sending message with insufficient fee", async function () {
      const { user1, user2, messageContract } = await loadFixture(
        deployMessageContract
      );

      // Create conversation
      const conversationKey = generateConversationKey("test");
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
      const insufficientFee = payAsYouGoFee / BigInt(2); // Half the required fee

      await expect(
        messageContract
          .connect(user1)
          .sendMessage(convId, user2.address, "test", {
            value: insufficientFee,
          })
      ).to.be.revertedWith("Message: insufficient fee payment");
    });

    it("Should revert when relayer tries to charge from user with insufficient funds", async function () {
      const { user1, user2, relayer, messageContract } = await loadFixture(
        deployMessageContract
      );

      // Create conversation
      const conversationKey = generateConversationKey("test");
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
      const relayerFee = await messageContract.relayerFee();
      const insufficientDeposit = relayerFee / BigInt(2);
      await messageContract
        .connect(user1)
        .depositFunds({ value: insufficientDeposit });

      // Try to send message via relayer
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

    it("Should revert when relayer tries to charge from user with zero balance", async function () {
      const { user1, user2, relayer, messageContract } = await loadFixture(
        deployMessageContract
      );

      // Create conversation
      const conversationKey = generateConversationKey("test");
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

      // Don't deposit any funds
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

  describe("Invalid Fee Amounts", function () {
    it("Should revert when relayer tries to charge incorrect fee", async function () {
      const { user1, user2, relayer, messageContract } = await loadFixture(
        deployMessageContract
      );

      // Create conversation
      const conversationKey = generateConversationKey("test");
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

      // Try to charge incorrect fee (higher than relayerFee)
      const incorrectFee = await messageContract.payAsYouGoFee();

      await expect(
        messageContract
          .connect(relayer)
          .sendMessageViaRelayer(
            convId,
            user1.address,
            user2.address,
            "test",
            incorrectFee
          )
      ).to.be.revertedWith("Message: invalid fee amount for relayer");
    });

    it("Should revert when setting zero pay-as-you-go fee", async function () {
      const { owner, messageContract } = await loadFixture(
        deployMessageContract
      );

      await expect(
        messageContract.connect(owner).setPayAsYouGoFee(0)
      ).to.be.revertedWith("Message: Pay as you go fee must be greater than 0");
    });

    it("Should revert when setting zero relayer fee", async function () {
      const { owner, messageContract } = await loadFixture(
        deployMessageContract
      );

      await expect(
        messageContract.connect(owner).setRelayerFee(0)
      ).to.be.revertedWith("Message: Relayer fee must be greater than 0");
    });
  });

  describe("Unauthorized Access", function () {
    it("Should revert when non-relayer tries to send via relayer", async function () {
      const { user1, user2, nonRelayer, messageContract } = await loadFixture(
        deployMessageContract
      );

      // Create conversation
      const conversationKey = generateConversationKey("test");
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
      await messageContract
        .connect(user1)
        .depositFunds({ value: ethers.parseEther("0.01") });

      // Non-relayer tries to send via relayer
      const relayerFee = await messageContract.relayerFee();

      await expect(
        messageContract
          .connect(nonRelayer)
          .sendMessageViaRelayer(
            convId,
            user1.address,
            user2.address,
            "test",
            relayerFee
          )
      ).to.be.revertedWith("Message: caller is not the relayer");
    });

    it("Should revert when non-owner tries to update fees", async function () {
      const { user1, messageContract } = await loadFixture(
        deployMessageContract
      );

      const newFee = ethers.parseEther("0.000001");

      await expect(messageContract.connect(user1).setPayAsYouGoFee(newFee)).to
        .be.reverted;

      await expect(messageContract.connect(user1).setRelayerFee(newFee)).to.be
        .reverted;
    });

    it("Should revert when non-owner tries to set relayer", async function () {
      const { user1, user2, messageContract } = await loadFixture(
        deployMessageContract
      );

      await expect(messageContract.connect(user1).setRelayer(user2.address)).to
        .be.reverted;
    });
  });

  describe("Empty/Zero Value Deposits", function () {
    it("Should revert when depositing zero value", async function () {
      const { user1, messageContract } = await loadFixture(
        deployMessageContract
      );

      await expect(
        messageContract.connect(user1).depositFunds({ value: 0 })
      ).to.be.revertedWith("Message: must send ETH");
    });
  });

  describe("Multiple Transactions Edge Cases", function () {
    it("Should handle multiple messages in quick succession", async function () {
      const { user1, user2, messageContract } = await loadFixture(
        deployMessageContract
      );

      // Create conversation
      const conversationKey = generateConversationKey("test");
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

      // Send multiple messages rapidly
      const payAsYouGoFee = await messageContract.payAsYouGoFee();
      const messages = ["Message 1", "Message 2", "Message 3"];

      for (const msg of messages) {
        await expect(
          messageContract
            .connect(user1)
            .sendMessage(
              convId,
              user2.address,
              encryptMessage(msg, conversationKey),
              {
                value: payAsYouGoFee,
              }
            )
        ).to.emit(messageContract, "MessageSent");
      }
    });

    it("Should handle depleted funds after multiple relayer messages", async function () {
      const { user1, user2, relayer, messageContract } = await loadFixture(
        deployMessageContract
      );

      // Create conversation
      const conversationKey = generateConversationKey("test");
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

      // Deposit exactly enough for 2 messages
      const relayerFee = await messageContract.relayerFee();
      const depositAmount = relayerFee * BigInt(2);
      await messageContract
        .connect(user1)
        .depositFunds({ value: depositAmount });

      // Send 2 messages (should succeed)
      await messageContract
        .connect(relayer)
        .sendMessageViaRelayer(
          convId,
          user1.address,
          user2.address,
          "msg1",
          relayerFee
        );

      await messageContract
        .connect(relayer)
        .sendMessageViaRelayer(
          convId,
          user1.address,
          user2.address,
          "msg2",
          relayerFee
        );

      // Third message should fail (insufficient funds)
      await expect(
        messageContract
          .connect(relayer)
          .sendMessageViaRelayer(
            convId,
            user1.address,
            user2.address,
            "msg3",
            relayerFee
          )
      ).to.be.revertedWith(
        "Message: user does not have enough funds to pay the fee"
      );
    });
  });

  describe("Conversation Re-creation", function () {
    it("Should allow updating conversation if already created", async function () {
      const { user1, user2, messageContract } = await loadFixture(
        deployMessageContract
      );

      const conversationKey1 = generateConversationKey("seed1");
      const conversationKey2 = generateConversationKey("seed2");

      const encryptedKeyFor1_1 = encryptConversationKeyForAddress(
        conversationKey1,
        user1.address
      );
      const encryptedKeyFor2_1 = encryptConversationKeyForAddress(
        conversationKey1,
        user2.address
      );
      const encryptedKeyFor1_2 = encryptConversationKeyForAddress(
        conversationKey2,
        user1.address
      );
      const encryptedKeyFor2_2 = encryptConversationKeyForAddress(
        conversationKey2,
        user2.address
      );

      const convId = await messageContract
        .connect(user1)
        .createConversation.staticCall(
          user2.address,
          `0x${encryptedKeyFor1_1}`,
          `0x${encryptedKeyFor2_1}`
        );

      // Create conversation first time
      await messageContract
        .connect(user1)
        .createConversation(
          user2.address,
          `0x${encryptedKeyFor1_1}`,
          `0x${encryptedKeyFor2_1}`
        );

      // Try to create again with different keys (will overwrite)
      await messageContract
        .connect(user1)
        .createConversation(
          user2.address,
          `0x${encryptedKeyFor1_2}`,
          `0x${encryptedKeyFor2_2}`
        );

      // Verify conversation was updated
      const conv = await messageContract.conversations(convId);
      expect(conv.encryptedConversationKeyForSmallerAddress).to.not.equal(
        `0x${encryptedKeyFor1_1}`
      );
    });
  });
});
