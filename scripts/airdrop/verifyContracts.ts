import { run, ethers } from "hardhat";
import fs from "fs";
import path from "path";

/**
 * Etherscan Contract Verification Script for Airdrop Contracts
 *
 * This script verifies all deployed airdrop contracts on Etherscan using Hardhat's verify plugin.
 * It reads deployment information from deployment files and verifies contracts with their
 * constructor arguments.
 *
 * Usage:
 *   npx hardhat run scripts/airdrop/verifyContracts.ts --network sepolia
 *
 * Requirements:
 *   - ETHERSCAN_API_KEY in .env file
 *   - Deployment files in deployments/ directory
 *   - Contracts must be compiled
 */

interface DeploymentInfo {
  network?: string;
  registryAddress?: string;
  factoryImplementationAddress?: string;
  merkleAirdropImplementationAddress?: string;
  dummyTokenAddress?: string;
  owner?: string;
  deployer?: string;
  transactionHashes?: {
    dummyTokenDeployment?: string;
    merkleAirdropDeployment?: string;
    factoryDeployment?: string;
    registryDeployment?: string;
  };
  blockNumbers?: {
    dummyTokenDeployment?: number;
    merkleAirdropDeployment?: number;
    factoryDeployment?: number;
    registryDeployment?: number;
  };
}

interface VerificationResult {
  contract: string;
  address: string;
  status: "success" | "failed" | "skipped";
  error?: string;
}

async function main() {
  console.log("=".repeat(80));
  console.log("Etherscan Contract Verification Script - Airdrop Contracts");
  console.log("=".repeat(80));

  // Get network info
  const network = await ethers.provider.getNetwork();
  const networkName = network.name || "unknown";
  const chainId = network.chainId.toString();

  console.log(`\nNetwork: ${networkName} (Chain ID: ${chainId})`);

  // Check if Etherscan API key is set
  const etherscanApiKey = process.env.ETHERSCAN_API_KEY;
  if (!etherscanApiKey) {
    throw new Error(
      "ETHERSCAN_API_KEY not found in .env file. Please set it before running verification."
    );
  }
  console.log(`✓ Etherscan API Key found`);

  const deploymentsDir = path.join(__dirname, "../../deployments");
  const deploymentFile = path.join(deploymentsDir, `sepolia_airdrop.json`);

  let deploymentInfo: DeploymentInfo = {};

  // Load deployment info
  if (fs.existsSync(deploymentFile)) {
    deploymentInfo = JSON.parse(fs.readFileSync(deploymentFile, "utf-8"));
    console.log(`\n✓ Loaded deployment info from: ${deploymentFile}`);
  } else {
    console.log(`\n⚠️  Deployment file not found: ${deploymentFile}`);
    console.log(
      `   You can specify addresses manually or create a deployment file.`
    );

    // Allow manual address input
    const registryAddress = process.env.REGISTRY_ADDRESS;
    const factoryAddress = process.env.FACTORY_ADDRESS;
    const merkleAddress = process.env.MERKLE_AIRDROP_ADDRESS;
    const dummyTokenAddress = process.env.DUMMY_TOKEN_ADDRESS;

    if (registryAddress) {
      deploymentInfo.registryAddress = registryAddress;
      console.log(`✓ Using REGISTRY_ADDRESS from env: ${registryAddress}`);
    }
    if (factoryAddress) {
      deploymentInfo.factoryImplementationAddress = factoryAddress;
      console.log(`✓ Using FACTORY_ADDRESS from env: ${factoryAddress}`);
    }
    if (merkleAddress) {
      deploymentInfo.merkleAirdropImplementationAddress = merkleAddress;
      console.log(`✓ Using MERKLE_AIRDROP_ADDRESS from env: ${merkleAddress}`);
    }
    if (dummyTokenAddress) {
      deploymentInfo.dummyTokenAddress = dummyTokenAddress;
      console.log(`✓ Using DUMMY_TOKEN_ADDRESS from env: ${dummyTokenAddress}`);
    }

    if (
      !deploymentInfo.registryAddress &&
      !deploymentInfo.factoryImplementationAddress &&
      !deploymentInfo.merkleAirdropImplementationAddress
    ) {
      throw new Error(
        "No deployment info found. Please provide addresses via:\n" +
          "  1. Deployment file: deployments/sepolia_airdrop.json\n" +
          "  2. Environment variables: REGISTRY_ADDRESS, FACTORY_ADDRESS, MERKLE_AIRDROP_ADDRESS"
      );
    }
  }

  // Verify contracts
  const verificationResults: VerificationResult[] = [];

  // ========== VERIFY MERKLE AIRDROP IMPLEMENTATION ==========
  if (deploymentInfo.merkleAirdropImplementationAddress) {
    const merkleAddress = deploymentInfo.merkleAirdropImplementationAddress;

    console.log("\n" + "=".repeat(80));
    console.log("Verifying MerkleAirdrop Implementation");
    console.log("=".repeat(80));
    console.log(`Address: ${merkleAddress}`);

    try {
      // MerkleAirdrop constructor takes: token, owner, merkleRoot, metadataURI, totalAmount
      // From the deployment script, we used:
      // - dummyTokenAddress
      // - deployerAddress (owner)
      // - keccak256("0x00") (dummy merkle root)
      // - "ipfs://dummy" (dummy metadata URI)
      // - parseEther("1000") (dummy total amount)

      const owner =
        deploymentInfo.owner || deploymentInfo.deployer || ethers.ZeroAddress;
      const dummyToken = deploymentInfo.dummyTokenAddress || ethers.ZeroAddress;
      const dummyMerkleRoot = ethers.keccak256("0x00");
      const dummyMetadataURI = "ipfs://dummy";
      const dummyTotalAmount = ethers.parseEther("1000");

      console.log(`Constructor Arguments:`);
      console.log(`  Token: ${dummyToken}`);
      console.log(`  Owner: ${owner}`);
      console.log(`  Merkle Root: ${dummyMerkleRoot}`);
      console.log(`  Metadata URI: ${dummyMetadataURI}`);
      console.log(`  Total Amount: ${dummyTotalAmount.toString()}`);

      await run("verify:verify", {
        address: merkleAddress,
        constructorArguments: [
          dummyToken,
          owner,
          dummyMerkleRoot,
          dummyMetadataURI,
          dummyTotalAmount,
        ],
      });

      console.log(`✅ MerkleAirdrop verified successfully`);
      verificationResults.push({
        contract: "MerkleAirdrop",
        address: merkleAddress,
        status: "success",
      });
    } catch (error: any) {
      const errorMessage = error.message || String(error);
      console.log(`❌ Failed to verify MerkleAirdrop: ${errorMessage}`);

      // Check if already verified
      if (
        errorMessage.includes("Already Verified") ||
        errorMessage.includes("already verified")
      ) {
        console.log(`   ℹ️  Contract is already verified on Etherscan`);
        verificationResults.push({
          contract: "MerkleAirdrop",
          address: merkleAddress,
          status: "skipped",
          error: "Already verified",
        });
      } else {
        verificationResults.push({
          contract: "MerkleAirdrop",
          address: merkleAddress,
          status: "failed",
          error: errorMessage,
        });
      }
    }
  } else {
    console.log(`\n⚠️  MerkleAirdrop address not found, skipping verification`);
  }

  // ========== VERIFY AIRDROP FACTORY IMPLEMENTATION ==========
  if (deploymentInfo.factoryImplementationAddress) {
    const factoryAddress = deploymentInfo.factoryImplementationAddress;

    console.log("\n" + "=".repeat(80));
    console.log("Verifying AirdropFactory Implementation");
    console.log("=".repeat(80));
    console.log(`Address: ${factoryAddress}`);

    try {
      // AirdropFactory constructor takes: implementation_ (address(0) for clone mode)
      console.log(`Constructor Arguments:`);
      console.log(`  Implementation: ${ethers.ZeroAddress} (clone mode)`);

      await run("verify:verify", {
        address: factoryAddress,
        constructorArguments: [ethers.ZeroAddress],
      });

      console.log(`✅ AirdropFactory verified successfully`);
      verificationResults.push({
        contract: "AirdropFactory",
        address: factoryAddress,
        status: "success",
      });
    } catch (error: any) {
      const errorMessage = error.message || String(error);
      console.log(`❌ Failed to verify AirdropFactory: ${errorMessage}`);

      // Check if already verified
      if (
        errorMessage.includes("Already Verified") ||
        errorMessage.includes("already verified")
      ) {
        console.log(`   ℹ️  Contract is already verified on Etherscan`);
        verificationResults.push({
          contract: "AirdropFactory",
          address: factoryAddress,
          status: "skipped",
          error: "Already verified",
        });
      } else {
        verificationResults.push({
          contract: "AirdropFactory",
          address: factoryAddress,
          status: "failed",
          error: errorMessage,
        });
      }
    }
  } else {
    console.log(
      `\n⚠️  AirdropFactory address not found, skipping verification`
    );
  }

  // ========== VERIFY SERVER AIRDROP REGISTRY ==========
  if (deploymentInfo.registryAddress) {
    console.log("\n" + "=".repeat(80));
    console.log("Verifying ServerAirdropRegistry");
    console.log("=".repeat(80));
    console.log(`Address: ${deploymentInfo.registryAddress}`);

    try {
      // ServerAirdropRegistry constructor takes: factoryImplementation_, merkleAirdropImplementation_
      const factoryImpl =
        deploymentInfo.factoryImplementationAddress || ethers.ZeroAddress;
      const merkleImpl =
        deploymentInfo.merkleAirdropImplementationAddress || ethers.ZeroAddress;

      if (
        factoryImpl === ethers.ZeroAddress ||
        merkleImpl === ethers.ZeroAddress
      ) {
        throw new Error(
          "Factory or MerkleAirdrop implementation addresses not found in deployment info"
        );
      }

      console.log(`Constructor Arguments:`);
      console.log(`  Factory Implementation: ${factoryImpl}`);
      console.log(`  MerkleAirdrop Implementation: ${merkleImpl}`);

      await run("verify:verify", {
        address: deploymentInfo.registryAddress,
        constructorArguments: [factoryImpl, merkleImpl],
      });

      console.log(`✅ ServerAirdropRegistry verified successfully`);
      verificationResults.push({
        contract: "ServerAirdropRegistry",
        address: deploymentInfo.registryAddress,
        status: "success",
      });
    } catch (error: any) {
      const errorMessage = error.message || String(error);
      console.log(`❌ Failed to verify ServerAirdropRegistry: ${errorMessage}`);

      // Check if already verified
      if (
        errorMessage.includes("Already Verified") ||
        errorMessage.includes("already verified")
      ) {
        console.log(`   ℹ️  Contract is already verified on Etherscan`);
        verificationResults.push({
          contract: "ServerAirdropRegistry",
          address: deploymentInfo.registryAddress,
          status: "skipped",
          error: "Already verified",
        });
      } else {
        verificationResults.push({
          contract: "ServerAirdropRegistry",
          address: deploymentInfo.registryAddress,
          status: "failed",
          error: errorMessage,
        });
      }
    }
  } else {
    console.log(
      `\n⚠️  ServerAirdropRegistry address not found, skipping verification`
    );
  }

  // ========== VERIFY MOCK ERC20 (Optional) ==========
  // Note: MockERC20 is just a temporary contract for deployment, typically doesn't need verification
  // But we'll verify it if address is provided
  if (deploymentInfo.dummyTokenAddress) {
    const dummyTokenAddress = deploymentInfo.dummyTokenAddress;

    console.log("\n" + "=".repeat(80));
    console.log("Verifying MockERC20 (Dummy Token)");
    console.log("=".repeat(80));
    console.log(`Address: ${dummyTokenAddress}`);
    console.log(
      `ℹ️  Note: This is a temporary dummy token for MerkleAirdrop constructor`
    );

    try {
      // MockERC20 constructor takes: name, symbol, decimals, initialSupply
      // From deployment script: "Dummy Token", "DUMMY", 18, parseEther("1000000")
      await run("verify:verify", {
        address: dummyTokenAddress,
        constructorArguments: [
          "Dummy Token",
          "DUMMY",
          18,
          ethers.parseEther("1000000"),
        ],
      });

      console.log(`✅ MockERC20 verified successfully`);
      verificationResults.push({
        contract: "MockERC20",
        address: dummyTokenAddress,
        status: "success",
      });
    } catch (error: any) {
      const errorMessage = error.message || String(error);
      console.log(`❌ Failed to verify MockERC20: ${errorMessage}`);

      // Check if already verified
      if (
        errorMessage.includes("Already Verified") ||
        errorMessage.includes("already verified")
      ) {
        console.log(`   ℹ️  Contract is already verified on Etherscan`);
        verificationResults.push({
          contract: "MockERC20",
          address: dummyTokenAddress,
          status: "skipped",
          error: "Already verified",
        });
      } else {
        // MockERC20 verification failure is not critical
        console.log(`   ℹ️  Skipping MockERC20 verification (not critical)`);
        verificationResults.push({
          contract: "MockERC20",
          address: dummyTokenAddress,
          status: "skipped",
          error: errorMessage,
        });
      }
    }
  }

  // ========== SUMMARY ==========
  console.log("\n" + "=".repeat(80));
  console.log("Verification Summary");
  console.log("=".repeat(80));

  const successful = verificationResults.filter(
    (r) => r.status === "success"
  ).length;
  const failed = verificationResults.filter(
    (r) => r.status === "failed"
  ).length;
  const skipped = verificationResults.filter(
    (r) => r.status === "skipped"
  ).length;

  console.log(`\n📊 Results:`);
  console.log(`  ✅ Successful: ${successful}`);
  console.log(`  ⏭️  Skipped (already verified): ${skipped}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`  Total: ${verificationResults.length}`);

  if (verificationResults.length > 0) {
    console.log(`\n📝 Details:`);
    verificationResults.forEach((result) => {
      const statusIcon =
        result.status === "success"
          ? "✅"
          : result.status === "skipped"
          ? "⏭️"
          : "❌";
      console.log(`  ${statusIcon} ${result.contract}: ${result.address}`);
      if (result.error) {
        console.log(`     ${result.error}`);
      }
    });
  }

  // Generate Etherscan links
  if (networkName === "sepolia") {
    console.log(`\n🔗 Etherscan Links (Sepolia):`);
    verificationResults.forEach((result) => {
      if (result.status === "success" || result.status === "skipped") {
        console.log(
          `  ${result.contract}: https://sepolia.etherscan.io/address/${result.address}#code`
        );
      }
    });
  } else if (networkName === "mainnet") {
    console.log(`\n🔗 Etherscan Links (Mainnet):`);
    verificationResults.forEach((result) => {
      if (result.status === "success" || result.status === "skipped") {
        console.log(
          `  ${result.contract}: https://etherscan.io/address/${result.address}#code`
        );
      }
    });
  }

  // Save verification results
  const resultsFile = path.join(
    deploymentsDir,
    `verification_results_airdrop_${networkName}_${Date.now()}.json`
  );
  fs.writeFileSync(
    resultsFile,
    JSON.stringify(
      {
        network: networkName,
        chainId: chainId,
        verifiedAt: new Date().toISOString(),
        results: verificationResults,
        deploymentInfo: deploymentInfo,
      },
      null,
      2
    )
  );
  console.log(`\n📝 Verification results saved to: ${resultsFile}`);

  console.log("\n" + "=".repeat(80));
  if (failed === 0) {
    console.log("✅ All Contract Verifications Completed Successfully!");
  } else {
    console.log("⚠️  Some Contract Verifications Failed");
  }
  console.log("=".repeat(80));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Verification script failed:");
    console.error(error);
    process.exit(1);
  });
