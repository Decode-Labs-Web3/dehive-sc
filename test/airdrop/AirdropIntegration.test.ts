import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
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

describe("Airdrop Integration - End-to-End Flow", function () {
  async function deployIntegrationFixture() {
    const registryFixture = await deployAirdropRegistryFixture();
    const { registry } = registryFixture;

    const signers = await ethers.getSigners();
    const [deployer, owner1, owner2, creator1, creator2, user1, user2, user3] =
      signers;

    // Create two servers
    const serverId1 = generateServerIds(1)[0];
    const serverId2 = "507f1f77bcf86cd799439012";

    const factory1 = await createServerFactory(registry, serverId1, owner1);
    const factory2 = await createServerFactory(registry, serverId2, owner2);

    // Deploy tokens
    const token1 = await deployMockERC20(
      "Token1",
      "TKN1",
      18,
      ethers.parseEther("1000000")
    );
    const token2 = await deployMockERC20(
      "Token2",
      "TKN2",
      18,
      ethers.parseEther("1000000")
    );

    return {
      ...registryFixture,
      registry,
      factory1,
      factory2,
      serverId1,
      serverId2,
      owner1,
      owner2,
      creator1,
      creator2,
      user1,
      user2,
      user3,
      token1,
      token2,
      signers,
    };
  }

  describe("Complete Flow: Registry → Factory → Campaign", function () {
    it("Should complete full flow from Registry to Claim", async function () {
      const { registry, factory1, token1, creator1, user1, user2, signers } =
        await loadFixture(deployIntegrationFixture);

      const creator1Address = await creator1.getAddress();
      const user1Address = await user1.getAddress();
      const user2Address = await user2.getAddress();

      // Step 1: Create claims
      const claims = generateTestClaims(
        2,
        [user1Address, user2Address],
        undefined,
        0
      );
      const merkleTreeData = generateMerkleTree(claims);
      const totalAmount = claims.reduce((sum, claim) => {
        const amount =
          typeof claim.amount === "string"
            ? BigInt(claim.amount)
            : claim.amount;
        return sum + amount;
      }, BigInt(0));

      // Step 2: Mint tokens to creator
      await mintTokensTo(token1, creator1, totalAmount);

      // Step 3: Approve tokens
      await token1
        .connect(creator1)
        .approve(await factory1.getAddress(), totalAmount);

      // Step 4: Create campaign
      const { campaign } = await createTestCampaign(
        factory1,
        token1,
        claims,
        creator1,
        "ipfs://test-campaign"
      );

      // Step 5: Verify campaign was created
      expect(await campaign.getAddress()).to.not.equal(ethers.ZeroAddress);
      expect(await campaign.merkleRoot()).to.equal(merkleTreeData.root);
      expect(await campaign.totalAmount()).to.equal(totalAmount);

      // Step 6: Claim tokens
      const claim1Index = 0;
      const claim1 = claims[claim1Index];
      const proof1 = generateMerkleProof(merkleTreeData, claim1Index);
      const amount1 =
        typeof claim1.amount === "string"
          ? BigInt(claim1.amount)
          : claim1.amount;

      const claimTx = await campaign
        .connect(user1)
        .claim(claim1.index, user1Address, amount1, proof1);

      // Step 7: Verify claim was successful
      await expect(claimTx)
        .to.emit(campaign, "Claimed")
        .withArgs(claim1.index, user1Address, amount1);
      expect(await campaign.isClaimed(claim1.index)).to.be.true;

      // Verify token balance
      const user1Balance = await token1.balanceOf(user1Address);
      expect(user1Balance).to.be.gte(amount1);
    });

    it("Should create multiple campaigns from different factories", async function () {
      const {
        factory1,
        factory2,
        token1,
        token2,
        creator1,
        creator2,
        user1,
        user2,
        signers,
      } = await loadFixture(deployIntegrationFixture);

      const user1Address = await user1.getAddress();
      const user2Address = await user2.getAddress();

      // Campaign 1 from Factory 1
      const claims1 = generateTestClaims(1, [user1Address], undefined, 0);
      const merkleTreeData1 = generateMerkleTree(claims1);
      const totalAmount1 = claims1.reduce((sum, claim) => {
        const amount =
          typeof claim.amount === "string"
            ? BigInt(claim.amount)
            : claim.amount;
        return sum + amount;
      }, BigInt(0));

      await mintTokensTo(token1, creator1, totalAmount1);
      await token1
        .connect(creator1)
        .approve(await factory1.getAddress(), totalAmount1);
      const { campaign: campaign1 } = await createTestCampaign(
        factory1,
        token1,
        claims1,
        creator1
      );

      // Campaign 2 from Factory 2
      const claims2 = generateTestClaims(1, [user2Address], undefined, 100);
      const merkleTreeData2 = generateMerkleTree(claims2);
      const totalAmount2 = claims2.reduce((sum, claim) => {
        const amount =
          typeof claim.amount === "string"
            ? BigInt(claim.amount)
            : claim.amount;
        return sum + amount;
      }, BigInt(0));

      await mintTokensTo(token2, creator2, totalAmount2);
      await token2
        .connect(creator2)
        .approve(await factory2.getAddress(), totalAmount2);
      const { campaign: campaign2 } = await createTestCampaign(
        factory2,
        token2,
        claims2,
        creator2
      );

      // Verify campaigns are different
      expect(await campaign1.getAddress()).to.not.equal(
        await campaign2.getAddress()
      );
      expect(await campaign1.token()).to.not.equal(await campaign2.token());

      // Verify both campaigns work independently
      const proof1 = generateMerkleProof(merkleTreeData1, 0);
      const amount1 =
        typeof claims1[0].amount === "string"
          ? BigInt(claims1[0].amount)
          : claims1[0].amount;

      const proof2 = generateMerkleProof(merkleTreeData2, 0);
      const amount2 =
        typeof claims2[0].amount === "string"
          ? BigInt(claims2[0].amount)
          : claims2[0].amount;

      await campaign1
        .connect(user1)
        .claim(claims1[0].index, user1Address, amount1, proof1);
      await campaign2
        .connect(user2)
        .claim(claims2[0].index, user2Address, amount2, proof2);

      expect(await campaign1.isClaimed(claims1[0].index)).to.be.true;
      expect(await campaign2.isClaimed(claims2[0].index)).to.be.true;
    });

    it("Should isolate campaigns across different servers", async function () {
      const { factory1, factory2, token1, creator1, creator2, user1, signers } =
        await loadFixture(deployIntegrationFixture);

      const user1Address = await user1.getAddress();

      // Create campaign in server 1
      const claims1 = generateTestClaims(1, [user1Address], undefined, 0);
      const merkleTreeData1 = generateMerkleTree(claims1);
      const totalAmount1 = claims1.reduce((sum, claim) => {
        const amount =
          typeof claim.amount === "string"
            ? BigInt(claim.amount)
            : claim.amount;
        return sum + amount;
      }, BigInt(0));

      await mintTokensTo(token1, creator1, totalAmount1);
      await token1
        .connect(creator1)
        .approve(await factory1.getAddress(), totalAmount1);
      const { campaign: campaign1 } = await createTestCampaign(
        factory1,
        token1,
        claims1,
        creator1
      );

      // Create campaign in server 2 with same user but different amounts
      const claims2 = generateTestClaims(1, [user1Address], undefined, 100);
      const merkleTreeData2 = generateMerkleTree(claims2);
      const totalAmount2 = claims2.reduce((sum, claim) => {
        const amount =
          typeof claim.amount === "string"
            ? BigInt(claim.amount)
            : claim.amount;
        return sum + amount;
      }, BigInt(0));

      await mintTokensTo(token1, creator2, totalAmount2);
      await token1
        .connect(creator2)
        .approve(await factory2.getAddress(), totalAmount2);
      const { campaign: campaign2 } = await createTestCampaign(
        factory2,
        token1,
        claims2,
        creator2
      );

      // Verify campaigns are isolated
      expect(await campaign1.merkleRoot()).to.not.equal(
        await campaign2.merkleRoot()
      );
      expect(await campaign1.getAddress()).to.not.equal(
        await campaign2.getAddress()
      );

      // Both campaigns should work independently
      const proof1 = generateMerkleProof(merkleTreeData1, 0);
      const amount1 =
        typeof claims1[0].amount === "string"
          ? BigInt(claims1[0].amount)
          : claims1[0].amount;

      const proof2 = generateMerkleProof(merkleTreeData2, 0);
      const amount2 =
        typeof claims2[0].amount === "string"
          ? BigInt(claims2[0].amount)
          : claims2[0].amount;

      await campaign1
        .connect(user1)
        .claim(claims1[0].index, user1Address, amount1, proof1);
      await campaign2
        .connect(user1)
        .claim(claims2[0].index, user1Address, amount2, proof2);

      expect(await campaign1.isClaimed(claims1[0].index)).to.be.true;
      expect(await campaign2.isClaimed(claims2[0].index)).to.be.true;
    });
  });

  describe("Event Chain Verification", function () {
    it("Should emit events in correct order: FactoryCreated → AirdropCampaignCreated → Claimed", async function () {
      const { registry, factory1, token1, creator1, user1, signers } =
        await loadFixture(deployIntegrationFixture);

      const user1Address = await user1.getAddress();
      const creator1Address = await creator1.getAddress();

      // Step 1: Create factory (FactoryCreated event)
      // Use a unique serverId that's not in the fixture
      const serverId = "507f1f77bcf86cd7994390ff"; // Use a unique ID
      const factoryTx = await registry
        .connect(creator1)
        .createFactoryForServer(serverId, creator1Address);
      const factoryReceipt = await factoryTx.wait();

      // Verify FactoryCreated event
      await expect(factoryTx).to.emit(registry, "FactoryCreated");

      // Extract factory address from event
      const factoryCreatedEvent = factoryReceipt?.logs.find((log) => {
        try {
          const parsed = registry.interface.parseLog(log as any);
          return parsed?.name === "FactoryCreated";
        } catch {
          return false;
        }
      });
      if (!factoryCreatedEvent) {
        throw new Error("FactoryCreated event not found");
      }
      const parsed = registry.interface.parseLog(factoryCreatedEvent as any);
      const newFactoryAddress = parsed?.args[0]; // First arg is factory address
      const newFactory = await ethers.getContractAt(
        "AirdropFactory",
        newFactoryAddress
      );

      // Step 2: Create campaign (AirdropCampaignCreated event)
      const claims = generateTestClaims(1, [user1Address]);
      const merkleTreeData = generateMerkleTree(claims);
      const totalAmount = claims.reduce((sum, claim) => {
        const amount =
          typeof claim.amount === "string"
            ? BigInt(claim.amount)
            : claim.amount;
        return sum + amount;
      }, BigInt(0));

      await mintTokensTo(token1, creator1, totalAmount);
      await token1.connect(creator1).approve(newFactoryAddress, totalAmount);

      const campaignTx = await newFactory
        .connect(creator1)
        .createAirdropAndFund(
          await token1.getAddress(),
          merkleTreeData.root,
          "ipfs://test",
          totalAmount
        );
      const campaignReceipt = await campaignTx.wait();

      // Verify AirdropCampaignCreated event
      await expect(campaignTx).to.emit(newFactory, "AirdropCampaignCreated");

      // Extract campaign address from event
      const campaignCreatedEvent = campaignReceipt?.logs.find((log) => {
        try {
          const parsed = newFactory.interface.parseLog(log as any);
          return parsed?.name === "AirdropCampaignCreated";
        } catch {
          return false;
        }
      });

      expect(campaignCreatedEvent).to.not.be.undefined;
      if (!campaignCreatedEvent) return;

      const parsedCampaign = newFactory.interface.parseLog(
        campaignCreatedEvent as any
      );
      const campaignAddress = parsedCampaign?.args[0];
      const campaign = await ethers.getContractAt(
        "MerkleAirdrop",
        campaignAddress
      );

      // Step 3: Claim tokens (Claimed event)
      const claim = claims[0];
      const proof = generateMerkleProof(merkleTreeData, 0);
      const amount =
        typeof claim.amount === "string" ? BigInt(claim.amount) : claim.amount;

      const claimTx = await campaign
        .connect(user1)
        .claim(claim.index, user1Address, amount, proof);

      // Verify Claimed event
      await expect(claimTx)
        .to.emit(campaign, "Claimed")
        .withArgs(claim.index, user1Address, amount);

      // Verify event order (block numbers)
      const factoryBlock = factoryReceipt!.blockNumber;
      const campaignBlock = campaignReceipt!.blockNumber;
      const claimBlock = (await claimTx.wait())!.blockNumber;

      expect(campaignBlock).to.be.greaterThan(factoryBlock);
      expect(claimBlock).to.be.greaterThan(campaignBlock);
    });
  });

  describe("Multiple Servers Scenario", function () {
    it("Should handle multiple servers with independent factories", async function () {
      const { registry, signers } = await loadFixture(deployIntegrationFixture);
      // Use signers that aren't used in the fixture (fixture uses 0-7)
      const owner1 = signers[8] || signers[signers.length - 3];
      const owner2 = signers[9] || signers[signers.length - 2];
      const owner3 = signers[10] || signers[signers.length - 1];

      // Use unique serverIds that don't conflict with the fixture
      // The fixture uses generateServerIds(1)[0] and "507f1f77bcf86cd799439012"
      const serverIds = [
        "507f1f77bcf86cd799439020",
        "507f1f77bcf86cd799439021",
        "507f1f77bcf86cd799439022",
      ];

      // Create 3 factories for 3 servers
      const factory1 = await createServerFactory(
        registry,
        serverIds[0],
        owner1
      );
      const factory2 = await createServerFactory(
        registry,
        serverIds[1],
        owner2
      );
      const factory3 = await createServerFactory(
        registry,
        serverIds[2],
        owner3
      );

      // Verify all factories exist
      expect(await factory1.getAddress()).to.not.equal(
        await factory2.getAddress()
      );
      expect(await factory2.getAddress()).to.not.equal(
        await factory3.getAddress()
      );
      expect(await factory1.getAddress()).to.not.equal(
        await factory3.getAddress()
      );

      // Verify serverId tracking
      expect(await factory1.serverId()).to.equal(serverIds[0]);
      expect(await factory2.serverId()).to.equal(serverIds[1]);
      expect(await factory3.serverId()).to.equal(serverIds[2]);

      // Verify registry tracking
      // The fixture already created 2 factories, so total should be 5
      expect(await registry.getFactoryCount()).to.equal(5);
      expect(await registry.getFactoryByServerId(serverIds[0])).to.equal(
        await factory1.getAddress()
      );
      expect(await registry.getFactoryByServerId(serverIds[1])).to.equal(
        await factory2.getAddress()
      );
      expect(await registry.getFactoryByServerId(serverIds[2])).to.equal(
        await factory3.getAddress()
      );
    });

    it("Should allow creating campaigns in different servers simultaneously", async function () {
      const { registry, token1, creator1, creator2, user1, user2, signers } =
        await loadFixture(deployIntegrationFixture);

      const user1Address = await user1.getAddress();
      const user2Address = await user2.getAddress();

      // Create two servers with unique IDs that don't conflict with the fixture
      // The fixture uses generateServerIds(1)[0] and "507f1f77bcf86cd799439012"
      const serverId1 = "507f1f77bcf86cd799439030";
      const serverId2 = "507f1f77bcf86cd799439031";

      const factory1 = await createServerFactory(registry, serverId1, creator1);
      const factory2 = await createServerFactory(registry, serverId2, creator2);

      // Create campaigns in both servers
      const claims1 = generateTestClaims(1, [user1Address], undefined, 0);
      const claims2 = generateTestClaims(1, [user2Address], undefined, 100);

      const merkleTreeData1 = generateMerkleTree(claims1);
      const merkleTreeData2 = generateMerkleTree(claims2);

      const totalAmount1 = claims1.reduce((sum, claim) => {
        const amount =
          typeof claim.amount === "string"
            ? BigInt(claim.amount)
            : claim.amount;
        return sum + amount;
      }, BigInt(0));

      const totalAmount2 = claims2.reduce((sum, claim) => {
        const amount =
          typeof claim.amount === "string"
            ? BigInt(claim.amount)
            : claim.amount;
        return sum + amount;
      }, BigInt(0));

      // Mint and approve tokens
      await mintTokensTo(token1, creator1, totalAmount1);
      await mintTokensTo(token1, creator2, totalAmount2);
      await token1
        .connect(creator1)
        .approve(await factory1.getAddress(), totalAmount1);
      await token1
        .connect(creator2)
        .approve(await factory2.getAddress(), totalAmount2);

      // Create both campaigns
      const { campaign: campaign1 } = await createTestCampaign(
        factory1,
        token1,
        claims1,
        creator1
      );
      const { campaign: campaign2 } = await createTestCampaign(
        factory2,
        token1,
        claims2,
        creator2
      );

      // Verify campaigns are independent
      expect(await campaign1.getAddress()).to.not.equal(
        await campaign2.getAddress()
      );
      expect(await campaign1.merkleRoot()).to.not.equal(
        await campaign2.merkleRoot()
      );
    });
  });

  describe("Cross-Server Campaign Claims", function () {
    it("Should allow user to claim from multiple campaigns across different servers", async function () {
      const {
        registry,
        factory1,
        factory2,
        token1,
        token2,
        creator1,
        creator2,
        user1,
        signers,
      } = await loadFixture(deployIntegrationFixture);

      const user1Address = await user1.getAddress();

      // Create campaign in server 1
      const claims1 = generateTestClaims(1, [user1Address], undefined, 0);
      const merkleTreeData1 = generateMerkleTree(claims1);
      const totalAmount1 = claims1.reduce((sum, claim) => {
        const amount =
          typeof claim.amount === "string"
            ? BigInt(claim.amount)
            : claim.amount;
        return sum + amount;
      }, BigInt(0));

      await mintTokensTo(token1, creator1, totalAmount1);
      await token1
        .connect(creator1)
        .approve(await factory1.getAddress(), totalAmount1);
      const { campaign: campaign1 } = await createTestCampaign(
        factory1,
        token1,
        claims1,
        creator1
      );

      // Create campaign in server 2 with same user
      const claims2 = generateTestClaims(1, [user1Address], undefined, 100);
      const merkleTreeData2 = generateMerkleTree(claims2);
      const totalAmount2 = claims2.reduce((sum, claim) => {
        const amount =
          typeof claim.amount === "string"
            ? BigInt(claim.amount)
            : claim.amount;
        return sum + amount;
      }, BigInt(0));

      await mintTokensTo(token2, creator2, totalAmount2);
      await token2
        .connect(creator2)
        .approve(await factory2.getAddress(), totalAmount2);
      const { campaign: campaign2 } = await createTestCampaign(
        factory2,
        token2,
        claims2,
        creator2
      );

      // Claim from both campaigns
      const proof1 = generateMerkleProof(merkleTreeData1, 0);
      const amount1 =
        typeof claims1[0].amount === "string"
          ? BigInt(claims1[0].amount)
          : claims1[0].amount;

      const proof2 = generateMerkleProof(merkleTreeData2, 0);
      const amount2 =
        typeof claims2[0].amount === "string"
          ? BigInt(claims2[0].amount)
          : claims2[0].amount;

      // Claim from campaign 1
      await campaign1
        .connect(user1)
        .claim(claims1[0].index, user1Address, amount1, proof1);

      // Claim from campaign 2
      await campaign2
        .connect(user1)
        .claim(claims2[0].index, user1Address, amount2, proof2);

      // Verify both claims were successful
      expect(await campaign1.isClaimed(claims1[0].index)).to.be.true;
      expect(await campaign2.isClaimed(claims2[0].index)).to.be.true;

      // Verify user received tokens from both campaigns
      const token1Balance = await token1.balanceOf(user1Address);
      const token2Balance = await token2.balanceOf(user1Address);

      expect(token1Balance).to.be.gte(amount1);
      expect(token2Balance).to.be.gte(amount2);
    });
  });
});
