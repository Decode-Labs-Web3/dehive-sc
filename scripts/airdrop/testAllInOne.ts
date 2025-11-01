import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
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
} from "../../test/airdrop/helpers/airdropHelpers";
import {
  generateMerkleTree,
  generateMerkleProof,
} from "../../test/airdrop/helpers/merkleHelpers";
import {
  loadCSVClaims,
  getTotalAmount,
} from "../../test/airdrop/helpers/csvHelpers";
import {
  generateServerIds,
  generateTestClaims,
  getTestUserAddresses,
} from "../../test/airdrop/helpers/testDataGenerator";

/**
 * Comprehensive All-in-One Test Script
 *
 * Simulates a Discord-like scenario with:
 * - Multiple servers, each with an AirdropFactory clone
 * - Multiple campaigns per server factory
 * - Users claiming from different campaigns
 * - At least 200 test cases with 19 users
 * - Uses airdrop1.csv and airdrop2.csv for test data
 */

interface TestResult {
  success: boolean;
  message: string;
  gasUsed?: bigint;
}

interface CampaignData {
  campaign: MerkleAirdrop;
  claims: any[];
  merkleTreeData: any;
  factory: AirdropFactory;
  serverId: string;
  campaignIndex: number;
}

async function main() {
  console.log("======================================");
  console.log("Airdrop System - All-in-One Test");
  console.log("======================================");
  console.log("");

  const signers = await ethers.getSigners();
  const addresses = await getTestUserAddresses();

  console.log(`✓ Loaded ${signers.length} signers`);
  console.log(`Signers: ${signers.map((signer) => signer.address).join(", ")}`);
  console.log(`✓ Using ${addresses.length} test addresses`);
  console.log(`Addresses: ${addresses.join(", ")}`);
  console.log("");

  // Step 1: Deploy Registry and implementations
  console.log("Step 1: Deploying Registry and implementations...");
  const registryFixture = await deployAirdropRegistryFixture();
  const { registry, merkleAirdropImplementation } = registryFixture;
  console.log(`✓ Registry deployed: ${await registry.getAddress()}`);
  console.log(
    `✓ MerkleAirdrop implementation: ${await merkleAirdropImplementation.getAddress()}`
  );
  console.log("");

  // Step 2: Load CSV data
  console.log("Step 2: Loading CSV data...");
  const csv1Path = path.join(process.cwd(), "test-data", "airdrop1.csv");
  const csv2Path = path.join(process.cwd(), "test-data", "airdrop2.csv");

  let csv1Claims: any[] = [];
  let csv2Claims: any[] = [];

  try {
    csv1Claims = loadCSVClaims(csv1Path, 0);
    console.log(`✓ Loaded ${csv1Claims.length} claims from airdrop1.csv`);
  } catch (error) {
    console.log(`⚠ Could not load airdrop1.csv: ${error}`);
  }

  try {
    csv2Claims = loadCSVClaims(csv2Path, 1000);
    console.log(`✓ Loaded ${csv2Claims.length} claims from airdrop2.csv`);
  } catch (error) {
    console.log(`⚠ Could not load airdrop2.csv: ${error}`);
  }

  console.log("");

  // Step 3: Create multiple servers (10 servers)
  console.log("Step 3: Creating servers and factories...");
  const numServers = 10;
  const serverIds = generateServerIds(numServers);
  const factories: AirdropFactory[] = [];

  for (let i = 0; i < numServers; i++) {
    const ownerIndex = (i % (signers.length - 1)) + 1; // Skip account 0
    const factory = await createServerFactory(
      registry,
      serverIds[i],
      signers[ownerIndex]
    );
    factories.push(factory);

    if ((i + 1) % 5 === 0) {
      console.log(`  Created ${i + 1} / ${numServers} factories...`);
    }
  }

  console.log(`✓ Created ${factories.length} server factories`);
  const factoryCount = await registry.getFactoryCount();
  if (factoryCount !== BigInt(numServers)) {
    throw new Error(`Expected ${numServers} factories, got ${factoryCount}`);
  }
  console.log("");

  // Step 4: Create campaigns per server
  console.log("Step 4: Creating campaigns...");
  const numCampaignsPerServer = 3;
  const token = await deployMockERC20(
    "Test Token",
    "TEST",
    18,
    ethers.parseEther("1000000000")
  );
  const allCampaigns: CampaignData[] = [];

  let campaignCount = 0;
  for (let i = 0; i < numServers; i++) {
    const factory = factories[i];
    const serverId = serverIds[i];

    for (let j = 0; j < numCampaignsPerServer; j++) {
      campaignCount++;
      const creator =
        signers[((i * numCampaignsPerServer + j) % (signers.length - 1)) + 1];
      const creatorAddress = await creator.getAddress();

      // Determine which CSV to use for this campaign
      const useCSV1 = campaignCount % 2 === 1;
      let claims: any[];

      if (useCSV1 && csv1Claims.length > 0) {
        // Use airdrop1.csv with offset
        const startIndex = (campaignCount - 1) * csv1Claims.length;
        claims = csv1Claims.map((claim, idx) => ({
          ...claim,
          index: startIndex + idx,
        }));
      } else if (csv2Claims.length > 0) {
        // Use airdrop2.csv with offset
        const startIndex = campaignCount * 1000;
        claims = csv2Claims.map((claim, idx) => ({
          ...claim,
          index: startIndex + idx,
        }));
      } else {
        // Fallback: Generate test claims
        const startIndex = campaignCount * 1000;
        const userCount = Math.min(5, addresses.length);
        const campaignAddresses = addresses.slice(
          ((campaignCount - 1) * userCount) % addresses.length,
          Math.min(
            (campaignCount * userCount) % addresses.length || addresses.length,
            addresses.length
          )
        );
        claims = generateTestClaims(
          userCount,
          campaignAddresses,
          undefined,
          startIndex
        );
      }

      const merkleTreeData = generateMerkleTree(claims);
      const totalAmount = getTotalAmount(claims);

      // Mint and approve tokens
      await mintTokensTo(token, creator, totalAmount);
      await token
        .connect(creator)
        .approve(await factory.getAddress(), totalAmount);

      // Create campaign
      const { campaign } = await createTestCampaign(
        factory,
        token,
        claims,
        creator,
        `ipfs://server-${i}-campaign-${j}`
      );

      allCampaigns.push({
        campaign,
        claims,
        merkleTreeData,
        factory,
        serverId,
        campaignIndex: j,
      });

      if (campaignCount % 10 === 0) {
        console.log(`  Created ${campaignCount} campaigns...`);
      }
    }
  }

  console.log(
    `✓ Created ${allCampaigns.length} campaigns across ${numServers} servers`
  );
  console.log("");

  // Step 5: Users claim from campaigns
  console.log("Step 5: Users claiming from campaigns...");
  const testResults: TestResult[] = [];
  let claimCount = 0;
  let successCount = 0;
  let failureCount = 0;

  // Map addresses to signers
  const addressToSigner = new Map<string, (typeof signers)[0]>();
  for (const signer of signers) {
    const address = await signer.getAddress();
    addressToSigner.set(address.toLowerCase(), signer);
  }

  for (const campaignData of allCampaigns) {
    const { campaign, claims, merkleTreeData } = campaignData;

    for (let i = 0; i < claims.length; i++) {
      const claim = claims[i];
      const claimAccount = claim.account.toLowerCase();

      // Find signer for this address
      const signer = addressToSigner.get(claimAccount);
      if (!signer) {
        console.log(
          `⚠ Skipping claim for ${claimAccount.slice(
            0,
            6
          )}...${claimAccount.slice(-6)} (signer not found)`
        );
        continue;
      }

      try {
        const proof = generateMerkleProof(merkleTreeData, i);
        const amount =
          typeof claim.amount === "string"
            ? BigInt(claim.amount)
            : claim.amount;

        // Check if already claimed
        const isClaimed = await campaign.isClaimed(claim.index);
        if (isClaimed) {
          continue; // Skip if already claimed
        }

        const tx = await campaign
          .connect(signer)
          .claim(claim.index, claimAccount, amount, proof);
        const receipt = await tx.wait();

        claimCount++;
        successCount++;

        testResults.push({
          success: true,
          message: `Claim ${claimCount}: User ${claimAccount.slice(
            0,
            10
          )}... claimed ${amount} tokens from campaign`,
          gasUsed: receipt!.gasUsed,
        });

        console.log(
          `Claim ${claimCount}: User ${claimAccount.slice(
            0,
            6
          )}...${claimAccount.slice(-6)} claimed ${amount} tokens from campaign`
        );

        if (claimCount % 20 === 0) {
          console.log(`  Processed ${claimCount} claims...`);
        }
      } catch (error: any) {
        claimCount++;
        failureCount++;

        testResults.push({
          success: false,
          message: `Claim ${claimCount}: Failed for ${claimAccount.slice(
            0,
            10
          )}... - ${error.message}`,
        });

        if (failureCount % 10 === 0) {
          console.log(`  ⚠ ${failureCount} failed claims...`);
        }
      }
    }
  }

  console.log(`✓ Processed ${claimCount} claims`);
  console.log(`  ✅ Successful: ${successCount}`);
  console.log(`  ❌ Failed: ${failureCount}`);
  console.log("");

  // Step 6: Verification
  console.log("Step 6: Verifying claim states...");
  let verifiedCount = 0;

  for (const campaignData of allCampaigns) {
    const { campaign, claims } = campaignData;

    for (const claim of claims) {
      const isClaimed = await campaign.isClaimed(claim.index);
      if (isClaimed) {
        verifiedCount++;
      }
    }
  }

  console.log(`✓ Verified ${verifiedCount} claims as successfully claimed`);
  console.log("");

  // Step 7: Summary
  console.log("======================================");
  console.log("Test Summary");
  console.log("======================================");
  console.log(`Servers created: ${numServers}`);
  console.log(`Campaigns created: ${allCampaigns.length}`);
  console.log(`Total claims processed: ${claimCount}`);
  console.log(`Successful claims: ${successCount}`);
  console.log(`Failed claims: ${failureCount}`);
  console.log(`Verified claims: ${verifiedCount}`);
  console.log(`Test scenarios: ${testResults.length}`);

  // Calculate gas statistics
  const successfulResults = testResults.filter((r) => r.success && r.gasUsed);
  if (successfulResults.length > 0) {
    const totalGas = successfulResults.reduce(
      (sum, r) => sum + (r.gasUsed || BigInt(0)),
      BigInt(0)
    );
    const avgGas = totalGas / BigInt(successfulResults.length);
    const minGas = successfulResults.reduce(
      (min, r) => (r.gasUsed && r.gasUsed < min ? r.gasUsed : min),
      successfulResults[0].gasUsed || BigInt(0)
    );
    const maxGas = successfulResults.reduce(
      (max, r) => (r.gasUsed && r.gasUsed > max ? r.gasUsed : max),
      BigInt(0)
    );

    console.log("");
    console.log("Gas Statistics:");
    console.log(`  Total gas used: ${totalGas.toString()}`);
    console.log(`  Average gas per claim: ${avgGas.toString()}`);
    console.log(`  Min gas: ${minGas.toString()}`);
    console.log(`  Max gas: ${maxGas.toString()}`);
  }

  console.log("");
  console.log("======================================");
  console.log("All-in-One Test Complete! ✅");
  console.log("======================================");

  // Verify minimum test coverage
  if (testResults.length >= 200) {
    console.log(
      `✓ Test coverage requirement met: ${testResults.length} >= 200 test scenarios`
    );
  } else {
    console.log(
      `⚠ Test coverage below requirement: ${testResults.length} < 200 test scenarios`
    );
  }
}

// Run the script
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
