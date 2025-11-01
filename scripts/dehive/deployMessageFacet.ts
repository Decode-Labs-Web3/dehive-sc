import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

/**
 * Deployment script for MessageFacet contract (standalone Message contract)
 *
 * Usage: npx hardhat run scripts/dehive/deployMessageFacet.ts --network <network>
 */

interface DeploymentInfo {
  network: string;
  contractAddress: string;
  owner: string;
  deployer: string;
  payAsYouGoFee: string;
  relayerFee: string;
  deployedAt: number;
  transactionHash: string;
  blockNumber: number;
}

async function main() {
  console.log("=".repeat(60));
  console.log("Deploying MessageFacet Contract");
  console.log("=".repeat(60));

  // Get signers
  const [deployer, owner] = await ethers.getSigners();

  console.log(`\nDeployer: ${deployer.address}`);
  console.log(`Owner: ${owner.address}`);

  // Deploy contract
  console.log("\nDeploying MessageFacet contract...");
  const MessageFactory = await ethers.getContractFactory("Message");
  const messageFacet = await MessageFactory.deploy(owner.address);

  await messageFacet.waitForDeployment();
  const contractAddress = await messageFacet.getAddress();

  console.log(`✓ MessageFacet deployed at: ${contractAddress}`);

  // Get fees
  const payAsYouGoFee = await messageFacet.payAsYouGoFee();
  const relayerFee = await messageFacet.relayerFee();

  console.log(`✓ Pay-as-You-Go Fee: ${ethers.formatEther(payAsYouGoFee)} ETH`);
  console.log(`✓ Relayer Fee: ${ethers.formatEther(relayerFee)} ETH`);

  // Get deployment transaction details
  const deployTx = messageFacet.deploymentTransaction();
  const receipt = deployTx ? await deployTx.wait() : null;

  // Get network info
  const network = await ethers.provider.getNetwork();
  const networkName = network.name || "unknown";
  const blockNumber = await ethers.provider.getBlockNumber();

  // Create deployment info
  const deploymentInfo: DeploymentInfo = {
    network: networkName,
    contractAddress,
    owner: owner.address,
    deployer: deployer.address,
    payAsYouGoFee: payAsYouGoFee.toString(),
    relayerFee: relayerFee.toString(),
    deployedAt: Date.now(),
    transactionHash: receipt?.hash || "",
    blockNumber,
  };

  // Save deployment info
  const deploymentsDir = path.join(__dirname, "../../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const deploymentFile = path.join(
    deploymentsDir,
    `messageFacet_${networkName}.json`
  );
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));

  console.log(`\n✓ Deployment info saved to: ${deploymentFile}`);

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log("Deployment Summary");
  console.log("=".repeat(60));
  console.log(`Network: ${networkName}`);
  console.log(`Facet Address: ${contractAddress}`);
  console.log(`Owner: ${owner.address}`);
  console.log(`Pay-as-You-Go Fee: ${ethers.formatEther(payAsYouGoFee)} ETH`);
  console.log(`Relayer Fee: ${ethers.formatEther(relayerFee)} ETH`);
  console.log(`Block Number: ${blockNumber}`);
  console.log("=".repeat(60));

  return {
    contractAddress,
    messageFacet,
    deploymentInfo,
  };
}

// Execute deployment
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Deployment failed:");
    console.error(error);
    process.exit(1);
  });
