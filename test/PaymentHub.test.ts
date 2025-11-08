import { expect } from "chai";
import { ethers } from "hardhat";
import { PaymentHub, MockERC20 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("PaymentHub - Standalone Mode", function () {
  let paymentHub: PaymentHub;
  let mockToken: MockERC20;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();

    // Deploy PaymentHub
    const PaymentHubFactory = await ethers.getContractFactory("PaymentHub");
    paymentHub = await PaymentHubFactory.deploy(owner.address);
    await paymentHub.waitForDeployment();

    // Deploy Mock ERC20 for testing
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20Factory.deploy(
      "Test Token",
      "TEST",
      ethers.parseEther("1000000")
    );
    await mockToken.waitForDeployment();

    // Distribute tokens to users
    await mockToken.transfer(user1.address, ethers.parseEther("1000"));
    await mockToken.transfer(user2.address, ethers.parseEther("1000"));
  });

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      expect(await paymentHub.owner()).to.equal(owner.address);
    });

    it("Should initialize with zero transaction fee", async function () {
      expect(await paymentHub.transactionFeePercent()).to.equal(0);
    });

    it("Should have zero accumulated fees initially", async function () {
      expect(await paymentHub.accumulatedFees(ethers.ZeroAddress)).to.equal(0);
      expect(
        await paymentHub.accumulatedFees(await mockToken.getAddress())
      ).to.equal(0);
    });
  });

  describe("ConversationId Computation", function () {
    it("Should compute the same conversationId for any order of addresses", async function () {
      const convId1 = await paymentHub.computeConversationId(
        user1.address,
        user2.address
      );
      const convId2 = await paymentHub.computeConversationId(
        user2.address,
        user1.address
      );
      expect(convId1).to.equal(convId2);
    });

    it("Should compute different conversationIds for different address pairs", async function () {
      const convId1 = await paymentHub.computeConversationId(
        user1.address,
        user2.address
      );
      const convId2 = await paymentHub.computeConversationId(
        user1.address,
        user3.address
      );
      expect(convId1).to.not.equal(convId2);
    });
  });

  describe("Native Token Payments", function () {
    it("Should send native tokens successfully", async function () {
      const amount = ethers.parseEther("1");
      const conversationId = await paymentHub.computeConversationId(
        user1.address,
        user2.address
      );

      const user2BalanceBefore = await ethers.provider.getBalance(
        user2.address
      );

      await expect(
        paymentHub
          .connect(user1)
          .sendNative(
            conversationId,
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
          conversationId,
          user1.address,
          user2.address,
          ethers.ZeroAddress,
          amount,
          0, // No fee
          "QmTest123",
          ethers.id("test-content"),
          0,
          "msg-001",
          await ethers.provider.getBlock("latest").then((b) => b!.timestamp + 1)
        );

      const user2BalanceAfter = await ethers.provider.getBalance(user2.address);
      expect(user2BalanceAfter - user2BalanceBefore).to.equal(amount);
    });

    it("Should revert if recipient is zero address", async function () {
      const conversationId = 123n;
      await expect(
        paymentHub
          .connect(user1)
          .sendNative(
            conversationId,
            ethers.ZeroAddress,
            "QmTest123",
            ethers.id("test-content"),
            0,
            "msg-001",
            { value: ethers.parseEther("1") }
          )
      ).to.be.revertedWith("PaymentHub: recipient cannot be zero address");
    });

    it("Should revert if amount is zero", async function () {
      const conversationId = 123n;
      await expect(
        paymentHub
          .connect(user1)
          .sendNative(
            conversationId,
            user2.address,
            "QmTest123",
            ethers.id("test-content"),
            0,
            "msg-001",
            { value: 0 }
          )
      ).to.be.revertedWith("PaymentHub: amount must be greater than 0");
    });

    it("Should apply transaction fee when set", async function () {
      // Set 1% fee (100 basis points)
      await paymentHub.connect(owner).setTransactionFee(100);

      const amount = ethers.parseEther("1");
      const expectedFee = amount / 100n; // 1%
      const expectedToRecipient = amount - expectedFee;

      const conversationId = await paymentHub.computeConversationId(
        user1.address,
        user2.address
      );

      const user2BalanceBefore = await ethers.provider.getBalance(
        user2.address
      );

      await paymentHub
        .connect(user1)
        .sendNative(
          conversationId,
          user2.address,
          "QmTest123",
          ethers.id("test-content"),
          0,
          "msg-001",
          { value: amount }
        );

      const user2BalanceAfter = await ethers.provider.getBalance(user2.address);
      expect(user2BalanceAfter - user2BalanceBefore).to.equal(
        expectedToRecipient
      );

      // Check accumulated fees
      expect(await paymentHub.accumulatedFees(ethers.ZeroAddress)).to.equal(
        expectedFee
      );
    });
  });

  describe("ERC-20 Token Payments", function () {
    it("Should send ERC-20 tokens successfully", async function () {
      const amount = ethers.parseEther("10");
      const conversationId = await paymentHub.computeConversationId(
        user1.address,
        user2.address
      );

      // Approve tokens
      await mockToken
        .connect(user1)
        .approve(await paymentHub.getAddress(), amount);

      const user2BalanceBefore = await mockToken.balanceOf(user2.address);

      await expect(
        paymentHub
          .connect(user1)
          .sendERC20(
            conversationId,
            user2.address,
            await mockToken.getAddress(),
            amount,
            "QmTest123",
            ethers.id("test-content"),
            0,
            "msg-001"
          )
      )
        .to.emit(paymentHub, "PaymentSent")
        .withArgs(
          conversationId,
          user1.address,
          user2.address,
          await mockToken.getAddress(),
          amount,
          0, // No fee
          "QmTest123",
          ethers.id("test-content"),
          0,
          "msg-001",
          await ethers.provider.getBlock("latest").then((b) => b!.timestamp + 1)
        );

      const user2BalanceAfter = await mockToken.balanceOf(user2.address);
      expect(user2BalanceAfter - user2BalanceBefore).to.equal(amount);
    });

    it("Should revert if recipient is zero address", async function () {
      const amount = ethers.parseEther("10");
      const conversationId = 123n;

      await mockToken
        .connect(user1)
        .approve(await paymentHub.getAddress(), amount);

      await expect(
        paymentHub
          .connect(user1)
          .sendERC20(
            conversationId,
            ethers.ZeroAddress,
            await mockToken.getAddress(),
            amount,
            "QmTest123",
            ethers.id("test-content"),
            0,
            "msg-001"
          )
      ).to.be.revertedWith("PaymentHub: recipient cannot be zero address");
    });

    it("Should revert if token is zero address", async function () {
      const amount = ethers.parseEther("10");
      const conversationId = 123n;

      await expect(
        paymentHub
          .connect(user1)
          .sendERC20(
            conversationId,
            user2.address,
            ethers.ZeroAddress,
            amount,
            "QmTest123",
            ethers.id("test-content"),
            0,
            "msg-001"
          )
      ).to.be.revertedWith("PaymentHub: token cannot be zero address");
    });

    it("Should revert if amount is zero", async function () {
      const conversationId = 123n;

      await expect(
        paymentHub
          .connect(user1)
          .sendERC20(
            conversationId,
            user2.address,
            await mockToken.getAddress(),
            0,
            "QmTest123",
            ethers.id("test-content"),
            0,
            "msg-001"
          )
      ).to.be.revertedWith("PaymentHub: amount must be greater than 0");
    });

    it("Should apply transaction fee when set", async function () {
      // Set 2% fee (200 basis points)
      await paymentHub.connect(owner).setTransactionFee(200);

      const amount = ethers.parseEther("100");
      const expectedFee = amount / 50n; // 2%
      const expectedToRecipient = amount - expectedFee;

      const conversationId = await paymentHub.computeConversationId(
        user1.address,
        user2.address
      );

      // Approve tokens
      await mockToken
        .connect(user1)
        .approve(await paymentHub.getAddress(), amount);

      const user2BalanceBefore = await mockToken.balanceOf(user2.address);

      await paymentHub
        .connect(user1)
        .sendERC20(
          conversationId,
          user2.address,
          await mockToken.getAddress(),
          amount,
          "QmTest123",
          ethers.id("test-content"),
          0,
          "msg-001"
        );

      const user2BalanceAfter = await mockToken.balanceOf(user2.address);
      expect(user2BalanceAfter - user2BalanceBefore).to.equal(
        expectedToRecipient
      );

      // Check accumulated fees
      const tokenAddress = await mockToken.getAddress();
      expect(await paymentHub.accumulatedFees(tokenAddress)).to.equal(
        expectedFee
      );
    });
  });

  describe("Owner Functions", function () {
    describe("setTransactionFee", function () {
      it("Should allow owner to set transaction fee", async function () {
        await expect(paymentHub.connect(owner).setTransactionFee(500))
          .to.emit(paymentHub, "TransactionFeeSet")
          .withArgs(
            500,
            await ethers.provider
              .getBlock("latest")
              .then((b) => b!.timestamp + 1)
          );

        expect(await paymentHub.transactionFeePercent()).to.equal(500);
      });

      it("Should revert if non-owner tries to set fee", async function () {
        await expect(
          paymentHub.connect(user1).setTransactionFee(500)
        ).to.be.revertedWith("PaymentHub: caller is not the owner");
      });

      it("Should revert if fee exceeds maximum (10%)", async function () {
        await expect(
          paymentHub.connect(owner).setTransactionFee(1001)
        ).to.be.revertedWith("PaymentHub: fee cannot exceed 10%");
      });

      it("Should allow setting fee to maximum (1000 basis points = 10%)", async function () {
        await paymentHub.connect(owner).setTransactionFee(1000);
        expect(await paymentHub.transactionFeePercent()).to.equal(1000);
      });

      it("Should allow setting fee to zero", async function () {
        await paymentHub.connect(owner).setTransactionFee(100);
        await paymentHub.connect(owner).setTransactionFee(0);
        expect(await paymentHub.transactionFeePercent()).to.equal(0);
      });
    });

    describe("withdrawFees", function () {
      it("Should allow owner to withdraw native token fees", async function () {
        // Set 1% fee
        await paymentHub.connect(owner).setTransactionFee(100);

        // Send payment to accumulate fees
        const amount = ethers.parseEther("10");
        const conversationId = await paymentHub.computeConversationId(
          user1.address,
          user2.address
        );

        await paymentHub
          .connect(user1)
          .sendNative(
            conversationId,
            user2.address,
            "QmTest123",
            ethers.id("test-content"),
            0,
            "msg-001",
            { value: amount }
          );

        const expectedFee = amount / 100n; // 1%
        const ownerBalanceBefore = await ethers.provider.getBalance(
          owner.address
        );

        const tx = await paymentHub
          .connect(owner)
          .withdrawFees(ethers.ZeroAddress);
        const receipt = await tx.wait();
        const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

        const ownerBalanceAfter = await ethers.provider.getBalance(
          owner.address
        );
        expect(ownerBalanceAfter - ownerBalanceBefore + gasUsed).to.equal(
          expectedFee
        );

        // Check fees are reset
        expect(await paymentHub.accumulatedFees(ethers.ZeroAddress)).to.equal(
          0
        );
      });

      it("Should allow owner to withdraw ERC-20 token fees", async function () {
        // Set 5% fee
        await paymentHub.connect(owner).setTransactionFee(500);

        // Send payment to accumulate fees
        const amount = ethers.parseEther("100");
        const conversationId = await paymentHub.computeConversationId(
          user1.address,
          user2.address
        );

        await mockToken
          .connect(user1)
          .approve(await paymentHub.getAddress(), amount);

        await paymentHub
          .connect(user1)
          .sendERC20(
            conversationId,
            user2.address,
            await mockToken.getAddress(),
            amount,
            "QmTest123",
            ethers.id("test-content"),
            0,
            "msg-001"
          );

        const expectedFee = amount / 20n; // 5%
        const ownerBalanceBefore = await mockToken.balanceOf(owner.address);

        await expect(
          paymentHub.connect(owner).withdrawFees(await mockToken.getAddress())
        )
          .to.emit(paymentHub, "FeesWithdrawn")
          .withArgs(
            await mockToken.getAddress(),
            expectedFee,
            owner.address,
            await ethers.provider
              .getBlock("latest")
              .then((b) => b!.timestamp + 1)
          );

        const ownerBalanceAfter = await mockToken.balanceOf(owner.address);
        expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(expectedFee);

        // Check fees are reset
        const tokenAddress = await mockToken.getAddress();
        expect(await paymentHub.accumulatedFees(tokenAddress)).to.equal(0);
      });

      it("Should revert if non-owner tries to withdraw fees", async function () {
        await expect(
          paymentHub.connect(user1).withdrawFees(ethers.ZeroAddress)
        ).to.be.revertedWith("PaymentHub: caller is not the owner");
      });

      it("Should revert if there are no fees to withdraw", async function () {
        await expect(
          paymentHub.connect(owner).withdrawFees(ethers.ZeroAddress)
        ).to.be.revertedWith("PaymentHub: no fees to withdraw");
      });
    });
  });

  describe("Edge Cases", function () {
    it("Should handle multiple payments in the same conversation", async function () {
      const conversationId = await paymentHub.computeConversationId(
        user1.address,
        user2.address
      );

      // Send 3 payments
      for (let i = 0; i < 3; i++) {
        await paymentHub
          .connect(user1)
          .sendNative(
            conversationId,
            user2.address,
            `QmTest${i}`,
            ethers.id(`test-content-${i}`),
            0,
            `msg-00${i}`,
            { value: ethers.parseEther("0.1") }
          );
      }

      // All should succeed
    });

    it("Should handle payments with different modes (public/secret)", async function () {
      const conversationId = await paymentHub.computeConversationId(
        user1.address,
        user2.address
      );

      // Public mode (0)
      await paymentHub.connect(user1).sendNative(
        conversationId,
        user2.address,
        "QmPublic",
        ethers.id("public-content"),
        0, // Public
        "msg-001",
        { value: ethers.parseEther("0.1") }
      );

      // Secret mode (1)
      await paymentHub.connect(user1).sendNative(
        conversationId,
        user2.address,
        "QmSecret",
        ethers.id("secret-content"),
        1, // Secret
        "msg-002",
        { value: ethers.parseEther("0.1") }
      );

      // Both should succeed
    });
  });
});
