import { ethers } from "hardhat";
import fs from "fs";
import path from "path";
import { DehiveProxy, Message } from "../../typechain-types";
import { getFunctionSelectors } from "./helpers/facetHelpers";

/**
 * Deployment script for Sepolia testnet
 *
 * This script:
 * 1. Deploys DehiveProxy
 * 2. Deploys MessageFacet (standalone Message contract)
 * 3. Installs MessageFacet into DehiveProxy
 * 4. Initializes MessageFacet through proxy
 * 5. Sets relayer address
 * 6. Saves all deployment information
 *
 * Usage: npx hardhat run scripts/dehive/deploySepolia.ts --network sepolia
 */

interface DeploymentInfo {
  network: string;
  proxyAddress: string;
  facetAddress: string;
  owner: string;
  deployer: string;
  relayer: string;
  payAsYouGoFee: string;
  relayerFee: string;
  functionSelectors: string[];
  deployedAt: number;
  transactionHashes: {
    proxyDeployment: string;
    facetDeployment: string;
    facetInstallation: string;
    relayerSetup: string;
  };
  blockNumbers: {
    proxyDeployment: number;
    facetDeployment: number;
    facetInstallation: number;
    relayerSetup: number;
  };
}

async function main() {
  console.log("=".repeat(80));
  console.log("Deploying DehiveProxy + MessageFacet to Sepolia");
  console.log("=".repeat(80));

  // Get network info
  const network = await ethers.provider.getNetwork();
  const networkName = network.name || "sepolia";
  const chainId = network.chainId.toString();

  console.log(`\nNetwork: ${networkName}`);
  console.log(`Chain ID: ${chainId}`);

  // Get signer from PRIVATE_KEY (all roles use the same account)
  const deployer = (await ethers.getSigners())[0];
  const owner = deployer; // Same account for owner
  const relayer = deployer; // Same account for relayer

  console.log(`\n📋 Deployment Configuration:`);
  console.log(`  Deployer: ${deployer.address}`);
  console.log(`  Owner: ${owner.address} (same as deployer)`);
  console.log(`  Relayer: ${relayer.address} (same as deployer)`);

  // Check balance
  const deployerBalance = await ethers.provider.getBalance(deployer.address);

  console.log(`\n💰 Account Balance:`);
  console.log(
    `  Deployer/Owner/Relayer: ${ethers.formatEther(deployerBalance)} ETH`
  );

  if (deployerBalance < ethers.parseEther("0.01")) {
    console.warn(
      "\n⚠️  WARNING: Deployer balance is low. Deployment may fail!"
    );
  }

  // ========== STEP 1: DEPLOY PROXY ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 1: Deploying DehiveProxy");
  console.log("=".repeat(80));

  console.log("Deploying DehiveProxy contract...");
  const ProxyFactory = await ethers.getContractFactory("DehiveProxy");
  const proxy = await ProxyFactory.deploy();
  await proxy.waitForDeployment();
  const proxyAddress = await proxy.getAddress();

  const proxyDeployTx = proxy.deploymentTransaction();
  const proxyDeployReceipt = proxyDeployTx ? await proxyDeployTx.wait() : null;
  const proxyBlockNumber = await ethers.provider.getBlockNumber();

  const proxyOwner = await proxy.owner();

  console.log(`✓ DehiveProxy deployed at: ${proxyAddress}`);
  console.log(`✓ Proxy owner: ${proxyOwner}`);
  console.log(`✓ Transaction: ${proxyDeployReceipt?.hash || "N/A"}`);
  console.log(
    `✓ Block number: ${proxyDeployReceipt?.blockNumber || proxyBlockNumber}`
  );

  // ========== STEP 2: DEPLOY FACET ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 2: Deploying MessageFacet");
  console.log("=".repeat(80));

  console.log("Deploying MessageFacet contract...");
  const MessageFactory = await ethers.getContractFactory("Message");
  // Use deployer address as owner (they're the same account)
  const messageFacet = await MessageFactory.deploy(deployer.address);
  await messageFacet.waitForDeployment();
  const facetAddress = await messageFacet.getAddress();

  const facetDeployTx = messageFacet.deploymentTransaction();
  const facetDeployReceipt = facetDeployTx ? await facetDeployTx.wait() : null;
  const facetBlockNumber = await ethers.provider.getBlockNumber();

  console.log(`✓ MessageFacet deployed at: ${facetAddress}`);
  console.log(`✓ Transaction: ${facetDeployReceipt?.hash || "N/A"}`);
  console.log(
    `✓ Block number: ${facetDeployReceipt?.blockNumber || facetBlockNumber}`
  );

  // ========== STEP 3: INSTALL FACET ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 3: Installing MessageFacet into DehiveProxy");
  console.log("=".repeat(80));

  // Get IMessage ABI for function selectors
  const imessageArtifactPath = path.join(
    __dirname,
    "../../artifacts/contracts/interfaces/IMessage.sol/IMessage.json"
  );
  const imessageAbi = JSON.parse(
    fs.readFileSync(imessageArtifactPath, "utf-8")
  ).abi;

  const functionSelectors = getFunctionSelectors(imessageAbi);
  console.log(`✓ Found ${functionSelectors.length} function selectors`);

  const facetCut = {
    facetAddress: facetAddress,
    functionSelectors: functionSelectors,
    action: 0, // Add
  };

  const messageArtifactPath = path.join(
    __dirname,
    "../../artifacts/contracts/Message.sol/Message.json"
  );
  const messageAbi = JSON.parse(
    fs.readFileSync(messageArtifactPath, "utf-8")
  ).abi;

  const initCalldata = ethers.Interface.from(messageAbi).encodeFunctionData(
    "init",
    [proxyOwner]
  );

  console.log("Installing facet into proxy...");
  const installTx = await proxy
    .connect(deployer)
    .facetCut([facetCut], facetAddress, initCalldata);
  const installReceipt = await installTx.wait();
  const installBlockNumber = installReceipt!.blockNumber;

  console.log(`✓ MessageFacet installed into proxy`);
  console.log(`✓ Transaction: ${installTx.hash}`);
  console.log(`✓ Block number: ${installBlockNumber}`);

  // Connect to proxy as Message interface
  const messageViaProxy = MessageFactory.attach(proxyAddress) as Message;

  // ========== STEP 4: SET RELAYER ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 4: Setting Relayer Address");
  console.log("=".repeat(80));

  console.log("Setting relayer address...");
  const setRelayerTx = await messageViaProxy
    .connect(deployer)
    .setRelayer(relayer.address);
  const setRelayerReceipt = await setRelayerTx.wait();
  const setRelayerBlockNumber = setRelayerReceipt!.blockNumber;

  const currentRelayer = await messageViaProxy.relayer();
  console.log(`✓ Relayer set to: ${currentRelayer}`);
  console.log(`✓ Transaction: ${setRelayerTx.hash}`);
  console.log(`✓ Block number: ${setRelayerBlockNumber}`);

  // ========== STEP 5: VERIFY DEPLOYMENT ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 5: Verifying Deployment");
  console.log("=".repeat(80));

  // Verify fees
  const payAsYouGoFee = await messageViaProxy.payAsYouGoFee();
  const relayerFee = await messageViaProxy.relayerFee();
  console.log(`✓ Pay-as-You-Go Fee: ${ethers.formatEther(payAsYouGoFee)} ETH`);
  console.log(`✓ Relayer Fee: ${ethers.formatEther(relayerFee)} ETH`);

  // Verify facet installation
  const installedSelectors = await proxy.facetFunctionSelectors(facetAddress);
  console.log(
    `✓ Facet has ${installedSelectors.length} function selectors installed`
  );

  // ========== STEP 6: SAVE DEPLOYMENT INFO ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 6: Saving Deployment Information");
  console.log("=".repeat(80));

  const deploymentInfo: DeploymentInfo = {
    network: networkName,
    proxyAddress: proxyAddress,
    facetAddress: facetAddress,
    owner: proxyOwner,
    deployer: deployer.address,
    relayer: relayer.address,
    payAsYouGoFee: payAsYouGoFee.toString(),
    relayerFee: relayerFee.toString(),
    functionSelectors: functionSelectors,
    deployedAt: Date.now(),
    transactionHashes: {
      proxyDeployment: proxyDeployReceipt?.hash || "",
      facetDeployment: facetDeployReceipt?.hash || "",
      facetInstallation: installTx.hash,
      relayerSetup: setRelayerTx.hash,
    },
    blockNumbers: {
      proxyDeployment: proxyDeployReceipt?.blockNumber || proxyBlockNumber,
      facetDeployment: facetDeployReceipt?.blockNumber || facetBlockNumber,
      facetInstallation: installBlockNumber,
      relayerSetup: setRelayerBlockNumber,
    },
  };

  // Save deployment info
  const deploymentsDir = path.join(__dirname, "../../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const deploymentFile = path.join(
    deploymentsDir,
    `sepolia_dehiveProxy_messageFacet.json`
  );
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));

  console.log(`✓ Deployment info saved to: ${deploymentFile}`);

  // ========== FINAL SUMMARY ==========
  console.log("\n" + "=".repeat(80));
  console.log("Deployment Summary");
  console.log("=".repeat(80));
  console.log(`Network: ${networkName} (Chain ID: ${chainId})`);
  console.log(`\n📦 Contracts:`);
  console.log(`  DehiveProxy: ${proxyAddress}`);
  console.log(`  MessageFacet: ${facetAddress}`);
  console.log(`\n👤 Roles:`);
  console.log(`  Proxy Owner: ${proxyOwner}`);
  console.log(`  Deployer: ${deployer.address}`);
  console.log(`  Relayer: ${relayer.address}`);
  console.log(`\n💰 Fees:`);
  console.log(`  Pay-as-You-Go: ${ethers.formatEther(payAsYouGoFee)} ETH`);
  console.log(`  Relayer: ${ethers.formatEther(relayerFee)} ETH`);
  console.log(`\n🔧 Configuration:`);
  console.log(`  Function Selectors: ${functionSelectors.length}`);
  console.log(`\n📄 Transactions:`);
  console.log(
    `  Proxy Deployment: ${deploymentInfo.transactionHashes.proxyDeployment}`
  );
  console.log(
    `  Facet Deployment: ${deploymentInfo.transactionHashes.facetDeployment}`
  );
  console.log(
    `  Facet Installation: ${deploymentInfo.transactionHashes.facetInstallation}`
  );
  console.log(
    `  Relayer Setup: ${deploymentInfo.transactionHashes.relayerSetup}`
  );
  console.log(`\n📍 Block Numbers:`);
  console.log(`  Proxy: ${deploymentInfo.blockNumbers.proxyDeployment}`);
  console.log(`  Facet: ${deploymentInfo.blockNumbers.facetDeployment}`);
  console.log(
    `  Installation: ${deploymentInfo.blockNumbers.facetInstallation}`
  );
  console.log(`  Relayer Setup: ${deploymentInfo.blockNumbers.relayerSetup}`);
  console.log("\n" + "=".repeat(80));
  console.log("✅ Deployment Completed Successfully!");
  console.log("=".repeat(80));
  console.log(`\n📝 Deployment file: ${deploymentFile}`);
  console.log(
    `\n🔗 Explorer Links (if available):\n  Proxy: https://sepolia.etherscan.io/address/${proxyAddress}\n  Facet: https://sepolia.etherscan.io/address/${facetAddress}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Deployment failed:");
    console.error(error);
    process.exit(1);
  });
