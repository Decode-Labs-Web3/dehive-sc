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
  getTestUserAddresses,
} from "./helpers/testDataGenerator";

describe("Airdrop Load Tests", function () {
  async function deployLoadFixture() {
    const registryFixture = await deployAirdropRegistryFixture();
    const { registry } = registryFixture;
    const signers = await ethers.getSigners();
    const addresses = await getTestUserAddresses();

    return {
      ...registryFixture,
      registry,
      signers,
      addresses,
    };
  }

  describe("Multiple Servers Load Test", function () {
    it("Should handle 10+ servers with factories", async function () {
      const { registry, signers } = await loadFixture(deployLoadFixture);
      this.timeout(600000); // 10 minutes

      const numServers = 10;
      const serverIds = generateServerIds(numServers);
      const factories: AirdropFactory[] = [];

      // Create 10 factories
      for (let i = 0; i < numServers; i++) {
        const ownerIndex = (i % (signers.length - 1)) + 1; // Skip account 0
        const factory = await createServerFactory(
          registry,
          serverIds[i],
          signers[ownerIndex]
        );
        factories.push(factory);
      }

      // Verify all factories exist
      expect(await registry.getFactoryCount()).to.equal(numServers);

      // Verify all factories are different
      const factoryAddresses = await Promise.all(
        factories.map((f) => f.getAddress())
      );
      const uniqueAddresses = new Set(
        factoryAddresses.map((addr) => addr.toLowerCase())
      );
      expect(uniqueAddresses.size).to.equal(numServers);

      // Verify serverId tracking
      for (let i = 0; i < numServers; i++) {
        const factoryAddress = await registry.getFactoryByServerId(
          serverIds[i]
        );
        expect(factoryAddress).to.equal(await factories[i].getAddress());
        expect(await factories[i].serverId()).to.equal(serverIds[i]);
      }
    });

    it("Should handle 15 servers with enumeration", async function () {
      const { registry, signers } = await loadFixture(deployLoadFixture);
      this.timeout(600000);

      const numServers = 15;
      const serverIds = generateServerIds(numServers);
      const factories: AirdropFactory[] = [];

      // Create factories
      for (let i = 0; i < numServers; i++) {
        const ownerIndex = (i % (signers.length - 1)) + 1;
        const factory = await createServerFactory(
          registry,
          serverIds[i],
          signers[ownerIndex]
        );
        factories.push(factory);
      }

      // Verify enumeration
      const allFactories = await registry.getAllFactories();
      expect(allFactories.length).to.equal(numServers);

      // Verify all factories are in the list
      const factoryAddresses = await Promise.all(
        factories.map((f) => f.getAddress())
      );
      for (const factoryAddress of factoryAddresses) {
        expect(allFactories).to.include(factoryAddress);
      }
    });
  });

  describe("Multiple Campaigns Load Test", function () {
    it("Should create 5+ campaigns per server Factory", async function () {
      const { registry, signers, addresses } = await loadFixture(
        deployLoadFixture
      );
      this.timeout(600000);

      const serverId = generateServerIds(1)[0];
      const factory = await createServerFactory(registry, serverId, signers[1]);
      const token = await deployMockERC20();
      const numCampaigns = 5;

      const campaigns: MerkleAirdrop[] = [];

      // Create multiple campaigns
      for (let i = 0; i < numCampaigns; i++) {
        const creator = signers[(i % (signers.length - 1)) + 1];
        const creatorAddress = await creator.getAddress();

        // Create claims for this campaign
        const startIndex = i * 1000;
        const userCount = Math.max(
          1,
          Math.ceil(addresses.length / numCampaigns)
        );
        const campaignAddresses = addresses.slice(
          (i * userCount) % addresses.length,
          ((i + 1) * userCount) % addresses.length || addresses.length
        );
        // Ensure at least one address for valid merkle root
        if (campaignAddresses.length === 0) {
          campaignAddresses.push(addresses[0]);
        }

        const claims = generateTestClaims(
          campaignAddresses.length,
          campaignAddresses,
          undefined,
          startIndex
        );
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
          creator,
          `ipfs://campaign-${i}`
        );

        campaigns.push(campaign);
      }

      // Verify all campaigns were created
      expect(campaigns.length).to.equal(numCampaigns);

      // Verify all campaigns are different
      const campaignAddresses = await Promise.all(
        campaigns.map((c) => c.getAddress())
      );
      const uniqueAddresses = new Set(
        campaignAddresses.map((addr) => addr.toLowerCase())
      );
      expect(uniqueAddresses.size).to.equal(numCampaigns);
    });

    it("Should handle 10 campaigns across multiple servers", async function () {
      const { registry, signers, addresses } = await loadFixture(
        deployLoadFixture
      );
      this.timeout(900000);

      const numServers = 3;
      const campaignsPerServer = 3;
      const serverIds = generateServerIds(numServers);
      const token = await deployMockERC20();

      const factories: AirdropFactory[] = [];
      const allCampaigns: MerkleAirdrop[] = [];

      // Create factories for each server
      for (let i = 0; i < numServers; i++) {
        const owner = signers[(i % (signers.length - 1)) + 1];
        const factory = await createServerFactory(
          registry,
          serverIds[i],
          owner
        );
        factories.push(factory);

        // Create campaigns in each factory
        for (let j = 0; j < campaignsPerServer; j++) {
          const creator =
            signers[((i * campaignsPerServer + j) % (signers.length - 1)) + 1];
          const creatorAddress = await creator.getAddress();

          const startIndex = i * 10000 + j * 1000;
          const userCount = Math.max(
            1,
            Math.ceil(addresses.length / (numServers * campaignsPerServer))
          );
          const campaignAddresses = addresses.slice(
            ((i * campaignsPerServer + j) * userCount) % addresses.length,
            ((i * campaignsPerServer + j + 1) * userCount) % addresses.length ||
              addresses.length
          );
          // Ensure at least one address for valid merkle root
          if (campaignAddresses.length === 0) {
            campaignAddresses.push(addresses[0]);
          }

          const claims = generateTestClaims(
            campaignAddresses.length,
            campaignAddresses,
            undefined,
            startIndex
          );
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
            creator,
            `ipfs://server-${i}-campaign-${j}`
          );

          allCampaigns.push(campaign);
        }
      }

      // Verify total campaigns
      expect(allCampaigns.length).to.equal(numServers * campaignsPerServer);
    });
  });

  describe("Many Users Claiming Load Test", function () {
    it("Should handle 19 users claiming from campaigns", async function () {
      const { registry, signers, addresses } = await loadFixture(
        deployLoadFixture
      );
      this.timeout(900000);

      const serverId = generateServerIds(1)[0];
      const factory = await createServerFactory(registry, serverId, signers[1]);
      const token = await deployMockERC20();

      // Create campaign with all 19 users
      const claims = generateTestClaims(19, addresses, undefined, 0);
      const merkleTreeData = generateMerkleTree(claims);
      const totalAmount = claims.reduce((sum, claim) => {
        const amount =
          typeof claim.amount === "string"
            ? BigInt(claim.amount)
            : claim.amount;
        return sum + amount;
      }, BigInt(0));

      const creator = signers[2];
      await mintTokensTo(token, creator, totalAmount);
      await token
        .connect(creator)
        .approve(await factory.getAddress(), totalAmount);

      const { campaign } = await createTestCampaign(
        factory,
        token,
        claims,
        creator,
        "ipfs://large-campaign"
      );

      // Create address to signer mapping
      const addressToSigner = new Map<string, (typeof signers)[0]>();
      for (const signer of signers) {
        const addr = await signer.getAddress();
        addressToSigner.set(addr.toLowerCase(), signer);
      }

      // All 19 users claim their tokens
      for (let i = 0; i < claims.length; i++) {
        const claim = claims[i];
        const user =
          addressToSigner.get(claim.account.toLowerCase()) || signers[0];

        const userAddress = await user.getAddress();
        const proof = generateMerkleProof(merkleTreeData, i);
        const amount =
          typeof claim.amount === "string"
            ? BigInt(claim.amount)
            : claim.amount;

        // Claim tokens
        await campaign
          .connect(user)
          .claim(claim.index, userAddress, amount, proof);

        // Verify claim was successful
        expect(await campaign.isClaimed(claim.index)).to.be.true;

        if ((i + 1) % 5 === 0) {
          console.log(`  Claimed ${i + 1} / ${claims.length} claims...`);
        }
      }

      // Verify all claims were processed
      for (let i = 0; i < claims.length; i++) {
        expect(await campaign.isClaimed(claims[i].index)).to.be.true;
      }

      console.log(`✓ Successfully processed ${claims.length} claims`);
    });

    it("Should handle concurrent claims from multiple campaigns", async function () {
      const { registry, signers, addresses } = await loadFixture(
        deployLoadFixture
      );
      this.timeout(1200000); // 20 minutes

      const numServers = 3;
      const campaignsPerServer = 2;
      const serverIds = generateServerIds(numServers);
      const token = await deployMockERC20();

      const allCampaigns: Array<{
        campaign: MerkleAirdrop;
        merkleTreeData: any;
        claims: any[];
      }> = [];

      // Create campaigns
      for (let i = 0; i < numServers; i++) {
        const owner = signers[(i % (signers.length - 1)) + 1];
        const factory = await createServerFactory(
          registry,
          serverIds[i],
          owner
        );

        for (let j = 0; j < campaignsPerServer; j++) {
          const creator =
            signers[((i * campaignsPerServer + j) % (signers.length - 1)) + 1];
          const startIndex = i * 10000 + j * 1000;
          const userCount = Math.min(5, addresses.length); // 5 users per campaign
          const campaignAddresses = addresses.slice(
            ((i * campaignsPerServer + j) * userCount) % addresses.length,
            Math.min(
              (i * campaignsPerServer + j + 1) * userCount,
              addresses.length
            )
          );
          // Ensure at least one address for valid merkle root
          if (campaignAddresses.length === 0) {
            campaignAddresses.push(addresses[0]);
          }

          const claims = generateTestClaims(
            campaignAddresses.length,
            campaignAddresses,
            undefined,
            startIndex
          );
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

          const { campaign, merkleTreeData: treeData } =
            await createTestCampaign(
              factory,
              token,
              claims,
              creator,
              `ipfs://s${i}-c${j}`
            );

          allCampaigns.push({
            campaign,
            merkleTreeData: treeData,
            claims,
          });
        }
      }

      // Create address to signer mapping
      const addressToSigner = new Map<string, (typeof signers)[0]>();
      for (const signer of signers) {
        const addr = await signer.getAddress();
        addressToSigner.set(addr.toLowerCase(), signer);
      }

      // Claim from all campaigns
      const claimPromises: Promise<any>[] = [];

      for (const { campaign, merkleTreeData, claims } of allCampaigns) {
        for (let i = 0; i < claims.length; i++) {
          const claim = claims[i];
          const user =
            addressToSigner.get(claim.account.toLowerCase()) || signers[0];

          const userAddress = await user.getAddress();
          const proof = generateMerkleProof(merkleTreeData, i);
          const amount =
            typeof claim.amount === "string"
              ? BigInt(claim.amount)
              : claim.amount;

          claimPromises.push(
            campaign
              .connect(user)
              .claim(claim.index, userAddress, amount, proof)
          );
        }
      }

      // Wait for all claims
      await Promise.all(claimPromises);

      // Verify all claims
      for (const { campaign, claims } of allCampaigns) {
        for (const claim of claims) {
          expect(await campaign.isClaimed(claim.index)).to.be.true;
        }
      }

      console.log(
        `✓ Successfully processed claims from ${allCampaigns.length} campaigns`
      );
    });
  });

  describe("Gas Optimization Verification", function () {
    it("Should measure gas costs for key operations", async function () {
      const { registry, signers, addresses } = await loadFixture(
        deployLoadFixture
      );

      // Measure Factory creation gas
      const serverId = generateServerIds(1)[0];
      const owner = signers[1];
      const factoryCreationTx = await registry
        .connect(owner)
        .createFactoryForServer(serverId, await owner.getAddress());
      const factoryCreationReceipt = await factoryCreationTx.wait();
      const factoryCreationGas = factoryCreationReceipt!.gasUsed;

      const factory = await ethers.getContractAt(
        "AirdropFactory",
        await registry.getFactoryByServerId(serverId)
      );

      // Measure Campaign creation gas
      const token = await deployMockERC20();
      const creator = signers[2];
      const claims = generateTestClaims(5, addresses.slice(0, 5), undefined, 0);
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

      const campaignCreationTx = await factory
        .connect(creator)
        .createAirdropAndFund(
          await token.getAddress(),
          merkleTreeData.root,
          "ipfs://test",
          totalAmount
        );
      const campaignCreationReceipt = await campaignCreationTx.wait();
      const campaignCreationGas = campaignCreationReceipt!.gasUsed;

      // Measure Claim gas
      const campaignCreatedEvent = campaignCreationReceipt?.logs.find((log) => {
        try {
          const parsed = factory.interface.parseLog(log as any);
          return parsed?.name === "AirdropCampaignCreated";
        } catch {
          return false;
        }
      });

      if (campaignCreatedEvent) {
        const parsed = factory.interface.parseLog(campaignCreatedEvent as any);
        const campaignAddress = parsed?.args[0];
        const campaign = await ethers.getContractAt(
          "MerkleAirdrop",
          campaignAddress
        );

        const claimIndex = 0;
        const claim = claims[claimIndex];
        const user =
          signers.find(
            async (s) =>
              (await s.getAddress()).toLowerCase() ===
              claim.account.toLowerCase()
          ) || signers[0];
        const userAddress = await user.getAddress();
        const proof = generateMerkleProof(merkleTreeData, claimIndex);
        const amount =
          typeof claim.amount === "string"
            ? BigInt(claim.amount)
            : claim.amount;

        const claimTx = await campaign
          .connect(user)
          .claim(claim.index, userAddress, amount, proof);
        const claimReceipt = await claimTx.wait();
        const claimGas = claimReceipt!.gasUsed;

        console.log(`\nGas Usage:`);
        console.log(`  Factory Creation: ${factoryCreationGas.toString()}`);
        console.log(`  Campaign Creation: ${campaignCreationGas.toString()}`);
        console.log(`  Claim: ${claimGas.toString()}`);
      }
    });
  });
});
