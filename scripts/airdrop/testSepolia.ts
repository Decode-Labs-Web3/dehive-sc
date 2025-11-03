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
  generateMerkleTree,
  generateMerkleProof,
  ClaimData,
} from "../../test/airdrop/helpers/merkleHelpers";
import {
  loadCSVClaims,
  getTotalAmount,
} from "../../test/airdrop/helpers/csvHelpers";
import {
  generateServerIds,
  generateTestClaims,
} from "../../test/airdrop/helpers/testDataGenerator";

/**
 * Comprehensive Test Script for Sepolia Airdrop Contracts
 *
 * This script tests the deployed airdrop contracts on Sepolia:
 * 1. Creates a factory for a server via Registry
 * 2. Deploys/uses a token for testing
 * 3. Creates a campaign via factory
 * 4. Users claim from the campaign
 * 5. Verifies claim states
 *
 * Usage: npx hardhat run scripts/airdrop/testSepolia.ts --network sepolia
 *
 * Requires:
 * - PRIVATE_KEY, PRIVATE_KEY_A, PRIVATE_KEY_B in .env
 * - Deployed contracts on Sepolia
 */

interface TestResult {
  success: boolean;
  message: string;
  gasUsed?: bigint;
}

interface CampaignData {
  campaign: MerkleAirdrop;
  claims: ClaimData[];
  merkleTreeData: any;
  factory: AirdropFactory;
  serverId: string;
  campaignIndex: number;
}

// Deployed contract addresses on Sepolia
const DEPLOYED_ADDRESSES = {
  registry: "0xac2FeCc2Bca3221B6eEf8A92B0dF29fA0BfdAFa2",
  factory: "0xAcff01C4509cC6B2BD770F59c3c6F2061E5F0bf0",
  merkleAirdrop: "0x82953eE584b0b5Bbf097810FD538c81646A1e256",
  dummyToken: "0x71d0e59ee19A5F944f2e0E3b2fce472567c63115",
};

async function main() {
  console.log("=".repeat(80));
  console.log("Airdrop System - Sepolia Test Script");
  console.log("=".repeat(80));
  console.log("");

  // Get network info
  const network = await ethers.provider.getNetwork();
  const networkName = network.name || "sepolia";
  const chainId = network.chainId.toString();

  console.log(`Network: ${networkName} (Chain ID: ${chainId})`);
  console.log("");

  // Load signers from private keys
  const privateKey = process.env.PRIVATE_KEY;
  const privateKeyA = process.env.PRIVATE_KEY_A;
  const privateKeyB = process.env.PRIVATE_KEY_B;

  if (!privateKey || !privateKeyA || !privateKeyB) {
    throw new Error(
      "Missing private keys. Please set PRIVATE_KEY, PRIVATE_KEY_A, and PRIVATE_KEY_B in .env"
    );
  }

  const provider = ethers.provider;
  const deployer = new ethers.Wallet(privateKey, provider);
  const userA = new ethers.Wallet(privateKeyA, provider);
  const userB = new ethers.Wallet(privateKeyB, provider);

  const deployerAddress = await deployer.getAddress();
  const userAAddress = await userA.getAddress();
  const userBAddress = await userB.getAddress();

  console.log("📋 Test Accounts:");
  console.log(`  Deployer: ${deployerAddress}`);
  console.log(`  User A: ${userAAddress}`);
  console.log(`  User B: ${userBAddress}`);
  console.log("");

  // Check balances
  const deployerBalance = await provider.getBalance(deployerAddress);
  const userABalance = await provider.getBalance(userAAddress);
  const userBBalance = await provider.getBalance(userBAddress);

  console.log("💰 Account Balances:");
  console.log(
    `  Deployer: ${ethers.formatEther(deployerBalance)} ETH ${
      deployerBalance < ethers.parseEther("0.01") ? "⚠️  LOW" : ""
    }`
  );
  console.log(
    `  User A: ${ethers.formatEther(userABalance)} ETH ${
      userABalance < ethers.parseEther("0.01") ? "⚠️  LOW" : ""
    }`
  );
  console.log(
    `  User B: ${ethers.formatEther(userBBalance)} ETH ${
      userBBalance < ethers.parseEther("0.01") ? "⚠️  LOW" : ""
    }`
  );
  console.log("");

  // Connect to deployed contracts
  console.log("=".repeat(80));
  console.log("Connecting to Deployed Contracts");
  console.log("=".repeat(80));

  const RegistryFactory = await ethers.getContractFactory(
    "ServerAirdropRegistry"
  );
  const registry = RegistryFactory.attach(
    DEPLOYED_ADDRESSES.registry
  ) as ServerAirdropRegistry;

  const AirdropFactoryFactory = await ethers.getContractFactory(
    "AirdropFactory"
  );
  const factoryImplementation = AirdropFactoryFactory.attach(
    DEPLOYED_ADDRESSES.factory
  ) as AirdropFactory;

  const MerkleAirdropFactory = await ethers.getContractFactory("MerkleAirdrop");
  const merkleAirdropImplementation = MerkleAirdropFactory.attach(
    DEPLOYED_ADDRESSES.merkleAirdrop
  ) as MerkleAirdrop;

  const MockERC20Factory = await ethers.getContractFactory("MockERC20");
  const dummyToken = MockERC20Factory.attach(
    DEPLOYED_ADDRESSES.dummyToken
  ) as MockERC20;

  console.log(`✓ Registry: ${await registry.getAddress()}`);
  console.log(
    `✓ Factory Implementation: ${await factoryImplementation.getAddress()}`
  );
  console.log(
    `✓ MerkleAirdrop Implementation: ${await merkleAirdropImplementation.getAddress()}`
  );
  console.log(`✓ Dummy Token: ${await dummyToken.getAddress()}`);
  console.log("");

  // Verify implementations in registry
  const registryFactoryImpl = await registry.factoryImplementation();
  const registryMerkleImpl = await registry.merkleAirdropImplementation();

  console.log("🔍 Verifying Registry Configuration:");
  console.log(
    `  Factory Implementation: ${registryFactoryImpl} ${
      registryFactoryImpl.toLowerCase() ===
      DEPLOYED_ADDRESSES.factory.toLowerCase()
        ? "✓"
        : "✗"
    }`
  );
  console.log(
    `  Merkle Implementation: ${registryMerkleImpl} ${
      registryMerkleImpl.toLowerCase() ===
      DEPLOYED_ADDRESSES.merkleAirdrop.toLowerCase()
        ? "✓"
        : "✗"
    }`
  );
  console.log("");

  // ========== STEP 1: CREATE SERVER FACTORY ==========
  console.log("=".repeat(80));
  console.log("Step 1: Creating Server Factory");
  console.log("=".repeat(80));

  const serverId = generateServerIds(1)[0]; // Generate a single server ID
  console.log(`Creating factory for server: ${serverId}`);

  try {
    // Check if factory already exists
    const existingFactory = await registry.getFactoryByServerId(serverId);
    if (existingFactory !== ethers.ZeroAddress) {
      console.log(
        `⚠️  Factory already exists for serverId ${serverId}: ${existingFactory}`
      );
      console.log(`  Using existing factory...`);
      const factory = AirdropFactoryFactory.attach(
        existingFactory
      ) as AirdropFactory;
      console.log(`✓ Using existing factory: ${await factory.getAddress()}`);
      console.log("");
      await testWithFactory(
        factory,
        serverId,
        deployer,
        userA,
        userB,
        dummyToken,
        networkName,
        chainId
      );
    } else {
      // Create new factory
      const tx = await registry
        .connect(deployer)
        .createFactoryForServer(serverId, deployerAddress);
      const receipt = await tx.wait();

      // Extract factory address from event
      const factoryCreatedEvent = receipt?.logs.find((log) => {
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
      const factoryAddress = parsed?.args[0]; // First arg is factory address

      console.log(`✓ Factory created: ${factoryAddress}`);
      console.log(`✓ Transaction: ${tx.hash}`);
      console.log(`✓ Block number: ${receipt!.blockNumber}`);
      console.log("");

      const factory = AirdropFactoryFactory.attach(
        factoryAddress
      ) as AirdropFactory;

      await testWithFactory(
        factory,
        serverId,
        deployer,
        userA,
        userB,
        dummyToken,
        networkName,
        chainId
      );
    }
  } catch (error: any) {
    console.error(`❌ Failed to create factory: ${error.message}`);
    throw error;
  }
}

async function testWithFactory(
  factory: AirdropFactory,
  serverId: string,
  deployer: ethers.Wallet,
  userA: ethers.Wallet,
  userB: ethers.Wallet,
  token: MockERC20,
  networkName: string,
  chainId: string
) {
  // ========== STEP 2: CREATE CAMPAIGN ==========
  console.log("=".repeat(80));
  console.log("Step 2: Creating Airdrop Campaign");
  console.log("=".repeat(80));

  // Generate test claims for users
  const claims: ClaimData[] = [
    {
      index: 0,
      account: await userA.getAddress(),
      amount: ethers.parseEther("100"),
    },
    {
      index: 1,
      account: await userB.getAddress(),
      amount: ethers.parseEther("200"),
    },
    {
      index: 2,
      account: await deployer.getAddress(),
      amount: ethers.parseEther("50"),
    },
  ];

  console.log(`Creating campaign with ${claims.length} claims:`);
  claims.forEach((claim, i) => {
    console.log(
      `  Claim ${i}: ${claim.account.slice(0, 10)}...${claim.account.slice(
        -6
      )} - ${ethers.formatEther(claim.amount)} tokens`
    );
  });

  // Generate Merkle tree
  const merkleTreeData = generateMerkleTree(claims);
  const merkleRoot = merkleTreeData.root;
  const totalAmount = getTotalAmount(claims);

  console.log(`✓ Merkle root: ${merkleRoot}`);
  console.log(`✓ Total amount: ${ethers.formatEther(totalAmount)} tokens`);
  console.log("");

  // Mint tokens to deployer (campaign creator)
  console.log("Minting tokens to campaign creator...");
  try {
    const tokenBalance = await token.balanceOf(await deployer.getAddress());
    if (tokenBalance < totalAmount) {
      // Check if deployer is the owner of the token
      const tokenOwner = await token.owner();
      if (
        tokenOwner.toLowerCase() === (await deployer.getAddress()).toLowerCase()
      ) {
        const mintAmount =
          totalAmount - tokenBalance + ethers.parseEther("1000"); // Mint extra
        const mintTx = await token
          .connect(deployer)
          .mint(await deployer.getAddress(), mintAmount);
        await mintTx.wait();
        console.log(`✓ Minted ${ethers.formatEther(mintAmount)} tokens`);
      } else {
        console.log(
          `⚠️  Token owner is ${tokenOwner}, deployer cannot mint. Using existing balance...`
        );
      }
    } else {
      console.log(
        `✓ Sufficient token balance: ${ethers.formatEther(tokenBalance)}`
      );
    }
  } catch (error: any) {
    console.log(`⚠️  Could not mint tokens: ${error.message}`);
    console.log(`  Continuing with existing balance...`);
  }

  // Approve factory to spend tokens
  const approveTx = await token
    .connect(deployer)
    .approve(await factory.getAddress(), totalAmount);
  await approveTx.wait();
  console.log(
    `✓ Approved factory to spend ${ethers.formatEther(totalAmount)} tokens`
  );
  console.log("");

  // Create campaign
  console.log("Creating campaign...");
  const createTx = await factory
    .connect(deployer)
    .createAirdropAndFund(
      await token.getAddress(),
      merkleRoot,
      "ipfs://test-campaign-sepolia",
      totalAmount
    );
  const createReceipt = await createTx.wait();

  // Extract campaign address from event
  const campaignCreatedEvent = createReceipt?.logs.find((log) => {
    try {
      const parsed = factory.interface.parseLog(log as any);
      return parsed?.name === "AirdropCampaignCreated";
    } catch {
      return false;
    }
  });

  if (!campaignCreatedEvent) {
    throw new Error("AirdropCampaignCreated event not found");
  }

  const parsed = factory.interface.parseLog(campaignCreatedEvent as any);
  const campaignAddress = parsed?.args[0]; // First arg is campaign address

  console.log(`✓ Campaign created: ${campaignAddress}`);
  console.log(`✓ Transaction: ${createTx.hash}`);
  console.log(`✓ Block number: ${createReceipt!.blockNumber}`);
  console.log("");

  const MerkleAirdropFactory = await ethers.getContractFactory("MerkleAirdrop");
  const campaign = MerkleAirdropFactory.attach(
    campaignAddress
  ) as MerkleAirdrop;

  // Verify campaign details
  const campaignToken = await campaign.token();
  const campaignRoot = await campaign.merkleRoot();
  const campaignTotalAmount = await campaign.totalAmount();

  console.log("🔍 Verifying Campaign Details:");
  console.log(
    `  Token: ${campaignToken} ${
      campaignToken.toLowerCase() === (await token.getAddress()).toLowerCase()
        ? "✓"
        : "✗"
    }`
  );
  console.log(
    `  Merkle Root: ${campaignRoot} ${
      campaignRoot.toLowerCase() === merkleRoot.toLowerCase() ? "✓" : "✗"
    }`
  );
  console.log(
    `  Total Amount: ${ethers.formatEther(campaignTotalAmount)} ${
      campaignTotalAmount === totalAmount ? "✓" : "✗"
    }`
  );
  console.log("");

  // ========== STEP 3: USERS CLAIM FROM CAMPAIGN ==========
  console.log("=".repeat(80));
  console.log("Step 3: Users Claiming from Campaign");
  console.log("=".repeat(80));

  const testResults: TestResult[] = [];
  let claimCount = 0;
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < claims.length; i++) {
    const claim = claims[i];
    const claimAccount = claim.account.toLowerCase();

    // Determine which signer to use
    let signer: ethers.Wallet;
    if (claimAccount === (await userA.getAddress()).toLowerCase()) {
      signer = userA;
    } else if (claimAccount === (await userB.getAddress()).toLowerCase()) {
      signer = userB;
    } else if (claimAccount === (await deployer.getAddress()).toLowerCase()) {
      signer = deployer;
    } else {
      console.log(
        `⚠️  Skipping claim for ${claimAccount.slice(
          0,
          6
        )}...${claimAccount.slice(-6)} (signer not found)`
      );
      continue;
    }

    try {
      const proof = generateMerkleProof(merkleTreeData, i);
      const amount =
        typeof claim.amount === "string" ? BigInt(claim.amount) : claim.amount;

      // Check if already claimed
      const isClaimed = await campaign.isClaimed(claim.index);
      if (isClaimed) {
        console.log(
          `⏭️  Claim ${claim.index} already claimed by ${claimAccount.slice(
            0,
            6
          )}...${claimAccount.slice(-6)}`
        );
        continue;
      }

      console.log(
        `Claiming for ${claimAccount.slice(0, 10)}...${claimAccount.slice(
          -6
        )} (${ethers.formatEther(amount)} tokens)...`
      );

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
        )}... claimed ${ethers.formatEther(amount)} tokens`,
        gasUsed: receipt!.gasUsed,
      });

      console.log(
        `✅ Claim ${claimCount}: User ${claimAccount.slice(
          0,
          6
        )}...${claimAccount.slice(-6)} claimed ${ethers.formatEther(
          amount
        )} tokens`
      );
      console.log(`   Transaction: ${tx.hash}`);
      console.log(`   Gas used: ${receipt!.gasUsed.toString()}`);
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

      console.log(
        `❌ Claim ${claimCount}: Failed for ${claimAccount.slice(
          0,
          6
        )}...${claimAccount.slice(-6)}`
      );
      console.log(`   Error: ${error.message}`);
    }
  }

  console.log("");
  console.log(`✓ Processed ${claimCount} claims`);
  console.log(`  ✅ Successful: ${successCount}`);
  console.log(`  ❌ Failed: ${failureCount}`);
  console.log("");

  // ========== STEP 4: VERIFICATION ==========
  console.log("=".repeat(80));
  console.log("Step 4: Verifying Claim States");
  console.log("=".repeat(80));

  let verifiedCount = 0;

  for (const claim of claims) {
    const isClaimed = await campaign.isClaimed(claim.index);
    if (isClaimed) {
      verifiedCount++;
      console.log(
        `✓ Claim ${claim.index} verified as claimed (${claim.account.slice(
          0,
          6
        )}...${claim.account.slice(-6)})`
      );
    } else {
      console.log(
        `✗ Claim ${claim.index} not claimed (${claim.account.slice(
          0,
          6
        )}...${claim.account.slice(-6)})`
      );
    }
  }

  console.log("");
  console.log(`✓ Verified ${verifiedCount} claims as successfully claimed`);

  // Check campaign balance
  const campaignBalance = await token.balanceOf(await campaign.getAddress());
  console.log(
    `✓ Campaign balance: ${ethers.formatEther(campaignBalance)} tokens`
  );
  console.log("");

  // ========== FINAL SUMMARY ==========
  console.log("=".repeat(80));
  console.log("Test Summary");
  console.log("=".repeat(80));
  console.log(`Network: ${networkName} (Chain ID: ${chainId})`);
  console.log(`Server ID: ${serverId}`);
  console.log(`Campaign: ${await campaign.getAddress()}`);
  console.log(`Total claims processed: ${claimCount}`);
  console.log(`Successful claims: ${successCount}`);
  console.log(`Failed claims: ${failureCount}`);
  console.log(`Verified claims: ${verifiedCount}`);

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
  console.log("=".repeat(80));
  console.log("✅ Sepolia Test Complete!");
  console.log("=".repeat(80));
  console.log(
    `\n🔗 Explorer Links:\n  Campaign: https://sepolia.etherscan.io/address/${await campaign.getAddress()}\n  Factory: https://sepolia.etherscan.io/address/${await factory.getAddress()}\n  Registry: https://sepolia.etherscan.io/address/${
      DEPLOYED_ADDRESSES.registry
    }`
  );
}

// Run the script
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
