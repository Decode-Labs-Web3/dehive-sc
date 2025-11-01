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

  // Verify relayer is set correctly
  const currentRelayer = await messageContract.relayer();
  if (currentRelayer !== relayer.address) {
    console.log(`\n⚠ Relayer not set. Setting relayer to: ${relayer.address}`);
    try {
      await messageContract.connect(owner).setRelayer(relayer.address);
      console.log(`✓ Relayer set successfully`);
    } catch (error: any) {
      console.log(`⚠ Could not set relayer: ${error.message}`);
    }
  }

  console.log(`\nAvailable accounts:`);
  console.log(`  [O] Owner: ${owner.address}`);
  console.log(`  [1] User1: ${user1.address}`);
  console.log(`  [2] User2: ${user2.address}`);
  console.log(`  [R] Relayer: ${relayer.address}`);
  console.log(`\nContract fees:`);
  const payAsYouGoFee = await messageContract.payAsYouGoFee();
  const relayerFee = await messageContract.relayerFee();
  console.log(`  Pay-as-you-go fee: ${ethers.formatEther(payAsYouGoFee)} ETH`);
  console.log(`  Relayer fee: ${ethers.formatEther(relayerFee)} ETH`);

  const conversations = new Map<
    string,
    { id: bigint; key: string; sender: any; receiver: string }
  >();

  while (true) {
    console.log("\n" + "=".repeat(70));
    console.log("Menu:");
    console.log("  === Conversation Functions ===");
    console.log("  1. Create conversation");
    console.log("  2. Get my encrypted conversation key");
    console.log("  === Message Functions ===");
    console.log("  3. Send direct message (pay-as-you-go)");
    console.log("  4. Send message via relayer (credit-based)");
    console.log("  === Funds Functions ===");
    console.log("  5. Deposit funds");
    console.log("  6. Display user balance");
    console.log("  === Message Viewing ===");
    console.log("  7. Display messages");
    console.log("  8. Display all messages");
    console.log("  === Owner Functions ===");
    console.log("  9. Set pay-as-you-go fee (owner only)");
    console.log("  10. Set relayer fee (owner only)");
    console.log("  11. Set relayer address (owner only)");
    console.log("  === Exit ===");
    console.log("  0. Exit");
    console.log("=".repeat(70));

    const choice = await question("\nEnter your choice (0-11): ");

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
          const userChoice = await question("Select user [1=User1, 2=User2]: ");
          const user = userChoice.trim() === "1" ? user1 : user2;

          const conversationIdStr = await question("Enter conversation ID: ");
          const conversationId = BigInt(conversationIdStr.trim());

          console.log(`\n🔑 Retrieving encrypted conversation key...`);
          try {
            const encryptedKey = await messageContract
              .connect(user)
              .getMyEncryptedConversationKeys(conversationId);

            // Convert bytes to hex
            let keyHex: string;
            if (typeof encryptedKey === "string") {
              keyHex = encryptedKey.startsWith("0x")
                ? encryptedKey.substring(2)
                : encryptedKey;
            } else {
              keyHex = ethers.hexlify(encryptedKey).substring(2);
            }

            // Decrypt the key
            const decryptedKey = decryptConversationKeyForAddress(
              keyHex.toLowerCase(),
              user.address.toLowerCase()
            );

            console.log(
              `✓ Encrypted key retrieved: ${keyHex.substring(0, 20)}...`
            );
            console.log(
              `✓ Decrypted key (first 20 chars): ${decryptedKey.substring(
                0,
                20
              )}...`
            );

            // Store in conversations if not already stored
            const convKey = `${user.address}-${conversationId}`;
            if (!conversations.has(convKey)) {
              // Try to find the other participant
              const conv = await messageContract.conversations(conversationId);
              const otherAddress =
                conv.smallerAddress.toLowerCase() === user.address.toLowerCase()
                  ? conv.largerAddress
                  : conv.smallerAddress;

              conversations.set(convKey, {
                id: conversationId,
                key: decryptedKey,
                sender: user,
                receiver: otherAddress,
              });
              console.log(`✓ Conversation key stored for future use`);
            }
          } catch (error: any) {
            console.error(`❌ Failed to retrieve key: ${error.message}`);
          }
          break;
        }

        case "3": {
          const convKey = await question(
            "Enter conversation key (sender-receiver) or conversation ID: "
          );

          let conv:
            | { id: bigint; key: string; sender: any; receiver: string }
            | undefined;

          // Try to find by conversation key first
          conv = conversations.get(convKey.trim());

          // If not found, try to find by conversation ID
          if (!conv) {
            try {
              const convId = BigInt(convKey.trim());
              // Try to get from stored conversations
              for (const [key, storedConv] of conversations.entries()) {
                if (storedConv.id === convId) {
                  conv = storedConv;
                  break;
                }
              }

              if (!conv) {
                console.log(
                  "❌ Conversation not found! Please create it first or retrieve the key."
                );
                break;
              }
            } catch {
              console.log("❌ Invalid conversation ID or key!");
              break;
            }
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

        case "4": {
          const convKey = await question(
            "Enter conversation key (sender-receiver) or conversation ID: "
          );

          let conv:
            | { id: bigint; key: string; sender: any; receiver: string }
            | undefined;

          // Try to find by conversation key first
          conv = conversations.get(convKey.trim());

          // If not found, try to find by conversation ID
          if (!conv) {
            try {
              const convId = BigInt(convKey.trim());
              for (const [key, storedConv] of conversations.entries()) {
                if (storedConv.id === convId) {
                  conv = storedConv;
                  break;
                }
              }

              if (!conv) {
                console.log(
                  "❌ Conversation not found! Please create it first or retrieve the key."
                );
                break;
              }
            } catch {
              console.log("❌ Invalid conversation ID or key!");
              break;
            }
          }

          // Get sender address
          const senderChoice = await question(
            "Enter sender address (user who will be charged): "
          );
          const senderAddress = senderChoice.trim();

          // Get receiver address
          const receiverChoice = await question("Enter receiver address: ");
          const receiverAddress = receiverChoice.trim();

          const message = await question("Enter message: ");

          // Verify relayer is correct
          const currentRelayer = await messageContract.relayer();
          if (currentRelayer !== relayer.address) {
            console.log(
              `⚠ Warning: Contract relayer (${currentRelayer}) != script relayer (${relayer.address})`
            );
            console.log(`  Using script relayer to send...`);
          }

          await sendRelayerMessage(
            messageContract,
            relayer, // Use relayer signer to send transaction
            conv.id,
            senderAddress, // from address
            receiverAddress, // to address
            message.trim(),
            conv.key
          );
          break;
        }

        case "5": {
          const userChoice = await question("Select user [1=User1, 2=User2]: ");
          const user = userChoice.trim() === "1" ? user1 : user2;

          const amount = await question("Enter amount in ETH: ");

          await depositFunds(messageContract, user, amount.trim());
          break;
        }

        case "6": {
          const userChoice = await question(
            "Select user [1=User1, 2=User2], or enter address: "
          );
          let user: any;

          if (userChoice.trim() === "1") {
            user = user1;
          } else if (userChoice.trim() === "2") {
            user = user2;
          } else {
            // Try to find signer by address
            const address = userChoice.trim();
            if (user1.address.toLowerCase() === address.toLowerCase()) {
              user = user1;
            } else if (user2.address.toLowerCase() === address.toLowerCase()) {
              user = user2;
            } else {
              console.log(
                `⚠ Address ${address} not found in signers. Showing balance from contract...`
              );
              const balance = await messageContract.funds(address);
              console.log(
                `\n💰 Balance for ${address}: ${ethers.formatEther(
                  balance
                )} ETH`
              );
              break;
            }
          }

          await displayUserBalance(messageContract, user);
          break;
        }

        case "7": {
          const convKey = await question(
            "Enter conversation key (sender-receiver) or conversation ID: "
          );

          let conv:
            | { id: bigint; key: string; sender: any; receiver: string }
            | undefined;

          conv = conversations.get(convKey.trim());

          if (!conv) {
            try {
              const convId = BigInt(convKey.trim());
              for (const [key, storedConv] of conversations.entries()) {
                if (storedConv.id === convId) {
                  conv = storedConv;
                  break;
                }
              }

              if (!conv) {
                console.log(
                  "❌ Conversation not found! Cannot decrypt messages without key."
                );
                console.log(
                  "   Please create conversation or retrieve key first."
                );
                break;
              }
            } catch {
              console.log("❌ Invalid conversation ID or key!");
              break;
            }
          }

          await displayMessages(messageContract, conv.id, conv.key);
          break;
        }

        case "8": {
          console.log(`\n📥 Fetching all messages...`);
          const allMessages = await fetchAllMessages(messageContract);

          if (allMessages.length === 0) {
            console.log("No messages found.");
            break;
          }

          console.log(`\n📋 All Messages (${allMessages.length} total):\n`);
          console.log("=".repeat(70));

          for (const msg of allMessages) {
            const date = new Date(msg.timestamp * 1000);
            console.log(`Conversation ID: ${msg.conversationId.toString()}`);
            console.log(`From: ${msg.from}`);
            console.log(`To: ${msg.to}`);
            console.log(
              `Encrypted: ${msg.encryptedMessage.substring(0, 50)}...`
            );
            console.log(`Time: ${date.toLocaleString()}`);
            console.log(`Block: ${msg.blockNumber}`);
            console.log("-".repeat(70));
          }
          break;
        }

        case "9": {
          const ownerChoice = await question(
            "This requires owner. Confirm owner address matches: "
          );
          if (
            ownerChoice.trim().toLowerCase() !== owner.address.toLowerCase()
          ) {
            console.log("❌ Owner address mismatch!");
            break;
          }

          const feeStr = await question("Enter new pay-as-you-go fee in ETH: ");
          const newFee = ethers.parseEther(feeStr.trim());

          console.log(`\n⚙️  Updating pay-as-you-go fee...`);
          const tx = await messageContract
            .connect(owner)
            .setPayAsYouGoFee(newFee);
          await tx.wait();

          const updatedFee = await messageContract.payAsYouGoFee();
          console.log(
            `✓ Fee updated to: ${ethers.formatEther(updatedFee)} ETH`
          );
          break;
        }

        case "10": {
          const ownerChoice = await question(
            "This requires owner. Confirm owner address matches: "
          );
          if (
            ownerChoice.trim().toLowerCase() !== owner.address.toLowerCase()
          ) {
            console.log("❌ Owner address mismatch!");
            break;
          }

          const feeStr = await question("Enter new relayer fee in ETH: ");
          const newFee = ethers.parseEther(feeStr.trim());

          console.log(`\n⚙️  Updating relayer fee...`);
          const tx = await messageContract.connect(owner).setRelayerFee(newFee);
          await tx.wait();

          const updatedFee = await messageContract.relayerFee();
          console.log(
            `✓ Fee updated to: ${ethers.formatEther(updatedFee)} ETH`
          );
          break;
        }

        case "11": {
          const ownerChoice = await question(
            "This requires owner. Confirm owner address matches: "
          );
          if (
            ownerChoice.trim().toLowerCase() !== owner.address.toLowerCase()
          ) {
            console.log("❌ Owner address mismatch!");
            break;
          }

          const newRelayerAddress = await question(
            "Enter new relayer address: "
          );

          console.log(`\n⚙️  Setting relayer address...`);
          const tx = await messageContract
            .connect(owner)
            .setRelayer(newRelayerAddress.trim());
          await tx.wait();

          const updatedRelayer = await messageContract.relayer();
          console.log(`✓ Relayer set to: ${updatedRelayer}`);
          break;
        }

        case "0": {
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
