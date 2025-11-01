import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { DehiveProxy, Message, IDehiveProxy } from "../typechain-types";
import { getFunctionSelectors } from "../scripts/dehive/helpers/facetHelpers";
import {
  computeConversationId,
  simulateCreateConversation,
} from "./helpers/conversationHelpers";
import {
  encryptMessage,
  decryptMessage,
  generateConversationKey,
  encryptConversationKeyForAddress,
  decryptConversationKeyForAddress,
} from "./helpers/mockEncryption";

describe("MessageFacet - Proxy Integration", function () {
  // Fixture for deploying DehiveProxy and MessageFacet
  async function deployProxyAndFacet() {
    const [deployer, owner, user1, user2, user3, relayer] =
      await ethers.getSigners();

    // Deploy DehiveProxy
    const ProxyFactory = await ethers.getContractFactory("DehiveProxy");
    const proxy = await ProxyFactory.deploy();
    await proxy.waitForDeployment();
    const proxyAddress = await proxy.getAddress();

    // Deploy MessageFacet
    const MessageFactory = await ethers.getContractFactory("Message");
    const messageFacet = await MessageFactory.deploy(owner.address);
    await messageFacet.waitForDeployment();
    const facetAddress = await messageFacet.getAddress();

    // Get IMessage ABI for function selectors
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

    // Prepare facet cut
    const facetCut = {
      facetAddress: facetAddress,
      functionSelectors: functionSelectors,
      action: 0, // Add
    };

    // Get Message ABI for init encoding
    const messageArtifactPath = path.join(
      __dirname,
      "../artifacts/contracts/Message.sol/Message.json"
    );
    const messageAbi = JSON.parse(
      fs.readFileSync(messageArtifactPath, "utf-8")
    ).abi;

    // Get proxy owner (deployer is the proxy owner)
    const proxyOwner = await proxy.owner();

    // Encode init function call (pass proxy owner to init)
    const initCalldata = ethers.Interface.from(messageAbi).encodeFunctionData(
      "init",
      [proxyOwner]
    );

    // Install facet (use deployer since they're the proxy owner)
    const installTx = await proxy
      .connect(deployer)
      .facetCut([facetCut], facetAddress, initCalldata);
    await installTx.wait();

    // Connect to proxy as Message interface
    const messageViaProxy = MessageFactory.attach(proxyAddress) as Message;

    // Set relayer (proxy owner can call admin functions)
    await messageViaProxy.connect(deployer).setRelayer(relayer.address);

    return {
      deployer,
      owner,
      user1,
      user2,
      user3,
      relayer,
      proxy,
      proxyAddress,
      messageFacet,
      facetAddress,
      messageViaProxy,
      functionSelectors,
    };
  }

  describe("Facet Installation", function () {
    it("Should deploy proxy and facet successfully", async function () {
      const { proxy, messageFacet, proxyAddress, facetAddress } =
        await loadFixture(deployProxyAndFacet);

      expect(await proxy.getAddress()).to.equal(proxyAddress);
      expect(await messageFacet.getAddress()).to.equal(facetAddress);
    });

    it("Should install MessageFacet into proxy", async function () {
      const { proxy, facetAddress, functionSelectors } = await loadFixture(
        deployProxyAndFacet
      );

      // Verify facet is installed
      const installedSelectors = await proxy.facetFunctionSelectors(
        facetAddress
      );
      expect(installedSelectors.length).to.equal(functionSelectors.length);

      // Verify each selector points to the facet
      for (const selector of functionSelectors) {
        const facet = await proxy.facetAddress(selector);
        expect(facet.toLowerCase()).to.equal(facetAddress.toLowerCase());
      }
    });

    it("Should initialize MessageFacet through proxy", async function () {
      const { messageViaProxy, owner } = await loadFixture(deployProxyAndFacet);

      // Check that fees are initialized
      const payAsYouGoFee = await messageViaProxy.payAsYouGoFee();
      const relayerFee = await messageViaProxy.relayerFee();

      expect(payAsYouGoFee).to.equal(ethers.parseEther("0.0000002"));
      expect(relayerFee).to.equal(ethers.parseEther("0.0000001"));
    });
  });

  describe("Message Functions via Proxy", function () {
    it("Should create conversation through proxy", async function () {
      const { user1, user2, messageViaProxy } = await loadFixture(
        deployProxyAndFacet
      );

      const { conversationId, conversationKey } =
        await simulateCreateConversation(
          messageViaProxy,
          user1,
          user2.address,
          "test-seed"
        );

      expect(conversationId).to.be.a("bigint");

      // Verify conversation exists
      const conv = await messageViaProxy.conversations(conversationId);
      expect(conv.createdAt).to.be.gt(0);
    });

    it("Should send message through proxy (pay-as-you-go)", async function () {
      const { user1, user2, messageViaProxy } = await loadFixture(
        deployProxyAndFacet
      );

      // Create conversation
      const { conversationId, conversationKey } =
        await simulateCreateConversation(
          messageViaProxy,
          user1,
          user2.address,
          "test-seed"
        );

      // Send message
      const message = "Hello from proxy!";
      const encryptedMessage = encryptMessage(message, conversationKey);
      const payAsYouGoFee = await messageViaProxy.payAsYouGoFee();

      const tx = await messageViaProxy
        .connect(user1)
        .sendMessage(conversationId, user2.address, encryptedMessage, {
          value: payAsYouGoFee,
        });

      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);

      await expect(tx)
        .to.emit(messageViaProxy, "MessageSent")
        .withArgs(
          conversationId,
          user1.address,
          user2.address,
          encryptedMessage
        );
    });

    it("Should send message via relayer through proxy", async function () {
      const { user1, user2, relayer, messageViaProxy } = await loadFixture(
        deployProxyAndFacet
      );

      // Create conversation
      const { conversationId, conversationKey } =
        await simulateCreateConversation(
          messageViaProxy,
          user1,
          user2.address,
          "test-seed"
        );

      // Deposit funds
      const depositAmount = ethers.parseEther("0.01");
      await messageViaProxy
        .connect(user1)
        .depositFunds({ value: depositAmount });

      // Send message via relayer
      const message = "Hello via relayer!";
      const encryptedMessage = encryptMessage(message, conversationKey);
      const relayerFee = await messageViaProxy.relayerFee();

      const tx = await messageViaProxy
        .connect(relayer)
        .sendMessageViaRelayer(
          conversationId,
          user1.address,
          user2.address,
          encryptedMessage,
          relayerFee
        );

      await expect(tx)
        .to.emit(messageViaProxy, "MessageSent")
        .withArgs(
          conversationId,
          user1.address,
          user2.address,
          encryptedMessage
        );
    });

    it("Should deposit funds through proxy", async function () {
      const { user1, messageViaProxy } = await loadFixture(deployProxyAndFacet);

      const depositAmount = ethers.parseEther("0.01");
      const tx = await messageViaProxy
        .connect(user1)
        .depositFunds({ value: depositAmount });
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);

      await expect(tx)
        .to.emit(messageViaProxy, "FundsDeposited")
        .withArgs(depositAmount, user1.address, block!.timestamp);

      const balance = await messageViaProxy.funds(user1.address);
      expect(balance).to.equal(depositAmount);
    });

    it("Should retrieve encrypted conversation key through proxy", async function () {
      const { user1, user2, messageViaProxy } = await loadFixture(
        deployProxyAndFacet
      );

      const conversationKey = generateConversationKey("test-seed");
      const encryptedKeyFor1 = encryptConversationKeyForAddress(
        conversationKey,
        user1.address
      );
      const encryptedKeyFor2 = encryptConversationKeyForAddress(
        conversationKey,
        user2.address
      );

      const convId = await messageViaProxy
        .connect(user1)
        .createConversation.staticCall(
          user2.address,
          `0x${encryptedKeyFor1}`,
          `0x${encryptedKeyFor2}`
        );

      await messageViaProxy
        .connect(user1)
        .createConversation(
          user2.address,
          `0x${encryptedKeyFor1}`,
          `0x${encryptedKeyFor2}`
        );

      // Retrieve key
      const retrievedKeyBytes = await messageViaProxy
        .connect(user1)
        .getMyEncryptedConversationKeys(convId);

      // Convert bytes to hex
      let keyHex: string;
      if (typeof retrievedKeyBytes === "string") {
        keyHex = retrievedKeyBytes.startsWith("0x")
          ? retrievedKeyBytes.substring(2)
          : retrievedKeyBytes;
      } else {
        keyHex = ethers.hexlify(retrievedKeyBytes).substring(2);
      }

      // Decrypt and verify
      const decryptedKey = decryptConversationKeyForAddress(
        keyHex.toLowerCase(),
        user1.address.toLowerCase()
      );

      // Verify key works
      const testMessage = "Test message";
      const encryptedTestMsg = encryptMessage(testMessage, decryptedKey);
      const decryptedTestMsg = decryptMessage(encryptedTestMsg, decryptedKey);
      expect(decryptedTestMsg).to.equal(testMessage);
    });
  });

  describe("Admin Functions via Proxy", function () {
    it("Should set pay-as-you-go fee through proxy", async function () {
      const { deployer, messageViaProxy } = await loadFixture(
        deployProxyAndFacet
      );

      const newFee = ethers.parseEther("0.000001");
      const tx = await messageViaProxy
        .connect(deployer)
        .setPayAsYouGoFee(newFee);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);

      await expect(tx)
        .to.emit(messageViaProxy, "PayAsYouGoFeeSet")
        .withArgs(newFee, block!.timestamp);

      const updatedFee = await messageViaProxy.payAsYouGoFee();
      expect(updatedFee).to.equal(newFee);
    });

    it("Should set relayer fee through proxy", async function () {
      const { deployer, messageViaProxy } = await loadFixture(
        deployProxyAndFacet
      );

      const newFee = ethers.parseEther("0.0000005");
      const tx = await messageViaProxy.connect(deployer).setRelayerFee(newFee);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);

      await expect(tx)
        .to.emit(messageViaProxy, "RelayerFeeSet")
        .withArgs(newFee, block!.timestamp);

      const updatedFee = await messageViaProxy.relayerFee();
      expect(updatedFee).to.equal(newFee);
    });

    it("Should set relayer through proxy", async function () {
      const { deployer, relayer, messageViaProxy } = await loadFixture(
        deployProxyAndFacet
      );

      const [, , , , , , , , , , newRelayerSigner] = await ethers.getSigners();
      const newRelayer = newRelayerSigner;
      const tx = await messageViaProxy
        .connect(deployer)
        .setRelayer(newRelayer.address);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);

      await expect(tx)
        .to.emit(messageViaProxy, "RelayerSet")
        .withArgs(newRelayer.address, block!.timestamp);

      const updatedRelayer = await messageViaProxy.relayer();
      expect(updatedRelayer).to.equal(newRelayer.address);
    });
  });

  describe("Storage Isolation", function () {
    it("Should maintain separate storage for different conversations", async function () {
      const { user1, user2, user3, messageViaProxy } = await loadFixture(
        deployProxyAndFacet
      );

      // Create two different conversations
      const { conversationId: convId1 } = await simulateCreateConversation(
        messageViaProxy,
        user1,
        user2.address,
        "seed1"
      );

      const { conversationId: convId2 } = await simulateCreateConversation(
        messageViaProxy,
        user1,
        user3.address,
        "seed2"
      );

      expect(convId1).to.not.equal(convId2);

      const conv1 = await messageViaProxy.conversations(convId1);
      const conv2 = await messageViaProxy.conversations(convId2);

      expect(conv1.createdAt).to.be.gt(0);
      expect(conv2.createdAt).to.be.gt(0);
      // Both conversations have user1, but with different participants (user2 vs user3)
      // So either smallerAddress or largerAddress should differ
      expect(
        conv1.smallerAddress !== conv2.smallerAddress ||
          conv1.largerAddress !== conv2.largerAddress
      ).to.be.true;
    });
  });
});
