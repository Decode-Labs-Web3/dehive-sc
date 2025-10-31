import { ethers } from "hardhat";
import fs from "fs";
import path from "path";
import readline from "readline";
import { Message } from "../../typechain-types";
import { computeConversationId } from "../../test/helpers/conversationHelpers";
import {
  encryptMessage,
  decryptMessage,
  generateConversationKey,
  encryptConversationKeyForAddress,
  decryptConversationKeyForAddress,
} from "../../test/helpers/mockEncryption";
import {
  fetchAllMessages,
  fetchConversationMessages,
} from "../../test/helpers/messageFetcher";

/**
 * Interactive Test Script for Message Contract
 *
 * This script simulates frontend interactions:
 * - Create conversations interactively
 * - Send messages (both methods)
 * - Fetch and decrypt messages
 * - Display formatted output
 *
 * Usage: npx hardhat run scripts/message/interactiveTest.ts --network <network>
 */

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function deployOrConnect(): Promise<Message> {
  const network = await ethers.provider.getNetwork();
  const networkName = network.name || "localhost";
  const deploymentFile = path.join(
    __dirname,
    "../../deployments",
    `message_${networkName}.json`
  );

  if (fs.existsSync(deploymentFile)) {
    const deploymentInfo = JSON.parse(fs.readFileSync(deploymentFile, "utf-8"));
    const MessageFactory = await ethers.getContractFactory("Message");
    return MessageFactory.attach(deploymentInfo.contractAddress) as Message;
  }

  const [deployer, owner, relayer] = await ethers.getSigners();
  const MessageFactory = await ethers.getContractFactory("Message");
  const messageContract = await MessageFactory.deploy(owner.address);
  await messageContract.waitForDeployment();
  await messageContract.connect(owner).setRelayer(relayer.address);

  return messageContract;
}

async function createConversationInteractive(
  messageContract: Message,
  sender: any,
  receiverAddress: string
): Promise<{ conversationId: bigint; conversationKey: string }> {
  const conversationKey = generateConversationKey(
    `${sender.address}-${receiverAddress}`
  );
  const encryptedKeyFor1 = encryptConversationKeyForAddress(
    conversationKey,
    sender.address
  );
  const encryptedKeyFor2 = encryptConversationKeyForAddress(
    conversationKey,
    receiverAddress
  );

  const conversationId = await messageContract
    .connect(sender)
    .createConversation.staticCall(
      receiverAddress,
      `0x${encryptedKeyFor1}`,
      `0x${encryptedKeyFor2}`
    );

  console.log(`\n📝 Creating conversation...`);
  const tx = await messageContract
    .connect(sender)
    .createConversation(
      receiverAddress,
      `0x${encryptedKeyFor1}`,
      `0x${encryptedKeyFor2}`
    );

  await tx.wait();
  console.log(`✓ Conversation created! ID: ${conversationId.toString()}`);

  return { conversationId, conversationKey };
}

async function sendDirectMessage(
  messageContract: Message,
  sender: any,
  conversationId: bigint,
  receiverAddress: string,
  message: string,
  conversationKey: string
): Promise<void> {
  const payAsYouGoFee = await messageContract.payAsYouGoFee();
  const encryptedMsg = encryptMessage(message, conversationKey);

  console.log(`\n📨 Sending message...`);
  const tx = await messageContract
    .connect(sender)
    .sendMessage(conversationId, receiverAddress, encryptedMsg, {
      value: payAsYouGoFee,
    });

  await tx.wait();
  console.log(`✓ Message sent! Fee: ${ethers.formatEther(payAsYouGoFee)} ETH`);
}

async function sendRelayerMessage(
  messageContract: Message,
  relayer: any,
  conversationId: bigint,
  fromAddress: string,
  toAddress: string,
  message: string,
  conversationKey: string
): Promise<void> {
  const relayerFee = await messageContract.relayerFee();
  const encryptedMsg = encryptMessage(message, conversationKey);

  console.log(`\n📨 Sending message via relayer...`);
  const tx = await messageContract
    .connect(relayer)
    .sendMessageViaRelayer(
      conversationId,
      fromAddress,
      toAddress,
      encryptedMsg,
      relayerFee
    );

  await tx.wait();
  console.log(
    `✓ Message sent via relayer! Fee: ${ethers.formatEther(relayerFee)} ETH`
  );
}

async function displayMessages(
  messageContract: Message,
  conversationId: bigint,
  conversationKey: string
): Promise<void> {
  console.log(
    `\n📥 Fetching messages for conversation ${conversationId.toString()}...`
  );

  const messages = await fetchConversationMessages(
    messageContract,
    conversationId
  );

  console.log(`\n📋 Messages (${messages.length} total):\n`);
  console.log("-".repeat(70));

  if (messages.length === 0) {
    console.log("No messages found.");
    return;
  }

  for (const msg of messages) {
    try {
      const decrypted = decryptMessage(msg.encryptedMessage, conversationKey);
      const date = new Date(msg.timestamp * 1000);

      console.log(`From: ${msg.from}`);
      console.log(`To: ${msg.to}`);
      console.log(`Message: ${decrypted}`);
      console.log(`Time: ${date.toLocaleString()}`);
      console.log(`Block: ${msg.blockNumber}`);
      console.log("-".repeat(70));
    } catch (error) {
      console.log(`Failed to decrypt message: ${error}`);
      console.log(`Encrypted: ${msg.encryptedMessage.substring(0, 50)}...`);
      console.log("-".repeat(70));
    }
  }
}

async function depositFunds(
  messageContract: Message,
  user: any,
  amount: string
): Promise<void> {
  const depositAmount = ethers.parseEther(amount);

  console.log(`\n💰 Depositing ${amount} ETH...`);
  const tx = await messageContract
    .connect(user)
    .depositFunds({ value: depositAmount });
  await tx.wait();

  const balance = await messageContract.funds(user.address);
  console.log(
    `✓ Deposit complete! New balance: ${ethers.formatEther(balance)} ETH`
  );
}

async function displayUserBalance(
  messageContract: Message,
  user: any
): Promise<void> {
  const balance = await messageContract.funds(user.address);
  console.log(`\n💰 Current balance: ${ethers.formatEther(balance)} ETH`);
}

async function interactiveMenu() {
  const network = await ethers.provider.getNetwork();
  console.log("\n" + "=".repeat(70));
  console.log("Message Contract Interactive Test");
  console.log(`Network: ${network.name || "localhost"}`);
  console.log("=".repeat(70));

  // Deploy or connect
  const messageContract = await deployOrConnect();
  const contractAddress = await messageContract.getAddress();
  console.log(`\n✓ Connected to contract: ${contractAddress}`);

  // Get signers
  const [deployer, owner, user1, user2, relayer] = await ethers.getSigners();
  console.log(`\nAvailable accounts:`);
  console.log(`  [1] User1: ${user1.address}`);
  console.log(`  [2] User2: ${user2.address}`);
  console.log(`  [R] Relayer: ${relayer.address}`);

  const conversations = new Map<
    string,
    { id: bigint; key: string; sender: any; receiver: string }
  >();

  while (true) {
    console.log("\n" + "=".repeat(70));
    console.log("Menu:");
    console.log("  1. Create conversation");
    console.log("  2. Send direct message (pay-as-you-go)");
    console.log("  3. Deposit funds");
    console.log("  4. Send message via relayer (credit-based)");
    console.log("  5. Display messages");
    console.log("  6. Display user balance");
    console.log("  7. Exit");
    console.log("=".repeat(70));

    const choice = await question("\nEnter your choice (1-7): ");

    try {
      switch (choice.trim()) {
        case "1": {
          const senderChoice = await question(
            "Select sender [1=User1, 2=User2]: "
          );
          const sender = senderChoice.trim() === "1" ? user1 : user2;

          const receiverAddress = await question("Enter receiver address: ");

          const { conversationId, conversationKey } =
            await createConversationInteractive(
              messageContract,
              sender,
              receiverAddress.trim()
            );

          const convKey = `${sender.address}-${receiverAddress.trim()}`;
          conversations.set(convKey, {
            id: conversationId,
            key: conversationKey,
            sender,
            receiver: receiverAddress.trim(),
          });

          console.log(`\n✓ Conversation stored! Key: ${convKey}`);
          break;
        }

        case "2": {
          const convKey = await question(
            "Enter conversation key (sender-receiver): "
          );
          const conv = conversations.get(convKey.trim());

          if (!conv) {
            console.log("❌ Conversation not found!");
            break;
          }

          const message = await question("Enter message: ");

          await sendDirectMessage(
            messageContract,
            conv.sender,
            conv.id,
            conv.receiver,
            message.trim(),
            conv.key
          );
          break;
        }

        case "3": {
          const userChoice = await question("Select user [1=User1, 2=User2]: ");
          const user = userChoice.trim() === "1" ? user1 : user2;

          const amount = await question("Enter amount in ETH: ");

          await depositFunds(messageContract, user, amount.trim());
          break;
        }

        case "4": {
          const convKey = await question(
            "Enter conversation key (sender-receiver): "
          );
          const conv = conversations.get(convKey.trim());

          if (!conv) {
            console.log("❌ Conversation not found!");
            break;
          }

          const message = await question("Enter message: ");

          await sendRelayerMessage(
            messageContract,
            relayer,
            conv.id,
            conv.sender.address,
            conv.receiver,
            message.trim(),
            conv.key
          );
          break;
        }

        case "5": {
          const convKey = await question(
            "Enter conversation key (sender-receiver): "
          );
          const conv = conversations.get(convKey.trim());

          if (!conv) {
            console.log("❌ Conversation not found!");
            break;
          }

          await displayMessages(messageContract, conv.id, conv.key);
          break;
        }

        case "6": {
          const userChoice = await question("Select user [1=User1, 2=User2]: ");
          const user = userChoice.trim() === "1" ? user1 : user2;

          await displayUserBalance(messageContract, user);
          break;
        }

        case "7": {
          console.log("\n👋 Goodbye!");
          rl.close();
          return;
        }

        default:
          console.log("❌ Invalid choice!");
      }
    } catch (error: any) {
      console.error(`\n❌ Error: ${error.message || error}`);
    }
  }
}

interactiveMenu()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    rl.close();
    process.exit(1);
  });
