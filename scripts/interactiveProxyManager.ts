import { ethers } from "hardhat";
import { DehiveProxy, Message, PaymentHub } from "../typechain-types";
import * as readline from "readline";

/**
 * Interactive Proxy Manager Script
 *
 * This script provides an interactive terminal interface to:
 * 1. Read all state from Message and PaymentHub facets through the proxy
 * 2. View current settings (fees, relayer, owner, etc.)
 * 3. Change settings interactively (fees, relayer, etc.)
 *
 * Usage: npx hardhat run scripts/interactiveProxyManager.ts --network <network>
 */

interface SystemState {
  proxy: {
    address: string;
    owner: string;
  };
  message: {
    owner: string;
    payAsYouGoFee: bigint;
    relayerFee: bigint;
    relayer: string;
  };
  paymentHub: {
    owner: string;
    transactionFeePercent: bigint;
    accumulatedFeesNative: bigint;
    accumulatedFeesERC20?: Map<string, bigint>;
  };
}

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Helper function to ask questions
function question(query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, resolve));
}

// Helper function to format ETH values
function formatETH(value: bigint): string {
  return `${ethers.formatEther(value)} ETH`;
}

// Helper function to format basis points to percentage
function formatBasisPoints(value: bigint): string {
  return `${Number(value)} bps (${(Number(value) / 100).toFixed(2)}%)`;
}

// Read all state from contracts
async function readSystemState(
  proxy: DehiveProxy,
  messageViaProxy: Message,
  paymentHubViaProxy: PaymentHub
): Promise<SystemState> {
  console.log("\n📖 Reading system state...");

  const proxyAddress = await proxy.getAddress();
  const proxyOwner = await proxy.owner();

  const messageOwner = await messageViaProxy.owner();
  const payAsYouGoFee = await messageViaProxy.payAsYouGoFee();
  const relayerFee = await messageViaProxy.relayerFee();
  const relayer = await messageViaProxy.relayer();

  const paymentHubOwner = await paymentHubViaProxy.owner();
  const transactionFeePercent =
    await paymentHubViaProxy.transactionFeePercent();
  const accumulatedFeesNative = await paymentHubViaProxy.accumulatedFees(
    ethers.ZeroAddress
  );

  // Optionally check ERC-20 token fees if token address is provided
  const accumulatedFeesERC20 = new Map<string, bigint>();
  if (process.env.TOKEN_ADDRESS) {
    try {
      const tokenFees = await paymentHubViaProxy.accumulatedFees(
        process.env.TOKEN_ADDRESS
      );
      if (tokenFees > 0n) {
        accumulatedFeesERC20.set(process.env.TOKEN_ADDRESS, tokenFees);
      }
    } catch (error) {
      // Token address might not be valid or contract might not exist
    }
  }

  return {
    proxy: {
      address: proxyAddress,
      owner: proxyOwner,
    },
    message: {
      owner: messageOwner,
      payAsYouGoFee,
      relayerFee,
      relayer,
    },
    paymentHub: {
      owner: paymentHubOwner,
      transactionFeePercent,
      accumulatedFeesNative,
      accumulatedFeesERC20,
    },
  };
}

// Display current state
function displayState(state: SystemState) {
  console.log("\n" + "=".repeat(80));
  console.log("📊 CURRENT SYSTEM STATE");
  console.log("=".repeat(80));

  console.log("\n🔷 PROXY CONTRACT:");
  console.log(`  Address: ${state.proxy.address}`);
  console.log(`  Owner: ${state.proxy.owner}`);

  console.log("\n💬 MESSAGE FACET:");
  console.log(`  Owner: ${state.message.owner}`);
  console.log(`  Pay-as-You-Go Fee: ${formatETH(state.message.payAsYouGoFee)}`);
  console.log(`  Relayer Fee: ${formatETH(state.message.relayerFee)}`);
  console.log(`  Relayer: ${state.message.relayer}`);

  console.log("\n💰 PAYMENT HUB FACET:");
  console.log(`  Owner: ${state.paymentHub.owner}`);
  console.log(
    `  Transaction Fee: ${formatBasisPoints(
      state.paymentHub.transactionFeePercent
    )}`
  );
  console.log(
    `  Accumulated Fees (Native): ${formatETH(
      state.paymentHub.accumulatedFeesNative
    )}`
  );
  if (
    state.paymentHub.accumulatedFeesERC20 &&
    state.paymentHub.accumulatedFeesERC20.size > 0
  ) {
    console.log(`  Accumulated Fees (ERC-20):`);
    for (const [token, amount] of state.paymentHub.accumulatedFeesERC20) {
      console.log(`    ${token}: ${ethers.formatEther(amount)} tokens`);
    }
  }

  console.log("\n" + "=".repeat(80));
}

// Display main menu
function displayMenu() {
  console.log("\n📋 MAIN MENU:");
  console.log("  1. Refresh state");
  console.log("  2. Update Message Pay-as-You-Go Fee");
  console.log("  3. Update Message Relayer Fee");
  console.log("  4. Update Message Relayer Address");
  console.log("  5. Update PaymentHub Transaction Fee");
  console.log("  6. Withdraw PaymentHub Fees (Native)");
  console.log("  7. Withdraw PaymentHub Fees (ERC-20)");
  console.log("  8. Check user funds (Message)");
  console.log("  9. Exit");
  console.log("");
}

// Update Message Pay-as-You-Go Fee
async function updatePayAsYouGoFee(
  messageViaProxy: Message,
  signer: any
): Promise<void> {
  try {
    const currentFee = await messageViaProxy.payAsYouGoFee();
    console.log(`\nCurrent Pay-as-You-Go Fee: ${formatETH(currentFee)}`);

    const input = await question("Enter new fee in ETH (e.g., 0.0001): ");
    const newFee = ethers.parseEther(input);

    console.log(`\nUpdating fee to ${formatETH(newFee)}...`);
    const tx = await messageViaProxy.connect(signer).setPayAsYouGoFee(newFee);
    console.log(`Transaction hash: ${tx.hash}`);
    console.log("Waiting for confirmation...");
    await tx.wait();
    console.log("✅ Fee updated successfully!");
  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
  }
}

// Update Message Relayer Fee
async function updateRelayerFee(
  messageViaProxy: Message,
  signer: any
): Promise<void> {
  try {
    const currentFee = await messageViaProxy.relayerFee();
    console.log(`\nCurrent Relayer Fee: ${formatETH(currentFee)}`);

    const input = await question(
      "Enter new relayer fee in ETH (e.g., 0.00001): "
    );
    const newFee = ethers.parseEther(input);

    console.log(`\nUpdating relayer fee to ${formatETH(newFee)}...`);
    const tx = await messageViaProxy.connect(signer).setRelayerFee(newFee);
    console.log(`Transaction hash: ${tx.hash}`);
    console.log("Waiting for confirmation...");
    await tx.wait();
    console.log("✅ Relayer fee updated successfully!");
  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
  }
}

// Update Message Relayer Address
async function updateRelayer(
  messageViaProxy: Message,
  signer: any
): Promise<void> {
  try {
    const currentRelayer = await messageViaProxy.relayer();
    console.log(`\nCurrent Relayer: ${currentRelayer}`);

    const input = await question("Enter new relayer address: ");
    const newRelayer = input.trim();

    if (!ethers.isAddress(newRelayer)) {
      throw new Error("Invalid address format");
    }

    console.log(`\nUpdating relayer to ${newRelayer}...`);
    const tx = await messageViaProxy.connect(signer).setRelayer(newRelayer);
    console.log(`Transaction hash: ${tx.hash}`);
    console.log("Waiting for confirmation...");
    await tx.wait();
    console.log("✅ Relayer updated successfully!");
  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
  }
}

// Update PaymentHub Transaction Fee
async function updateTransactionFee(
  paymentHubViaProxy: PaymentHub,
  signer: any
): Promise<void> {
  try {
    const currentFee = await paymentHubViaProxy.transactionFeePercent();
    console.log(`\nCurrent Transaction Fee: ${formatBasisPoints(currentFee)}`);

    const input = await question(
      "Enter new fee in basis points (100 = 1%, max 1000 = 10%): "
    );
    const newFee = BigInt(input);

    if (newFee > 1000n) {
      throw new Error("Fee cannot exceed 1000 basis points (10%)");
    }

    console.log(
      `\nUpdating transaction fee to ${formatBasisPoints(newFee)}...`
    );
    const tx = await paymentHubViaProxy
      .connect(signer)
      .setTransactionFee(newFee);
    console.log(`Transaction hash: ${tx.hash}`);
    console.log("Waiting for confirmation...");
    await tx.wait();
    console.log("✅ Transaction fee updated successfully!");
  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
  }
}

// Withdraw PaymentHub Fees (Native)
async function withdrawFees(
  paymentHubViaProxy: PaymentHub,
  signer: any
): Promise<void> {
  try {
    const fees = await paymentHubViaProxy.accumulatedFees(ethers.ZeroAddress);
    console.log(`\nAccumulated Native Fees: ${formatETH(fees)}`);

    if (fees === 0n) {
      console.log("⚠️  No fees to withdraw");
      return;
    }

    const confirm = await question(`Withdraw ${formatETH(fees)}? (yes/no): `);
    if (confirm.toLowerCase() !== "yes") {
      console.log("Withdrawal cancelled");
      return;
    }

    console.log("\nWithdrawing fees...");
    const tx = await paymentHubViaProxy
      .connect(signer)
      .withdrawFees(ethers.ZeroAddress);
    console.log(`Transaction hash: ${tx.hash}`);
    console.log("Waiting for confirmation...");
    await tx.wait();
    console.log("✅ Fees withdrawn successfully!");
  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
  }
}

// Withdraw PaymentHub Fees (ERC-20)
async function withdrawERC20Fees(
  paymentHubViaProxy: PaymentHub,
  signer: any
): Promise<void> {
  try {
    const input = await question("Enter ERC-20 token address: ");
    const tokenAddress = input.trim();

    if (!ethers.isAddress(tokenAddress)) {
      throw new Error("Invalid address format");
    }

    const fees = await paymentHubViaProxy.accumulatedFees(tokenAddress);
    console.log(
      `\nAccumulated ERC-20 Fees: ${ethers.formatEther(fees)} tokens`
    );

    if (fees === 0n) {
      console.log("⚠️  No fees to withdraw");
      return;
    }

    const confirm = await question(
      `Withdraw ${ethers.formatEther(fees)} tokens? (yes/no): `
    );
    if (confirm.toLowerCase() !== "yes") {
      console.log("Withdrawal cancelled");
      return;
    }

    console.log("\nWithdrawing fees...");
    const tx = await paymentHubViaProxy
      .connect(signer)
      .withdrawFees(tokenAddress);
    console.log(`Transaction hash: ${tx.hash}`);
    console.log("Waiting for confirmation...");
    await tx.wait();
    console.log("✅ Fees withdrawn successfully!");
  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
  }
}

// Check user funds
async function checkUserFunds(messageViaProxy: Message): Promise<void> {
  try {
    const input = await question("Enter user address to check funds: ");
    const userAddress = input.trim();

    if (!ethers.isAddress(userAddress)) {
      throw new Error("Invalid address format");
    }

    const funds = await messageViaProxy.funds(userAddress);
    console.log(`\n💰 Funds for ${userAddress}: ${formatETH(funds)}`);
  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
  }
}

// Main interactive loop
async function main() {
  console.log("=".repeat(80));
  console.log("🔧 INTERACTIVE PROXY MANAGER");
  console.log("=".repeat(80));

  // Load contract addresses from environment
  const proxyAddress = process.env.PROXY_ADDRESS;
  const messageFacetAddress = process.env.MESSAGE_FACET_ADDRESS;
  const paymentFacetAddress =
    process.env.PAYMENT_FACET_ADDRESS || process.env.PAYMENT_HUB_FACET_ADDRESS;

  if (!proxyAddress) {
    throw new Error("PROXY_ADDRESS not found in environment variables");
  }

  // Get signer (owner)
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY not found in environment variables");
  }

  const provider = ethers.provider;
  const signer = new ethers.Wallet(privateKey, provider);

  console.log(`\n📋 Configuration:`);
  console.log(`  Network: ${(await provider.getNetwork()).name}`);
  console.log(`  Proxy: ${proxyAddress}`);
  console.log(`  Signer: ${signer.address}`);

  // Connect to contracts
  console.log("\n🔗 Connecting to contracts...");
  const ProxyFactory = await ethers.getContractFactory("DehiveProxy");
  const proxy = ProxyFactory.attach(proxyAddress) as DehiveProxy;

  const MessageFactory = await ethers.getContractFactory("Message");
  const messageViaProxy = MessageFactory.attach(proxyAddress) as Message;

  const PaymentHubFactory = await ethers.getContractFactory("PaymentHub");
  const paymentHubViaProxy = PaymentHubFactory.attach(
    proxyAddress
  ) as PaymentHub;

  console.log("✅ Connected to contracts");

  // Initial state read
  let state = await readSystemState(proxy, messageViaProxy, paymentHubViaProxy);
  displayState(state);

  // Main loop
  let running = true;
  while (running) {
    displayMenu();
    const choice = await question("Select an option (1-9): ");

    switch (choice.trim()) {
      case "1":
        state = await readSystemState(
          proxy,
          messageViaProxy,
          paymentHubViaProxy
        );
        displayState(state);
        break;

      case "2":
        await updatePayAsYouGoFee(messageViaProxy, signer);
        state = await readSystemState(
          proxy,
          messageViaProxy,
          paymentHubViaProxy
        );
        displayState(state);
        break;

      case "3":
        await updateRelayerFee(messageViaProxy, signer);
        state = await readSystemState(
          proxy,
          messageViaProxy,
          paymentHubViaProxy
        );
        displayState(state);
        break;

      case "4":
        await updateRelayer(messageViaProxy, signer);
        state = await readSystemState(
          proxy,
          messageViaProxy,
          paymentHubViaProxy
        );
        displayState(state);
        break;

      case "5":
        await updateTransactionFee(paymentHubViaProxy, signer);
        state = await readSystemState(
          proxy,
          messageViaProxy,
          paymentHubViaProxy
        );
        displayState(state);
        break;

      case "6":
        await withdrawFees(paymentHubViaProxy, signer);
        state = await readSystemState(
          proxy,
          messageViaProxy,
          paymentHubViaProxy
        );
        displayState(state);
        break;

      case "7":
        await withdrawERC20Fees(paymentHubViaProxy, signer);
        state = await readSystemState(
          proxy,
          messageViaProxy,
          paymentHubViaProxy
        );
        displayState(state);
        break;

      case "8":
        await checkUserFunds(messageViaProxy);
        break;

      case "9":
        console.log("\n👋 Goodbye!");
        running = false;
        break;

      default:
        console.log("\n❌ Invalid option. Please select 1-9.");
    }
  }

  rl.close();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Error:");
    console.error(error);
    rl.close();
    process.exit(1);
  });
