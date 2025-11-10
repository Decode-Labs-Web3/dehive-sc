import { ethers, run } from "hardhat";
import fs from "fs";
import path from "path";
import { DehiveProxy, Message, PaymentHub } from "../typechain-types";
import { getFunctionSelectors } from "./dehive/helpers/facetHelpers";

/**
 * Comprehensive Deployment and Verification Script for Dehive System
 *
 * This script:
 * 1. Deploys DehiveProxy, Message Facet, and PaymentHub Facet
 * 2. Installs facets into proxy (handling selector conflicts)
 * 3. Sets up relayer address
 * 4. Verifies all contracts on Etherscan
 * 5. Tests read/write access through proxy
 * 6. Tests withdrawFunds function on proxy
 * 7. Saves comprehensive deployment information
 *
 * Usage: npx hardhat run scripts/deployAndVerifyAll.ts --network <network>
 *
 * Requirements:
 *   - ETHERSCAN_API_KEY in .env file for verification
 *   - Sufficient balance for deployment and verification
 */

interface DeploymentInfo {
  network: string;
  chainId: string;
  proxyAddress: string;
  messageFacetAddress: string;
  paymentHubFacetAddress: string;
  owner: string;
  deployer: string;
  relayer?: string;
  messageSelectors: string[];
  paymentHubSelectors: string[];
  paymentHubConflicts?: string[];
  verificationResults: {
    messageRead: boolean;
    messageWrite: boolean;
    paymentHubRead: boolean;
    paymentHubWrite: boolean;
    proxyWithdraw: boolean;
  };
  etherscanVerification: {
    proxy: boolean;
    messageFacet: boolean;
    paymentHubFacet: boolean;
  };
  deployedAt: number;
  transactionHashes: {
    proxyDeployment?: string;
    messageFacetDeployment?: string;
    messageFacetInstallation?: string;
    paymentHubFacetDeployment?: string;
    paymentHubFacetInstallation?: string;
    relayerSetup?: string;
    proxyWithdrawTest?: string;
  };
  blockNumbers: {
    proxyDeployment?: number;
    messageFacetDeployment?: number;
    messageFacetInstallation?: number;
    paymentHubFacetDeployment?: number;
    paymentHubFacetInstallation?: number;
    relayerSetup?: number;
    proxyWithdrawTest?: number;
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
  console.log("Comprehensive Deployment & Verification: Dehive System");
  console.log("=".repeat(80));

  // Get network info
  const network = await ethers.provider.getNetwork();
  const networkName = network.name || "unknown";
  const chainId = network.chainId.toString();

  console.log(`\nNetwork: ${networkName} (Chain ID: ${chainId})`);

  // Get signer
  const deployer = (await ethers.getSigners())[0];
  const owner = deployer; // Same account for owner
  const relayer = deployer; // Same account for relayer

  console.log(`\nDeployer: ${deployer.address}`);
  console.log(`Owner: ${owner.address}`);
  console.log(`Relayer: ${relayer.address}`);

  // Check balance
  const deployerBalance = await ethers.provider.getBalance(deployer.address);
  console.log(
    `\n💰 Deployer Balance: ${ethers.formatEther(deployerBalance)} ETH`
  );

  if (deployerBalance < ethers.parseEther("0.01")) {
    console.warn(
      "\n⚠️  WARNING: Deployer balance is low. Deployment may fail!"
    );
  }

  // Check Etherscan API key
  const etherscanApiKey = process.env.ETHERSCAN_API_KEY;
  if (!etherscanApiKey) {
    console.warn(
      "\n⚠️  WARNING: ETHERSCAN_API_KEY not found. Verification will be skipped."
    );
  } else {
    console.log(`✓ Etherscan API Key found`);
  }

  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  // Initialize deployment info
  const deploymentInfo: DeploymentInfo = {
    network: networkName,
    chainId: chainId,
    proxyAddress: "",
    messageFacetAddress: "",
    paymentHubFacetAddress: "",
    owner: owner.address,
    deployer: deployer.address,
    messageSelectors: [],
    paymentHubSelectors: [],
    verificationResults: {
      messageRead: false,
      messageWrite: false,
      paymentHubRead: false,
      paymentHubWrite: false,
      proxyWithdraw: false,
    },
    etherscanVerification: {
      proxy: false,
      messageFacet: false,
      paymentHubFacet: false,
    },
    deployedAt: Date.now(),
    transactionHashes: {},
    blockNumbers: {},
  };

  // ========== STEP 1: DEPLOY PROXY ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 1: Deploying DehiveProxy");
  console.log("=".repeat(80));

  console.log("\nDeploying DehiveProxy...");
  const ProxyFactory = await ethers.getContractFactory("DehiveProxy");
  const proxy = await ProxyFactory.deploy();
  await proxy.waitForDeployment();
  const proxyAddress = await proxy.getAddress();

  const proxyDeployTx = proxy.deploymentTransaction();
  const proxyDeployReceipt = proxyDeployTx ? await proxyDeployTx.wait() : null;
  const proxyBlockNumber = await ethers.provider.getBlockNumber();

  deploymentInfo.proxyAddress = proxyAddress;
  deploymentInfo.transactionHashes.proxyDeployment =
    proxyDeployReceipt?.hash || "";
  deploymentInfo.blockNumbers.proxyDeployment =
    proxyDeployReceipt?.blockNumber || proxyBlockNumber;

  console.log(`✓ DehiveProxy deployed at: ${proxyAddress}`);
  console.log(`✓ Transaction: ${proxyDeployReceipt?.hash || "N/A"}`);
  console.log(
    `✓ Block number: ${proxyDeployReceipt?.blockNumber || proxyBlockNumber}`
  );

  const proxyOwner = await proxy.owner();
  console.log(`✓ Proxy owner: ${proxyOwner}`);

  // ========== STEP 2: DEPLOY MESSAGE FACET ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 2: Deploying Message Facet");
  console.log("=".repeat(80));

  console.log("\nDeploying Message facet...");
  const MessageFactory = await ethers.getContractFactory("Message");
  const messageFacet = await MessageFactory.deploy(owner.address);
  await messageFacet.waitForDeployment();
  const messageFacetAddress = await messageFacet.getAddress();

  const messageDeployTx = messageFacet.deploymentTransaction();
  const messageDeployReceipt = messageDeployTx
    ? await messageDeployTx.wait()
    : null;
  const messageBlockNumber = await ethers.provider.getBlockNumber();

  deploymentInfo.messageFacetAddress = messageFacetAddress;
  deploymentInfo.transactionHashes.messageFacetDeployment =
    messageDeployReceipt?.hash || "";
  deploymentInfo.blockNumbers.messageFacetDeployment =
    messageDeployReceipt?.blockNumber || messageBlockNumber;

  console.log(`✓ Message facet deployed at: ${messageFacetAddress}`);
  console.log(`✓ Transaction: ${messageDeployReceipt?.hash || "N/A"}`);
  console.log(
    `✓ Block number: ${messageDeployReceipt?.blockNumber || messageBlockNumber}`
  );

  // Get Message function selectors
  const imessageArtifactPath = path.join(
    __dirname,
    "../artifacts/contracts/interfaces/IMessage.sol/IMessage.json"
  );
  const imessageAbi = JSON.parse(
    fs.readFileSync(imessageArtifactPath, "utf-8")
  ).abi;
  const messageSelectors = getFunctionSelectors(imessageAbi);
  deploymentInfo.messageSelectors = messageSelectors;
  console.log(`✓ Found ${messageSelectors.length} Message function selectors`);

  // Install Message facet into proxy
  console.log("\nInstalling Message facet into proxy...");
  const facetCut = {
    facetAddress: messageFacetAddress,
    functionSelectors: messageSelectors,
    action: 0, // Add
  };

  const messageArtifactPath = path.join(
    __dirname,
    "../artifacts/contracts/Message.sol/Message.json"
  );
  const messageAbi = JSON.parse(
    fs.readFileSync(messageArtifactPath, "utf-8")
  ).abi;

  const initCalldata = ethers.Interface.from(messageAbi).encodeFunctionData(
    "init",
    [proxyOwner]
  );

  const installTx = await proxy
    .connect(deployer)
    .facetCut([facetCut], messageFacetAddress, initCalldata);
  const installReceipt = await installTx.wait();
  const installBlockNumber = installReceipt!.blockNumber;

  deploymentInfo.transactionHashes.messageFacetInstallation = installTx.hash;
  deploymentInfo.blockNumbers.messageFacetInstallation = installBlockNumber;

  console.log(`✓ Message facet installed into proxy`);
  console.log(`✓ Transaction: ${installTx.hash}`);
  console.log(`✓ Block number: ${installBlockNumber}`);

  // ========== STEP 3: DEPLOY PAYMENTHUB FACET ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 3: Deploying PaymentHub Facet");
  console.log("=".repeat(80));

  console.log("\nDeploying PaymentHub facet...");
  const PaymentHubFactory = await ethers.getContractFactory("PaymentHub");
  const paymentHubFacet = await PaymentHubFactory.deploy(owner.address);
  await paymentHubFacet.waitForDeployment();
  const paymentHubFacetAddress = await paymentHubFacet.getAddress();

  const paymentHubDeployTx = paymentHubFacet.deploymentTransaction();
  const paymentHubDeployReceipt = paymentHubDeployTx
    ? await paymentHubDeployTx.wait()
    : null;
  const paymentHubBlockNumber = await ethers.provider.getBlockNumber();

  deploymentInfo.paymentHubFacetAddress = paymentHubFacetAddress;
  deploymentInfo.transactionHashes.paymentHubFacetDeployment =
    paymentHubDeployReceipt?.hash || "";
  deploymentInfo.blockNumbers.paymentHubFacetDeployment =
    paymentHubDeployReceipt?.blockNumber || paymentHubBlockNumber;

  console.log(`✓ PaymentHub facet deployed at: ${paymentHubFacetAddress}`);
  console.log(`✓ Transaction: ${paymentHubDeployReceipt?.hash || "N/A"}`);
  console.log(
    `✓ Block number: ${
      paymentHubDeployReceipt?.blockNumber || paymentHubBlockNumber
    }`
  );

  // Get PaymentHub function selectors
  const ipaymenthubArtifactPath = path.join(
    __dirname,
    "../artifacts/contracts/interfaces/IPaymentHub.sol/IPaymentHub.json"
  );
  const ipaymenthubAbi = JSON.parse(
    fs.readFileSync(ipaymenthubArtifactPath, "utf-8")
  ).abi;

  const allPaymentHubSelectors = getFunctionSelectors(ipaymenthubAbi);
  console.log(
    `✓ Found ${allPaymentHubSelectors.length} PaymentHub function selectors`
  );

  // Check which selectors are already installed
  const installedFacets = await proxy.facetAddresses();
  const selectorToFacet: Map<string, string> = new Map();

  for (const facetAddr of installedFacets) {
    const selectors = await proxy.facetFunctionSelectors(facetAddr);
    for (const selector of selectors) {
      selectorToFacet.set(selector.toLowerCase(), facetAddr);
    }
  }

  // Filter out already installed selectors
  const availableSelectors: string[] = [];
  const alreadyInstalledSelectors: string[] = [];

  for (const selector of allPaymentHubSelectors) {
    const selectorLower = selector.toLowerCase();
    if (selectorToFacet.has(selectorLower)) {
      alreadyInstalledSelectors.push(selector);
      const existingFacet = selectorToFacet.get(selectorLower);
      console.log(
        `⚠️  Selector ${selector} already installed in facet: ${existingFacet}`
      );
    } else {
      availableSelectors.push(selector);
    }
  }

  console.log(`\n📊 Selector Status:`);
  console.log(`  ✅ Available to install: ${availableSelectors.length}`);
  console.log(`  ⚠️  Already installed: ${alreadyInstalledSelectors.length}`);

  if (availableSelectors.length === 0) {
    console.log(
      `\n⚠️  Warning: All PaymentHub selectors are already installed!`
    );
    console.log(`   PaymentHub facet may already be installed.`);
    console.log(`   Skipping installation...`);
  } else {
    if (alreadyInstalledSelectors.length > 0) {
      console.log(
        `\n⚠️  Warning: ${alreadyInstalledSelectors.length} selector(s) are already installed.`
      );
      console.log(
        `   Will install only the ${availableSelectors.length} available selectors.`
      );
      deploymentInfo.paymentHubConflicts = alreadyInstalledSelectors;
    }

    const paymentHubFacetCut = {
      facetAddress: paymentHubFacetAddress,
      functionSelectors: availableSelectors,
      action: 0, // Add
    };

    const paymenthubArtifactPath = path.join(
      __dirname,
      "../artifacts/contracts/PaymentHub.sol/PaymentHub.json"
    );
    const paymenthubAbi = JSON.parse(
      fs.readFileSync(paymenthubArtifactPath, "utf-8")
    ).abi;

    const paymentHubInitCalldata = ethers.Interface.from(
      paymenthubAbi
    ).encodeFunctionData("init", [proxyOwner]);

    console.log("Installing PaymentHub facet into proxy...");
    const paymentHubInstallTx = await proxy
      .connect(deployer)
      .facetCut(
        [paymentHubFacetCut],
        paymentHubFacetAddress,
        paymentHubInitCalldata
      );
    const paymentHubInstallReceipt = await paymentHubInstallTx.wait();
    const paymentHubInstallBlockNumber = paymentHubInstallReceipt!.blockNumber;

    deploymentInfo.transactionHashes.paymentHubFacetInstallation =
      paymentHubInstallTx.hash;
    deploymentInfo.blockNumbers.paymentHubFacetInstallation =
      paymentHubInstallBlockNumber;

    console.log(`✓ PaymentHub facet installed into proxy`);
    console.log(`✓ Transaction: ${paymentHubInstallTx.hash}`);
    console.log(`✓ Block number: ${paymentHubInstallBlockNumber}`);
  }

  deploymentInfo.paymentHubSelectors = allPaymentHubSelectors;

  // ========== STEP 4: SET RELAYER ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 4: Setting Relayer Address");
  console.log("=".repeat(80));

  // Connect to proxy as Message interface
  const messageViaProxy = MessageFactory.attach(proxyAddress) as Message;

  try {
    const currentRelayer = await messageViaProxy.relayer();
    if (
      currentRelayer.toLowerCase() === ethers.ZeroAddress.toLowerCase() ||
      currentRelayer.toLowerCase() !== relayer.address.toLowerCase()
    ) {
      console.log("Setting relayer address...");
      const setRelayerTx = await messageViaProxy
        .connect(deployer)
        .setRelayer(relayer.address);
      const setRelayerReceipt = await setRelayerTx.wait();
      const setRelayerBlockNumber = setRelayerReceipt!.blockNumber;

      deploymentInfo.relayer = relayer.address;
      deploymentInfo.transactionHashes.relayerSetup = setRelayerTx.hash;
      deploymentInfo.blockNumbers.relayerSetup = setRelayerBlockNumber;

      const updatedRelayer = await messageViaProxy.relayer();
      console.log(`✓ Relayer set to: ${updatedRelayer}`);
      console.log(`✓ Transaction: ${setRelayerTx.hash}`);
      console.log(`✓ Block number: ${setRelayerBlockNumber}`);
    } else {
      console.log(`✓ Relayer already set to: ${currentRelayer}`);
      deploymentInfo.relayer = currentRelayer;
    }
  } catch (error: any) {
    console.log(`⚠️  Could not set relayer: ${error.message}`);
    console.log(`   This is optional, continuing...`);
  }

  // ========== STEP 5: VERIFY READ/WRITE ACCESS ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 5: Verifying Read/Write Access Through Proxy");
  console.log("=".repeat(80));

  // Connect to proxy as both interfaces
  const paymentHubViaProxy = PaymentHubFactory.attach(
    proxyAddress
  ) as PaymentHub;

  // Verify Message facet read access
  console.log("\n5.1 Testing Message Facet Read Access...");
  try {
    const payAsYouGoFee = await messageViaProxy.payAsYouGoFee();
    const relayerFee = await messageViaProxy.relayerFee();
    const messageOwner = await messageViaProxy.owner();
    console.log(
      `  ✓ payAsYouGoFee(): ${ethers.formatEther(payAsYouGoFee)} ETH`
    );
    console.log(`  ✓ relayerFee(): ${ethers.formatEther(relayerFee)} ETH`);
    console.log(`  ✓ owner(): ${messageOwner}`);
    deploymentInfo.verificationResults.messageRead = true;
  } catch (error: any) {
    console.log(`  ❌ Message read failed: ${error.message}`);
  }

  // Verify Message facet write access
  console.log("\n5.2 Testing Message Facet Write Access...");
  try {
    const currentRelayer = await messageViaProxy.relayer();
    if (currentRelayer.toLowerCase() !== relayer.address.toLowerCase()) {
      try {
        await messageViaProxy
          .connect(deployer)
          .setRelayer.staticCall(relayer.address);
        console.log(`  ✓ setRelayer() callable through proxy`);
        deploymentInfo.verificationResults.messageWrite = true;
      } catch {
        console.log(`  ⚠️  setRelayer() not callable (may not be owner)`);
      }
    } else {
      console.log(`  ✓ Relayer already set, write access confirmed`);
      deploymentInfo.verificationResults.messageWrite = true;
    }
  } catch (error: any) {
    console.log(`  ❌ Message write test failed: ${error.message}`);
  }

  // Verify PaymentHub facet read access
  console.log("\n5.3 Testing PaymentHub Facet Read Access...");
  try {
    const transactionFee = await paymentHubViaProxy.transactionFeePercent();
    const paymentHubOwner = await paymentHubViaProxy.owner();
    const accumulatedFees = await paymentHubViaProxy.accumulatedFees(
      ethers.ZeroAddress
    );
    console.log(`  ✓ transactionFeePercent(): ${transactionFee} basis points`);
    console.log(`  ✓ owner(): ${paymentHubOwner}`);
    console.log(
      `  ✓ accumulatedFees(native): ${ethers.formatEther(accumulatedFees)} ETH`
    );
    deploymentInfo.verificationResults.paymentHubRead = true;
  } catch (error: any) {
    console.log(`  ❌ PaymentHub read failed: ${error.message}`);
  }

  // Verify PaymentHub facet write access
  console.log("\n5.4 Testing PaymentHub Facet Write Access...");
  try {
    const currentFee = await paymentHubViaProxy.transactionFeePercent();
    const newFee = currentFee === 0n ? 100n : 0n; // Toggle between 0 and 100

    try {
      await paymentHubViaProxy
        .connect(deployer)
        .setTransactionFee.staticCall(newFee);
      console.log(`  ✓ setTransactionFee() callable through proxy`);
      deploymentInfo.verificationResults.paymentHubWrite = true;
    } catch (error: any) {
      console.log(
        `  ⚠️  setTransactionFee() not callable: ${error.message} (may not be owner)`
      );
    }
  } catch (error: any) {
    console.log(`  ❌ PaymentHub write test failed: ${error.message}`);
  }

  // ========== STEP 6: TEST PROXY WITHDRAW FUNCTION ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 6: Testing Proxy Withdraw Function");
  console.log("=".repeat(80));

  // Send some ETH to the proxy to test withdrawal
  console.log("\nSending test ETH to proxy...");
  const testAmount = ethers.parseEther("0.001");
  const sendTx = await deployer.sendTransaction({
    to: proxyAddress,
    value: testAmount,
  });
  await sendTx.wait();
  console.log(`✓ Sent ${ethers.formatEther(testAmount)} ETH to proxy`);

  // Check proxy balance
  const proxyBalance = await ethers.provider.getBalance(proxyAddress);
  console.log(`✓ Proxy balance: ${ethers.formatEther(proxyBalance)} ETH`);

  // Test withdraw function
  console.log("\nTesting withdrawFunds() function...");
  try {
    const withdrawTx = await proxy
      .connect(deployer)
      .withdrawFunds(testAmount, "Test withdrawal for deployment verification");
    const withdrawReceipt = await withdrawTx.wait();
    const withdrawBlockNumber = withdrawReceipt!.blockNumber;

    deploymentInfo.transactionHashes.proxyWithdrawTest = withdrawTx.hash;
    deploymentInfo.blockNumbers.proxyWithdrawTest = withdrawBlockNumber;

    const newProxyBalance = await ethers.provider.getBalance(proxyAddress);
    console.log(`✓ withdrawFunds() executed successfully`);
    console.log(`✓ Transaction: ${withdrawTx.hash}`);
    console.log(`✓ Block number: ${withdrawBlockNumber}`);
    console.log(
      `✓ New proxy balance: ${ethers.formatEther(newProxyBalance)} ETH`
    );
    deploymentInfo.verificationResults.proxyWithdraw = true;
  } catch (error: any) {
    console.log(`  ❌ Proxy withdraw test failed: ${error.message}`);
  }

  // ========== STEP 7: VERIFY CONTRACTS ON ETHERSCAN ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 7: Verifying Contracts on Etherscan");
  console.log("=".repeat(80));

  if (!etherscanApiKey) {
    console.log(
      "\n⚠️  Skipping Etherscan verification (ETHERSCAN_API_KEY not found)"
    );
  } else {
    // Verify Proxy (no constructor args)
    console.log("\n7.1 Verifying DehiveProxy...");
    const proxyResult = await verifyContract(proxyAddress, [], "DehiveProxy");
    deploymentInfo.etherscanVerification.proxy = proxyResult.success;

    // Verify Message Facet (with constructor args)
    console.log("\n7.2 Verifying Message Facet...");
    const messageResult = await verifyContract(
      messageFacetAddress,
      [owner.address],
      "Message"
    );
    deploymentInfo.etherscanVerification.messageFacet = messageResult.success;

    // Verify PaymentHub Facet (with constructor args)
    console.log("\n7.3 Verifying PaymentHub Facet...");
    const paymentHubResult = await verifyContract(
      paymentHubFacetAddress,
      [owner.address],
      "PaymentHub"
    );
    deploymentInfo.etherscanVerification.paymentHubFacet =
      paymentHubResult.success;
  }

  // ========== STEP 8: SAVE DEPLOYMENT INFO ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 8: Saving Deployment Information");
  console.log("=".repeat(80));

  const deploymentFile = path.join(
    deploymentsDir,
    `${networkName}_deployAndVerifyAll_${Date.now()}.json`
  );
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));

  console.log(`✓ Deployment info saved to: ${deploymentFile}`);

  // ========== FINAL SUMMARY ==========
  console.log("\n" + "=".repeat(80));
  console.log("Deployment & Verification Summary");
  console.log("=".repeat(80));
  console.log(`Network: ${networkName} (Chain ID: ${chainId})`);
  console.log(`\n📦 Contracts:`);
  console.log(`  DehiveProxy: ${deploymentInfo.proxyAddress}`);
  console.log(`  Message Facet: ${deploymentInfo.messageFacetAddress}`);
  console.log(`  PaymentHub Facet: ${deploymentInfo.paymentHubFacetAddress}`);
  console.log(`\n👤 Roles:`);
  console.log(`  Proxy Owner: ${proxyOwner}`);
  console.log(`  Deployer: ${deployer.address}`);
  if (deploymentInfo.relayer) {
    console.log(`  Relayer: ${deploymentInfo.relayer}`);
  }
  console.log(`\n🔧 Configuration:`);
  console.log(`  Message Selectors: ${deploymentInfo.messageSelectors.length}`);
  console.log(
    `  PaymentHub Selectors: ${deploymentInfo.paymentHubSelectors.length}`
  );
  if (deploymentInfo.paymentHubConflicts) {
    console.log(
      `  PaymentHub Conflicts: ${deploymentInfo.paymentHubConflicts.length}`
    );
  }
  console.log(`\n✅ Verification Results:`);
  console.log(
    `  Message Read: ${
      deploymentInfo.verificationResults.messageRead ? "✅" : "❌"
    }`
  );
  console.log(
    `  Message Write: ${
      deploymentInfo.verificationResults.messageWrite ? "✅" : "❌"
    }`
  );
  console.log(
    `  PaymentHub Read: ${
      deploymentInfo.verificationResults.paymentHubRead ? "✅" : "❌"
    }`
  );
  console.log(
    `  PaymentHub Write: ${
      deploymentInfo.verificationResults.paymentHubWrite ? "✅" : "❌"
    }`
  );
  console.log(
    `  Proxy Withdraw: ${
      deploymentInfo.verificationResults.proxyWithdraw ? "✅" : "❌"
    }`
  );
  console.log(`\n🔍 Etherscan Verification:`);
  console.log(
    `  Proxy: ${deploymentInfo.etherscanVerification.proxy ? "✅" : "❌"}`
  );
  console.log(
    `  Message Facet: ${
      deploymentInfo.etherscanVerification.messageFacet ? "✅" : "❌"
    }`
  );
  console.log(
    `  PaymentHub Facet: ${
      deploymentInfo.etherscanVerification.paymentHubFacet ? "✅" : "❌"
    }`
  );

  // Generate Etherscan links
  if (networkName === "sepolia") {
    console.log(`\n🔗 Etherscan Links (Sepolia):`);
    console.log(
      `  DehiveProxy: https://sepolia.etherscan.io/address/${deploymentInfo.proxyAddress}#code`
    );
    console.log(
      `  Message Facet: https://sepolia.etherscan.io/address/${deploymentInfo.messageFacetAddress}#code`
    );
    console.log(
      `  PaymentHub Facet: https://sepolia.etherscan.io/address/${deploymentInfo.paymentHubFacetAddress}#code`
    );
  } else if (networkName === "mainnet") {
    console.log(`\n🔗 Etherscan Links (Mainnet):`);
    console.log(
      `  DehiveProxy: https://etherscan.io/address/${deploymentInfo.proxyAddress}#code`
    );
    console.log(
      `  Message Facet: https://etherscan.io/address/${deploymentInfo.messageFacetAddress}#code`
    );
    console.log(
      `  PaymentHub Facet: https://etherscan.io/address/${deploymentInfo.paymentHubFacetAddress}#code`
    );
  }

  console.log("\n" + "=".repeat(80));
  console.log("✅ Deployment & Verification Completed Successfully!");
  console.log("=".repeat(80));
  console.log(`\n📝 Deployment file: ${deploymentFile}`);
  console.log(
    `\n💡 Use the proxy address to interact with both Message and PaymentHub:`
  );
  console.log(`   ${deploymentInfo.proxyAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Deployment failed:");
    console.error(error);
    process.exit(1);
  });
