import { ethers } from "hardhat";
import fs from "fs";
import path from "path";
import { DehiveProxy, Message, IDehiveProxy } from "../../typechain-types";
import {
  getFunctionSelectors,
  verifyFacetInstallation,
} from "./helpers/facetHelpers";

/**
 * Installation script for MessageFacet into DehiveProxy
 *
 * Usage: npx hardhat run scripts/dehive/installMessageFacet.ts --network <network>
 */

interface InstallationInfo {
  network: string;
  proxyAddress: string;
  facetAddress: string;
  owner: string;
  functionSelectors: string[];
  installedAt: number;
  transactionHash: string;
  blockNumber: number;
}

async function main() {
  console.log("=".repeat(60));
  console.log("Installing MessageFacet into DehiveProxy");
  console.log("=".repeat(60));

  // Get network
  const network = await ethers.provider.getNetwork();
  const networkName = network.name || "unknown";

  // Load deployment info
  const deploymentsDir = path.join(__dirname, "../../deployments");
  const proxyDeploymentFile = path.join(
    deploymentsDir,
    `dehiveProxy_${networkName}.json`
  );
  const facetDeploymentFile = path.join(
    deploymentsDir,
    `messageFacet_${networkName}.json`
  );

  if (!fs.existsSync(proxyDeploymentFile)) {
    throw new Error(
      `Proxy deployment not found. Please deploy proxy first: ${proxyDeploymentFile}`
    );
  }

  if (!fs.existsSync(facetDeploymentFile)) {
    throw new Error(
      `Facet deployment not found. Please deploy facet first: ${facetDeploymentFile}`
    );
  }

  const proxyDeployment = JSON.parse(
    fs.readFileSync(proxyDeploymentFile, "utf-8")
  );
  const facetDeployment = JSON.parse(
    fs.readFileSync(facetDeploymentFile, "utf-8")
  );

  const proxyAddress = proxyDeployment.contractAddress;
  const facetAddress = facetDeployment.contractAddress;

  console.log(`\nProxy Address: ${proxyAddress}`);
  console.log(`Facet Address: ${facetAddress}`);

  // Get signers
  const [deployer, owner] = await ethers.getSigners();
  console.log(`\nOwner: ${owner.address}`);

  // Attach to contracts
  const ProxyFactory = await ethers.getContractFactory("DehiveProxy");
  const proxy = ProxyFactory.attach(proxyAddress) as DehiveProxy;

  // Verify owner
  const proxyOwner = await proxy.owner();
  if (proxyOwner.toLowerCase() !== owner.address.toLowerCase()) {
    throw new Error(
      `Proxy owner mismatch. Expected ${owner.address}, got ${proxyOwner}`
    );
  }
  console.log(`✓ Proxy owner verified: ${proxyOwner}`);

  // Get Message ABI to extract function selectors
  const MessageFactory = await ethers.getContractFactory("Message");
  const messageArtifact = await MessageFactory.getDeploymentTransaction();

  // Get ABI from artifacts
  const messageArtifactPath = path.join(
    __dirname,
    "../../artifacts/contracts/Message.sol/Message.json"
  );
  const messageArtifactJson = JSON.parse(
    fs.readFileSync(messageArtifactPath, "utf-8")
  );
  const messageAbi = messageArtifactJson.abi;

  // Get IMessage interface ABI
  const imessageArtifactPath = path.join(
    __dirname,
    "../../artifacts/contracts/interfaces/IMessage.sol/IMessage.json"
  );
  const imessageArtifactJson = JSON.parse(
    fs.readFileSync(imessageArtifactPath, "utf-8")
  );
  const imessageAbi = imessageArtifactJson.abi;

  // Get function selectors from IMessage interface
  const functionSelectors = getFunctionSelectors(imessageAbi);
  console.log(`\n✓ Found ${functionSelectors.length} function selectors:`);
  functionSelectors.forEach((selector, index) => {
    console.log(`  ${index + 1}. ${selector}`);
  });

  // Prepare facet cut
  const facetCut = {
    facetAddress: facetAddress,
    functionSelectors: functionSelectors,
    action: 0, // Add
  };

  // Encode init function call
  const initCalldata = ethers.Interface.from(messageAbi).encodeFunctionData(
    "init",
    [owner.address]
  );

  console.log("\nInstalling MessageFacet into proxy...");
  console.log(`  Facet Address: ${facetAddress}`);
  console.log(`  Function Selectors: ${functionSelectors.length}`);
  console.log(`  Init Owner: ${owner.address}`);

  // Install facet
  const tx = await proxy
    .connect(owner)
    .facetCut([facetCut], facetAddress, initCalldata);

  console.log(`\nTransaction sent: ${tx.hash}`);
  console.log("Waiting for confirmation...");

  const receipt = await tx.wait();
  console.log(`✓ Transaction confirmed at block ${receipt!.blockNumber}`);

  // Verify installation
  console.log("\nVerifying installation...");
  const isInstalled = await verifyFacetInstallation(
    proxy as unknown as IDehiveProxy,
    facetAddress,
    functionSelectors
  );

  if (!isInstalled) {
    throw new Error("Facet installation verification failed");
  }
  console.log("✓ Facet installation verified");

  // Get block number
  const blockNumber = await ethers.provider.getBlockNumber();

  // Create installation info
  const installationInfo: InstallationInfo = {
    network: networkName,
    proxyAddress: proxyAddress,
    facetAddress: facetAddress,
    owner: owner.address,
    functionSelectors: functionSelectors,
    installedAt: Date.now(),
    transactionHash: receipt!.hash,
    blockNumber: blockNumber,
  };

  // Save installation info
  const installationFile = path.join(
    deploymentsDir,
    `messageFacet_installation_${networkName}.json`
  );
  fs.writeFileSync(installationFile, JSON.stringify(installationInfo, null, 2));

  console.log(`\n✓ Installation info saved to: ${installationFile}`);

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log("Installation Summary");
  console.log("=".repeat(60));
  console.log(`Network: ${networkName}`);
  console.log(`Proxy Address: ${proxyAddress}`);
  console.log(`Facet Address: ${facetAddress}`);
  console.log(`Owner: ${owner.address}`);
  console.log(`Function Selectors: ${functionSelectors.length}`);
  console.log(`Transaction Hash: ${receipt!.hash}`);
  console.log(`Block Number: ${blockNumber}`);
  console.log("=".repeat(60));

  return {
    proxyAddress,
    facetAddress,
    proxy,
    installationInfo,
  };
}

// Execute installation
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Installation failed:");
    console.error(error);
    process.exit(1);
  });
