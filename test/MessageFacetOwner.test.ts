import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { DehiveProxy, Message } from "../typechain-types";
import { getFunctionSelectors } from "../scripts/dehive/helpers/facetHelpers";

describe("MessageFacet - Owner Functions", function () {
  async function deployProxyAndFacet() {
    const [deployer, owner, user1, user2, relayer, nonOwner] =
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

    // Get function selectors and install facet
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
      deployer,
      owner,
      user1,
      user2,
      relayer,
      nonOwner,
      proxy,
      messageViaProxy,
    };
  }

  describe("Proxy Owner Access Control", function () {
    it("Should allow proxy owner to set pay-as-you-go fee", async function () {
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

    it("Should allow proxy owner to set relayer fee", async function () {
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

    it("Should allow proxy owner to set relayer address", async function () {
      const { deployer, messageViaProxy } = await loadFixture(
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

    it("Should prevent non-owner from setting pay-as-you-go fee", async function () {
      const { nonOwner, messageViaProxy } = await loadFixture(
        deployProxyAndFacet
      );

      const newFee = ethers.parseEther("0.000001");
      await expect(
        messageViaProxy.connect(nonOwner).setPayAsYouGoFee(newFee)
      ).to.be.revertedWith("Message: caller is not the owner");
    });

    it("Should prevent non-owner from setting relayer fee", async function () {
      const { nonOwner, messageViaProxy } = await loadFixture(
        deployProxyAndFacet
      );

      const newFee = ethers.parseEther("0.0000005");
      await expect(
        messageViaProxy.connect(nonOwner).setRelayerFee(newFee)
      ).to.be.revertedWith("Message: caller is not the owner");
    });

    it("Should prevent non-owner from setting relayer", async function () {
      const { nonOwner, messageViaProxy } = await loadFixture(
        deployProxyAndFacet
      );

      const [, , , , , , , , , , newRelayerSigner] = await ethers.getSigners();
      const newRelayer = newRelayerSigner;
      await expect(
        messageViaProxy.connect(nonOwner).setRelayer(newRelayer.address)
      ).to.be.revertedWith("Message: caller is not the owner");
    });
  });

  describe("Relayer Functionality", function () {
    it("Should allow relayer to send messages via relayer", async function () {
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
          "test-seed"
        );

      // Deposit funds
      const depositAmount = ethers.parseEther("0.01");
      await messageViaProxy
        .connect(user1)
        .depositFunds({ value: depositAmount });

      // Send message via relayer
      const { encryptMessage } = await import("./helpers/mockEncryption");
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

      await expect(tx).to.emit(messageViaProxy, "MessageSent");
    });

    it("Should prevent non-relayer from sending via relayer", async function () {
      const { owner, user1, user2, nonOwner, messageViaProxy } =
        await loadFixture(deployProxyAndFacet);

      // Create conversation
      const { simulateCreateConversation } = await import(
        "./helpers/conversationHelpers"
      );
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

      // Try to send via relayer (should fail)
      const { encryptMessage } = await import("./helpers/mockEncryption");
      const message = "Hello via relayer!";
      const encryptedMessage = encryptMessage(message, conversationKey);
      const relayerFee = await messageViaProxy.relayerFee();

      await expect(
        messageViaProxy
          .connect(nonOwner)
          .sendMessageViaRelayer(
            conversationId,
            user1.address,
            user2.address,
            encryptedMessage,
            relayerFee
          )
      ).to.be.revertedWith("Message: caller is not the relayer");
    });

    it("Should allow proxy owner to change relayer and still work", async function () {
      const { deployer, owner, user1, user2, relayer, messageViaProxy } =
        await loadFixture(deployProxyAndFacet);

      // Create conversation
      const { simulateCreateConversation } = await import(
        "./helpers/conversationHelpers"
      );
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

      // Change relayer
      const [, , , , , , , , , , newRelayerSigner] = await ethers.getSigners();
      const newRelayer = newRelayerSigner;
      await messageViaProxy.connect(deployer).setRelayer(newRelayer.address);

      // Verify old relayer can no longer send
      const { encryptMessage } = await import("./helpers/mockEncryption");
      const message = "Hello via relayer!";
      const encryptedMessage = encryptMessage(message, conversationKey);
      const relayerFee = await messageViaProxy.relayerFee();

      await expect(
        messageViaProxy
          .connect(relayer)
          .sendMessageViaRelayer(
            conversationId,
            user1.address,
            user2.address,
            encryptedMessage,
            relayerFee
          )
      ).to.be.revertedWith("Message: caller is not the relayer");

      // Verify new relayer can send
      const tx = await messageViaProxy
        .connect(newRelayer)
        .sendMessageViaRelayer(
          conversationId,
          user1.address,
          user2.address,
          encryptedMessage,
          relayerFee
        );

      await expect(tx).to.emit(messageViaProxy, "MessageSent");
    });
  });
});
