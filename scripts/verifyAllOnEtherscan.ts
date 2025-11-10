import { run, ethers } from "hardhat";
import fs from "fs";
import path from "path";

/**
 * Comprehensive Etherscan Verification Script for DehiveProxy and All Facets
 *
 * This script verifies:
 * 1. DehiveProxy contract (no constructor args)
 * 2. Message facet (with constructor args)
 * 3. PaymentHub facet (with constructor args)
 *
 * IMPORTANT: Diamond proxies don't work with Etherscan's automatic proxy detection.
 * Each contract must be verified separately.
 *
 * Usage:
 *   npx hardhat run scripts/verifyAllOnEtherscan.ts --network sepolia
 *
 * Requirements:
 *   - ETHERSCAN_API_KEY in .env file
 *   - Deployment files in deployments/ directory OR environment variables
 *   - Contracts must be compiled
 */

interface DeploymentInfo {
  proxyAddress?: string;
  messageFacetAddress?: string;
  paymentHubFacetAddress?: string;
  owner?: string;
  deployer?: string;
  transactionHashes?: {
    proxyDeployment?: string;
    messageFacetDeployment?: string;
    paymentHubFacetDeployment?: string;
  };
  blockNumbers?: {
    proxyDeployment?: number;
    messageFacetDeployment?: number;
    paymentHubFacetDeployment?: number;
  };
}

async function verifyContract(
  address: string,
  constructorArgs: any[] = [],
  contractName?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`\n  Verifying ${contractName || address}...`);
    await run("verify:verify", {
      address: address,
      constructorArguments: constructorArgs,
    });
    console.log(`  ✓ Successfully verified ${contractName || address}`);
    return { success: true };
  } catch (error: any) {
    // Check if already verified
    if (
      error.message.includes("Already Verified") ||
      error.message.includes("already verified")
    ) {
      console.log(`  ✓ Already verified: ${contractName || address}`);
      return { success: true };
    }
    console.log(`  ❌ Failed to verify ${contractName || address}`);
    console.log(`     Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log("=".repeat(80));
  console.log("Etherscan Verification: DehiveProxy + All Facets");
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

  const deploymentsDir = path.join(__dirname, "../deployments");

  // Try to load deployment info
  let deploymentInfo: DeploymentInfo = {};

  // Try to load from deployAll deployment file (most recent)
  const deployAllFiles = fs
    .readdirSync(deploymentsDir)
    .filter((f) => f.includes("deployAll") && f.endsWith(".json"))
    .sort()
    .reverse();

  if (deployAllFiles.length > 0) {
    const latestDeployAllFile = path.join(deploymentsDir, deployAllFiles[0]);
    deploymentInfo = JSON.parse(fs.readFileSync(latestDeployAllFile, "utf-8"));
    console.log(`\n✓ Loaded deployment info from: ${latestDeployAllFile}`);
  } else {
    // Try to load from individual deployment files
    const proxyDeploymentFile = path.join(
      deploymentsDir,
      `${networkName}_dehiveProxy_messageFacet.json`
    );
    const paymentHubDeploymentFile = path.join(
      deploymentsDir,
      `${networkName}_paymentHubFacet.json`
    );

    if (fs.existsSync(proxyDeploymentFile)) {
      const proxyDeployment = JSON.parse(
        fs.readFileSync(proxyDeploymentFile, "utf-8")
      );
      deploymentInfo.proxyAddress =
        proxyDeployment.proxyAddress || proxyDeployment.contractAddress;
      deploymentInfo.messageFacetAddress =
        proxyDeployment.facetAddress || proxyDeployment.messageFacetAddress;
      deploymentInfo.owner = proxyDeployment.owner;
      console.log(`✓ Loaded proxy deployment from: ${proxyDeploymentFile}`);
    }

    if (fs.existsSync(paymentHubDeploymentFile)) {
      const paymentHubDeployment = JSON.parse(
        fs.readFileSync(paymentHubDeploymentFile, "utf-8")
      );
      deploymentInfo.paymentHubFacetAddress = paymentHubDeployment.facetAddress;
      console.log(
        `✓ Loaded PaymentHub deployment from: ${paymentHubDeploymentFile}`
      );
    }
  }

  // Allow environment variables to override
  if (process.env.PROXY_ADDRESS) {
    deploymentInfo.proxyAddress = process.env.PROXY_ADDRESS;
    console.log(
      `✓ Using PROXY_ADDRESS from env: ${deploymentInfo.proxyAddress}`
    );
  }

  if (process.env.MESSAGE_FACET_ADDRESS) {
    deploymentInfo.messageFacetAddress = process.env.MESSAGE_FACET_ADDRESS;
    console.log(
      `✓ Using MESSAGE_FACET_ADDRESS from env: ${deploymentInfo.messageFacetAddress}`
    );
  }

  if (process.env.PAYMENTHUB_FACET_ADDRESS) {
    deploymentInfo.paymentHubFacetAddress = process.env.PAYMENT_FACET_ADDRESS;
    console.log(
      `✓ Using PAYMENT_FACET_ADDRESS from env: ${deploymentInfo.paymentHubFacetAddress}`
    );
  }

  // Validate addresses
  if (!deploymentInfo.proxyAddress) {
    throw new Error(
      "Proxy address not found. Please provide via:\n" +
        "  1. Deployment file: deployments/<network>_deployAll_*.json\n" +
        "  2. Environment variable: PROXY_ADDRESS"
    );
  }

  if (!deploymentInfo.messageFacetAddress) {
    console.log(
      `\n⚠️  Warning: Message facet address not found. Skipping Message facet verification.`
    );
  }

  if (!deploymentInfo.paymentHubFacetAddress) {
    console.log(
      `\n⚠️  Warning: PaymentHub facet address not found. Skipping PaymentHub facet verification.`
    );
  }

  // Get owner address for constructor args
  let ownerAddress = deploymentInfo.owner;
  if (!ownerAddress) {
    // Try to get owner from proxy
    try {
      const ProxyFactory = await ethers.getContractFactory("DehiveProxy");
      const proxy = ProxyFactory.attach(deploymentInfo.proxyAddress) as any;
      ownerAddress = await proxy.owner();
      console.log(`✓ Retrieved owner from proxy: ${ownerAddress}`);
    } catch (error: any) {
      console.log(`⚠️  Could not retrieve owner from proxy: ${error.message}`);
      console.log(
        `   You may need to provide owner address manually for facet verification.`
      );
    }
  }

  if (!ownerAddress) {
    const [deployer] = await ethers.getSigners();
    ownerAddress = deployer.address;
    console.log(
      `⚠️  Using deployer address as owner: ${ownerAddress} (may be incorrect)`
    );
  }

  // ========== VERIFY CONTRACTS ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 1: Verifying DehiveProxy");
  console.log("=".repeat(80));

  const verificationResults: Array<{
    contract: string;
    address: string;
    status: "success" | "failed" | "skipped";
    error?: string;
  }> = [];

  // Verify Proxy (no constructor args)
  const proxyResult = await verifyContract(
    deploymentInfo.proxyAddress,
    [],
    "DehiveProxy"
  );
  verificationResults.push({
    contract: "DehiveProxy",
    address: deploymentInfo.proxyAddress,
    status: proxyResult.success ? "success" : "failed",
    error: proxyResult.error,
  });

  // Verify Message Facet (with constructor args)
  if (deploymentInfo.messageFacetAddress) {
    console.log("\n" + "=".repeat(80));
    console.log("Step 2: Verifying Message Facet");
    console.log("=".repeat(80));

    const messageResult = await verifyContract(
      deploymentInfo.messageFacetAddress,
      [ownerAddress],
      "Message"
    );
    verificationResults.push({
      contract: "Message",
      address: deploymentInfo.messageFacetAddress,
      status: messageResult.success ? "success" : "failed",
      error: messageResult.error,
    });
  } else {
    verificationResults.push({
      contract: "Message",
      address: "N/A",
      status: "skipped",
    });
  }

  // Verify PaymentHub Facet (with constructor args)
  if (deploymentInfo.paymentHubFacetAddress) {
    console.log("\n" + "=".repeat(80));
    console.log("Step 3: Verifying PaymentHub Facet");
    console.log("=".repeat(80));

    const paymentHubResult = await verifyContract(
      deploymentInfo.paymentHubFacetAddress,
      [ownerAddress],
      "PaymentHub"
    );
    verificationResults.push({
      contract: "PaymentHub",
      address: deploymentInfo.paymentHubFacetAddress,
      status: paymentHubResult.success ? "success" : "failed",
      error: paymentHubResult.error,
    });
  } else {
    verificationResults.push({
      contract: "PaymentHub",
      address: "N/A",
      status: "skipped",
    });
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
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`  ⏭️  Skipped: ${skipped}`);

  console.log(`\n📝 Details:`);
  verificationResults.forEach((result) => {
    const statusIcon =
      result.status === "success"
        ? "✅"
        : result.status === "failed"
        ? "❌"
        : "⏭️";
    console.log(`  ${statusIcon} ${result.contract}: ${result.address}`);
    if (result.error) {
      console.log(`     Error: ${result.error}`);
    }
  });

  // Generate Etherscan links
  if (networkName === "sepolia") {
    console.log(`\n🔗 Etherscan Links (Sepolia):`);
    console.log(
      `  DehiveProxy: https://sepolia.etherscan.io/address/${deploymentInfo.proxyAddress}#code`
    );
    if (deploymentInfo.messageFacetAddress) {
      console.log(
        `  Message Facet: https://sepolia.etherscan.io/address/${deploymentInfo.messageFacetAddress}#code`
      );
    }
    if (deploymentInfo.paymentHubFacetAddress) {
      console.log(
        `  PaymentHub Facet: https://sepolia.etherscan.io/address/${deploymentInfo.paymentHubFacetAddress}#code`
      );
    }
  } else if (networkName === "mainnet") {
    console.log(`\n🔗 Etherscan Links (Mainnet):`);
    console.log(
      `  DehiveProxy: https://etherscan.io/address/${deploymentInfo.proxyAddress}#code`
    );
    if (deploymentInfo.messageFacetAddress) {
      console.log(
        `  Message Facet: https://etherscan.io/address/${deploymentInfo.messageFacetAddress}#code`
      );
    }
    if (deploymentInfo.paymentHubFacetAddress) {
      console.log(
        `  PaymentHub Facet: https://etherscan.io/address/${deploymentInfo.paymentHubFacetAddress}#code`
      );
    }
  }

  // Important note about Diamond proxy verification
  console.log("\n" + "=".repeat(80));
  console.log("Important Notes");
  console.log("=".repeat(80));
  console.log(`
⚠️  DIAMOND PROXY VERIFICATION:

Etherscan's automatic proxy detection does NOT work with Diamond proxies.
This is expected behavior - Diamond proxies use a different pattern than
standard EIP-1967 proxies.

WHAT THIS MEANS:
- The proxy contract is verified separately (✓ Done above)
- Each facet is verified separately (✓ Done above)
- Etherscan will show "No implementation contract detected" for the proxy
- This is NORMAL and does not affect functionality

HOW TO USE:
- Users can interact with the proxy address directly
- The proxy will route calls to the appropriate facet
- All facets are verified, so users can inspect the code

VERIFICATION STATUS:
- Proxy: ${proxyResult.success ? "✅ Verified" : "❌ Failed"}
- Message Facet: ${
    deploymentInfo.messageFacetAddress
      ? verificationResults.find((r) => r.contract === "Message")?.status ===
        "success"
        ? "✅ Verified"
        : "❌ Failed"
      : "⏭️  Not deployed"
  }
- PaymentHub Facet: ${
    deploymentInfo.paymentHubFacetAddress
      ? verificationResults.find((r) => r.contract === "PaymentHub")?.status ===
        "success"
        ? "✅ Verified"
        : "❌ Failed"
      : "⏭️  Not deployed"
  }
`);

  if (failed > 0) {
    console.log(`\n⚠️  Some verifications failed. Check the errors above.`);
    process.exit(1);
  } else {
    console.log(`\n✅ All verifications completed successfully!`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Verification failed:");
    console.error(error);
    process.exit(1);
  });
