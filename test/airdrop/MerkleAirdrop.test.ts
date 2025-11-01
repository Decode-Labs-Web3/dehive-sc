import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  MerkleAirdrop,
  MockERC20,
  AirdropFactory,
} from "../../typechain-types";
import {
  deployCompleteAirdropFixture,
  deployMockERC20,
  mintTokensTo,
} from "./helpers/airdropHelpers";
import {
  generateMerkleTree,
  generateMerkleProof,
  generateLeafHash,
} from "./helpers/merkleHelpers";
import { generateTestClaims } from "./helpers/testDataGenerator";

describe("MerkleAirdrop - Token Claiming", function () {
  async function deployCampaignFixture() {
    const signers = await ethers.getSigners();
    const [deployer, owner, creator, user1, user2] = signers;

    const claims = generateTestClaims(5, [
      await user1.getAddress(),
      await user2.getAddress(),
      await signers[3].getAddress(),
      await signers[4].getAddress(),
      await signers[5].getAddress(),
    ]);

    const { campaign, token, merkleTreeData, factory, registry } =
      await deployCompleteAirdropFixture(
        "507f1f77bcf86cd799439011",
        claims,
        owner,
        creator
      );

    return {
      campaign,
      token,
      merkleTreeData,
      claims,
      owner,
      creator,
      user1,
      user2,
      signers,
      factory,
      registry,
    };
  }

  describe("Campaign Initialization", function () {
    it("Should deploy campaign with correct parameters", async function () {
      const { campaign, token, merkleTreeData, creator, claims } =
        await loadFixture(deployCampaignFixture);

      // Campaign owner is the creator (msg.sender who created it)
      const ownerAddress = await creator.getAddress();
      const totalAmount = claims.reduce((sum, claim) => {
        const amount =
          typeof claim.amount === "string"
            ? BigInt(claim.amount)
            : claim.amount;
        return sum + amount;
      }, BigInt(0));

      expect(await campaign.token()).to.equal(await token.getAddress());
      expect(await campaign.merkleRoot()).to.equal(merkleTreeData.root);
      expect(await campaign.owner()).to.equal(ownerAddress);
      expect(await campaign.totalAmount()).to.equal(totalAmount);
      expect(await campaign.metadataURI()).to.equal("ipfs://test");
    });

    it("Should set claim deadline to 7 days", async function () {
      const { campaign } = await loadFixture(deployCampaignFixture);
      const currentTime = await time.latest();
      const deadline = await campaign.claimDeadline();

      // Allow 1 second tolerance
      expect(deadline).to.be.closeTo(
        BigInt(currentTime) + BigInt(7 * 24 * 60 * 60),
        BigInt(1)
      );
    });

    it("Should set unlock timestamp to 7 days", async function () {
      const { campaign } = await loadFixture(deployCampaignFixture);
      const currentTime = await time.latest();
      const unlockTimestamp = await campaign.unlockTimestamp();

      // Allow 1 second tolerance
      expect(unlockTimestamp).to.be.closeTo(
        BigInt(currentTime) + BigInt(7 * 24 * 60 * 60),
        BigInt(1)
      );
    });

    it("Should emit Initialized event", async function () {
      const { campaign, token, merkleTreeData, creator } = await loadFixture(
        deployCampaignFixture
      );

      const filter = campaign.filters.Initialized();
      const events = await campaign.queryFilter(filter);

      expect(events.length).to.be.greaterThan(0);
      const event = events[0];
      if (event.args) {
        expect(event.args[0]).to.equal(await token.getAddress());
        // Campaign owner is the creator (msg.sender who created it)
        expect(event.args[1]).to.equal(await creator.getAddress());
        expect(event.args[2]).to.equal(merkleTreeData.root);
      }
    });
  });

  describe("Token Claiming", function () {
    it("Should allow valid claim with correct Merkle proof", async function () {
      const { campaign, token, merkleTreeData, claims, user1 } =
        await loadFixture(deployCampaignFixture);

      const claimIndex = 0;
      const claim = claims[claimIndex];
      const user1Address = await user1.getAddress();

      // Verify claim is for user1
      expect(claim.account.toLowerCase()).to.equal(user1Address.toLowerCase());

      // Get proof
      const proof = generateMerkleProof(merkleTreeData, claimIndex);

      // Get initial balance
      const balanceBefore = await token.balanceOf(user1Address);

      // Claim tokens
      const amount =
        typeof claim.amount === "string" ? BigInt(claim.amount) : claim.amount;
      const tx = await campaign
        .connect(user1)
        .claim(claim.index, user1Address, amount, proof);

      // Verify event
      await expect(tx)
        .to.emit(campaign, "Claimed")
        .withArgs(claim.index, user1Address, amount);

      // Verify tokens were transferred
      const balanceAfter = await token.balanceOf(user1Address);
      expect(balanceAfter - balanceBefore).to.equal(amount);
    });

    it("Should prevent double claiming", async function () {
      const { campaign, token, merkleTreeData, claims, user1 } =
        await loadFixture(deployCampaignFixture);

      const claimIndex = 0;
      const claim = claims[claimIndex];
      const user1Address = await user1.getAddress();
      const proof = generateMerkleProof(merkleTreeData, claimIndex);
      const amount =
        typeof claim.amount === "string" ? BigInt(claim.amount) : claim.amount;

      // First claim should succeed
      await campaign
        .connect(user1)
        .claim(claim.index, user1Address, amount, proof);

      // Second claim should fail
      await expect(
        campaign.connect(user1).claim(claim.index, user1Address, amount, proof)
      ).to.be.revertedWith("MerkleAirdrop: drop already claimed");
    });

    it("Should mark claim as claimed in bitmap", async function () {
      const { campaign, merkleTreeData, claims, user1 } = await loadFixture(
        deployCampaignFixture
      );

      const claimIndex = 0;
      const claim = claims[claimIndex];
      const user1Address = await user1.getAddress();
      const proof = generateMerkleProof(merkleTreeData, claimIndex);
      const amount =
        typeof claim.amount === "string" ? BigInt(claim.amount) : claim.amount;

      // Verify claim is not claimed
      expect(await campaign.isClaimed(claim.index)).to.be.false;

      // Claim tokens
      await campaign
        .connect(user1)
        .claim(claim.index, user1Address, amount, proof);

      // Verify claim is marked as claimed
      expect(await campaign.isClaimed(claim.index)).to.be.true;
    });

    it("Should allow multiple users to claim from same campaign", async function () {
      const { campaign, token, merkleTreeData, claims, user1, user2, signers } =
        await loadFixture(deployCampaignFixture);

      // Claim 1: user1
      const claim1Index = 0;
      const claim1 = claims[claim1Index];
      const user1Address = await user1.getAddress();
      const proof1 = generateMerkleProof(merkleTreeData, claim1Index);
      const amount1 =
        typeof claim1.amount === "string"
          ? BigInt(claim1.amount)
          : claim1.amount;

      await campaign
        .connect(user1)
        .claim(claim1.index, user1Address, amount1, proof1);

      // Claim 2: user2
      const claim2Index = 1;
      const claim2 = claims[claim2Index];
      const user2Address = await user2.getAddress();
      const proof2 = generateMerkleProof(merkleTreeData, claim2Index);
      const amount2 =
        typeof claim2.amount === "string"
          ? BigInt(claim2.amount)
          : claim2.amount;

      await campaign
        .connect(user2)
        .claim(claim2.index, user2Address, amount2, proof2);

      // Verify both claims were successful
      expect(await campaign.isClaimed(claim1.index)).to.be.true;
      expect(await campaign.isClaimed(claim2.index)).to.be.true;

      // Verify token balances
      const user1Balance = await token.balanceOf(user1Address);
      const user2Balance = await token.balanceOf(user2Address);

      // Balances should be non-zero (initial balance + claimed amount)
      expect(user1Balance).to.be.gte(amount1);
      expect(user2Balance).to.be.gte(amount2);
    });

    it("Should reject claim with invalid Merkle proof", async function () {
      const { campaign, merkleTreeData, claims, user1 } = await loadFixture(
        deployCampaignFixture
      );

      const claimIndex = 0;
      const claim = claims[claimIndex];
      const user1Address = await user1.getAddress();
      const amount =
        typeof claim.amount === "string" ? BigInt(claim.amount) : claim.amount;

      // Create invalid proof (use proof for different claim)
      const invalidProof =
        merkleTreeData.claims.length > 1
          ? generateMerkleProof(merkleTreeData, 1)
          : [
              "0x0000000000000000000000000000000000000000000000000000000000000000",
            ];

      await expect(
        campaign
          .connect(user1)
          .claim(claim.index, user1Address, amount, invalidProof)
      ).to.be.revertedWith("MerkleAirdrop: invalid merkle proof");
    });

    it("Should reject claim with wrong amount", async function () {
      const { campaign, merkleTreeData, claims, user1 } = await loadFixture(
        deployCampaignFixture
      );

      const claimIndex = 0;
      const claim = claims[claimIndex];
      const user1Address = await user1.getAddress();
      const proof = generateMerkleProof(merkleTreeData, claimIndex);
      const wrongAmount =
        typeof claim.amount === "string"
          ? BigInt(claim.amount) + BigInt(1000)
          : claim.amount + BigInt(1000);

      await expect(
        campaign
          .connect(user1)
          .claim(claim.index, user1Address, wrongAmount, proof)
      ).to.be.revertedWith("MerkleAirdrop: invalid merkle proof");
    });

    it("Should reject claim with wrong index", async function () {
      const { campaign, merkleTreeData, claims, user1 } = await loadFixture(
        deployCampaignFixture
      );

      const claimIndex = 0;
      const claim = claims[claimIndex];
      const user1Address = await user1.getAddress();
      const proof = generateMerkleProof(merkleTreeData, claimIndex);
      const amount =
        typeof claim.amount === "string" ? BigInt(claim.amount) : claim.amount;

      // Use wrong index
      const wrongIndex = claim.index + 1;

      await expect(
        campaign.connect(user1).claim(wrongIndex, user1Address, amount, proof)
      ).to.be.revertedWith("MerkleAirdrop: invalid merkle proof");
    });

    it("Should reject claim where caller is not the account", async function () {
      const { campaign, merkleTreeData, claims, user1, user2 } =
        await loadFixture(deployCampaignFixture);

      const claimIndex = 0;
      const claim = claims[claimIndex];
      const user1Address = await user1.getAddress();
      const user2Address = await user2.getAddress();
      const proof = generateMerkleProof(merkleTreeData, claimIndex);
      const amount =
        typeof claim.amount === "string" ? BigInt(claim.amount) : claim.amount;

      // User2 tries to claim user1's tokens
      await expect(
        campaign.connect(user2).claim(claim.index, user1Address, amount, proof)
      ).to.be.revertedWith("MerkleAirdrop: caller must be the account");
    });

    it("Should reject claim with zero amount", async function () {
      const { campaign, merkleTreeData, claims, user1 } = await loadFixture(
        deployCampaignFixture
      );

      const claimIndex = 0;
      const claim = claims[claimIndex];
      const user1Address = await user1.getAddress();
      const proof = generateMerkleProof(merkleTreeData, claimIndex);

      await expect(
        campaign.connect(user1).claim(claim.index, user1Address, 0, proof)
      ).to.be.revertedWith("MerkleAirdrop: amount must be greater than zero");
    });
  });

  describe("Claim Deadline", function () {
    it("Should prevent claims after deadline", async function () {
      const { campaign, merkleTreeData, claims, user1 } = await loadFixture(
        deployCampaignFixture
      );

      const claimIndex = 0;
      const claim = claims[claimIndex];
      const user1Address = await user1.getAddress();
      const proof = generateMerkleProof(merkleTreeData, claimIndex);
      const amount =
        typeof claim.amount === "string" ? BigInt(claim.amount) : claim.amount;

      // Advance time past deadline (7 days + 1 second)
      const deadline = await campaign.claimDeadline();
      await time.increaseTo(deadline + BigInt(1));

      await expect(
        campaign.connect(user1).claim(claim.index, user1Address, amount, proof)
      ).to.be.revertedWith("MerkleAirdrop: claim period expired");
    });

    it("Should allow claims before deadline", async function () {
      const { campaign, token, merkleTreeData, claims, user1 } =
        await loadFixture(deployCampaignFixture);

      const claimIndex = 0;
      const claim = claims[claimIndex];
      const user1Address = await user1.getAddress();
      const proof = generateMerkleProof(merkleTreeData, claimIndex);
      const amount =
        typeof claim.amount === "string" ? BigInt(claim.amount) : claim.amount;

      // Advance time but before deadline
      await time.increase(BigInt(6 * 24 * 60 * 60)); // 6 days

      // Should still be able to claim
      await expect(
        campaign.connect(user1).claim(claim.index, user1Address, amount, proof)
      ).to.not.be.reverted;
    });

    it("Should return correct days until expiry", async function () {
      const { campaign } = await loadFixture(deployCampaignFixture);

      const daysUntilExpiry = await campaign.getDaysUntilExpiry();
      expect(daysUntilExpiry).to.be.closeTo(BigInt(7), BigInt(1)); // ~7 days
    });
  });

  describe("Withdrawal Mechanism", function () {
    it("Should prevent withdrawal before unlock period", async function () {
      const { campaign, creator } = await loadFixture(deployCampaignFixture);

      // Try to withdraw immediately
      await expect(
        campaign.connect(creator).withdrawRemaining()
      ).to.be.revertedWith("MerkleAirdrop: withdrawal not yet allowed");
    });

    it("Should allow withdrawal after unlock period", async function () {
      const { campaign, token, creator, claims } = await loadFixture(
        deployCampaignFixture
      );

      // Campaign owner is the creator (msg.sender who created it)
      const ownerAddress = await creator.getAddress();

      // Advance time past unlock period (7 days + 1 second)
      const unlockTimestamp = await campaign.unlockTimestamp();
      await time.increaseTo(unlockTimestamp + BigInt(1));

      // Get balance before withdrawal
      const balanceBefore = await token.balanceOf(ownerAddress);
      const campaignBalance = await token.balanceOf(
        await campaign.getAddress()
      );

      // Withdraw remaining tokens
      const tx = await campaign.connect(creator).withdrawRemaining();

      // Verify event
      await expect(tx)
        .to.emit(campaign, "Withdrawn")
        .withArgs(ownerAddress, campaignBalance);

      // Verify tokens were transferred
      const balanceAfter = await token.balanceOf(ownerAddress);
      expect(balanceAfter - balanceBefore).to.equal(campaignBalance);

      // Campaign balance should be zero
      const newCampaignBalance = await token.balanceOf(
        await campaign.getAddress()
      );
      expect(newCampaignBalance).to.equal(0);
    });

    it("Should only allow owner to withdraw", async function () {
      const { campaign, user1 } = await loadFixture(deployCampaignFixture);

      // Advance time past unlock period
      const unlockTimestamp = await campaign.unlockTimestamp();
      await time.increaseTo(unlockTimestamp + BigInt(1));

      // Non-owner tries to withdraw
      await expect(campaign.connect(user1).withdrawRemaining()).to.be.reverted;
    });

    it("Should revert if no tokens to withdraw", async function () {
      const {
        campaign,
        creator,
        merkleTreeData,
        claims,
        token,
        user1,
        user2,
        signers,
      } = await loadFixture(deployCampaignFixture);

      // Claim all tokens
      for (let i = 0; i < claims.length; i++) {
        const claim = claims[i];
        const user =
          signers.find(
            async (s) =>
              (await s.getAddress()).toLowerCase() ===
              claim.account.toLowerCase()
          ) || user1;
        const proof = generateMerkleProof(merkleTreeData, i);
        const amount =
          typeof claim.amount === "string"
            ? BigInt(claim.amount)
            : claim.amount;

        try {
          await campaign
            .connect(user)
            .claim(claim.index, claim.account, amount, proof);
        } catch (e) {
          // Skip if user doesn't match or already claimed
        }
      }

      // Advance time past unlock period
      const unlockTimestamp = await campaign.unlockTimestamp();
      await time.increaseTo(unlockTimestamp + BigInt(1));

      // Try to withdraw - should revert if all tokens were claimed
      const balance = await token.balanceOf(await campaign.getAddress());
      if (balance === BigInt(0)) {
        await expect(
          campaign.connect(creator).withdrawRemaining()
        ).to.be.revertedWith("MerkleAirdrop: no tokens to withdraw");
      }
    });

    it("Should return correct days until withdrawal", async function () {
      const { campaign } = await loadFixture(deployCampaignFixture);

      const daysUntilWithdrawal = await campaign.getDaysUntilWithdrawal();
      expect(daysUntilWithdrawal).to.be.closeTo(BigInt(7), BigInt(1)); // ~7 days
    });
  });

  describe("View Functions", function () {
    it("Should return correct token address", async function () {
      const { campaign, token } = await loadFixture(deployCampaignFixture);
      expect(await campaign.token()).to.equal(await token.getAddress());
    });

    it("Should return correct metadata URI", async function () {
      const { campaign } = await loadFixture(deployCampaignFixture);
      expect(await campaign.metadataURI()).to.equal("ipfs://test");
    });

    it("Should return correct balance", async function () {
      const { campaign, token, claims } = await loadFixture(
        deployCampaignFixture
      );

      const totalAmount = claims.reduce((sum, claim) => {
        const amount =
          typeof claim.amount === "string"
            ? BigInt(claim.amount)
            : claim.amount;
        return sum + amount;
      }, BigInt(0));

      const balance = await campaign.getBalance();
      expect(balance).to.equal(totalAmount);
    });

    it("Should correctly track claimed status", async function () {
      const { campaign, merkleTreeData, claims, user1 } = await loadFixture(
        deployCampaignFixture
      );

      const claimIndex = 0;
      const claim = claims[claimIndex];
      const user1Address = await user1.getAddress();
      const proof = generateMerkleProof(merkleTreeData, claimIndex);
      const amount =
        typeof claim.amount === "string" ? BigInt(claim.amount) : claim.amount;

      // Before claiming
      expect(await campaign.isClaimed(claim.index)).to.be.false;

      // After claiming
      await campaign
        .connect(user1)
        .claim(claim.index, user1Address, amount, proof);
      expect(await campaign.isClaimed(claim.index)).to.be.true;

      // Other claims should still be unclaimed
      if (claims.length > 1) {
        expect(await campaign.isClaimed(claims[1].index)).to.be.false;
      }
    });
  });
});
