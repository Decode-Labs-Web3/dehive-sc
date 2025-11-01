import { ethers } from "hardhat";
import { DehiveProxy, Message } from "../../typechain-types";

/**
 * Complete setup script for Message in DehiveProxy
 *
 * This script:
 * 1. Deploys DehiveProxy (if not already deployed)
 * 2. Deploys MessageFacet (if not already deployed)
 * 3. Installs MessageFacet into DehiveProxy
 * 4. Optionally sets relayer address
 * 5. Returns both standalone and proxy addresses for testing
 *
 * Usage: npx hardhat run scripts/dehive/setupMessage.ts --network <network>
 */

async function main() {
  console.log("=".repeat(70));
  console.log("Complete Message Setup (DehiveProxy + MessageFacet)");
  console.log("=".repeat(70));

  // Get signers
  const [deployer, owner, relayer] = await ethers.getSigners();
  console.log(`\nDeployer: ${deployer.address}`);
  console.log(`Owner: ${owner.address}`);
  console.log(`Relayer: ${relayer.address}`);

  // Step 1: Deploy or load DehiveProxy
  console.log("\n" + "-".repeat(70));
  console.log("Step 1: Deploying/Loading DehiveProxy");
  console.log("-".repeat(70));

  let proxy: DehiveProxy;
  let proxyAddress: string;

  const network = await ethers.provider.getNetwork();
  const networkName = network.name || "unknown";

  try {
    // Try to load existing deployment
    const fs = await import("fs");
    const path = await import("path");
    const deploymentsDir = path.join(__dirname, "../../deployments");
    const proxyFile = path.join(
      deploymentsDir,
      `dehiveProxy_${networkName}.json`
    );

    if (fs.existsSync(proxyFile)) {
      const deployment = JSON.parse(fs.readFileSync(proxyFile, "utf-8"));
      proxyAddress = deployment.contractAddress;
      const ProxyFactory = await ethers.getContractFactory("DehiveProxy");
      proxy = ProxyFactory.attach(proxyAddress) as DehiveProxy;
      console.log(`✓ Using existing proxy at: ${proxyAddress}`);
    } else {
      throw new Error("Proxy not found, will deploy");
    }
  } catch {
    // Deploy new proxy
    console.log("Deploying new DehiveProxy...");
    const ProxyFactory = await ethers.getContractFactory("DehiveProxy");
    proxy = await ProxyFactory.deploy();
    await proxy.waitForDeployment();
    proxyAddress = await proxy.getAddress();
    console.log(`✓ DehiveProxy deployed at: ${proxyAddress}`);
  }

  // Step 2: Deploy MessageFacet (standalone)
  console.log("\n" + "-".repeat(70));
  console.log("Step 2: Deploying MessageFacet (Standalone)");
  console.log("-".repeat(70));

  console.log("Deploying MessageFacet...");
  const MessageFactory = await ethers.getContractFactory("Message");
  const messageFacet = await MessageFactory.deploy(owner.address);
  await messageFacet.waitForDeployment();
  const facetAddress = await messageFacet.getAddress();
  console.log(`✓ MessageFacet deployed at: ${facetAddress}`);

  // Step 3: Install MessageFacet into DehiveProxy
  console.log("\n" + "-".repeat(70));
  console.log("Step 3: Installing MessageFacet into DehiveProxy");
  console.log("-".repeat(70));

  // Import helpers
  const { getFunctionSelectors } = await import("./helpers/facetHelpers");

  // Get function selectors
  const fs = await import("fs");
  const path = await import("path");
  const imessageArtifactPath = path.join(
    __dirname,
    "../../artifacts/contracts/interfaces/IMessage.sol/IMessage.json"
  );
  const imessageAbi = JSON.parse(
    fs.readFileSync(imessageArtifactPath, "utf-8")
  ).abi;

  const functionSelectors = getFunctionSelectors(imessageAbi);
  console.log(`✓ Found ${functionSelectors.length} function selectors`);

  // Get Message ABI for init encoding
  const messageArtifactPath = path.join(
    __dirname,
    "../../artifacts/contracts/Message.sol/Message.json"
  );
  const messageAbi = JSON.parse(
    fs.readFileSync(messageArtifactPath, "utf-8")
  ).abi;

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

  console.log("Installing facet into proxy...");
  const installTx = await proxy
    .connect(owner)
    .facetCut([facetCut], facetAddress, initCalldata);

  await installTx.wait();
  console.log(`✓ MessageFacet installed into proxy`);

  // Step 4: Set relayer (optional)
  console.log("\n" + "-".repeat(70));
  console.log("Step 4: Setting Relayer Address");
  console.log("-".repeat(70));

  // Connect to proxy as Message interface
  const messageViaProxy = MessageFactory.attach(proxyAddress) as Message;

  console.log("Setting relayer via proxy...");
  const setRelayerTx = await messageViaProxy
    .connect(owner)
    .setRelayer(relayer.address);
  await setRelayerTx.wait();
  console.log(`✓ Relayer set to: ${relayer.address}`);

  // Get final state
  const payAsYouGoFee = await messageViaProxy.payAsYouGoFee();
  const finalRelayerFee = await messageViaProxy.relayerFee();
  const finalRelayer = await messageViaProxy.relayer();

  // Print final summary
  console.log("\n" + "=".repeat(70));
  console.log("Setup Complete");
  console.log("=".repeat(70));
  console.log(`Network: ${networkName}`);
  console.log(`\nDehiveProxy Address: ${proxyAddress}`);
  console.log(`MessageFacet (Standalone) Address: ${facetAddress}`);
  console.log(`Owner: ${owner.address}`);
  console.log(`Relayer: ${finalRelayer}`);
  console.log(`\nPay-as-You-Go Fee: ${ethers.formatEther(payAsYouGoFee)} ETH`);
  console.log(`Relayer Fee: ${ethers.formatEther(finalRelayerFee)} ETH`);
  console.log("\n" + "=".repeat(70));
  console.log(
    "You can now use the proxy address to interact with Message functions"
  );
  console.log(
    `  Example: const message = MessageFactory.attach("${proxyAddress}")`
  );
  console.log("=".repeat(70));

  return {
    proxyAddress,
    facetAddress,
    proxy,
    messageFacet,
    messageViaProxy,
  };
}

// Execute setup
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Setup failed:");
    console.error(error);
    process.exit(1);
  });
