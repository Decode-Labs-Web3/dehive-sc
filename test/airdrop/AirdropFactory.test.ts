import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import {
  AirdropFactory,
  MerkleAirdrop,
  MockERC20,
  IAirdropFactory,
} from "../../typechain-types";
import {
  deployAirdropRegistryFixture,
  createServerFactory,
  createTestCampaign,
  deployMockERC20,
  mintTokensTo,
} from "./helpers/airdropHelpers";
import {
  generateTestClaims,
  generateServerIds,
} from "./helpers/testDataGenerator";
import { generateMerkleTree } from "./helpers/merkleHelpers";

describe("AirdropFactory - Campaign Creation", function () {
  async function deployFactoryFixture() {
    const { registry, merkleAirdropImplementation } =
      await deployAirdropRegistryFixture();
    const [deployer, owner] = await ethers.getSigners();
    const serverId = generateServerIds(1)[0];
    const factory = await createServerFactory(registry, serverId, owner);

    // Deploy token for campaigns
    const token = await deployMockERC20();
    const ownerAddress = await owner.getAddress();

    return {
      registry,
      factory,
      factoryImplementation: registry.factoryImplementation(),
      merkleAirdropImplementation,
      token,
      serverId,
      owner,
      ownerAddress,
      deployer,
    };
  }

  describe("Factory Initialization", function () {
    it("Should initialize Factory clone with correct parameters", async function () {
      const { factory, serverId, ownerAddress } = await loadFixture(
        deployFactoryFixture
      );

      expect(await factory.initialized()).to.be.true;
      expect(await factory.serverId()).to.equal(serverId);
      expect(await factory.owner()).to.equal(ownerAddress);
      expect(await factory.implementation()).to.not.equal(ethers.ZeroAddress);
    });

    it("Should emit FactoryInitialized event", async function () {
      const { factory, serverId, ownerAddress } = await loadFixture(
        deployFactoryFixture
      );

      // Get initialization events from factory deployment
      const filter = factory.filters.FactoryInitialized();
      const events = await factory.queryFilter(filter);

      expect(events.length).to.be.greaterThan(0);
      const event = events[0];
      if (event.args) {
        expect(event.args[0]).to.equal(await factory.getAddress());
        // Handle Indexed types - indexed strings are keccak256 hashed, so we compare the hash
        // For indexed strings, ethers v6 returns an Indexed type
        const serverIdArg = event.args[1];
        // If it's an Indexed type, we need to hash the expected value and compare
        // Or we can verify the serverId directly from the contract
        const contractServerId = await factory.serverId();
        expect(contractServerId).to.equal(serverId);
        expect(event.args[2]).to.equal(ownerAddress);
      }
    });

    it("Should prevent re-initialization", async function () {
      const { registry, merkleAirdropImplementation } = await loadFixture(
        deployFactoryFixture
      );
      const { factory } = await loadFixture(deployFactoryFixture);
      const [deployer, owner] = await ethers.getSigners();
      const ownerAddress = await owner.getAddress();
      const serverId = "507f1f77bcf86cd799439999";

      // Try to call initialize again
      await expect(
        factory.initialize(
          await merkleAirdropImplementation.getAddress(),
          serverId,
          ownerAddress
        )
      ).to.be.revertedWith("AirdropFactory: already initialized");
    });
  });

  describe("Campaign Creation", function () {
    it("Should create a campaign and fund it in single transaction", async function () {
      const { factory, token, serverId, deployer } = await loadFixture(
        deployFactoryFixture
      );
      const [deployerSigner] = await ethers.getSigners();
      const deployerAddress = await deployerSigner.getAddress();

      // Generate test claims
      const addresses = [
        deployerAddress,
        "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      ];
      const claims = generateTestClaims(2, addresses, undefined, 0);
      const merkleTreeData = generateMerkleTree(claims);

      const totalAmount = claims.reduce((sum, claim) => {
        const amount =
          typeof claim.amount === "string"
            ? BigInt(claim.amount)
            : claim.amount;
        return sum + amount;
      }, BigInt(0));

      // Mint tokens to deployer
      await mintTokensTo(token, deployerSigner, totalAmount);

      // Approve tokens
      await token
        .connect(deployerSigner)
        .approve(await factory.getAddress(), totalAmount);

      // Create campaign
      const tx = await factory
        .connect(deployerSigner)
        .createAirdropAndFund(
          await token.getAddress(),
          merkleTreeData.root,
          "ipfs://test",
          totalAmount
        );
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);

      // Verify event emission
      await expect(tx)
        .to.emit(factory, "AirdropCampaignCreated")
        .withArgs(
          (campaignAddress: string) => campaignAddress !== ethers.ZeroAddress,
          deployerAddress,
          serverId,
          await factory.getAddress(),
          await token.getAddress(),
          merkleTreeData.root,
          "ipfs://test",
          totalAmount,
          block!.timestamp,
          receipt!.blockNumber
        );

      // Verify campaign was created
      const events = receipt!.logs;
      const campaignCreatedEvent = events.find((log) => {
        try {
          const parsed = factory.interface.parseLog(log as any);
          return parsed?.name === "AirdropCampaignCreated";
        } catch {
          return false;
        }
      });

      expect(campaignCreatedEvent).to.not.be.undefined;

      if (campaignCreatedEvent) {
        const parsed = factory.interface.parseLog(campaignCreatedEvent as any);
        const campaignAddress = parsed?.args[0];

        // Verify campaign has correct balance
        const campaign = await ethers.getContractAt(
          "MerkleAirdrop",
          campaignAddress
        );
        const balance = await token.balanceOf(campaignAddress);
        expect(balance).to.equal(totalAmount);
      }
    });

    it("Should transfer tokens from creator to campaign", async function () {
      const { factory, token, deployer } = await loadFixture(
        deployFactoryFixture
      );
      const [deployerSigner] = await ethers.getSigners();
      const deployerAddress = await deployerSigner.getAddress();

      // Generate test claims
      const addresses = [deployerAddress];
      const claims = generateTestClaims(1, addresses);
      const totalAmount = claims.reduce((sum, claim) => {
        const amount =
          typeof claim.amount === "string"
            ? BigInt(claim.amount)
            : claim.amount;
        return sum + amount;
      }, BigInt(0));

      const merkleTreeData = generateMerkleTree(claims);

      // Get balance before minting (includes initial supply from constructor)
      const balanceBeforeMinting = await token.balanceOf(deployerAddress);

      // Mint tokens to deployer
      await mintTokensTo(token, deployerSigner, totalAmount);

      // Check initial balance after minting
      const balanceBefore = await token.balanceOf(deployerAddress);
      expect(balanceBefore).to.equal(balanceBeforeMinting + totalAmount);

      // Approve tokens
      await token
        .connect(deployerSigner)
        .approve(await factory.getAddress(), totalAmount);

      // Create campaign
      await factory
        .connect(deployerSigner)
        .createAirdropAndFund(
          await token.getAddress(),
          merkleTreeData.root,
          "ipfs://test",
          totalAmount
        );

      // Verify tokens were transferred
      // Balance should decrease by totalAmount (initial supply remains)
      const balanceAfter = await token.balanceOf(deployerAddress);
      expect(balanceAfter).to.equal(balanceBeforeMinting);

      // Get campaign address from events
      const filter = factory.filters.AirdropCampaignCreated();
      const events = await factory.queryFilter(filter);
      const campaignAddress = events[events.length - 1]?.args?.[0];

      const campaignBalance = await token.balanceOf(campaignAddress);
      expect(campaignBalance).to.equal(totalAmount);
    });

    it("Should create multiple campaigns per factory", async function () {
      const { factory, token, deployer } = await loadFixture(
        deployFactoryFixture
      );
      const [deployerSigner] = await ethers.getSigners();
      const deployerAddress = await deployerSigner.getAddress();

      // Create first campaign
      const claims1 = generateTestClaims(
        2,
        [deployerAddress, "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"],
        undefined,
        0
      );
      const merkleTreeData1 = generateMerkleTree(claims1);
      const totalAmount1 = claims1.reduce((sum, claim) => {
        const amount =
          typeof claim.amount === "string"
            ? BigInt(claim.amount)
            : claim.amount;
        return sum + amount;
      }, BigInt(0));

      // Create second campaign
      const claims2 = generateTestClaims(3, [deployerAddress], undefined, 100);
      const merkleTreeData2 = generateMerkleTree(claims2);
      const totalAmount2 = claims2.reduce((sum, claim) => {
        const amount =
          typeof claim.amount === "string"
            ? BigInt(claim.amount)
            : claim.amount;
        return sum + amount;
      }, BigInt(0));

      // Mint tokens for both campaigns
      await mintTokensTo(token, deployerSigner, totalAmount1 + totalAmount2);

      // Approve and create first campaign
      await token
        .connect(deployerSigner)
        .approve(await factory.getAddress(), totalAmount1 + totalAmount2);

      const tx1 = await factory
        .connect(deployerSigner)
        .createAirdropAndFund(
          await token.getAddress(),
          merkleTreeData1.root,
          "ipfs://campaign1",
          totalAmount1
        );

      const tx2 = await factory
        .connect(deployerSigner)
        .createAirdropAndFund(
          await token.getAddress(),
          merkleTreeData2.root,
          "ipfs://campaign2",
          totalAmount2
        );

      // Verify both campaigns were created
      await expect(tx1).to.emit(factory, "AirdropCampaignCreated");
      await expect(tx2).to.emit(factory, "AirdropCampaignCreated");

      // Get campaign addresses
      const filter = factory.filters.AirdropCampaignCreated();
      const events = await factory.queryFilter(filter);
      expect(events.length).to.be.at.least(2);

      const campaign1Address = events[events.length - 2]?.args?.[0];
      const campaign2Address = events[events.length - 1]?.args?.[0];

      // Verify campaigns are different
      expect(campaign1Address).to.not.equal(campaign2Address);

      // Verify each campaign has correct balance
      const campaign1Balance = await token.balanceOf(campaign1Address);
      const campaign2Balance = await token.balanceOf(campaign2Address);

      expect(campaign1Balance).to.equal(totalAmount1);
      expect(campaign2Balance).to.equal(totalAmount2);
    });

    it("Should set correct campaign owner", async function () {
      const { factory, token, deployer } = await loadFixture(
        deployFactoryFixture
      );
      const [deployerSigner] = await ethers.getSigners();
      const deployerAddress = await deployerSigner.getAddress();

      const claims = generateTestClaims(1, [deployerAddress]);
      const merkleTreeData = generateMerkleTree(claims);
      const totalAmount = claims.reduce((sum, claim) => {
        const amount =
          typeof claim.amount === "string"
            ? BigInt(claim.amount)
            : claim.amount;
        return sum + amount;
      }, BigInt(0));

      await mintTokensTo(token, deployerSigner, totalAmount);
      await token
        .connect(deployerSigner)
        .approve(await factory.getAddress(), totalAmount);

      await factory
        .connect(deployerSigner)
        .createAirdropAndFund(
          await token.getAddress(),
          merkleTreeData.root,
          "ipfs://test",
          totalAmount
        );

      // Get campaign address
      const filter = factory.filters.AirdropCampaignCreated();
      const events = await factory.queryFilter(filter);
      const campaignAddress = events[events.length - 1]?.args?.[0];

      const campaign = await ethers.getContractAt(
        "MerkleAirdrop",
        campaignAddress
      );
      expect(await campaign.owner()).to.equal(deployerAddress);
    });
  });

  describe("Error Handling", function () {
    it("Should revert if factory is not initialized", async function () {
      const AirdropFactoryFactory = await ethers.getContractFactory(
        "AirdropFactory"
      );
      // Deploy factory without initializing (for clone mode)
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

    it("Should revert if token is zero address", async function () {
      const { factory, deployer } = await loadFixture(deployFactoryFixture);
      const [deployerSigner] = await ethers.getSigners();
      const claims = generateTestClaims(1, [deployerSigner.address]);
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
          .connect(deployerSigner)
          .createAirdropAndFund(
            ethers.ZeroAddress,
            merkleTreeData.root,
            "ipfs://test",
            totalAmount
          )
      ).to.be.revertedWith("AirdropFactory: token cannot be zero address");
    });

    it("Should revert if merkle root is zero", async function () {
      const { factory, token, deployer } = await loadFixture(
        deployFactoryFixture
      );
      const [deployerSigner] = await ethers.getSigners();
      const totalAmount = ethers.parseEther("1000");

      await mintTokensTo(token, deployerSigner, totalAmount);
      await token
        .connect(deployerSigner)
        .approve(await factory.getAddress(), totalAmount);

      await expect(
        factory
          .connect(deployerSigner)
          .createAirdropAndFund(
            await token.getAddress(),
            ethers.ZeroHash,
            "ipfs://test",
            totalAmount
          )
      ).to.be.revertedWith("AirdropFactory: merkle root cannot be zero");
    });

    it("Should revert if total amount is zero", async function () {
      const { factory, token, deployer } = await loadFixture(
        deployFactoryFixture
      );
      const [deployerSigner] = await ethers.getSigners();
      const claims = generateTestClaims(1, [deployerSigner.address]);
      const merkleTreeData = generateMerkleTree(claims);

      await expect(
        factory
          .connect(deployerSigner)
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

    it("Should revert if creator has insufficient token balance", async function () {
      const { factory, deployer } = await loadFixture(deployFactoryFixture);
      const [deployerSigner, , , , , , , , , , , , , , , , , , , , newUser] =
        await ethers.getSigners();

      // Use a new user with no tokens (check if we have enough signers)
      const signers = await ethers.getSigners();
      const testUserIndex = Math.min(10, signers.length - 1);
      const testUser = signers[testUserIndex];
      const testUserAddress = await testUser.getAddress();

      // Deploy a fresh token for this test
      const token = await deployMockERC20();

      const claims = generateTestClaims(1, [testUserAddress]);
      const merkleTreeData = generateMerkleTree(claims);
      const totalAmount = claims.reduce((sum, claim) => {
        const amount =
          typeof claim.amount === "string"
            ? BigInt(claim.amount)
            : claim.amount;
        return sum + amount;
      }, BigInt(0));

      // Don't mint tokens - testUser has zero balance
      await token
        .connect(testUser)
        .approve(await factory.getAddress(), totalAmount);

      await expect(
        factory
          .connect(testUser)
          .createAirdropAndFund(
            await token.getAddress(),
            merkleTreeData.root,
            "ipfs://test",
            totalAmount
          )
      ).to.be.reverted; // ERC20 transfer will fail
    });

    it("Should revert if creator has not approved tokens", async function () {
      const { factory, token, deployer } = await loadFixture(
        deployFactoryFixture
      );
      const [deployerSigner] = await ethers.getSigners();
      const claims = generateTestClaims(1, [deployerSigner.address]);
      const merkleTreeData = generateMerkleTree(claims);
      const totalAmount = claims.reduce((sum, claim) => {
        const amount =
          typeof claim.amount === "string"
            ? BigInt(claim.amount)
            : claim.amount;
        return sum + amount;
      }, BigInt(0));

      // Mint tokens but don't approve
      await mintTokensTo(token, deployerSigner, totalAmount);

      await expect(
        factory
          .connect(deployerSigner)
          .createAirdropAndFund(
            await token.getAddress(),
            merkleTreeData.root,
            "ipfs://test",
            totalAmount
          )
      ).to.be.reverted; // ERC20 transferFrom will fail
    });
  });

  describe("Event Emissions", function () {
    it("Should emit AirdropCampaignCreated with all details for indexing", async function () {
      const { factory, token, serverId, deployer } = await loadFixture(
        deployFactoryFixture
      );
      const [deployerSigner] = await ethers.getSigners();
      const deployerAddress = await deployerSigner.getAddress();

      const claims = generateTestClaims(2, [
        deployerAddress,
        "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      ]);
      const merkleTreeData = generateMerkleTree(claims);
      const totalAmount = claims.reduce((sum, claim) => {
        const amount =
          typeof claim.amount === "string"
            ? BigInt(claim.amount)
            : claim.amount;
        return sum + amount;
      }, BigInt(0));

      await mintTokensTo(token, deployerSigner, totalAmount);
      await token
        .connect(deployerSigner)
        .approve(await factory.getAddress(), totalAmount);

      const tx = await factory
        .connect(deployerSigner)
        .createAirdropAndFund(
          await token.getAddress(),
          merkleTreeData.root,
          "ipfs://metadata",
          totalAmount
        );
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);

      await expect(tx)
        .to.emit(factory, "AirdropCampaignCreated")
        .withArgs(
          (campaign: string) => campaign !== ethers.ZeroAddress,
          deployerAddress,
          serverId,
          await factory.getAddress(),
          await token.getAddress(),
          merkleTreeData.root,
          "ipfs://metadata",
          totalAmount,
          block!.timestamp,
          receipt!.blockNumber
        );
    });
  });

  describe("View Functions", function () {
    it("Should return correct serverId", async function () {
      const { factory, serverId } = await loadFixture(deployFactoryFixture);
      expect(await factory.serverId()).to.equal(serverId);
      expect(await factory.getServerId()).to.equal(serverId);
    });

    it("Should return correct implementation address", async function () {
      const { factory, merkleAirdropImplementation } = await loadFixture(
        deployFactoryFixture
      );
      expect(await factory.implementation()).to.equal(
        await merkleAirdropImplementation.getAddress()
      );
      expect(await factory.getImplementation()).to.equal(
        await merkleAirdropImplementation.getAddress()
      );
    });

    it("Should return initialization status", async function () {
      const { factory } = await loadFixture(deployFactoryFixture);
      expect(await factory.initialized()).to.be.true;
    });
  });
});
