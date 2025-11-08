import { expect } from "chai";
import { ethers } from "hardhat";
import { PaymentHub, Message, MockERC20 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("PaymentHub Integration with Message", function () {
  let paymentHub: PaymentHub;
  let message: Message;
  let mockToken: MockERC20;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy Message contract
    const MessageFactory = await ethers.getContractFactory("Message");
    message = await MessageFactory.deploy(owner.address);
    await message.waitForDeployment();

    // Deploy PaymentHub contract
    const PaymentHubFactory = await ethers.getContractFactory("PaymentHub");
    paymentHub = await PaymentHubFactory.deploy(owner.address);
    await paymentHub.waitForDeployment();

    // Deploy Mock ERC20
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20Factory.deploy(
      "Test Token",
      "TEST",
      18, // decimals
      ethers.parseEther("1000000")
    );
    await mockToken.waitForDeployment();

    // Distribute tokens
    await mockToken.transfer(user1.address, ethers.parseEther("1000"));
    await mockToken.transfer(user2.address, ethers.parseEther("1000"));
  });

  describe("ConversationId Consistency", function () {
    it("Should compute the same conversationId in both contracts", async function () {
      const messageConvId = await computeConversationIdHelper(
        user1.address,
        user2.address
      );
      const paymentConvId = await paymentHub.computeConversationId(
        user1.address,
        user2.address
      );

      expect(messageConvId).to.equal(paymentConvId);
    });

    it("Should use the same conversationId for messages and payments", async function () {
      // Generate test conversation key (mock encryption)
      const testKey = "0x" + "a".repeat(64);

      // Create conversation in Message contract
      const createConvTx = await message
        .connect(user1)
        .createConversation(user2.address, testKey, testKey);
      await createConvTx.wait();

      // Get conversationId from Message contract
      const messageConvId = await computeConversationIdHelper(
        user1.address,
        user2.address
      );

      // Send payment using the same conversationId in PaymentHub
      const amount = ethers.parseEther("1");
      await expect(
        paymentHub
          .connect(user1)
          .sendNative(
            messageConvId,
            user2.address,
            "QmTest123",
            ethers.id("test-content"),
            0,
            "msg-001",
            { value: amount }
          )
      )
        .to.emit(paymentHub, "PaymentSent")
        .withArgs(
          messageConvId,
          user1.address,
          user2.address,
          ethers.ZeroAddress,
          amount,
          0,
          "QmTest123",
          ethers.id("test-content"),
          0,
          "msg-001",
          await ethers.provider.getBlock("latest").then((b) => b!.timestamp + 1)
        );
    });
  });

  describe("Full Conversation Flow", function () {
    it("Should support creating conversation, sending messages, and sending payments", async function () {
      const testKey = "0x" + "a".repeat(64);

      // 1. Create conversation in Message contract
      await message
        .connect(user1)
        .createConversation(user2.address, testKey, testKey);

      const conversationId = await computeConversationIdHelper(
        user1.address,
        user2.address
      );

      // 2. Set relayer in Message contract
      await message.connect(owner).setRelayer(owner.address);

      // 3. Send message (pay-as-you-go)
      const messagePayAsYouGoFee = await message.payAsYouGoFee();
      await message
        .connect(user1)
        .sendMessage(conversationId, user2.address, "Hello!", {
          value: messagePayAsYouGoFee,
        });

      // 4. Send native payment
      const paymentAmount = ethers.parseEther("0.5");
      await paymentHub
        .connect(user1)
        .sendNative(
          conversationId,
          user2.address,
          "QmPayment1",
          ethers.id("payment-content-1"),
          0,
          "pay-001",
          { value: paymentAmount }
        );

      // 5. Send ERC-20 payment
      const tokenAmount = ethers.parseEther("10");
      await mockToken
        .connect(user1)
        .approve(await paymentHub.getAddress(), tokenAmount);

      await paymentHub
        .connect(user1)
        .sendERC20(
          conversationId,
          user2.address,
          await mockToken.getAddress(),
          tokenAmount,
          "QmPayment2",
          ethers.id("payment-content-2"),
          0,
          "pay-002"
        );

      // All operations should succeed with the same conversationId
    });
  });

  describe("Separate Fee Management", function () {
    it("Should maintain separate fee structures for messages and payments", async function () {
      // Set fees for Message contract
      const messageFee = ethers.parseEther("0.0003");
      await message.connect(owner).setPayAsYouGoFee(messageFee);

      // Set fees for PaymentHub
      const paymentFeePercent = 200; // 2%
      await paymentHub.connect(owner).setTransactionFee(paymentFeePercent);

      // Verify fees are independent
      expect(await message.payAsYouGoFee()).to.equal(messageFee);
      expect(await paymentHub.transactionFeePercent()).to.equal(
        paymentFeePercent
      );
    });
  });

  describe("Event Emission for The Graph", function () {
    it("Should emit both MessageSent and PaymentSent events for the same conversation", async function () {
      const testKey = "0x" + "a".repeat(64);

      // Create conversation
      await message
        .connect(user1)
        .createConversation(user2.address, testKey, testKey);

      const conversationId = await computeConversationIdHelper(
        user1.address,
        user2.address
      );

      const messagePayAsYouGoFee = await message.payAsYouGoFee();

      // Send message
      await expect(
        message
          .connect(user1)
          .sendMessage(conversationId, user2.address, "Hello with payment!", {
            value: messagePayAsYouGoFee,
          })
      )
        .to.emit(message, "MessageSent")
        .withArgs(
          conversationId,
          user1.address,
          user2.address,
          "Hello with payment!"
        );

      // Send payment
      const paymentAmount = ethers.parseEther("1");
      await expect(
        paymentHub
          .connect(user1)
          .sendNative(
            conversationId,
            user2.address,
            "QmPayment",
            ethers.id("payment-content"),
            0,
            "pay-001",
            { value: paymentAmount }
          )
      )
        .to.emit(paymentHub, "PaymentSent")
        .withArgs(
          conversationId,
          user1.address,
          user2.address,
          ethers.ZeroAddress,
          paymentAmount,
          0,
          "QmPayment",
          ethers.id("payment-content"),
          0,
          "pay-001",
          await ethers.provider.getBlock("latest").then((b) => b!.timestamp + 1)
        );

      // The Graph can now index both events using the same conversationId
    });
  });

  describe("Independent Contract Operation", function () {
    it("Should allow payments without creating a conversation first", async function () {
      // PaymentHub doesn't require a conversation to exist in Message contract
      const conversationId = await paymentHub.computeConversationId(
        user1.address,
        user2.address
      );

      const amount = ethers.parseEther("1");
      await expect(
        paymentHub
          .connect(user1)
          .sendNative(
            conversationId,
            user2.address,
            "QmTest",
            ethers.id("test-content"),
            0,
            "msg-001",
            { value: amount }
          )
      ).to.not.be.reverted;

      // Payment should succeed even without conversation in Message contract
    });

    it("Should allow message sending without requiring payments", async function () {
      const testKey = "0x" + "a".repeat(64);

      // Create conversation and send message without any payments
      await message
        .connect(user1)
        .createConversation(user2.address, testKey, testKey);

      const conversationId = await computeConversationIdHelper(
        user1.address,
        user2.address
      );

      const messagePayAsYouGoFee = await message.payAsYouGoFee();

      await expect(
        message
          .connect(user1)
          .sendMessage(conversationId, user2.address, "Message only", {
            value: messagePayAsYouGoFee,
          })
      ).to.not.be.reverted;

      // Message should succeed without any payments
    });
  });

  // Helper function to compute conversationId the same way as Message contract
  async function computeConversationIdHelper(
    address1: string,
    address2: string
  ): Promise<bigint> {
    const [smaller, larger] =
      address1.toLowerCase() < address2.toLowerCase()
        ? [address1, address2]
        : [address2, address1];

    return BigInt(
      ethers.keccak256(
        ethers.solidityPacked(["address", "address"], [smaller, larger])
      )
    );
  }
});
