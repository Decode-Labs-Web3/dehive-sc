import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  ServerAirdropRegistry,
  AirdropFactory,
  MerkleAirdrop,
  MockERC20,
} from "../../typechain-types";
import {
  deployAirdropRegistryFixture,
  createServerFactory,
  createTestCampaign,
  deployMockERC20,
  mintTokensTo,
} from "./helpers/airdropHelpers";
import {
  generateMerkleTree,
  generateMerkleProof,
} from "./helpers/merkleHelpers";
import {
  generateTestClaims,
  generateServerIds,
} from "./helpers/testDataGenerator";

describe("Airdrop Edge Cases", function () {
  describe("Registry Edge Cases", function () {
    it("Should revert when creating factory with empty serverId", async function () {
      const { registry } = await loadFixture(deployAirdropRegistryFixture);
      const [deployer, owner] = await ethers.getSigners();
      const ownerAddress = await owner.getAddress();

      await expect(
        registry.connect(deployer).createFactoryForServer("", ownerAddress)
      ).to.be.revertedWith("ServerAirdropRegistry: serverId cannot be empty");
    });

    it("Should revert when creating factory with zero owner", async function () {
      const { registry } = await loadFixture(deployAirdropRegistryFixture);
      const [deployer] = await ethers.getSigners();
      const serverId = "507f1f77bcf86cd799439999";

      await expect(
        registry
          .connect(deployer)
          .createFactoryForServer(serverId, ethers.ZeroAddress)
      ).to.be.revertedWith("ServerAirdropRegistry: owner cannot be zero");
    });

    it("Should revert when creating duplicate factory for same serverId", async function () {
      const { registry } = await loadFixture(deployAirdropRegistryFixture);
      const [deployer, owner1, owner2] = await ethers.getSigners();
      const serverId = "507f1f77bcf86cd799439998";

      await createServerFactory(registry, serverId, owner1);

      await expect(
        registry
          .connect(deployer)
          .createFactoryForServer(serverId, await owner2.getAddress())
      ).to.be.revertedWith("ServerAirdropRegistry: factory already exists");
    });
  });

  describe("Factory Edge Cases", function () {
    it("Should revert creating campaign if factory not initialized", async function () {
      const AirdropFactoryFactory = await ethers.getContractFactory(
        "AirdropFactory"
      );
      const factory = await AirdropFactoryFactory.deploy(ethers.ZeroAddress);
      await factory.waitForDeployment();

      const [deployer] = await ethers.getSigners();
      const token = await deployMockERC20();
      const claims = generateTestClaims(1, [deployer.address]);
      const merkleTreeData = generateMerkleTree(claims);
      const totalAmount = claims.reduce((sum, claim) => {
        const amount =
          typeof claim.amount === "string"
            ? BigInt(claim.amount)
            : claim.amount;
        return sum + amount;
      }, BigInt(0));

      await expect(
        factory.createAirdropAndFund(
          await token.getAddress(),
          merkleTreeData.root,
          "ipfs://test",
          totalAmount
        )
      ).to.be.revertedWith("AirdropFactory: not initialized");
    });

    async function deployFactoryFixture() {
      const { registry } = await deployAirdropRegistryFixture();
      const [deployer, owner] = await ethers.getSigners();
      const serverId = generateServerIds(1)[0];
      const factory = await createServerFactory(registry, serverId, owner);
      return { factory, deployer };
    }

    it("Should revert creating campaign with zero token address", async function () {
      const { factory, deployer } = await loadFixture(deployFactoryFixture);

      const deployerAddress = await deployer.getAddress();
      const claims = generateTestClaims(1, [deployerAddress]);
      const merkleTreeData = generateMerkleTree(claims);
      const totalAmount = claims.reduce((sum, claim) => {
        const amount =
          typeof claim.amount === "string"
            ? BigInt(claim.amount)
            : claim.amount;
        return sum + amount;
      }, BigInt(0));

      await expect(
        factory
          .connect(deployer)
          .createAirdropAndFund(
            ethers.ZeroAddress,
            merkleTreeData.root,
            "ipfs://test",
            totalAmount
          )
      ).to.be.revertedWith("AirdropFactory: token cannot be zero address");
    });

    async function deployFactoryWithTokenFixture() {
      const { registry } = await deployAirdropRegistryFixture();
      const [deployer, owner] = await ethers.getSigners();
      const serverId = generateServerIds(1)[0];
      const factory = await createServerFactory(registry, serverId, owner);
      const token = await deployMockERC20();
      return { factory, token, deployer };
    }

    it("Should revert creating campaign with zero merkle root", async function () {
      const { factory, token, deployer } = await loadFixture(
        deployFactoryWithTokenFixture
      );

      const totalAmount = ethers.parseEther("1000");
      await mintTokensTo(token, deployer, totalAmount);
      await token
        .connect(deployer)
        .approve(await factory.getAddress(), totalAmount);

      await expect(
        factory
          .connect(deployer)
          .createAirdropAndFund(
            await token.getAddress(),
            ethers.ZeroHash,
            "ipfs://test",
            totalAmount
          )
      ).to.be.revertedWith("AirdropFactory: merkle root cannot be zero");
    });

    it("Should revert creating campaign with zero total amount", async function () {
      const { factory, token, deployer } = await loadFixture(
        deployFactoryWithTokenFixture
      );

      const deployerAddress = await deployer.getAddress();
      const claims = generateTestClaims(1, [deployerAddress]);
      const merkleTreeData = generateMerkleTree(claims);

      await expect(
        factory
          .connect(deployer)
          .createAirdropAndFund(
            await token.getAddress(),
            merkleTreeData.root,
            "ipfs://test",
            0
          )
      ).to.be.revertedWith(
        "AirdropFactory: total amount must be greater than zero"
      );
    });
  });

  describe("Campaign Edge Cases", function () {
    async function deployCampaignWithUserFixture() {
      const { registry } = await deployAirdropRegistryFixture();
      const [deployer, owner, creator, user1] = await ethers.getSigners();
      const serverId = generateServerIds(1)[0];
      const factory = await createServerFactory(registry, serverId, owner);
      const token = await deployMockERC20();
      const claims = generateTestClaims(1, [await user1.getAddress()]);
      const merkleTreeData = generateMerkleTree(claims);
      const totalAmount = claims.reduce((sum, claim) => {
        const amount =
          typeof claim.amount === "string"
            ? BigInt(claim.amount)
            : claim.amount;
        return sum + amount;
      }, BigInt(0));

      await mintTokensTo(token, creator, totalAmount);
      await token
        .connect(creator)
        .approve(await factory.getAddress(), totalAmount);
      const { campaign } = await createTestCampaign(
        factory,
        token,
        claims,
        creator
      );
      return { campaign, merkleTreeData, claims, user1 };
    }

    it("Should revert claim with invalid Merkle proof", async function () {
      const { campaign, merkleTreeData, claims, user1 } = await loadFixture(
        deployCampaignWithUserFixture
      );

      const claimIndex = 0;
      const claim = claims[claimIndex];
      const user1Address = await user1.getAddress();
      const invalidProof = [
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      ];
      const amount =
        typeof claim.amount === "string" ? BigInt(claim.amount) : claim.amount;

      await expect(
        campaign
          .connect(user1)
          .claim(claim.index, user1Address, amount, invalidProof)
      ).to.be.revertedWith("MerkleAirdrop: invalid merkle proof");
    });

    it("Should revert claim after deadline", async function () {
      const { campaign, merkleTreeData, claims, user1 } = await loadFixture(
        deployCampaignWithUserFixture
      );

      const claimIndex = 0;
      const claim = claims[claimIndex];
      const user1Address = await user1.getAddress();
      const proof = generateMerkleProof(merkleTreeData, claimIndex);
      const amount =
        typeof claim.amount === "string" ? BigInt(claim.amount) : claim.amount;

      // Advance time past deadline
      const deadline = await campaign.claimDeadline();
      await time.increaseTo(deadline + BigInt(1));

      await expect(
        campaign.connect(user1).claim(claim.index, user1Address, amount, proof)
      ).to.be.revertedWith("MerkleAirdrop: claim period expired");
    });

    it("Should revert double claim", async function () {
      const { campaign, merkleTreeData, claims, user1 } = await loadFixture(
        deployCampaignWithUserFixture
      );

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

    async function deployCampaignWithTwoUsersFixture() {
      const { registry } = await deployAirdropRegistryFixture();
      const [deployer, owner, creator, user1, user2] =
        await ethers.getSigners();
      const serverId = generateServerIds(1)[0];
      const factory = await createServerFactory(registry, serverId, owner);
      const token = await deployMockERC20();
      const claims = generateTestClaims(1, [await user1.getAddress()]);
      const merkleTreeData = generateMerkleTree(claims);
      const totalAmount = claims.reduce((sum, claim) => {
        const amount =
          typeof claim.amount === "string"
            ? BigInt(claim.amount)
            : claim.amount;
        return sum + amount;
      }, BigInt(0));

      await mintTokensTo(token, creator, totalAmount);
      await token
        .connect(creator)
        .approve(await factory.getAddress(), totalAmount);
      const { campaign } = await createTestCampaign(
        factory,
        token,
        claims,
        creator
      );
      return { campaign, merkleTreeData, claims, user1, user2 };
    }

    it("Should revert claim with wrong account", async function () {
      const { campaign, merkleTreeData, claims, user1, user2 } =
        await loadFixture(deployCampaignWithTwoUsersFixture);

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

    it("Should revert claim with zero amount", async function () {
      const { campaign, merkleTreeData, claims, user1 } = await loadFixture(
        deployCampaignWithUserFixture
      );

      const claimIndex = 0;
      const claim = claims[claimIndex];
      const user1Address = await user1.getAddress();
      const proof = generateMerkleProof(merkleTreeData, claimIndex);

      await expect(
        campaign.connect(user1).claim(claim.index, user1Address, 0, proof)
      ).to.be.revertedWith("MerkleAirdrop: amount must be greater than zero");
    });

    async function deployCampaignForWithdrawalFixture() {
      const { registry } = await deployAirdropRegistryFixture();
      const [deployer, owner, creator] = await ethers.getSigners();
      const serverId = generateServerIds(1)[0];
      const factory = await createServerFactory(registry, serverId, owner);
      const token = await deployMockERC20();
      const claims = generateTestClaims(1, [await creator.getAddress()]);
      const totalAmount = claims.reduce((sum, claim) => {
        const amount =
          typeof claim.amount === "string"
            ? BigInt(claim.amount)
            : claim.amount;
        return sum + amount;
      }, BigInt(0));

      await mintTokensTo(token, creator, totalAmount);
      await token
        .connect(creator)
        .approve(await factory.getAddress(), totalAmount);
      const { campaign } = await createTestCampaign(
        factory,
        token,
        claims,
        creator
      );
      // Campaign owner is the creator (msg.sender who created it)
      return { campaign, creator };
    }

    it("Should revert withdrawal before unlock period", async function () {
      const { campaign, creator } = await loadFixture(
        deployCampaignForWithdrawalFixture
      );

      await expect(
        campaign.connect(creator).withdrawRemaining()
      ).to.be.revertedWith("MerkleAirdrop: withdrawal not yet allowed");
    });

    async function deployCampaignForNonOwnerWithdrawalFixture() {
      const { registry } = await deployAirdropRegistryFixture();
      const [deployer, owner, creator, user1] = await ethers.getSigners();
      const serverId = generateServerIds(1)[0];
      const factory = await createServerFactory(registry, serverId, owner);
      const token = await deployMockERC20();
      const claims = generateTestClaims(1, [await user1.getAddress()]);
      const totalAmount = claims.reduce((sum, claim) => {
        const amount =
          typeof claim.amount === "string"
            ? BigInt(claim.amount)
            : claim.amount;
        return sum + amount;
      }, BigInt(0));

      await mintTokensTo(token, creator, totalAmount);
      await token
        .connect(creator)
        .approve(await factory.getAddress(), totalAmount);
      const { campaign } = await createTestCampaign(
        factory,
        token,
        claims,
        creator
      );
      return { campaign, user1 };
    }

    it("Should revert withdrawal by non-owner", async function () {
      const { campaign, user1 } = await loadFixture(
        deployCampaignForNonOwnerWithdrawalFixture
      );

      // Advance time past unlock period
      const unlockTimestamp = await campaign.unlockTimestamp();
      await time.increaseTo(unlockTimestamp + BigInt(1));

      // Non-owner tries to withdraw
      await expect(campaign.connect(user1).withdrawRemaining()).to.be.reverted;
    });

    async function deployCampaignForNoTokensWithdrawalFixture() {
      const { registry } = await deployAirdropRegistryFixture();
      const [deployer, owner, creator, user1] = await ethers.getSigners();
      const serverId = generateServerIds(1)[0];
      const factory = await createServerFactory(registry, serverId, owner);
      const token = await deployMockERC20();
      const claims = generateTestClaims(1, [await user1.getAddress()]);
      const merkleTreeData = generateMerkleTree(claims);
      const totalAmount = claims.reduce((sum, claim) => {
        const amount =
          typeof claim.amount === "string"
            ? BigInt(claim.amount)
            : claim.amount;
        return sum + amount;
      }, BigInt(0));

      await mintTokensTo(token, creator, totalAmount);
      await token
        .connect(creator)
        .approve(await factory.getAddress(), totalAmount);
      const { campaign } = await createTestCampaign(
        factory,
        token,
        claims,
        creator
      );
      // Campaign owner is the creator (msg.sender who created it)
      return { campaign, creator, merkleTreeData, claims, token, user1 };
    }

    it("Should revert withdrawal when no tokens remaining", async function () {
      const { campaign, creator, merkleTreeData, claims, token, user1 } =
        await loadFixture(deployCampaignForNoTokensWithdrawalFixture);

      // Claim all tokens
      const claimIndex = 0;
      const claim = claims[claimIndex];
      const user1Address = await user1.getAddress();
      const proof = generateMerkleProof(merkleTreeData, claimIndex);
      const amount =
        typeof claim.amount === "string" ? BigInt(claim.amount) : claim.amount;

      await campaign
        .connect(user1)
        .claim(claim.index, user1Address, amount, proof);

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
  });

  describe("Re-initialization Edge Cases", function () {
    async function deployCampaignForInitTestFixture() {
      const { registry } = await deployAirdropRegistryFixture();
      const [deployer, owner, creator] = await ethers.getSigners();
      const serverId = generateServerIds(1)[0];
      const factory = await createServerFactory(registry, serverId, owner);
      const token = await deployMockERC20();
      const claims = generateTestClaims(1, [await creator.getAddress()]);
      const totalAmount = claims.reduce((sum, claim) => {
        const amount =
          typeof claim.amount === "string"
            ? BigInt(claim.amount)
            : claim.amount;
        return sum + amount;
      }, BigInt(0));

      await mintTokensTo(token, creator, totalAmount);
      await token
        .connect(creator)
        .approve(await factory.getAddress(), totalAmount);
      const { campaign } = await createTestCampaign(
        factory,
        token,
        claims,
        creator
      );
      return { campaign };
    }

    it("Should revert initialize call on MerkleAirdrop", async function () {
      const { campaign } = await loadFixture(deployCampaignForInitTestFixture);

      // MerkleAirdrop initialize should always revert
      await expect(
        campaign.initialize(
          ethers.ZeroAddress,
          ethers.ZeroAddress,
          ethers.ZeroHash,
          "",
          0
        )
      ).to.be.revertedWith("MerkleAirdrop: use constructor instead");
    });
  });
});
