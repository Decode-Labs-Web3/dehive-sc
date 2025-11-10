import { ethers } from "hardhat";
import fs from "fs";
import path from "path";
import { DehiveProxy } from "../../typechain-types";
import { getFunctionSelectors } from "../dehive/helpers/facetHelpers";

/**
 * Script to check which function selectors are already installed in DehiveProxy
 * before attempting to install PaymentHub facet
 *
 * This script:
 * 1. Loads proxy address from env or deployment file
 * 2. Gets all currently installed facets and their selectors
 * 3. Gets PaymentHub function selectors
 * 4. Compares and shows which selectors are already installed
 * 5. Shows which selectors need to be installed
 *
 * Usage: npx hardhat run scripts/payment/checkProxyState.ts --network <network>
 */

interface SelectorInfo {
  selector: string;
  functionName: string;
  currentFacet?: string;
  status: "available" | "already_installed" | "conflict";
}

async function main() {
  console.log("=".repeat(80));
  console.log("Checking DehiveProxy State Before PaymentHub Installation");
  console.log("=".repeat(80));

  // Get network info
  const network = await ethers.provider.getNetwork();
  const networkName = network.name || "unknown";

  console.log(`\nNetwork: ${networkName}`);

  // Get signer
  const deployer = (await ethers.getSigners())[0];
  console.log(`\nDeployer: ${deployer.address}`);

  // ========== STEP 1: LOAD PROXY ADDRESS ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 1: Loading DehiveProxy Address");
  console.log("=".repeat(80));

  let proxyAddress: string;

  const deploymentsDir = path.join(__dirname, "../../deployments");

  // Try environment variable first
  if (process.env.PROXY_ADDRESS) {
    proxyAddress = process.env.PROXY_ADDRESS;
    console.log(
      `✓ Using proxy address from PROXY_ADDRESS env var: ${proxyAddress}`
    );
  } else {
    // Try to load from deployment file
    const proxyFile = path.join(
      deploymentsDir,
      `sepolia_dehiveProxy_messageFacet.json`
    );

    if (fs.existsSync(proxyFile)) {
      const proxyDeployment = JSON.parse(fs.readFileSync(proxyFile, "utf-8"));
      proxyAddress = proxyDeployment.proxyAddress;
      console.log(
        `✓ Loaded proxy address from deployment file: ${proxyAddress}`
      );
    } else {
      throw new Error(
        `Proxy address not found. Please set PROXY_ADDRESS env var or ensure deployment file exists at: ${proxyFile}`
      );
    }
  }

  // Connect to proxy
  const ProxyFactory = await ethers.getContractFactory("DehiveProxy");
  const proxy = ProxyFactory.attach(proxyAddress) as DehiveProxy;

  // ========== STEP 2: GET CURRENTLY INSTALLED FACETS ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 2: Getting Currently Installed Facets");
  console.log("=".repeat(80));

  const facetAddresses = await proxy.facetAddresses();
  console.log(`✓ Found ${facetAddresses.length} installed facet(s)`);

  // Map of selector -> facet address
  const selectorToFacet: Map<string, string> = new Map();

  // Get all selectors for each facet
  for (let i = 0; i < facetAddresses.length; i++) {
    const facetAddress = facetAddresses[i];
    const selectors = await proxy.facetFunctionSelectors(facetAddress);
    console.log(`\n  Facet ${i + 1}: ${facetAddress}`);
    console.log(`    Selectors: ${selectors.length}`);

    // Map each selector to its facet
    for (const selector of selectors) {
      selectorToFacet.set(selector.toLowerCase(), facetAddress);
    }

    // Show first few selectors as examples
    if (selectors.length > 0) {
      console.log(
        `    Examples: ${selectors.slice(0, 3).join(", ")}${
          selectors.length > 3 ? "..." : ""
        }`
      );
    }
  }

  // ========== STEP 3: GET PAYMENTHUB FUNCTION SELECTORS ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 3: Getting PaymentHub Function Selectors");
  console.log("=".repeat(80));

  // Get IPaymentHub ABI for function selectors
  const ipaymenthubArtifactPath = path.join(
    __dirname,
    "../../artifacts/contracts/interfaces/IPaymentHub.sol/IPaymentHub.json"
  );
  const ipaymenthubAbi = JSON.parse(
    fs.readFileSync(ipaymenthubArtifactPath, "utf-8")
  ).abi;

  const paymentHubSelectors = getFunctionSelectors(ipaymenthubAbi);
  console.log(
    `✓ Found ${paymentHubSelectors.length} PaymentHub function selectors`
  );

  // Create interface to get function names
  const paymentHubInterface = ethers.Interface.from(ipaymenthubAbi);
  const selectorToFunctionName: Map<string, string> = new Map();

  for (const fragment of Object.values(paymentHubInterface.fragments)) {
    if (fragment.type === "function") {
      const selector = paymentHubInterface.getFunction(fragment.name).selector;
      selectorToFunctionName.set(selector.toLowerCase(), fragment.name);
    }
  }

  // ========== STEP 4: COMPARE SELECTORS ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 4: Comparing Selectors");
  console.log("=".repeat(80));

  const selectorInfo: SelectorInfo[] = [];
  const availableSelectors: string[] = [];
  const alreadyInstalledSelectors: string[] = [];
  const conflictSelectors: string[] = [];

  for (const selector of paymentHubSelectors) {
    const selectorLower = selector.toLowerCase();
    const functionName = selectorToFunctionName.get(selectorLower) || "unknown";
    const currentFacet = selectorToFacet.get(selectorLower);

    if (currentFacet) {
      // Selector is already installed
      alreadyInstalledSelectors.push(selector);
      selectorInfo.push({
        selector,
        functionName,
        currentFacet,
        status: "already_installed",
      });
    } else {
      // Selector is available
      availableSelectors.push(selector);
      selectorInfo.push({
        selector,
        functionName,
        status: "available",
      });
    }
  }

  // ========== STEP 5: DISPLAY RESULTS ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 5: Results Summary");
  console.log("=".repeat(80));

  console.log(`\n📊 Summary:`);
  console.log(`  Total PaymentHub selectors: ${paymentHubSelectors.length}`);
  console.log(`  ✅ Available to install: ${availableSelectors.length}`);
  console.log(`  ⚠️  Already installed: ${alreadyInstalledSelectors.length}`);

  if (availableSelectors.length > 0) {
    console.log(`\n✅ Available Selectors (can be installed):`);
    for (const info of selectorInfo.filter((s) => s.status === "available")) {
      console.log(`  - ${info.functionName} (${info.selector})`);
    }
  }

  if (alreadyInstalledSelectors.length > 0) {
    console.log(`\n⚠️  Already Installed Selectors (will cause conflict):`);
    for (const info of selectorInfo.filter(
      (s) => s.status === "already_installed"
    )) {
      console.log(`  - ${info.functionName} (${info.selector})`);
      console.log(`    Currently installed in facet: ${info.currentFacet}`);
    }
  }

  // ========== STEP 6: RECOMMENDATIONS ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 6: Recommendations");
  console.log("=".repeat(80));

  if (alreadyInstalledSelectors.length === 0) {
    console.log(`\n✅ All PaymentHub selectors are available!`);
    console.log(`   You can proceed with installation.`);
    console.log(`\n   Next step: Run deployPaymentHubFacet.ts`);
  } else {
    console.log(
      `\n⚠️  Warning: ${alreadyInstalledSelectors.length} selector(s) are already installed!`
    );
    console.log(`\n   Options:`);
    console.log(
      `   1. Remove conflicting selectors from their current facets first`
    );
    console.log(
      `   2. Install only the available selectors (filter out conflicts)`
    );
    console.log(
      `   3. Replace the conflicting facet if it's an old PaymentHub installation`
    );
    console.log(`\n   To install only available selectors, use:`);
    console.log(
      `   npx hardhat run scripts/payment/deployPaymentHubFacet.ts --network ${networkName}`
    );
    console.log(`   (The script will be updated to filter out conflicts)`);
  }

  // Save results to file
  const resultsFile = path.join(
    deploymentsDir,
    `paymentHub_proxy_check_${networkName}_${Date.now()}.json`
  );
  fs.writeFileSync(
    resultsFile,
    JSON.stringify(
      {
        network: networkName,
        proxyAddress,
        checkedAt: new Date().toISOString(),
        installedFacets: facetAddresses,
        paymentHubSelectors: {
          total: paymentHubSelectors.length,
          available: availableSelectors,
          alreadyInstalled: alreadyInstalledSelectors.map((s) => {
            const info = selectorInfo.find((i) => i.selector === s);
            return {
              selector: s,
              functionName: info?.functionName,
              currentFacet: info?.currentFacet,
            };
          }),
        },
        selectorInfo,
      },
      null,
      2
    )
  );
  console.log(`\n📝 Results saved to: ${resultsFile}`);

  console.log("\n" + "=".repeat(80));
  console.log("✅ Proxy State Check Completed!");
  console.log("=".repeat(80));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Check failed:");
    console.error(error);
    process.exit(1);
  });
