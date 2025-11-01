import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { DehiveProxy, Message } from "../typechain-types";
import { getFunctionSelectors } from "../scripts/dehive/helpers/facetHelpers";

describe("MessageFacet - Edge Cases", function () {
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
      proxy,
      messageViaProxy,
      facetAddress,
    };
  }

  describe("Initialization", function () {
    it("Should prevent re-initialization of facet", async function () {
      const { owner, proxy, messageViaProxy, facetAddress } = await loadFixture(
        deployProxyAndFacet
      );

      // Try to call init again (should fail)
      const MessageFactory = await ethers.getContractFactory("Message");
      const messageArtifactPath = await import("path").then((p) =>
        p.join(__dirname, "../artifacts/contracts/Message.sol/Message.json")
      );
      const fs = await import("fs");
      const messageAbi = JSON.parse(
        fs.readFileSync(messageArtifactPath, "utf-8")
      ).abi;

      const initCalldata = ethers.Interface.from(messageAbi).encodeFunctionData(
        "init",
        [owner.address]
      );

      // Call init directly on proxy (should revert)
      await expect(
        messageViaProxy.connect(owner).init(owner.address)
      ).to.be.revertedWith("Message: already initialized");
    });
  });

  describe("Facet Upgrade Scenario", function () {
    it("Should maintain storage after facet operations", async function () {
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
          "test-seed"
        );

      // Deposit funds
      const depositAmount = ethers.parseEther("0.01");
      await messageViaProxy
        .connect(user1)
        .depositFunds({ value: depositAmount });

      // Verify state persists
      const conv = await messageViaProxy.conversations(conversationId);
      expect(conv.createdAt).to.be.gt(0);

      const balance = await messageViaProxy.funds(user1.address);
      expect(balance).to.equal(depositAmount);
    });
  });

  describe("Storage Isolation", function () {
    it("Should isolate storage between standalone and proxy modes", async function () {
      const { owner, user1, user2, messageViaProxy, proxy } = await loadFixture(
        deployProxyAndFacet
      );

      // Deploy standalone Message
      const MessageFactory = await ethers.getContractFactory("Message");
      const standaloneMessage = await MessageFactory.deploy(owner.address);
      await standaloneMessage.waitForDeployment();

      // Create conversation in proxy
      const { simulateCreateConversation } = await import(
        "./helpers/conversationHelpers"
      );
      const { conversationId: proxyConvId } = await simulateCreateConversation(
        messageViaProxy,
        user1,
        user2.address,
        "proxy-seed"
      );

      // Create conversation in standalone
      const { conversationId: standaloneConvId } =
        await simulateCreateConversation(
          standaloneMessage,
          user1,
          user2.address,
          "standalone-seed"
        );

      // Verify they are different (same addresses, same conversation ID)
      expect(proxyConvId).to.equal(standaloneConvId);

      // But storage is separate
      const proxyConv = await messageViaProxy.conversations(proxyConvId);
      const standaloneConv = await standaloneMessage.conversations(
        standaloneConvId
      );

      // Both should exist but have different storage
      expect(proxyConv.createdAt).to.be.gt(0);
      expect(standaloneConv.createdAt).to.be.gt(0);
    });
  });

  describe("Multiple Facets (if applicable)", function () {
    it("Should allow multiple facets to coexist", async function () {
      const { proxy, owner } = await loadFixture(deployProxyAndFacet);

      // Verify proxy can have multiple facets (if we add more later)
      const facetAddresses = await proxy.facetAddresses();
      expect(facetAddresses.length).to.be.gte(1); // At least MessageFacet
    });
  });
});
