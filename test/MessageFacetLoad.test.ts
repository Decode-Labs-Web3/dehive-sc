import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { DehiveProxy, Message } from "../typechain-types";
import { getFunctionSelectors } from "../scripts/dehive/helpers/facetHelpers";

describe("MessageFacet - Load Tests", function () {
  async function deployProxyAndFacet() {
    const [deployer, owner, user1, user2, relayer] = await ethers.getSigners();

    const ProxyFactory = await ethers.getContractFactory("DehiveProxy");
    const proxy = await ProxyFactory.deploy();
    await proxy.waitForDeployment();
    const proxyAddress = await proxy.getAddress();

    const MessageFactory = await ethers.getContractFactory("Message");
    const messageFacet = await MessageFactory.deploy(owner.address);
    await messageFacet.waitForDeployment();
    const facetAddress = await messageFacet.getAddress();

    const fs = await import("fs");
    const path = await import("path");
    const imessageArtifactPath = path.join(
      __dirname,
      "../artifacts/contracts/interfaces/IMessage.sol/IMessage.json"
    );
    const imessageAbi = JSON.parse(
      fs.readFileSync(imessageArtifactPath, "utf-8")
    ).abi;

    const functionSelectors = getFunctionSelectors(imessageAbi);

    const facetCut = {
      facetAddress: facetAddress,
      functionSelectors: functionSelectors,
      action: 0,
    };

    const messageArtifactPath = path.join(
      __dirname,
      "../artifacts/contracts/Message.sol/Message.json"
    );
    const messageAbi = JSON.parse(
      fs.readFileSync(messageArtifactPath, "utf-8")
    ).abi;

    // Get proxy owner
    const proxyOwner = await proxy.owner();

    const initCalldata = ethers.Interface.from(messageAbi).encodeFunctionData(
      "init",
      [proxyOwner]
    );

    await proxy
      .connect(deployer)
      .facetCut([facetCut], facetAddress, initCalldata);

    const messageViaProxy = MessageFactory.attach(proxyAddress) as Message;
    await messageViaProxy.connect(deployer).setRelayer(relayer.address);

    return {
      owner,
      user1,
      user2,
      relayer,
      messageViaProxy,
    };
  }

  describe("Load Testing", function () {
    it("Should handle 100+ messages through proxy", async function () {
      const { user1, user2, messageViaProxy } = await loadFixture(
        deployProxyAndFacet
      );

      // Create conversation
      const { simulateCreateConversation } = await import(
        "./helpers/conversationHelpers"
      );
      const { conversationId, conversationKey } =
        await simulateCreateConversation(
          messageViaProxy,
          user1,
          user2.address,
          "load-test-seed"
        );

      // Send 100 messages
      const numMessages = 100;
      const payAsYouGoFee = await messageViaProxy.payAsYouGoFee();
      const { encryptMessage } = await import("./helpers/mockEncryption");

      console.log(`\nSending ${numMessages} messages through proxy...`);

      for (let i = 0; i < numMessages; i++) {
        const message = `Test message ${i + 1}`;
        const encryptedMessage = encryptMessage(message, conversationKey);

        const tx = await messageViaProxy
          .connect(user1)
          .sendMessage(conversationId, user2.address, encryptedMessage, {
            value: payAsYouGoFee,
          });

        if ((i + 1) % 10 === 0) {
          console.log(`  Sent ${i + 1} messages...`);
        }
      }

      console.log(`✓ Successfully sent ${numMessages} messages`);

      // Verify messages were sent
      const { fetchConversationMessages } = await import(
        "./helpers/messageFetcher"
      );
      const messages = await fetchConversationMessages(
        messageViaProxy,
        conversationId
      );
      expect(messages.length).to.be.gte(numMessages);
    });

    it("Should handle bulk relayer messages through proxy", async function () {
      const { user1, user2, relayer, messageViaProxy } = await loadFixture(
        deployProxyAndFacet
      );

      // Create conversation
      const { simulateCreateConversation } = await import(
        "./helpers/conversationHelpers"
      );
      const { conversationId, conversationKey } =
        await simulateCreateConversation(
          messageViaProxy,
          user1,
          user2.address,
          "relayer-load-test-seed"
        );

      // Deposit funds
      const numMessages = 50;
      const relayerFee = await messageViaProxy.relayerFee();
      const depositAmount = relayerFee * BigInt(numMessages + 10); // Extra for safety
      await messageViaProxy
        .connect(user1)
        .depositFunds({ value: depositAmount });

      // Send messages via relayer
      const { encryptMessage } = await import("./helpers/mockEncryption");
      console.log(
        `\nSending ${numMessages} messages via relayer through proxy...`
      );

      for (let i = 0; i < numMessages; i++) {
        const message = `Relayer message ${i + 1}`;
        const encryptedMessage = encryptMessage(message, conversationKey);

        const tx = await messageViaProxy
          .connect(relayer)
          .sendMessageViaRelayer(
            conversationId,
            user1.address,
            user2.address,
            encryptedMessage,
            relayerFee
          );

        if ((i + 1) % 10 === 0) {
          console.log(`  Sent ${i + 1} messages via relayer...`);
        }
      }

      console.log(`✓ Successfully sent ${numMessages} messages via relayer`);

      // Verify balance was deducted
      const finalBalance = await messageViaProxy.funds(user1.address);
      const expectedBalance = depositAmount - relayerFee * BigInt(numMessages);
      expect(finalBalance).to.equal(expectedBalance);
    });

    it("Should compare gas costs: standalone vs proxy", async function () {
      const { owner, user1, user2 } = await loadFixture(deployProxyAndFacet);

      // Deploy standalone Message
      const MessageFactory = await ethers.getContractFactory("Message");
      const standaloneMessage = await MessageFactory.deploy(owner.address);
      await standaloneMessage.waitForDeployment();

      // Create conversations in both
      const { simulateCreateConversation } = await import(
        "./helpers/conversationHelpers"
      );
      const { conversationId: standaloneConvId, conversationKey } =
        await simulateCreateConversation(
          standaloneMessage,
          user1,
          user2.address,
          "gas-test-seed"
        );

      const { messageViaProxy } = await loadFixture(deployProxyAndFacet);
      const { conversationId: proxyConvId } = await simulateCreateConversation(
        messageViaProxy,
        user1,
        user2.address,
        "gas-test-seed"
      );

      // Send message in standalone
      const { encryptMessage } = await import("./helpers/mockEncryption");
      const message = "Gas test message";
      const encryptedMessage = encryptMessage(message, conversationKey);

      // Use the default fee (both contracts have the same initial fee)
      const payAsYouGoFee = ethers.parseEther("0.0000002");

      const standaloneTx = await standaloneMessage
        .connect(user1)
        .sendMessage(standaloneConvId, user2.address, encryptedMessage, {
          value: payAsYouGoFee,
        });
      const standaloneReceipt = await standaloneTx.wait();

      // Send message through proxy
      const proxyTx = await messageViaProxy
        .connect(user1)
        .sendMessage(proxyConvId, user2.address, encryptedMessage, {
          value: standalonePayAsYouGoFee, // Use same fee for comparison
        });
      const proxyReceipt = await proxyTx.wait();

      console.log(
        `\nGas Usage - Standalone: ${standaloneReceipt!.gasUsed.toString()}`
      );
      console.log(`Gas Usage - Proxy: ${proxyReceipt!.gasUsed.toString()}`);
      console.log(
        `Overhead: ${proxyReceipt!.gasUsed - standaloneReceipt!.gasUsed} gas`
      );

      // Both should succeed
      expect(standaloneReceipt!.status).to.equal(1);
      expect(proxyReceipt!.status).to.equal(1);
    });
  });
});
