import { ethers } from "hardhat";
import fs from "fs";
import path from "path";
import {
  ServerAirdropRegistry,
  AirdropFactory,
  MerkleAirdrop,
  MockERC20,
} from "../../typechain-types";

/**
 * Deployment script for Airdrop contracts to Sepolia testnet
 *
 * This script:
 * 1. Deploys MockERC20 (dummy token for MerkleAirdrop constructor)
 * 2. Deploys MerkleAirdrop implementation with dummy values
 * 3. Deploys AirdropFactory implementation (clone mode)
 * 4. Deploys ServerAirdropRegistry with both implementations
 * 5. Saves all deployment information
 *
 * Usage: npx hardhat run scripts/airdrop/deploySepolia.ts --network sepolia
 */

interface DeploymentInfo {
  network: string;
  registryAddress: string;
  factoryImplementationAddress: string;
  merkleAirdropImplementationAddress: string;
  dummyTokenAddress: string;
  owner: string;
  deployer: string;
  deployedAt: number;
  transactionHashes: {
    dummyTokenDeployment: string;
    merkleAirdropDeployment: string;
    factoryDeployment: string;
    registryDeployment: string;
  };
  blockNumbers: {
    dummyTokenDeployment: number;
    merkleAirdropDeployment: number;
    factoryDeployment: number;
    registryDeployment: number;
  };
}

async function main() {
  console.log("=".repeat(80));
  console.log("Deploying Airdrop Contracts to Sepolia");
  console.log("=".repeat(80));

  // Get network info
  const network = await ethers.provider.getNetwork();
  const networkName = network.name || "sepolia";
  const chainId = network.chainId.toString();

  console.log(`\nNetwork: ${networkName}`);
  console.log(`Chain ID: ${chainId}`);

  // Get signer from PRIVATE_KEY
  const deployer = (await ethers.getSigners())[0];
  const owner = deployer; // Same account for owner

  console.log(`\n📋 Deployment Configuration:`);
  console.log(`  Deployer: ${deployer.address}`);
  console.log(`  Owner: ${owner.address} (same as deployer)`);

  // Check balance
  const deployerBalance = await ethers.provider.getBalance(deployer.address);

  console.log(`\n💰 Account Balance:`);
  console.log(`  Deployer/Owner: ${ethers.formatEther(deployerBalance)} ETH`);

  if (deployerBalance < ethers.parseEther("0.01")) {
    console.warn(
      "\n⚠️  WARNING: Deployer balance is low. Deployment may fail!"
    );
  }

  // ========== STEP 1: DEPLOY DUMMY TOKEN ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 1: Deploying MockERC20 (dummy token)");
  console.log("=".repeat(80));

  console.log("Deploying MockERC20 contract...");
  const MockERC20Factory = await ethers.getContractFactory("MockERC20");
  const dummyToken = await MockERC20Factory.deploy(
    "Dummy Token",
    "DUMMY",
    18,
    ethers.parseEther("1000000")
  );
  await dummyToken.waitForDeployment();
  const dummyTokenAddress = await dummyToken.getAddress();

  const dummyTokenDeployTx = dummyToken.deploymentTransaction();
  const dummyTokenDeployReceipt = dummyTokenDeployTx
    ? await dummyTokenDeployTx.wait()
    : null;
  const dummyTokenBlockNumber =
    dummyTokenDeployReceipt?.blockNumber ||
    (await ethers.provider.getBlockNumber());

  console.log(`✓ MockERC20 deployed at: ${dummyTokenAddress}`);
  console.log(`✓ Transaction: ${dummyTokenDeployReceipt?.hash || "N/A"}`);
  console.log(
    `✓ Block number: ${
      dummyTokenDeployReceipt?.blockNumber || dummyTokenBlockNumber
    }`
  );

  // ========== STEP 2: DEPLOY MERKLE AIRDROP IMPLEMENTATION ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 2: Deploying MerkleAirdrop Implementation");
  console.log("=".repeat(80));

  console.log("Deploying MerkleAirdrop contract...");
  const MerkleAirdropFactory = await ethers.getContractFactory("MerkleAirdrop");
  const deployerAddress = await deployer.getAddress();
  const dummyMerkleRoot = ethers.keccak256("0x00");
  const dummyMetadataURI = "ipfs://dummy";
  const dummyTotalAmount = ethers.parseEther("1000");

  const merkleAirdropImplementation = await MerkleAirdropFactory.deploy(
    dummyTokenAddress,
    deployerAddress,
    dummyMerkleRoot,
    dummyMetadataURI,
    dummyTotalAmount
  );
  await merkleAirdropImplementation.waitForDeployment();
  const merkleAirdropAddress = await merkleAirdropImplementation.getAddress();

  const merkleDeployTx = merkleAirdropImplementation.deploymentTransaction();
  const merkleDeployReceipt = merkleDeployTx
    ? await merkleDeployTx.wait()
    : null;
  const merkleBlockNumber =
    merkleDeployReceipt?.blockNumber ||
    (await ethers.provider.getBlockNumber());

  console.log(`✓ MerkleAirdrop deployed at: ${merkleAirdropAddress}`);
  console.log(`✓ Transaction: ${merkleDeployReceipt?.hash || "N/A"}`);
  console.log(
    `✓ Block number: ${merkleDeployReceipt?.blockNumber || merkleBlockNumber}`
  );

  // ========== STEP 3: DEPLOY AIRDROP FACTORY IMPLEMENTATION ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 3: Deploying AirdropFactory Implementation");
  console.log("=".repeat(80));

  console.log("Deploying AirdropFactory contract...");
  const AirdropFactoryFactory = await ethers.getContractFactory(
    "AirdropFactory"
  );
  // Pass address(0) for clone mode
  const factoryImplementation = await AirdropFactoryFactory.deploy(
    ethers.ZeroAddress
  );
  await factoryImplementation.waitForDeployment();
  const factoryAddress = await factoryImplementation.getAddress();

  const factoryDeployTx = factoryImplementation.deploymentTransaction();
  const factoryDeployReceipt = factoryDeployTx
    ? await factoryDeployTx.wait()
    : null;
  const factoryBlockNumber =
    factoryDeployReceipt?.blockNumber ||
    (await ethers.provider.getBlockNumber());

  console.log(`✓ AirdropFactory deployed at: ${factoryAddress}`);
  console.log(`✓ Transaction: ${factoryDeployReceipt?.hash || "N/A"}`);
  console.log(
    `✓ Block number: ${factoryDeployReceipt?.blockNumber || factoryBlockNumber}`
  );

  // ========== STEP 4: DEPLOY REGISTRY ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 4: Deploying ServerAirdropRegistry");
  console.log("=".repeat(80));

  console.log("Deploying ServerAirdropRegistry contract...");
  const RegistryFactory = await ethers.getContractFactory(
    "ServerAirdropRegistry"
  );
  const registry = await RegistryFactory.deploy(
    factoryAddress,
    merkleAirdropAddress
  );
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();

  const registryDeployTx = registry.deploymentTransaction();
  const registryDeployReceipt = registryDeployTx
    ? await registryDeployTx.wait()
    : null;
  const registryBlockNumber =
    registryDeployReceipt?.blockNumber ||
    (await ethers.provider.getBlockNumber());

  console.log(`✓ ServerAirdropRegistry deployed at: ${registryAddress}`);
  console.log(`✓ Transaction: ${registryDeployReceipt?.hash || "N/A"}`);
  console.log(
    `✓ Block number: ${
      registryDeployReceipt?.blockNumber || registryBlockNumber
    }`
  );

  // ========== STEP 5: VERIFY DEPLOYMENT ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 5: Verifying Deployment");
  console.log("=".repeat(80));

  // Verify registry has correct implementations
  const registryFactoryImpl = await registry.factoryImplementation();
  const registryMerkleImpl = await registry.merkleAirdropImplementation();

  console.log(
    `✓ Registry Factory Implementation: ${registryFactoryImpl} ${
      registryFactoryImpl === factoryAddress ? "✓" : "✗"
    }`
  );
  console.log(
    `✓ Registry Merkle Implementation: ${registryMerkleImpl} ${
      registryMerkleImpl === merkleAirdropAddress ? "✓" : "✗"
    }`
  );

  if (registryFactoryImpl !== factoryAddress) {
    throw new Error("Registry factory implementation mismatch!");
  }
  if (registryMerkleImpl !== merkleAirdropAddress) {
    throw new Error("Registry merkle implementation mismatch!");
  }

  // Verify factory implementation
  const factoryImplValue = await factoryImplementation.implementation();
  console.log(
    `✓ Factory Implementation value: ${factoryImplValue} ${
      factoryImplValue === ethers.ZeroAddress ? "✓ (clone mode)" : "✗"
    }`
  );

  // ========== STEP 6: SAVE DEPLOYMENT INFO ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 6: Saving Deployment Information");
  console.log("=".repeat(80));

  const deploymentInfo: DeploymentInfo = {
    network: networkName,
    registryAddress: registryAddress,
    factoryImplementationAddress: factoryAddress,
    merkleAirdropImplementationAddress: merkleAirdropAddress,
    dummyTokenAddress: dummyTokenAddress,
    owner: deployerAddress,
    deployer: deployerAddress,
    deployedAt: Date.now(),
    transactionHashes: {
      dummyTokenDeployment: dummyTokenDeployReceipt?.hash || "",
      merkleAirdropDeployment: merkleDeployReceipt?.hash || "",
      factoryDeployment: factoryDeployReceipt?.hash || "",
      registryDeployment: registryDeployReceipt?.hash || "",
    },
    blockNumbers: {
      dummyTokenDeployment:
        dummyTokenDeployReceipt?.blockNumber || dummyTokenBlockNumber,
      merkleAirdropDeployment:
        merkleDeployReceipt?.blockNumber || merkleBlockNumber,
      factoryDeployment:
        factoryDeployReceipt?.blockNumber || factoryBlockNumber,
      registryDeployment:
        registryDeployReceipt?.blockNumber || registryBlockNumber,
    },
  };

  // Save deployment info
  const deploymentsDir = path.join(__dirname, "../../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const deploymentFile = path.join(deploymentsDir, `sepolia_airdrop.json`);
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));

  console.log(`✓ Deployment info saved to: ${deploymentFile}`);

  // ========== FINAL SUMMARY ==========
  console.log("\n" + "=".repeat(80));
  console.log("Deployment Summary");
  console.log("=".repeat(80));
  console.log(`Network: ${networkName} (Chain ID: ${chainId})`);
  console.log(`\n📦 Contracts:`);
  console.log(`  ServerAirdropRegistry: ${registryAddress}`);
  console.log(`  AirdropFactory Implementation: ${factoryAddress}`);
  console.log(`  MerkleAirdrop Implementation: ${merkleAirdropAddress}`);
  console.log(`  MockERC20 (Dummy): ${dummyTokenAddress}`);
  console.log(`\n👤 Roles:`);
  console.log(`  Owner/Deployer: ${deployerAddress}`);
  console.log(`\n📄 Transactions:`);
  console.log(
    `  Dummy Token: ${deploymentInfo.transactionHashes.dummyTokenDeployment}`
  );
  console.log(
    `  MerkleAirdrop: ${deploymentInfo.transactionHashes.merkleAirdropDeployment}`
  );
  console.log(
    `  AirdropFactory: ${deploymentInfo.transactionHashes.factoryDeployment}`
  );
  console.log(
    `  Registry: ${deploymentInfo.transactionHashes.registryDeployment}`
  );
  console.log(`\n📍 Block Numbers:`);
  console.log(
    `  Dummy Token: ${deploymentInfo.blockNumbers.dummyTokenDeployment}`
  );
  console.log(
    `  MerkleAirdrop: ${deploymentInfo.blockNumbers.merkleAirdropDeployment}`
  );
  console.log(
    `  AirdropFactory: ${deploymentInfo.blockNumbers.factoryDeployment}`
  );
  console.log(`  Registry: ${deploymentInfo.blockNumbers.registryDeployment}`);
  console.log("\n" + "=".repeat(80));
  console.log("✅ Deployment Completed Successfully!");
  console.log("=".repeat(80));
  console.log(`\n📝 Deployment file: ${deploymentFile}`);
  console.log(
    `\n🔗 Explorer Links (Sepolia):\n  Registry: https://sepolia.etherscan.io/address/${registryAddress}\n  Factory: https://sepolia.etherscan.io/address/${factoryAddress}\n  MerkleAirdrop: https://sepolia.etherscan.io/address/${merkleAirdropAddress}\n  Dummy Token: https://sepolia.etherscan.io/address/${dummyTokenAddress}`
  );
  console.log(
    `\n💡 Next Steps:\n  1. Run verification: npx hardhat run scripts/airdrop/verifyContracts.ts --network sepolia\n  2. Use Registry.createFactoryForServer() to create factory clones for each server`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Deployment failed:");
    console.error(error);
    process.exit(1);
  });
