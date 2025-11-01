import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

/**
 * Deployment script for DehiveProxy contract
 *
 * Usage: npx hardhat run scripts/dehive/deployProxy.ts --network <network>
 */

interface DeploymentInfo {
  network: string;
  contractAddress: string;
  owner: string;
  deployer: string;
  deployedAt: number;
  transactionHash: string;
  blockNumber: number;
}

async function main() {
  console.log("=".repeat(60));
  console.log("Deploying DehiveProxy Contract");
  console.log("=".repeat(60));

  // Get signers
  const [deployer] = await ethers.getSigners();

  console.log(`\nDeployer: ${deployer.address}`);
  console.log(`Owner (will be set to deployer): ${deployer.address}`);

  // Deploy contract
  console.log("\nDeploying DehiveProxy contract...");
  const DehiveProxyFactory = await ethers.getContractFactory("DehiveProxy");
  const proxy = await DehiveProxyFactory.deploy();

  await proxy.waitForDeployment();
  const contractAddress = await proxy.getAddress();

  console.log(`✓ DehiveProxy deployed at: ${contractAddress}`);

  // Verify owner is set correctly
  const owner = await proxy.owner();
  console.log(`✓ Owner set to: ${owner}`);

  // Get deployment transaction details
  const deployTx = proxy.deploymentTransaction();
  const receipt = deployTx ? await deployTx.wait() : null;

  // Get network info
  const network = await ethers.provider.getNetwork();
  const networkName = network.name || "unknown";
  const blockNumber = await ethers.provider.getBlockNumber();

  // Create deployment info
  const deploymentInfo: DeploymentInfo = {
    network: networkName,
    contractAddress,
    owner: owner,
    deployer: deployer.address,
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
    `dehiveProxy_${networkName}.json`
  );
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));

  console.log(`\n✓ Deployment info saved to: ${deploymentFile}`);

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log("Deployment Summary");
  console.log("=".repeat(60));
  console.log(`Network: ${networkName}`);
  console.log(`Proxy Address: ${contractAddress}`);
  console.log(`Owner: ${owner}`);
  console.log(`Block Number: ${blockNumber}`);
  console.log("=".repeat(60));

  return {
    contractAddress,
    proxy,
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
