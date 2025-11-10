import { ethers } from "hardhat";
import fs from "fs";
import path from "path";
import { DehiveProxy, Message, PaymentHub } from "../typechain-types";
import { getFunctionSelectors } from "./dehive/helpers/facetHelpers";

/**
 * Unified Deployment Script for DehiveProxy, Message Facet, and PaymentHub Facet
 *
 * This script:
 * 1. Checks for existing deployments from deployment files
 * 2. Verifies existing contracts are accessible and functional
 * 3. Deploys missing contracts (proxy, message facet, payment hub facet)
 * 4. Installs facets into proxy (handling selector conflicts)
 * 5. Verifies read/write access through proxy
 * 6. Saves comprehensive deployment information
 *
 * Usage: npx hardhat run scripts/deployAll.ts --network <network>
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
  };
  deployedAt: number;
  transactionHashes: {
    proxyDeployment?: string;
    messageFacetDeployment?: string;
    messageFacetInstallation?: string;
    paymentHubFacetDeployment?: string;
    paymentHubFacetInstallation?: string;
    relayerSetup?: string;
  };
  blockNumbers: {
    proxyDeployment?: number;
    messageFacetDeployment?: number;
    messageFacetInstallation?: number;
    paymentHubFacetDeployment?: number;
    paymentHubFacetInstallation?: number;
    relayerSetup?: number;
  };
}

interface ContractStatus {
  exists: boolean;
  address: string;
  accessible: boolean;
  installed: boolean;
}

async function checkContractAccessibility(
  address: string,
  factory: any
): Promise<boolean> {
  try {
    const contract = factory.attach(address);
    // Try to read a basic property
    if (factory.interface.hasFunction("owner")) {
      await contract.owner();
    } else if (factory.interface.hasFunction("transactionFeePercent")) {
      await contract.transactionFeePercent();
    }
    return true;
  } catch {
    return false;
  }
}

async function checkFacetInstalled(
  proxy: DehiveProxy,
  facetAddress: string
): Promise<boolean> {
  try {
    const selectors = await proxy.facetFunctionSelectors(facetAddress);
    return selectors.length > 0;
  } catch {
    return false;
  }
}

async function main() {
  console.log("=".repeat(80));
  console.log("Unified Deployment: DehiveProxy + Message + PaymentHub");
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
    },
    deployedAt: Date.now(),
    transactionHashes: {},
    blockNumbers: {},
  };

  // ========== STEP 1: CHECK/LOAD PROXY ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 1: Checking/Deploying DehiveProxy");
  console.log("=".repeat(80));

  let proxy: DehiveProxy | null = null;
  let proxyAddress: string = "";
  let proxyStatus: ContractStatus = {
    exists: false,
    address: "",
    accessible: false,
    installed: false,
  };

  // Try to load from deployment file
  const proxyDeploymentFile = path.join(
    deploymentsDir,
    `${networkName}_dehiveProxy_messageFacet.json`
  );

  if (fs.existsSync(proxyDeploymentFile)) {
    const proxyDeployment = JSON.parse(
      fs.readFileSync(proxyDeploymentFile, "utf-8")
    );
    proxyAddress =
      proxyDeployment.proxyAddress || proxyDeployment.contractAddress;
    proxyStatus.exists = true;
    proxyStatus.address = proxyAddress;

    console.log(`✓ Found existing proxy deployment: ${proxyAddress}`);

    // Verify proxy is accessible
    const ProxyFactory = await ethers.getContractFactory("DehiveProxy");
    proxyStatus.accessible = await checkContractAccessibility(
      proxyAddress,
      ProxyFactory
    );

    if (proxyStatus.accessible) {
      proxy = ProxyFactory.attach(proxyAddress) as DehiveProxy;
      const proxyOwner = await proxy.owner();
      console.log(`✓ Proxy is accessible, owner: ${proxyOwner}`);
      deploymentInfo.proxyAddress = proxyAddress;
    } else {
      console.log(
        `⚠️  Proxy exists but is not accessible, will deploy new one`
      );
    }
  } else if (process.env.PROXY_ADDRESS) {
    proxyAddress = process.env.PROXY_ADDRESS;
    proxyStatus.exists = true;
    proxyStatus.address = proxyAddress;

    console.log(
      `✓ Using proxy address from PROXY_ADDRESS env var: ${proxyAddress}`
    );

    const ProxyFactory = await ethers.getContractFactory("DehiveProxy");
    proxyStatus.accessible = await checkContractAccessibility(
      proxyAddress,
      ProxyFactory
    );

    if (proxyStatus.accessible) {
      proxy = ProxyFactory.attach(proxyAddress) as DehiveProxy;
      const proxyOwner = await proxy.owner();
      console.log(`✓ Proxy is accessible, owner: ${proxyOwner}`);
      deploymentInfo.proxyAddress = proxyAddress;
    } else {
      console.log(
        `⚠️  Proxy address provided but not accessible, will deploy new one`
      );
    }
  }

  // Deploy proxy if not found or not accessible
  if (!proxyStatus.accessible || !proxy) {
    console.log("\nDeploying new DehiveProxy...");
    const ProxyFactory = await ethers.getContractFactory("DehiveProxy");
    const newProxy = await ProxyFactory.deploy();
    await newProxy.waitForDeployment();
    proxyAddress = await newProxy.getAddress();
    proxy = newProxy;

    const proxyDeployTx = proxy.deploymentTransaction();
    const proxyDeployReceipt = proxyDeployTx
      ? await proxyDeployTx.wait()
      : null;
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
  }

  if (!proxy) {
    throw new Error("Proxy not initialized");
  }

  const proxyOwner = await proxy.owner();
  console.log(`✓ Proxy owner: ${proxyOwner}`);

  // ========== STEP 2: CHECK/LOAD/DEPLOY MESSAGE FACET ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 2: Checking/Deploying Message Facet");
  console.log("=".repeat(80));

  let messageFacet: Message | null = null;
  let messageFacetAddress: string = "";
  let messageFacetStatus: ContractStatus = {
    exists: false,
    address: "",
    accessible: false,
    installed: false,
  };

  // Try to load from deployment file
  if (fs.existsSync(proxyDeploymentFile)) {
    const proxyDeployment = JSON.parse(
      fs.readFileSync(proxyDeploymentFile, "utf-8")
    );
    messageFacetAddress =
      proxyDeployment.facetAddress || proxyDeployment.messageFacetAddress;
    if (messageFacetAddress) {
      messageFacetStatus.exists = true;
      messageFacetStatus.address = messageFacetAddress;

      console.log(
        `✓ Found existing Message facet deployment: ${messageFacetAddress}`
      );

      // Verify facet is accessible
      const MessageFactory = await ethers.getContractFactory("Message");
      messageFacetStatus.accessible = await checkContractAccessibility(
        messageFacetAddress,
        MessageFactory
      );

      if (messageFacetStatus.accessible) {
        messageFacet = MessageFactory.attach(messageFacetAddress) as Message;
        console.log(`✓ Message facet is accessible`);
        deploymentInfo.messageFacetAddress = messageFacetAddress;
      } else {
        console.log(
          `⚠️  Message facet exists but is not accessible, will deploy new one`
        );
      }
    }
  }

  // Deploy Message facet if not found or not accessible
  if (!messageFacetStatus.accessible || !messageFacet) {
    console.log("\nDeploying new Message facet...");
    const MessageFactory = await ethers.getContractFactory("Message");
    const newMessageFacet = await MessageFactory.deploy(owner.address);
    await newMessageFacet.waitForDeployment();
    messageFacetAddress = await newMessageFacet.getAddress();
    messageFacet = newMessageFacet;

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
      `✓ Block number: ${
        messageDeployReceipt?.blockNumber || messageBlockNumber
      }`
    );
  }

  if (!proxy || !messageFacetAddress) {
    throw new Error("Proxy or Message facet not initialized");
  }

  // Check if Message facet is installed in proxy
  messageFacetStatus.installed = await checkFacetInstalled(
    proxy,
    messageFacetAddress
  );

  if (messageFacetStatus.installed) {
    console.log(`✓ Message facet is already installed in proxy`);
  } else {
    console.log(`⚠️  Message facet is not installed in proxy, installing...`);

    // Get IMessage ABI for function selectors
    const imessageArtifactPath = path.join(
      __dirname,
      "../artifacts/contracts/interfaces/IMessage.sol/IMessage.json"
    );
    const imessageAbi = JSON.parse(
      fs.readFileSync(imessageArtifactPath, "utf-8")
    ).abi;

    const messageSelectors = getFunctionSelectors(imessageAbi);
    deploymentInfo.messageSelectors = messageSelectors;
    console.log(
      `✓ Found ${messageSelectors.length} Message function selectors`
    );

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

    console.log("Installing Message facet into proxy...");
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
  }

  // ========== STEP 3: CHECK/LOAD/DEPLOY PAYMENTHUB FACET ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 3: Checking/Deploying PaymentHub Facet");
  console.log("=".repeat(80));

  let paymentHubFacet: PaymentHub | null = null;
  let paymentHubFacetAddress: string = "";
  let paymentHubFacetStatus: ContractStatus = {
    exists: false,
    address: "",
    accessible: false,
    installed: false,
  };

  // Try to load from deployment file
  const paymentHubDeploymentFile = path.join(
    deploymentsDir,
    `${networkName}_paymentHubFacet.json`
  );

  if (fs.existsSync(paymentHubDeploymentFile)) {
    const paymentHubDeployment = JSON.parse(
      fs.readFileSync(paymentHubDeploymentFile, "utf-8")
    );
    paymentHubFacetAddress = paymentHubDeployment.facetAddress;
    if (paymentHubFacetAddress) {
      paymentHubFacetStatus.exists = true;
      paymentHubFacetStatus.address = paymentHubFacetAddress;

      console.log(
        `✓ Found existing PaymentHub facet deployment: ${paymentHubFacetAddress}`
      );

      // Verify facet is accessible
      const PaymentHubFactory = await ethers.getContractFactory("PaymentHub");
      paymentHubFacetStatus.accessible = await checkContractAccessibility(
        paymentHubFacetAddress,
        PaymentHubFactory
      );

      if (paymentHubFacetStatus.accessible) {
        paymentHubFacet = PaymentHubFactory.attach(
          paymentHubFacetAddress
        ) as PaymentHub;
        console.log(`✓ PaymentHub facet is accessible`);
        deploymentInfo.paymentHubFacetAddress = paymentHubFacetAddress;
      } else {
        console.log(
          `⚠️  PaymentHub facet exists but is not accessible, will deploy new one`
        );
      }
    }
  } else if (process.env.PAYMENTHUB_FACET_ADDRESS) {
    paymentHubFacetAddress = process.env.PAYMENTHUB_FACET_ADDRESS;
    paymentHubFacetStatus.exists = true;
    paymentHubFacetStatus.address = paymentHubFacetAddress;

    console.log(
      `✓ Using PaymentHub facet address from PAYMENTHUB_FACET_ADDRESS env var: ${paymentHubFacetAddress}`
    );

    const PaymentHubFactory = await ethers.getContractFactory("PaymentHub");
    paymentHubFacetStatus.accessible = await checkContractAccessibility(
      paymentHubFacetAddress,
      PaymentHubFactory
    );

    if (paymentHubFacetStatus.accessible) {
      paymentHubFacet = PaymentHubFactory.attach(
        paymentHubFacetAddress
      ) as PaymentHub;
      console.log(`✓ PaymentHub facet is accessible`);
      deploymentInfo.paymentHubFacetAddress = paymentHubFacetAddress;
    } else {
      console.log(
        `⚠️  PaymentHub facet address provided but not accessible, will deploy new one`
      );
    }
  }

  // Deploy PaymentHub facet if not found or not accessible
  if (!paymentHubFacetStatus.accessible || !paymentHubFacet) {
    console.log("\nDeploying new PaymentHub facet...");
    const PaymentHubFactory = await ethers.getContractFactory("PaymentHub");
    const newPaymentHubFacet = await PaymentHubFactory.deploy(owner.address);
    await newPaymentHubFacet.waitForDeployment();
    paymentHubFacetAddress = await newPaymentHubFacet.getAddress();
    paymentHubFacet = newPaymentHubFacet;

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
  }

  if (!proxy || !paymentHubFacetAddress) {
    throw new Error("Proxy or PaymentHub facet not initialized");
  }

  // Check if PaymentHub facet is installed in proxy
  paymentHubFacetStatus.installed = await checkFacetInstalled(
    proxy,
    paymentHubFacetAddress
  );

  if (paymentHubFacetStatus.installed) {
    console.log(`✓ PaymentHub facet is already installed in proxy`);
  } else {
    console.log(
      `⚠️  PaymentHub facet is not installed in proxy, installing...`
    );

    // Get IPaymentHub ABI for function selectors
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

      const facetCut = {
        facetAddress: paymentHubFacetAddress,
        functionSelectors: availableSelectors, // Only install available selectors
        action: 0, // Add
      };

      const paymenthubArtifactPath = path.join(
        __dirname,
        "../artifacts/contracts/PaymentHub.sol/PaymentHub.json"
      );
      const paymenthubAbi = JSON.parse(
        fs.readFileSync(paymenthubArtifactPath, "utf-8")
      ).abi;

      const initCalldata = ethers.Interface.from(
        paymenthubAbi
      ).encodeFunctionData("init", [proxyOwner]);

      console.log("Installing PaymentHub facet into proxy...");
      const installTx = await proxy
        .connect(deployer)
        .facetCut([facetCut], paymentHubFacetAddress, initCalldata);
      const installReceipt = await installTx.wait();
      const installBlockNumber = installReceipt!.blockNumber;

      deploymentInfo.transactionHashes.paymentHubFacetInstallation =
        installTx.hash;
      deploymentInfo.blockNumbers.paymentHubFacetInstallation =
        installBlockNumber;

      console.log(`✓ PaymentHub facet installed into proxy`);
      console.log(`✓ Transaction: ${installTx.hash}`);
      console.log(`✓ Block number: ${installBlockNumber}`);
    }

    deploymentInfo.paymentHubSelectors = allPaymentHubSelectors;
  }

  // ========== STEP 4: SET RELAYER (IF NEEDED) ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 4: Setting Relayer Address (if needed)");
  console.log("=".repeat(80));

  // Connect to proxy as Message interface
  const MessageFactory = await ethers.getContractFactory("Message");
  const messageViaProxy = MessageFactory.attach(
    deploymentInfo.proxyAddress
  ) as Message;

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
  const PaymentHubFactory = await ethers.getContractFactory("PaymentHub");
  const paymentHubViaProxy = PaymentHubFactory.attach(
    deploymentInfo.proxyAddress
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
    // Try to read current relayer (this is a write operation test)
    const currentRelayer = await messageViaProxy.relayer();
    if (currentRelayer.toLowerCase() !== relayer.address.toLowerCase()) {
      // Try to set relayer (if we have permission)
      try {
        const testTx = await messageViaProxy
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

    // Try static call first to test without actually changing state
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

  // ========== STEP 6: SAVE DEPLOYMENT INFO ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 6: Saving Deployment Information");
  console.log("=".repeat(80));

  const deploymentFile = path.join(
    deploymentsDir,
    `${networkName}_deployAll_${Date.now()}.json`
  );
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));

  console.log(`✓ Deployment info saved to: ${deploymentFile}`);

  // ========== FINAL SUMMARY ==========
  console.log("\n" + "=".repeat(80));
  console.log("Deployment Summary");
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
  console.log(`\n📄 Transactions:`);
  if (deploymentInfo.transactionHashes.proxyDeployment) {
    console.log(
      `  Proxy Deployment: ${deploymentInfo.transactionHashes.proxyDeployment}`
    );
  }
  if (deploymentInfo.transactionHashes.messageFacetDeployment) {
    console.log(
      `  Message Facet Deployment: ${deploymentInfo.transactionHashes.messageFacetDeployment}`
    );
  }
  if (deploymentInfo.transactionHashes.messageFacetInstallation) {
    console.log(
      `  Message Facet Installation: ${deploymentInfo.transactionHashes.messageFacetInstallation}`
    );
  }
  if (deploymentInfo.transactionHashes.paymentHubFacetDeployment) {
    console.log(
      `  PaymentHub Facet Deployment: ${deploymentInfo.transactionHashes.paymentHubFacetDeployment}`
    );
  }
  if (deploymentInfo.transactionHashes.paymentHubFacetInstallation) {
    console.log(
      `  PaymentHub Facet Installation: ${deploymentInfo.transactionHashes.paymentHubFacetInstallation}`
    );
  }
  if (deploymentInfo.transactionHashes.relayerSetup) {
    console.log(
      `  Relayer Setup: ${deploymentInfo.transactionHashes.relayerSetup}`
    );
  }

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
  console.log("✅ Unified Deployment Completed Successfully!");
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
