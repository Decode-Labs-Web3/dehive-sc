import { run, ethers } from "hardhat";
import fs from "fs";
import path from "path";

/**
 * PaymentHub Contract Verification Script
 *
 * This script verifies PaymentHub contract on Etherscan using Hardhat's verify plugin.
 * It reads deployment information from deployment files and verifies contracts with their
 * constructor arguments.
 *
 * Usage:
 *   npx hardhat run scripts/payment/verifyPaymentHub.ts --network sepolia
 *
 * Requirements:
 *   - ETHERSCAN_API_KEY in .env file
 *   - Deployment file in deployments/ directory OR PAYMENTHUB_FACET_ADDRESS env var
 *   - Contracts must be compiled
 */

interface DeploymentInfo {
  proxyAddress?: string;
  facetAddress?: string;
  owner?: string;
  deployer?: string;
  transactionFeePercent?: number;
  functionSelectors?: string[];
  transactionHashes?: {
    facetDeployment?: string;
    facetInstallation?: string;
  };
  blockNumbers?: {
    facetDeployment?: number;
    facetInstallation?: number;
  };
}

async function main() {
  console.log("=".repeat(80));
  console.log("PaymentHub Contract Verification Script");
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
    `sepolia_paymentHubFacet.json`
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
    const facetAddress = process.env.PAYMENTHUB_FACET_ADDRESS;

    if (facetAddress) {
      deploymentInfo.facetAddress = facetAddress;
      console.log(`✓ Using PAYMENTHUB_FACET_ADDRESS from env: ${facetAddress}`);
    }

    if (!deploymentInfo.facetAddress) {
      throw new Error(
        "No deployment info found. Please provide addresses via:\n" +
          "  1. Deployment file: deployments/sepolia_paymentHubFacet.json\n" +
          "  2. Environment variable: PAYMENTHUB_FACET_ADDRESS"
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

  // ========== VERIFY PAYMENTHUB FACET ==========
  if (deploymentInfo.facetAddress) {
    const facetAddress = deploymentInfo.facetAddress;

    console.log("\n" + "=".repeat(80));
    console.log("Verifying PaymentHub Facet (PaymentHub.sol)");
    console.log("=".repeat(80));
    console.log(`Address: ${facetAddress}`);

    try {
      // Verify PaymentHub with constructor arguments
      // The PaymentHub constructor takes an owner address
      const owner = deploymentInfo.owner || deploymentInfo.deployer;

      if (!owner) {
        throw new Error(
          "Owner address not found in deployment info. Cannot verify PaymentHub."
        );
      }

      console.log(`Constructor Arguments:`);
      console.log(`  Owner: ${owner}`);

      await run("verify:verify", {
        address: facetAddress,
        constructorArguments: [owner],
        libraries: {
          // PaymentHubStorage is a library that's compiled inline, not deployed separately
          // If your build uses separate library deployment, add it here:
          // PaymentHubStorage: "0x..."
        },
      });

      console.log(`✅ PaymentHub Facet verified successfully`);
      verificationResults.push({
        contract: "PaymentHub",
        address: facetAddress,
        status: "success",
      });
    } catch (error: any) {
      const errorMessage = error.message || String(error);
      console.log(`❌ Failed to verify PaymentHub: ${errorMessage}`);

      // Check if already verified
      if (
        errorMessage.includes("Already Verified") ||
        errorMessage.includes("already verified")
      ) {
        console.log(`   ℹ️  Contract is already verified on Etherscan`);
        verificationResults.push({
          contract: "PaymentHub",
          address: facetAddress,
          status: "skipped",
          error: "Already verified",
        });
      } else {
        verificationResults.push({
          contract: "PaymentHub",
          address: facetAddress,
          status: "failed",
          error: errorMessage,
        });
      }
    }
  } else {
    console.log(
      `\n⚠️  PaymentHub Facet address not found, skipping verification`
    );
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
    `verification_results_paymentHub_${networkName}_${Date.now()}.json`
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
