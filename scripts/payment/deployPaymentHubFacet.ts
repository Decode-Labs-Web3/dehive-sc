import { ethers } from "hardhat";
import fs from "fs";
import path from "path";
import { DehiveProxy, PaymentHub } from "../../typechain-types";
import { getFunctionSelectors } from "../dehive/helpers/facetHelpers";

/**
 * Deployment script for PaymentHub as a facet in DehiveProxy
 *
 * This script:
 * 1. Loads existing DehiveProxy address
 * 2. Deploys PaymentHub contract
 * 3. Installs PaymentHub as a facet in the proxy
 * 4. Initializes PaymentHub through proxy
 * 5. Saves all deployment information
 *
 * Usage: npx hardhat run scripts/payment/deployPaymentHubFacet.ts --network <network>
 */

interface DeploymentInfo {
  network: string;
  proxyAddress: string;
  facetAddress: string;
  owner: string;
  deployer: string;
  transactionFeePercent: number;
  functionSelectors: string[];
  deployedAt: number;
  transactionHashes: {
    facetDeployment: string;
    facetInstallation: string;
  };
  blockNumbers: {
    facetDeployment: number;
    facetInstallation: number;
  };
}

async function main() {
  console.log("=".repeat(80));
  console.log("Deploying PaymentHub as Facet in DehiveProxy");
  console.log("=".repeat(80));

  // Get network info
  const network = await ethers.provider.getNetwork();
  const networkName = network.name || "unknown";

  console.log(`\nNetwork: ${networkName}`);

  // Get signer
  const deployer = (await ethers.getSigners())[0];
  const owner = deployer; // Same account for owner

  console.log(`\nDeployer: ${deployer.address}`);
  console.log(`Owner: ${owner.address}`);

  // Check balance
  const deployerBalance = await ethers.provider.getBalance(deployer.address);
  console.log(`\n💰 Deployer Balance: ${ethers.formatEther(deployerBalance)} ETH`);

  if (deployerBalance < ethers.parseEther("0.01")) {
    console.warn("\n⚠️  WARNING: Deployer balance is low. Deployment may fail!");
  }

  // ========== STEP 1: LOAD PROXY ADDRESS ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 1: Loading DehiveProxy Address");
  console.log("=".repeat(80));

  let proxyAddress: string;

  const deploymentsDir = path.join(__dirname, "../../deployments");
  
  // Try environment variable first
  if (process.env.PROXY_ADDRESS) {
    proxyAddress = process.env.PROXY_ADDRESS;
    console.log(`✓ Using proxy address from PROXY_ADDRESS env var: ${proxyAddress}`);
  } else {
    // Try to load from deployment file
    const proxyFile = path.join(
      deploymentsDir,
      `sepolia_dehiveProxy_messageFacet.json`
    );

    if (fs.existsSync(proxyFile)) {
      const proxyDeployment = JSON.parse(fs.readFileSync(proxyFile, "utf-8"));
      proxyAddress = proxyDeployment.proxyAddress;
      console.log(`✓ Loaded proxy address from deployment file: ${proxyAddress}`);
    } else {
      throw new Error(
        `Proxy address not found. Please set PROXY_ADDRESS env var or ensure deployment file exists at: ${proxyFile}`
      );
    }
  }

  // Connect to proxy
  const ProxyFactory = await ethers.getContractFactory("DehiveProxy");
  const proxy = ProxyFactory.attach(proxyAddress) as DehiveProxy;

  // Verify proxy owner
  const proxyOwner = await proxy.owner();
  console.log(`✓ Proxy owner: ${proxyOwner}`);

  if (proxyOwner.toLowerCase() !== owner.address.toLowerCase()) {
    console.warn(`\n⚠️  WARNING: Deployer (${owner.address}) is not proxy owner (${proxyOwner})`);
    console.warn(`   Facet installation may fail!`);
  }

  // ========== STEP 2: DEPLOY FACET ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 2: Deploying PaymentHub Facet");
  console.log("=".repeat(80));

  console.log("Deploying PaymentHub contract...");
  const PaymentHubFactory = await ethers.getContractFactory("PaymentHub");
  const paymentHub = await PaymentHubFactory.deploy(deployer.address);
  await paymentHub.waitForDeployment();
  const facetAddress = await paymentHub.getAddress();

  const facetDeployTx = paymentHub.deploymentTransaction();
  const facetDeployReceipt = facetDeployTx ? await facetDeployTx.wait() : null;
  const facetBlockNumber = await ethers.provider.getBlockNumber();

  console.log(`✓ PaymentHub deployed at: ${facetAddress}`);
  console.log(`✓ Transaction: ${facetDeployReceipt?.hash || "N/A"}`);
  console.log(
    `✓ Block number: ${facetDeployReceipt?.blockNumber || facetBlockNumber}`
  );

  // ========== STEP 3: INSTALL FACET ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 3: Installing PaymentHub Facet into DehiveProxy");
  console.log("=".repeat(80));

  // Get IPaymentHub ABI for function selectors
  const ipaymenthubArtifactPath = path.join(
    __dirname,
    "../../artifacts/contracts/interfaces/IPaymentHub.sol/IPaymentHub.json"
  );
  const ipaymenthubAbi = JSON.parse(
    fs.readFileSync(ipaymenthubArtifactPath, "utf-8")
  ).abi;

  const functionSelectors = getFunctionSelectors(ipaymenthubAbi);
  console.log(`✓ Found ${functionSelectors.length} function selectors`);

  const facetCut = {
    facetAddress: facetAddress,
    functionSelectors: functionSelectors,
    action: 0, // Add
  };

  const paymenthubArtifactPath = path.join(
    __dirname,
    "../../artifacts/contracts/PaymentHub.sol/PaymentHub.json"
  );
  const paymenthubAbi = JSON.parse(
    fs.readFileSync(paymenthubArtifactPath, "utf-8")
  ).abi;

  const initCalldata = ethers.Interface.from(paymenthubAbi).encodeFunctionData(
    "init",
    [proxyOwner]
  );

  console.log("Installing facet into proxy...");
  const installTx = await proxy
    .connect(deployer)
    .facetCut([facetCut], facetAddress, initCalldata);
  const installReceipt = await installTx.wait();
  const installBlockNumber = installReceipt!.blockNumber;

  console.log(`✓ PaymentHub facet installed into proxy`);
  console.log(`✓ Transaction: ${installTx.hash}`);
  console.log(`✓ Block number: ${installBlockNumber}`);

  // Connect to proxy as PaymentHub interface
  const paymentHubViaProxy = PaymentHubFactory.attach(proxyAddress) as PaymentHub;

  // ========== STEP 4: VERIFY DEPLOYMENT ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 4: Verifying Deployment");
  console.log("=".repeat(80));

  // Verify fee
  const transactionFeePercent = await paymentHubViaProxy.transactionFeePercent();
  console.log(
    `✓ Transaction Fee: ${transactionFeePercent} basis points (${Number(transactionFeePercent) / 100}%)`
  );

  // Verify facet installation
  const installedSelectors = await proxy.facetFunctionSelectors(facetAddress);
  console.log(
    `✓ Facet has ${installedSelectors.length} function selectors installed`
  );

  // ========== STEP 5: SAVE DEPLOYMENT INFO ==========
  console.log("\n" + "=".repeat(80));
  console.log("Step 5: Saving Deployment Information");
  console.log("=".repeat(80));

  const deploymentInfo: DeploymentInfo = {
    network: networkName,
    proxyAddress: proxyAddress,
    facetAddress: facetAddress,
    owner: proxyOwner,
    deployer: deployer.address,
    transactionFeePercent: Number(transactionFeePercent),
    functionSelectors: functionSelectors,
    deployedAt: Date.now(),
    transactionHashes: {
      facetDeployment: facetDeployReceipt?.hash || "",
      facetInstallation: installTx.hash,
    },
    blockNumbers: {
      facetDeployment: facetDeployReceipt?.blockNumber || facetBlockNumber,
      facetInstallation: installBlockNumber,
    },
  };

  // Save deployment info
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const deploymentFile = path.join(
    deploymentsDir,
    `${networkName}_paymentHubFacet.json`
  );
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));

  console.log(`✓ Deployment info saved to: ${deploymentFile}`);

  // ========== FINAL SUMMARY ==========
  console.log("\n" + "=".repeat(80));
  console.log("Deployment Summary");
  console.log("=".repeat(80));
  console.log(`Network: ${networkName}`);
  console.log(`\n📦 Contracts:`);
  console.log(`  DehiveProxy: ${proxyAddress}`);
  console.log(`  PaymentHub Facet: ${facetAddress}`);
  console.log(`\n👤 Roles:`);
  console.log(`  Proxy Owner: ${proxyOwner}`);
  console.log(`  Deployer: ${deployer.address}`);
  console.log(`\n💰 Fees:`);
  console.log(`  Transaction Fee: ${transactionFeePercent} basis points`);
  console.log(`\n🔧 Configuration:`);
  console.log(`  Function Selectors: ${functionSelectors.length}`);
  console.log(`\n📄 Transactions:`);
  console.log(`  Facet Deployment: ${deploymentInfo.transactionHashes.facetDeployment}`);
  console.log(`  Facet Installation: ${deploymentInfo.transactionHashes.facetInstallation}`);
  console.log("\n" + "=".repeat(80));
  console.log("✅ Deployment Completed Successfully!");
  console.log("=".repeat(80));

  console.log("\n📝 Next Steps:");
  console.log("1. Verify contracts on Etherscan:");
  console.log(`   npx hardhat verify --network ${networkName} ${facetAddress} ${deployer.address}`);
  console.log("2. Set transaction fee (optional):");
  console.log(`   paymentHubViaProxy.setTransactionFee(100); // 1%`);
  console.log("3. Start using PaymentHub through proxy address:");
  console.log(`   ${proxyAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Deployment failed:");
    console.error(error);
    process.exit(1);
  });

