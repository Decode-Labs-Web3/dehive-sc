import { ethers } from "hardhat";
import fs from "fs";
import path from "path";
import { DehiveProxy, PaymentHub } from "../../typechain-types";

/**
 * Script to verify that DehiveProxy can read and write to PaymentHub facet
 *
 * This script:
 * 1. Loads proxy and PaymentHub facet addresses
 * 2. Tests reading functions through proxy
 * 3. Tests writing functions through proxy (if owner)
 * 4. Verifies all PaymentHub functions are accessible
 *
 * Usage: npx hardhat run scripts/payment/verifyProxyPaymentHub.ts --network <network>
 */

interface TestResult {
  test: string;
  status: "PASS" | "FAIL";
  message: string;
  details?: any;
}

async function main() {
  console.log("=".repeat(80));
  console.log("Verifying DehiveProxy Can Read/Write to PaymentHub");
  console.log("=".repeat(80));

  // Get network info
  const network = await ethers.provider.getNetwork();
  const networkName = network.name || "unknown";

  console.log(`\nNetwork: ${networkName}`);

  // Get signer
  const deployer = (await ethers.getSigners())[0];
  console.log(`\nDeployer: ${deployer.address}`);

  // ========== STEP 1: LOAD ADDRESSES ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 1: Loading Contract Addresses");
  console.log("=".repeat(80));

  const deploymentsDir = path.join(__dirname, "../../deployments");
  const deploymentFile = path.join(
    deploymentsDir,
    `${
      networkName === "sepolia" ? "sepolia" : networkName
    }_paymentHubFacet.json`
  );

  let proxyAddress: string;
  let facetAddress: string;

  if (fs.existsSync(deploymentFile)) {
    const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf-8"));
    proxyAddress = deployment.proxyAddress;
    facetAddress = deployment.facetAddress;
    console.log(`✓ Loaded from deployment file: ${deploymentFile}`);
  } else {
    // Try environment variables
    proxyAddress = process.env.PROXY_ADDRESS || "";
    facetAddress = process.env.PAYMENTHUB_FACET_ADDRESS || "";

    if (!proxyAddress || !facetAddress) {
      throw new Error(
        `Deployment file not found and addresses not provided via env vars.\n` +
          `Please provide PROXY_ADDRESS and PAYMENTHUB_FACET_ADDRESS`
      );
    }
    console.log(`✓ Using addresses from environment variables`);
  }

  console.log(`\n📦 Contracts:`);
  console.log(`  DehiveProxy: ${proxyAddress}`);
  console.log(`  PaymentHub Facet: ${facetAddress}`);

  // Connect to contracts
  const ProxyFactory = await ethers.getContractFactory("DehiveProxy");
  const proxy = ProxyFactory.attach(proxyAddress) as DehiveProxy;

  const PaymentHubFactory = await ethers.getContractFactory("PaymentHub");
  const paymentHubViaProxy = PaymentHubFactory.attach(
    proxyAddress
  ) as PaymentHub;
  const paymentHubFacet = PaymentHubFactory.attach(facetAddress) as PaymentHub;

  console.log(`✓ Connected to contracts`);

  // ========== STEP 2: VERIFY FACET INSTALLATION ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 2: Verifying Facet Installation");
  console.log("=".repeat(80));

  const results: TestResult[] = [];

  try {
    // Check if facet is installed
    const installedSelectors = await proxy.facetFunctionSelectors(facetAddress);
    console.log(
      `✓ PaymentHub facet has ${installedSelectors.length} function selectors installed`
    );

    if (installedSelectors.length === 0) {
      results.push({
        test: "Facet Installation",
        status: "FAIL",
        message: "PaymentHub facet has no selectors installed",
      });
      throw new Error("PaymentHub facet is not installed");
    }

    results.push({
      test: "Facet Installation",
      status: "PASS",
      message: `${installedSelectors.length} selectors installed`,
      details: { selectors: installedSelectors },
    });
  } catch (error: any) {
    results.push({
      test: "Facet Installation",
      status: "FAIL",
      message: error.message,
    });
    throw error;
  }

  // ========== STEP 3: TEST READ FUNCTIONS ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 3: Testing Read Functions Through Proxy");
  console.log("=".repeat(80));

  // Test 1: transactionFeePercent()
  try {
    const fee = await paymentHubViaProxy.transactionFeePercent();
    console.log(`✓ transactionFeePercent(): ${fee} basis points`);
    results.push({
      test: "Read: transactionFeePercent",
      status: "PASS",
      message: `Fee: ${fee} basis points`,
    });
  } catch (error: any) {
    console.log(`❌ transactionFeePercent(): ${error.message}`);
    results.push({
      test: "Read: transactionFeePercent",
      status: "FAIL",
      message: error.message,
    });
  }

  // Test 2: owner()
  try {
    const owner = await paymentHubViaProxy.owner();
    console.log(`✓ owner(): ${owner}`);
    results.push({
      test: "Read: owner",
      status: "PASS",
      message: `Owner: ${owner}`,
    });
  } catch (error: any) {
    console.log(`❌ owner(): ${error.message}`);
    results.push({
      test: "Read: owner",
      status: "FAIL",
      message: error.message,
    });
  }

  // Test 3: accumulatedFees()
  try {
    const fees = await paymentHubViaProxy.accumulatedFees(ethers.ZeroAddress);
    console.log(`✓ accumulatedFees(native): ${ethers.formatEther(fees)} ETH`);
    results.push({
      test: "Read: accumulatedFees",
      status: "PASS",
      message: `Native fees: ${ethers.formatEther(fees)} ETH`,
    });
  } catch (error: any) {
    console.log(`❌ accumulatedFees(): ${error.message}`);
    results.push({
      test: "Read: accumulatedFees",
      status: "FAIL",
      message: error.message,
    });
  }

  // Test 4: computeConversationId()
  try {
    // Use two test addresses (properly formatted)
    const user1 = deployer.address;
    const user2 = "0x0000000000000000000000000000000000000001"; // Simple test address
    const conversationId = await paymentHubViaProxy.computeConversationId(
      user1,
      user2
    );
    console.log(`✓ computeConversationId(): ${conversationId}`);
    results.push({
      test: "Read: computeConversationId",
      status: "PASS",
      message: `Conversation ID: ${conversationId}`,
    });
  } catch (error: any) {
    console.log(`❌ computeConversationId(): ${error.message}`);
    results.push({
      test: "Read: computeConversationId",
      status: "FAIL",
      message: error.message,
    });
  }

  // ========== STEP 4: TEST WRITE FUNCTIONS ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 4: Testing Write Functions Through Proxy");
  console.log("=".repeat(80));

  // Test 1: setTransactionFee() (owner only)
  try {
    const currentFee = await paymentHubViaProxy.transactionFeePercent();
    const newFee = currentFee === 0n ? 100n : 0n; // Toggle between 0 and 100

    console.log(`Testing setTransactionFee(${newFee})...`);
    console.log(`  Current fee: ${currentFee} basis points`);
    console.log(`  Setting to: ${newFee} basis points`);

    const tx = await paymentHubViaProxy
      .connect(deployer)
      .setTransactionFee(newFee);
    const receipt = await tx.wait();
    console.log(`  Transaction confirmed in block: ${receipt!.blockNumber}`);

    // Wait a bit for state to update
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const updatedFee = await paymentHubViaProxy.transactionFeePercent();
    console.log(`  Updated fee: ${updatedFee} basis points`);

    if (updatedFee === newFee) {
      console.log(
        `✓ setTransactionFee(): Successfully set fee to ${newFee} basis points`
      );
      results.push({
        test: "Write: setTransactionFee",
        status: "PASS",
        message: `Fee set to ${newFee} basis points`,
      });
    } else {
      throw new Error(
        `Fee not updated correctly. Expected ${newFee}, got ${updatedFee}`
      );
    }
  } catch (error: any) {
    console.log(`❌ setTransactionFee(): ${error.message}`);
    results.push({
      test: "Write: setTransactionFee",
      status: "FAIL",
      message: error.message,
    });
  }

  // ========== STEP 5: SUMMARY ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 5: Test Summary");
  console.log("=".repeat(80));

  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;

  console.log(`\n📊 Results:`);
  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`  Total: ${results.length}`);

  console.log(`\n📝 Details:`);
  results.forEach((result) => {
    const icon = result.status === "PASS" ? "✅" : "❌";
    console.log(`  ${icon} ${result.test}: ${result.message}`);
  });

  // Generate Etherscan links
  if (networkName === "sepolia") {
    console.log(`\n🔗 Etherscan Links (Sepolia):`);
    console.log(
      `  DehiveProxy: https://sepolia.etherscan.io/address/${proxyAddress}#code`
    );
    console.log(
      `  PaymentHub Facet: https://sepolia.etherscan.io/address/${facetAddress}#code`
    );
  } else if (networkName === "mainnet") {
    console.log(`\n🔗 Etherscan Links (Mainnet):`);
    console.log(
      `  DehiveProxy: https://etherscan.io/address/${proxyAddress}#code`
    );
    console.log(
      `  PaymentHub Facet: https://etherscan.io/address/${facetAddress}#code`
    );
  }

  // Save results
  const resultsFile = path.join(
    deploymentsDir,
    `paymentHub_proxy_verification_${networkName}_${Date.now()}.json`
  );
  fs.writeFileSync(
    resultsFile,
    JSON.stringify(
      {
        network: networkName,
        proxyAddress,
        facetAddress,
        verifiedAt: new Date().toISOString(),
        results,
        summary: {
          passed,
          failed,
          total: results.length,
        },
      },
      null,
      2
    )
  );
  console.log(`\n📝 Results saved to: ${resultsFile}`);

  console.log("\n" + "=".repeat(80));
  if (failed === 0) {
    console.log("✅ All Tests Passed! Proxy can read and write to PaymentHub.");
  } else {
    console.log("⚠️  Some Tests Failed. Check details above.");
  }
  console.log("=".repeat(80));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Verification failed:");
    console.error(error);
    process.exit(1);
  });
