import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

/**
 * Deployment script for Message contract
 *
 * Usage: npx hardhat run scripts/message/deploy.ts --network <network>
 */

interface DeploymentInfo {
  network: string;
  contractAddress: string;
  owner: string;
  deployer: string;
  payAsYouGoFee: string;
  relayerFee: string;
  relayer?: string;
  deployedAt: number;
  transactionHash: string;
  blockNumber: number;
}

async function main() {
  console.log("=".repeat(60));
  console.log("Deploying Message Contract");
  console.log("=".repeat(60));

  // Get signers
  const [deployer, owner, relayer] = await ethers.getSigners();

  console.log(`\nDeployer: ${deployer.address}`);
  console.log(`Owner: ${owner.address}`);
  console.log(`Relayer: ${relayer.address}`);

  // Deploy contract
  console.log("\nDeploying Message contract...");
  const MessageFactory = await ethers.getContractFactory("Message");
  const messageContract = await MessageFactory.deploy(owner.address);

  await messageContract.waitForDeployment();
  const contractAddress = await messageContract.getAddress();

  console.log(`✓ Message contract deployed at: ${contractAddress}`);

  // Set relayer
  console.log("\nSetting relayer address...");
  const setRelayerTx = await messageContract
    .connect(owner)
    .setRelayer(relayer.address);
  await setRelayerTx.wait();
  console.log(`✓ Relayer set to: ${relayer.address}`);

  // Get fees
  const payAsYouGoFee = await messageContract.payAsYouGoFee();
  const relayerFee = await messageContract.relayerFee();

  // Get deployment transaction details
  const deployTx = messageContract.deploymentTransaction();
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
    relayer: relayer.address,
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
    `message_${networkName}.json`
  );
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));

  console.log(`\n✓ Deployment info saved to: ${deploymentFile}`);

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log("Deployment Summary");
  console.log("=".repeat(60));
  console.log(`Network: ${networkName}`);
  console.log(`Contract Address: ${contractAddress}`);
  console.log(`Owner: ${owner.address}`);
  console.log(`Relayer: ${relayer.address}`);
  console.log(`Pay-as-You-Go Fee: ${ethers.formatEther(payAsYouGoFee)} ETH`);
  console.log(`Relayer Fee: ${ethers.formatEther(relayerFee)} ETH`);
  console.log(`Block Number: ${blockNumber}`);
  console.log("=".repeat(60));

  return {
    contractAddress,
    messageContract,
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
