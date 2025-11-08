import { ethers } from "hardhat";
import fs from "fs";
import path from "path";
import { Message } from "../../typechain-types";

/**
 * Script to Set Relayer Address on DehiveProxy
 *
 * This script sets the relayer address for the Message contract through the DehiveProxy.
 * The relayer is authorized to send messages on behalf of users who have deposited funds.
 *
 * Usage:
 *   npx hardhat run scripts/dehive/setRelayer.ts --network <network>
 *
 * Requirements:
 *   - PRIVATE_KEY in .env file (must be the proxy owner)
 *   - Proxy address (from env var PROXY_ADDRESS or deployment file)
 *   - New relayer address (from env var NEW_RELAYER_ADDRESS or prompted)
 *
 * Environment Variables:
 *   - PRIVATE_KEY: Private key of the proxy owner (required)
 *   - PROXY_ADDRESS: Address of the deployed proxy (optional, will use deployment file if not set)
 *   - NEW_RELAYER_ADDRESS: Address of the new relayer (optional, will use hardcoded value if not set)
 */

async function main() {
  console.log("=".repeat(80));
  console.log("Set Relayer Address Script");
  console.log("=".repeat(80));

  // Get network info
  const network = await ethers.provider.getNetwork();
  const networkName = network.name || "unknown";
  const chainId = network.chainId.toString();

  console.log(`\nNetwork: ${networkName} (Chain ID: ${chainId})`);

  // ========== STEP 1: LOAD PROXY ADDRESS ==========
  let proxyAddress: string;

  if (process.env.PROXY_ADDRESS) {
    proxyAddress = process.env.PROXY_ADDRESS;
    console.log(
      `\n✓ Using proxy address from PROXY_ADDRESS env var: ${proxyAddress}`
    );
  } else {
    // Try to load from deployment file
    const deploymentsDir = path.join(__dirname, "../../deployments");
    const deploymentFile = path.join(
      deploymentsDir,
      `sepolia_dehiveProxy_messageFacet.json`
    );

    if (fs.existsSync(deploymentFile)) {
      const deploymentInfo = JSON.parse(
        fs.readFileSync(deploymentFile, "utf-8")
      );
      proxyAddress = deploymentInfo.proxyAddress;
      console.log(
        `\n✓ Loaded proxy address from deployment file: ${proxyAddress}`
      );
    } else {
      // Use hardcoded address if no deployment file
      proxyAddress = "0x41bc86ba44813b2b106e1942cb68cc471714df2d";
      console.log(`\n✓ Using hardcoded proxy address: ${proxyAddress}`);
    }
  }

  // ========== STEP 2: LOAD NEW RELAYER ADDRESS ==========
  let newRelayerAddress: string;

  if (process.env.NEW_RELAYER_ADDRESS) {
    newRelayerAddress = process.env.NEW_RELAYER_ADDRESS;
    console.log(
      `\n✓ Using new relayer address from NEW_RELAYER_ADDRESS env var: ${newRelayerAddress}`
    );
  } else {
    // Use the provided address
    newRelayerAddress = "0xa6911d2f9e2f9be993fd71768ee05876390948e9";
    console.log(`\n✓ Using specified relayer address: ${newRelayerAddress}`);
  }

  // Validate addresses
  try {
    proxyAddress = ethers.getAddress(proxyAddress);
    newRelayerAddress = ethers.getAddress(newRelayerAddress);
  } catch (error: any) {
    throw new Error(`Invalid address format: ${error.message}`);
  }

  // ========== STEP 3: GET SIGNER (OWNER) ==========
  const owner = (await ethers.getSigners())[0];

  console.log(`\n📋 Configuration:`);
  console.log(`  Owner (caller): ${owner.address}`);
  console.log(`  Proxy Address: ${proxyAddress}`);
  console.log(`  New Relayer Address: ${newRelayerAddress}`);

  // Check balance
  const ownerBalance = await ethers.provider.getBalance(owner.address);
  console.log(`\n💰 Owner Balance: ${ethers.formatEther(ownerBalance)} ETH`);

  if (ownerBalance < ethers.parseEther("0.001")) {
    console.warn("\n⚠️  WARNING: Owner balance is low. Transaction may fail!");
  }

  // ========== STEP 4: CONNECT TO PROXY ==========
  console.log("\n" + "=".repeat(80));
  console.log("Connecting to Proxy");
  console.log("=".repeat(80));

  const MessageFactory = await ethers.getContractFactory("Message");
  const messageViaProxy = MessageFactory.attach(proxyAddress) as Message;

  // Verify proxy connection and get current state
  try {
    const currentRelayer = await messageViaProxy.relayer();
    const proxyOwner = await messageViaProxy.owner();
    const payAsYouGoFee = await messageViaProxy.payAsYouGoFee();
    const relayerFee = await messageViaProxy.relayerFee();

    console.log(`\n✓ Proxy connection verified`);
    console.log(`\n📊 Current State:`);
    console.log(`  Proxy Owner: ${proxyOwner}`);
    console.log(`  Current Relayer: ${currentRelayer}`);
    console.log(
      `  Pay-as-You-Go Fee: ${ethers.formatEther(payAsYouGoFee)} ETH`
    );
    console.log(`  Relayer Fee: ${ethers.formatEther(relayerFee)} ETH`);

    // Verify caller is the owner
    if (owner.address.toLowerCase() !== proxyOwner.toLowerCase()) {
      console.warn(
        `\n⚠️  WARNING: Caller (${owner.address}) is not the proxy owner (${proxyOwner})`
      );
      console.warn(`   Transaction will likely fail!`);
    }

    // Check if relayer is already set
    if (currentRelayer.toLowerCase() === newRelayerAddress.toLowerCase()) {
      console.warn(
        `\n⚠️  Note: Relayer is already set to ${newRelayerAddress}`
      );
      console.warn(`   Transaction will still proceed to confirm.`);
    }
  } catch (error: any) {
    throw new Error(`Failed to connect to proxy: ${error.message}`);
  }

  // ========== STEP 5: SET RELAYER ==========
  console.log("\n" + "=".repeat(80));
  console.log("Setting Relayer Address");
  console.log("=".repeat(80));

  console.log(`\nSetting relayer to: ${newRelayerAddress}`);
  console.log(`Calling setRelayer() on proxy at ${proxyAddress}...`);

  try {
    const tx = await messageViaProxy
      .connect(owner)
      .setRelayer(newRelayerAddress);
    console.log(`\n✓ Transaction sent: ${tx.hash}`);
    console.log(`  Waiting for confirmation...`);

    const receipt = await tx.wait();
    console.log(`✓ Transaction confirmed at block ${receipt!.blockNumber}`);
    console.log(`  Gas used: ${receipt!.gasUsed.toString()}`);

    // ========== STEP 6: VERIFY RELAYER WAS SET ==========
    console.log("\n" + "=".repeat(80));
    console.log("Verifying Relayer Update");
    console.log("=".repeat(80));

    const updatedRelayer = await messageViaProxy.relayer();
    console.log(`\n✓ Current relayer: ${updatedRelayer}`);

    if (updatedRelayer.toLowerCase() === newRelayerAddress.toLowerCase()) {
      console.log(`✅ Relayer successfully set to ${newRelayerAddress}`);
    } else {
      console.warn(`⚠️  Warning: Relayer address doesn't match expected value`);
      console.warn(`   Expected: ${newRelayerAddress}`);
      console.warn(`   Got: ${updatedRelayer}`);
    }

    // ========== STEP 7: SAVE RESULT ==========
    const deploymentsDir = path.join(__dirname, "../../deployments");
    if (!fs.existsSync(deploymentsDir)) {
      fs.mkdirSync(deploymentsDir, { recursive: true });
    }

    const resultFile = path.join(
      deploymentsDir,
      `setRelayer_${networkName}_${Date.now()}.json`
    );

    const result = {
      network: networkName,
      chainId: chainId,
      proxyAddress: proxyAddress,
      newRelayerAddress: newRelayerAddress,
      previousRelayer: receipt ? await messageViaProxy.relayer() : "unknown",
      owner: owner.address,
      transactionHash: tx.hash,
      blockNumber: receipt?.blockNumber,
      gasUsed: receipt?.gasUsed.toString(),
      timestamp: new Date().toISOString(),
    };

    fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
    console.log(`\n📝 Result saved to: ${resultFile}`);

    // ========== SUMMARY ==========
    console.log("\n" + "=".repeat(80));
    console.log("Summary");
    console.log("=".repeat(80));
    console.log(`Network: ${networkName} (Chain ID: ${chainId})`);
    console.log(`Proxy Address: ${proxyAddress}`);
    console.log(`New Relayer Address: ${newRelayerAddress}`);
    console.log(`Transaction Hash: ${tx.hash}`);
    console.log(`Block Number: ${receipt?.blockNumber}`);
    console.log(`Gas Used: ${receipt?.gasUsed.toString()}`);

    // Generate explorer link
    if (networkName === "sepolia") {
      console.log(`\n🔗 View on Etherscan:`);
      console.log(`   Transaction: https://sepolia.etherscan.io/tx/${tx.hash}`);
      console.log(
        `   Proxy: https://sepolia.etherscan.io/address/${proxyAddress}`
      );
    } else if (networkName === "mainnet") {
      console.log(`\n🔗 View on Etherscan:`);
      console.log(`   Transaction: https://etherscan.io/tx/${tx.hash}`);
      console.log(`   Proxy: https://etherscan.io/address/${proxyAddress}`);
    }

    console.log("\n" + "=".repeat(80));
    console.log("✅ Relayer Address Set Successfully!");
    console.log("=".repeat(80));
  } catch (error: any) {
    console.error(`\n❌ Failed to set relayer: ${error.message}`);

    // Provide helpful error messages
    if (error.message.includes("caller is not the owner")) {
      console.error(
        `\n💡 Solution: You need to use the proxy owner's private key in .env`
      );
      console.error(`   Current caller: ${owner.address}`);
    } else if (error.message.includes("Relayer cannot be zero address")) {
      console.error(`\n💡 Solution: Relayer address cannot be 0x0`);
    } else if (error.message.includes("insufficient funds")) {
      console.error(`\n💡 Solution: Add more ETH to the owner account`);
    }

    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Script failed:");
    console.error(error);
    process.exit(1);
  });
