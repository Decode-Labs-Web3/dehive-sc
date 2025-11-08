import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

/**
 * Deployment script for PaymentHub contract (standalone mode)
 *
 * This script deploys PaymentHub as a standalone contract with its own owner.
 * The contract can be used independently without a proxy.
 *
 * Usage: npx hardhat run scripts/payment/deployPaymentHub.ts --network <network>
 */

interface DeploymentInfo {
  network: string;
  contractAddress: string;
  owner: string;
  deployer: string;
  transactionFeePercent: number;
  deployedAt: number;
  transactionHash: string;
  blockNumber: number;
}

async function main() {
  console.log("=".repeat(80));
  console.log("Deploying PaymentHub Contract (Standalone Mode)");
  console.log("=".repeat(80));

  // Get signers
  const [deployer, owner] = await ethers.getSigners();

  console.log(`\nDeployer: ${deployer.address}`);
  console.log(`Owner: ${owner.address}`);

  // Check balance
  const deployerBalance = await ethers.provider.getBalance(deployer.address);
  console.log(`\n💰 Deployer Balance: ${ethers.formatEther(deployerBalance)} ETH`);

  if (deployerBalance < ethers.parseEther("0.01")) {
    console.warn("\n⚠️  WARNING: Deployer balance is low. Deployment may fail!");
  }

  // Deploy contract
  console.log("\nDeploying PaymentHub contract...");
  const PaymentHubFactory = await ethers.getContractFactory("PaymentHub");
  const paymentHub = await PaymentHubFactory.deploy(owner.address);

  await paymentHub.waitForDeployment();
  const contractAddress = await paymentHub.getAddress();

  console.log(`✓ PaymentHub deployed at: ${contractAddress}`);

  // Get initial state
  const transactionFeePercent = await paymentHub.transactionFeePercent();
  const contractOwner = await paymentHub.owner();

  console.log(`✓ Owner: ${contractOwner}`);
  console.log(`✓ Transaction Fee: ${transactionFeePercent} basis points (${Number(transactionFeePercent) / 100}%)`);

  // Get deployment transaction details
  const deployTx = paymentHub.deploymentTransaction();
  const receipt = deployTx ? await deployTx.wait() : null;

  // Get network info
  const network = await ethers.provider.getNetwork();
  const networkName = network.name || "unknown";
  const blockNumber = await ethers.provider.getBlockNumber();

  // Create deployment info
  const deploymentInfo: DeploymentInfo = {
    network: networkName,
    contractAddress,
    owner: contractOwner,
    deployer: deployer.address,
    transactionFeePercent: Number(transactionFeePercent),
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
    `paymentHub_${networkName}.json`
  );
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));

  console.log(`\n✓ Deployment info saved to: ${deploymentFile}`);

  // Print summary
  console.log("\n" + "=".repeat(80));
  console.log("Deployment Summary");
  console.log("=".repeat(80));
  console.log(`Network: ${networkName}`);
  console.log(`PaymentHub Address: ${contractAddress}`);
  console.log(`Owner: ${contractOwner}`);
  console.log(`Transaction Fee: ${transactionFeePercent} basis points`);
  console.log(`Block Number: ${blockNumber}`);
  console.log("=".repeat(80));

  // Print next steps
  console.log("\n📝 Next Steps:");
  console.log("1. Verify contract on Etherscan (if mainnet/testnet):");
  console.log(`   npx hardhat verify --network ${networkName} ${contractAddress} ${owner.address}`);
  console.log("2. Set transaction fee (optional):");
  console.log(`   await paymentHub.setTransactionFee(100); // 1%`);
  console.log("3. Start accepting payments in your chat application");

  return {
    contractAddress,
    paymentHub,
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

