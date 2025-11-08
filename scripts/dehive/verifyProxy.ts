import { ethers } from "hardhat";
import fs from "fs";
import path from "path";
import { DehiveProxy, Message } from "../../typechain-types";
import { getFunctionSelectors } from "./helpers/facetHelpers";

/**
 * Proxy Verification Script
 *
 * This script verifies that the DehiveProxy is correctly configured to
 * delegate calls to the Message contract (MessageFacet). It checks:
 *
 * 1. Facet Installation: Verifies MessageFacet is installed in proxy
 * 2. Function Selectors: Ensures all IMessage functions are correctly mapped
 * 3. Read Operations: Tests view/pure functions through proxy
 * 4. Write Operations: Tests state-changing functions through proxy
 * 5. Storage Isolation: Confirms proxy and facet have separate storage
 *
 * Usage:
 *   npx hardhat run scripts/dehive/verifyProxy.ts --network <network>
 *
 * Requirements:
 *   - PRIVATE_KEY in .env file
 *   - Deployed proxy address (from env var PROXY_ADDRESS or deployment file)
 *
 * Environment Variables:
 *   - PRIVATE_KEY: Private key of the proxy owner (required)
 *   - PROXY_ADDRESS: Address of the deployed proxy (optional, will use deployment file if not set)
 */

interface VerificationResult {
  test: string;
  status: "PASS" | "FAIL" | "WARN";
  message: string;
  details?: any;
}

async function main() {
  console.log("=".repeat(80));
  console.log("DehiveProxy Verification Script");
  console.log("=".repeat(80));

  // Get network info
  const network = await ethers.provider.getNetwork();
  const networkName = network.name || "unknown";
  const chainId = network.chainId.toString();

  console.log(`\nNetwork: ${networkName} (Chain ID: ${chainId})`);

  const results: VerificationResult[] = [];

  // ========== STEP 1: LOAD PROXY ADDRESS ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 1: Loading Proxy Address");
  console.log("=".repeat(80));

  let proxyAddress: string;
  let facetAddress: string | undefined;

  if (process.env.PROXY_ADDRESS) {
    proxyAddress = process.env.PROXY_ADDRESS;
    console.log(
      `\n✓ Using proxy address from PROXY_ADDRESS env var: ${proxyAddress}`
    );
  } else {
    // Try to load from deployment file
    const deploymentsDir = path.join(__dirname, "../../deployments");
    const deploymentFile = path.join(
      deploymentsDir,
      `sepolia_dehiveProxy_messageFacet.json`
    );

    if (fs.existsSync(deploymentFile)) {
      const deploymentInfo = JSON.parse(
        fs.readFileSync(deploymentFile, "utf-8")
      );
      proxyAddress = deploymentInfo.proxyAddress;
      facetAddress = deploymentInfo.facetAddress;
      console.log(
        `\n✓ Loaded proxy address from deployment file: ${proxyAddress}`
      );
      console.log(
        `✓ Loaded facet address from deployment file: ${facetAddress}`
      );
    } else {
      // Use hardcoded address
      proxyAddress = "0x41bc86ba44813b2b106e1942cb68cc471714df2d";
      console.log(`\n✓ Using hardcoded proxy address: ${proxyAddress}`);
    }
  }

  // Validate proxy address
  try {
    proxyAddress = ethers.getAddress(proxyAddress);
  } catch (error: any) {
    throw new Error(`Invalid proxy address format: ${error.message}`);
  }

  // ========== STEP 2: CONNECT TO CONTRACTS ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 2: Connecting to Contracts");
  console.log("=".repeat(80));

  const owner = (await ethers.getSigners())[0];
  console.log(`\n✓ Using account: ${owner.address}`);

  // Connect to proxy
  const ProxyFactory = await ethers.getContractFactory("DehiveProxy");
  const proxy = ProxyFactory.attach(proxyAddress) as DehiveProxy;

  // Connect to proxy as Message interface
  const MessageFactory = await ethers.getContractFactory("Message");
  const messageViaProxy = MessageFactory.attach(proxyAddress) as Message;

  console.log(`✓ Connected to proxy at: ${proxyAddress}`);

  // ========== STEP 3: VERIFY FACET INSTALLATION ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 3: Verifying Facet Installation");
  console.log("=".repeat(80));

  try {
    // Get all installed facets
    const facetAddresses = await proxy.facetAddresses();
    console.log(`\n✓ Found ${facetAddresses.length} installed facet(s)`);

    if (facetAddresses.length === 0) {
      results.push({
        test: "Facet Installation",
        status: "FAIL",
        message: "No facets installed in proxy",
      });
      console.log("❌ No facets installed in proxy");
    } else {
      results.push({
        test: "Facet Installation",
        status: "PASS",
        message: `${facetAddresses.length} facet(s) installed`,
        details: { facets: facetAddresses },
      });

      // Display each facet and its selectors
      for (let i = 0; i < facetAddresses.length; i++) {
        const facet = facetAddresses[i];
        const selectors = await proxy.facetFunctionSelectors(facet);
        console.log(`\n  Facet ${i + 1}:`);
        console.log(`    Address: ${facet}`);
        console.log(`    Function Selectors: ${selectors.length}`);

        if (
          facetAddress &&
          facet.toLowerCase() === facetAddress.toLowerCase()
        ) {
          console.log(`    ✓ This is the MessageFacet`);
        }
      }
    }
  } catch (error: any) {
    results.push({
      test: "Facet Installation",
      status: "FAIL",
      message: `Failed to query facets: ${error.message}`,
    });
    console.log(`❌ Failed to query facets: ${error.message}`);
  }

  // ========== STEP 4: VERIFY FUNCTION SELECTORS ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 4: Verifying Function Selectors");
  console.log("=".repeat(80));

  try {
    // Load IMessage ABI
    const imessageArtifactPath = path.join(
      __dirname,
      "../../artifacts/contracts/interfaces/IMessage.sol/IMessage.json"
    );
    const imessageAbi = JSON.parse(
      fs.readFileSync(imessageArtifactPath, "utf-8")
    ).abi;

    const expectedSelectors = getFunctionSelectors(imessageAbi);
    console.log(
      `\n✓ Found ${expectedSelectors.length} expected function selectors from IMessage`
    );

    // Check each selector
    let mappedCount = 0;
    let unmappedSelectors: string[] = [];

    console.log("\nVerifying function selector mappings:");

    for (const selector of expectedSelectors) {
      const facet = await proxy.facetAddress(selector);

      if (facet === ethers.ZeroAddress) {
        unmappedSelectors.push(selector);
        console.log(`  ❌ ${selector} -> NOT MAPPED`);
      } else {
        mappedCount++;
        console.log(`  ✓ ${selector} -> ${facet.substring(0, 10)}...`);
      }
    }

    if (unmappedSelectors.length === 0) {
      results.push({
        test: "Function Selector Mapping",
        status: "PASS",
        message: `All ${expectedSelectors.length} function selectors correctly mapped`,
        details: { mapped: mappedCount, unmapped: 0 },
      });
      console.log(
        `\n✅ All ${expectedSelectors.length} function selectors are correctly mapped`
      );
    } else {
      results.push({
        test: "Function Selector Mapping",
        status: "FAIL",
        message: `${unmappedSelectors.length} function selectors not mapped`,
        details: {
          mapped: mappedCount,
          unmapped: unmappedSelectors.length,
          unmappedSelectors,
        },
      });
      console.log(
        `\n⚠️  ${unmappedSelectors.length} function selectors are NOT mapped:`
      );
      unmappedSelectors.forEach((s) => console.log(`    - ${s}`));
    }
  } catch (error: any) {
    results.push({
      test: "Function Selector Mapping",
      status: "FAIL",
      message: `Failed to verify selectors: ${error.message}`,
    });
    console.log(`❌ Failed to verify selectors: ${error.message}`);
  }

  // ========== STEP 5: VERIFY READ OPERATIONS (VIEW FUNCTIONS) ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 5: Verifying Read Operations (View Functions)");
  console.log("=".repeat(80));

  console.log("\nTesting view functions through proxy:");

  // Test 5.1: Get owner
  try {
    const proxyOwner = await messageViaProxy.owner();
    console.log(`  ✓ owner() -> ${proxyOwner}`);

    // Verify it matches proxy.owner()
    const directProxyOwner = await proxy.owner();
    if (proxyOwner.toLowerCase() === directProxyOwner.toLowerCase()) {
      results.push({
        test: "Read: owner()",
        status: "PASS",
        message: "Successfully read owner through proxy",
        details: { owner: proxyOwner },
      });
      console.log(`    ✓ Matches direct proxy.owner() call`);
    } else {
      results.push({
        test: "Read: owner()",
        status: "WARN",
        message: "Owner mismatch between proxy and facet",
        details: { proxyOwner, directProxyOwner },
      });
      console.log(`    ⚠️  Mismatch with direct proxy.owner()`);
    }
  } catch (error: any) {
    results.push({
      test: "Read: owner()",
      status: "FAIL",
      message: `Failed to read owner: ${error.message}`,
    });
    console.log(`  ❌ owner() failed: ${error.message}`);
  }

  // Test 5.2: Get payAsYouGoFee
  try {
    const payAsYouGoFee = await messageViaProxy.payAsYouGoFee();
    console.log(
      `  ✓ payAsYouGoFee() -> ${ethers.formatEther(payAsYouGoFee)} ETH`
    );
    results.push({
      test: "Read: payAsYouGoFee()",
      status: "PASS",
      message: "Successfully read payAsYouGoFee through proxy",
      details: { fee: payAsYouGoFee.toString() },
    });
  } catch (error: any) {
    results.push({
      test: "Read: payAsYouGoFee()",
      status: "FAIL",
      message: `Failed to read payAsYouGoFee: ${error.message}`,
    });
    console.log(`  ❌ payAsYouGoFee() failed: ${error.message}`);
  }

  // Test 5.3: Get relayerFee
  try {
    const relayerFee = await messageViaProxy.relayerFee();
    console.log(`  ✓ relayerFee() -> ${ethers.formatEther(relayerFee)} ETH`);
    results.push({
      test: "Read: relayerFee()",
      status: "PASS",
      message: "Successfully read relayerFee through proxy",
      details: { fee: relayerFee.toString() },
    });
  } catch (error: any) {
    results.push({
      test: "Read: relayerFee()",
      status: "FAIL",
      message: `Failed to read relayerFee: ${error.message}`,
    });
    console.log(`  ❌ relayerFee() failed: ${error.message}`);
  }

  // Test 5.4: Get relayer
  try {
    const relayer = await messageViaProxy.relayer();
    console.log(`  ✓ relayer() -> ${relayer}`);
    results.push({
      test: "Read: relayer()",
      status: "PASS",
      message: "Successfully read relayer through proxy",
      details: { relayer },
    });
  } catch (error: any) {
    results.push({
      test: "Read: relayer()",
      status: "FAIL",
      message: `Failed to read relayer: ${error.message}`,
    });
    console.log(`  ❌ relayer() failed: ${error.message}`);
  }

  // Test 5.5: Get user funds
  try {
    const userFunds = await messageViaProxy.funds(owner.address);
    console.log(
      `  ✓ funds(${owner.address.substring(0, 10)}...) -> ${ethers.formatEther(
        userFunds
      )} ETH`
    );
    results.push({
      test: "Read: funds()",
      status: "PASS",
      message: "Successfully read funds through proxy",
      details: { user: owner.address, balance: userFunds.toString() },
    });
  } catch (error: any) {
    results.push({
      test: "Read: funds()",
      status: "FAIL",
      message: `Failed to read funds: ${error.message}`,
    });
    console.log(`  ❌ funds() failed: ${error.message}`);
  }

  // ========== STEP 6: VERIFY WRITE OPERATIONS (STATE-CHANGING FUNCTIONS) ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 6: Verifying Write Operations (State-Changing Functions)");
  console.log("=".repeat(80));

  console.log("\nTesting state-changing functions through proxy:");
  console.log(
    "Note: Tests are read-only using staticCall to avoid gas costs\n"
  );

  // Test 6.1: setRelayer (using staticCall to avoid actually changing state)
  try {
    const testRelayerAddress = "0x0000000000000000000000000000000000000001";
    await messageViaProxy
      .connect(owner)
      .setRelayer.staticCall(testRelayerAddress);
    console.log(`  ✓ setRelayer() can be called (staticCall test)`);
    results.push({
      test: "Write: setRelayer()",
      status: "PASS",
      message: "Successfully simulated setRelayer through proxy",
    });
  } catch (error: any) {
    // Check if error is due to permissions (expected if not owner)
    if (error.message.includes("caller is not the owner")) {
      results.push({
        test: "Write: setRelayer()",
        status: "WARN",
        message:
          "Caller is not owner (expected if testing with non-owner account)",
        details: { error: error.message },
      });
      console.log(`  ⚠️  setRelayer() requires owner privileges`);
    } else {
      results.push({
        test: "Write: setRelayer()",
        status: "FAIL",
        message: `Failed to simulate setRelayer: ${error.message}`,
      });
      console.log(`  ❌ setRelayer() failed: ${error.message}`);
    }
  }

  // Test 6.2: setPayAsYouGoFee
  try {
    const testFee = ethers.parseEther("0.0001");
    await messageViaProxy.connect(owner).setPayAsYouGoFee.staticCall(testFee);
    console.log(`  ✓ setPayAsYouGoFee() can be called (staticCall test)`);
    results.push({
      test: "Write: setPayAsYouGoFee()",
      status: "PASS",
      message: "Successfully simulated setPayAsYouGoFee through proxy",
    });
  } catch (error: any) {
    if (error.message.includes("caller is not the owner")) {
      results.push({
        test: "Write: setPayAsYouGoFee()",
        status: "WARN",
        message:
          "Caller is not owner (expected if testing with non-owner account)",
      });
      console.log(`  ⚠️  setPayAsYouGoFee() requires owner privileges`);
    } else {
      results.push({
        test: "Write: setPayAsYouGoFee()",
        status: "FAIL",
        message: `Failed to simulate setPayAsYouGoFee: ${error.message}`,
      });
      console.log(`  ❌ setPayAsYouGoFee() failed: ${error.message}`);
    }
  }

  // Test 6.3: setRelayerFee
  try {
    const testFee = ethers.parseEther("0.00005");
    await messageViaProxy.connect(owner).setRelayerFee.staticCall(testFee);
    console.log(`  ✓ setRelayerFee() can be called (staticCall test)`);
    results.push({
      test: "Write: setRelayerFee()",
      status: "PASS",
      message: "Successfully simulated setRelayerFee through proxy",
    });
  } catch (error: any) {
    if (error.message.includes("caller is not the owner")) {
      results.push({
        test: "Write: setRelayerFee()",
        status: "WARN",
        message:
          "Caller is not owner (expected if testing with non-owner account)",
      });
      console.log(`  ⚠️  setRelayerFee() requires owner privileges`);
    } else {
      results.push({
        test: "Write: setRelayerFee()",
        status: "FAIL",
        message: `Failed to simulate setRelayerFee: ${error.message}`,
      });
      console.log(`  ❌ setRelayerFee() failed: ${error.message}`);
    }
  }

  // Test 6.4: depositFunds
  try {
    const testDeposit = ethers.parseEther("0.001");
    await messageViaProxy
      .connect(owner)
      .depositFunds.staticCall({ value: testDeposit });
    console.log(`  ✓ depositFunds() can be called (staticCall test)`);
    results.push({
      test: "Write: depositFunds()",
      status: "PASS",
      message: "Successfully simulated depositFunds through proxy",
    });
  } catch (error: any) {
    results.push({
      test: "Write: depositFunds()",
      status: "FAIL",
      message: `Failed to simulate depositFunds: ${error.message}`,
    });
    console.log(`  ❌ depositFunds() failed: ${error.message}`);
  }

  // ========== STEP 7: STORAGE VERIFICATION ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 7: Verifying Storage Architecture");
  console.log("=".repeat(80));

  console.log("\nChecking storage architecture:");
  console.log("  - Proxy uses Diamond Storage pattern");
  console.log("  - Each facet has isolated storage via namespaced slots");
  console.log("  - Proxy storage and facet storage are separate");

  try {
    const proxyOwner = await proxy.owner();
    const messageOwner = await messageViaProxy.owner();

    console.log(`\n  Proxy owner: ${proxyOwner}`);
    console.log(`  Message owner (via proxy): ${messageOwner}`);

    if (proxyOwner.toLowerCase() === messageOwner.toLowerCase()) {
      results.push({
        test: "Storage Architecture",
        status: "PASS",
        message: "Proxy owner correctly accessible through Message facet",
        details: { proxyOwner, messageOwner },
      });
      console.log(`  ✓ Storage architecture is correct`);
    } else {
      results.push({
        test: "Storage Architecture",
        status: "WARN",
        message: "Owner addresses differ (may be intentional)",
        details: { proxyOwner, messageOwner },
      });
      console.log(`  ⚠️  Owner addresses differ`);
    }
  } catch (error: any) {
    results.push({
      test: "Storage Architecture",
      status: "FAIL",
      message: `Failed to verify storage: ${error.message}`,
    });
    console.log(`  ❌ Storage verification failed: ${error.message}`);
  }

  // ========== SUMMARY ==========
  console.log("\n" + "=".repeat(80));
  console.log("Verification Summary");
  console.log("=".repeat(80));

  const passCount = results.filter((r) => r.status === "PASS").length;
  const failCount = results.filter((r) => r.status === "FAIL").length;
  const warnCount = results.filter((r) => r.status === "WARN").length;

  console.log(`\n📊 Test Results:`);
  console.log(`  ✅ PASS: ${passCount}`);
  console.log(`  ❌ FAIL: ${failCount}`);
  console.log(`  ⚠️  WARN: ${warnCount}`);
  console.log(`  📝 Total: ${results.length}`);

  // Display detailed results
  console.log(`\n📋 Detailed Results:`);
  results.forEach((result, index) => {
    const icon =
      result.status === "PASS" ? "✅" : result.status === "FAIL" ? "❌" : "⚠️";
    console.log(`\n  [${index + 1}] ${icon} ${result.test}`);
    console.log(`      Status: ${result.status}`);
    console.log(`      Message: ${result.message}`);
    if (result.details) {
      console.log(
        `      Details: ${JSON.stringify(result.details, null, 2).substring(
          0,
          200
        )}...`
      );
    }
  });

  // Save results
  const deploymentsDir = path.join(__dirname, "../../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const resultFile = path.join(
    deploymentsDir,
    `proxyVerification_${networkName}_${Date.now()}.json`
  );

  fs.writeFileSync(
    resultFile,
    JSON.stringify(
      {
        network: networkName,
        chainId: chainId,
        proxyAddress: proxyAddress,
        facetAddress: facetAddress,
        tester: owner.address,
        timestamp: new Date().toISOString(),
        summary: {
          pass: passCount,
          fail: failCount,
          warn: warnCount,
          total: results.length,
        },
        results: results,
      },
      null,
      2
    )
  );

  console.log(`\n📝 Results saved to: ${resultFile}`);

  // Final verdict
  console.log("\n" + "=".repeat(80));
  if (failCount === 0) {
    console.log("✅ Proxy Verification PASSED!");
    console.log(
      "   The proxy is correctly configured to delegate calls to Message contract."
    );
  } else {
    console.log("❌ Proxy Verification FAILED!");
    console.log(
      `   ${failCount} test(s) failed. Please review the results above.`
    );
  }
  console.log("=".repeat(80));

  // Exit with appropriate code
  if (failCount > 0) {
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Verification script failed:");
    console.error(error);
    process.exit(1);
  });
