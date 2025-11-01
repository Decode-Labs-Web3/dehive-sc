import { run, ethers } from "hardhat";
import fs from "fs";
import path from "path";

/**
 * Etherscan Contract Verification Script
 *
 * This script verifies all deployed contracts on Etherscan using Hardhat's verify plugin.
 * It reads deployment information from deployment files and verifies contracts with their
 * constructor arguments and library dependencies.
 *
 * Usage:
 *   npx hardhat run scripts/dehive/verifyContracts.ts --network sepolia
 *
 * Requirements:
 *   - ETHERSCAN_API_KEY in .env file
 *   - Deployment files in deployments/ directory
 *   - Contracts must be compiled
 */

interface DeploymentInfo {
  proxyAddress?: string;
  facetAddress?: string;
  messageFacetAddress?: string;
  contractAddress?: string;
  transactionHash?: string;
  blockNumber?: number;
  owner?: string;
  deployer?: string;
  relayer?: string;
}

async function main() {
  console.log("=".repeat(80));
  console.log("Etherscan Contract Verification Script");
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
  const deploymentFile = path.join(
    deploymentsDir,
    `sepolia_dehiveProxy_messageFacet.json`
  );

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
    const proxyAddress = process.env.PROXY_ADDRESS;
    const facetAddress = process.env.MESSAGE_FACET_ADDRESS;

    if (proxyAddress) {
      deploymentInfo.proxyAddress = proxyAddress;
      console.log(`✓ Using PROXY_ADDRESS from env: ${proxyAddress}`);
    }
    if (facetAddress) {
      deploymentInfo.facetAddress = facetAddress;
      deploymentInfo.messageFacetAddress = facetAddress;
      console.log(`✓ Using MESSAGE_FACET_ADDRESS from env: ${facetAddress}`);
    }

    if (!deploymentInfo.proxyAddress && !deploymentInfo.facetAddress) {
      throw new Error(
        "No deployment info found. Please provide addresses via:\n" +
          "  1. Deployment file: deployments/sepolia_dehiveProxy_messageFacet.json\n" +
          "  2. Environment variables: PROXY_ADDRESS, MESSAGE_FACET_ADDRESS"
      );
    }
  }

  // Verify contracts
  const verificationResults: Array<{
    contract: string;
    address: string;
    status: "success" | "failed" | "skipped";
    error?: string;
  }> = [];

  // ========== VERIFY MESSAGE FACET ==========
  if (deploymentInfo.facetAddress || deploymentInfo.messageFacetAddress) {
    const facetAddress =
      deploymentInfo.facetAddress || deploymentInfo.messageFacetAddress!;

    console.log("\n" + "=".repeat(80));
    console.log("Verifying MessageFacet (Message.sol)");
    console.log("=".repeat(80));
    console.log(`Address: ${facetAddress}`);

    try {
      // Verify MessageFacet with constructor arguments
      // The Message constructor takes an owner address
      const owner = deploymentInfo.owner || deploymentInfo.deployer;

      if (!owner) {
        throw new Error(
          "Owner address not found in deployment info. Cannot verify MessageFacet."
        );
      }

      console.log(`Constructor Arguments:`);
      console.log(`  Owner: ${owner}`);

      await run("verify:verify", {
        address: facetAddress,
        constructorArguments: [owner],
        libraries: {
          // MessageStorage is a library that's compiled inline, not deployed separately
          // If your build uses separate library deployment, add it here:
          // MessageStorage: "0x..."
        },
      });

      console.log(`✅ MessageFacet verified successfully`);
      verificationResults.push({
        contract: "MessageFacet",
        address: facetAddress,
        status: "success",
      });
    } catch (error: any) {
      const errorMessage = error.message || String(error);
      console.log(`❌ Failed to verify MessageFacet: ${errorMessage}`);

      // Check if already verified
      if (
        errorMessage.includes("Already Verified") ||
        errorMessage.includes("already verified")
      ) {
        console.log(`   ℹ️  Contract is already verified on Etherscan`);
        verificationResults.push({
          contract: "MessageFacet",
          address: facetAddress,
          status: "skipped",
          error: "Already verified",
        });
      } else {
        verificationResults.push({
          contract: "MessageFacet",
          address: facetAddress,
          status: "failed",
          error: errorMessage,
        });
      }
    }
  } else {
    console.log(`\n⚠️  MessageFacet address not found, skipping verification`);
  }

  // ========== VERIFY DEHIVE PROXY ==========
  if (deploymentInfo.proxyAddress) {
    console.log("\n" + "=".repeat(80));
    console.log("Verifying DehiveProxy");
    console.log("=".repeat(80));
    console.log(`Address: ${deploymentInfo.proxyAddress}`);

    try {
      // DehiveProxy has no constructor arguments
      await run("verify:verify", {
        address: deploymentInfo.proxyAddress,
        constructorArguments: [],
      });

      console.log(`✅ DehiveProxy verified successfully`);
      verificationResults.push({
        contract: "DehiveProxy",
        address: deploymentInfo.proxyAddress,
        status: "success",
      });
    } catch (error: any) {
      const errorMessage = error.message || String(error);
      console.log(`❌ Failed to verify DehiveProxy: ${errorMessage}`);

      // Check if already verified
      if (
        errorMessage.includes("Already Verified") ||
        errorMessage.includes("already verified")
      ) {
        console.log(`   ℹ️  Contract is already verified on Etherscan`);
        verificationResults.push({
          contract: "DehiveProxy",
          address: deploymentInfo.proxyAddress,
          status: "skipped",
          error: "Already verified",
        });
      } else {
        verificationResults.push({
          contract: "DehiveProxy",
          address: deploymentInfo.proxyAddress,
          status: "failed",
          error: errorMessage,
        });
      }
    }
  } else {
    console.log(`\n⚠️  DehiveProxy address not found, skipping verification`);
  }

  // ========== VERIFY MESSAGE STORAGE LIBRARY (if deployed separately) ==========
  // Note: MessageStorage is typically linked at compile time, not deployed separately
  // Only verify if it was deployed as a separate contract

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
    `verification_results_${networkName}_${Date.now()}.json`
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
