import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ServerAirdropRegistry, AirdropFactory } from "../../typechain-types";
import {
  deployAirdropRegistryFixture,
  createServerFactory,
} from "./helpers/airdropHelpers";
import { generateServerIds } from "./helpers/testDataGenerator";

describe("ServerAirdropRegistry - Factory Clone Creation", function () {
  async function deployRegistryFixture() {
    return await deployAirdropRegistryFixture();
  }

  describe("Contract Deployment", function () {
    it("Should deploy Registry with correct implementation addresses", async function () {
      const { registry, factoryImplementation, merkleAirdropImplementation } =
        await loadFixture(deployRegistryFixture);

      expect(await registry.factoryImplementation()).to.equal(
        await factoryImplementation.getAddress()
      );
      expect(await registry.merkleAirdropImplementation()).to.equal(
        await merkleAirdropImplementation.getAddress()
      );
    });

    it("Should revert if factory implementation is zero address", async function () {
      const RegistryFactory = await ethers.getContractFactory(
        "ServerAirdropRegistry"
      );
      const [deployer] = await ethers.getSigners();

      // Deploy MerkleAirdrop implementation first
      const MockERC20Factory = await ethers.getContractFactory("MockERC20");
      const dummyToken = await MockERC20Factory.deploy(
        "Dummy",
        "DUMMY",
        18,
        ethers.parseEther("1000")
      );
      await dummyToken.waitForDeployment();

      const MerkleAirdropFactory = await ethers.getContractFactory(
        "MerkleAirdrop"
      );
      const merkleImpl = await MerkleAirdropFactory.deploy(
        await dummyToken.getAddress(),
        deployer.address,
        ethers.keccak256("0x00"),
        "ipfs://dummy",
        ethers.parseEther("1000")
      );
      await merkleImpl.waitForDeployment();

      await expect(
        RegistryFactory.deploy(
          ethers.ZeroAddress,
          await merkleImpl.getAddress()
        )
      ).to.be.revertedWith(
        "ServerAirdropRegistry: factory implementation cannot be zero"
      );
    });

    it("Should revert if MerkleAirdrop implementation is zero address", async function () {
      const RegistryFactory = await ethers.getContractFactory(
        "ServerAirdropRegistry"
      );
      const AirdropFactoryFactory = await ethers.getContractFactory(
        "AirdropFactory"
      );
      const factoryImpl = await AirdropFactoryFactory.deploy(
        ethers.ZeroAddress
      );
      await factoryImpl.waitForDeployment();

      await expect(
        RegistryFactory.deploy(
          await factoryImpl.getAddress(),
          ethers.ZeroAddress
        )
      ).to.be.revertedWith(
        "ServerAirdropRegistry: merkle airdrop implementation cannot be zero"
      );
    });
  });

  describe("Factory Clone Creation", function () {
    it("Should create a Factory clone for a server", async function () {
      const { registry } = await loadFixture(deployRegistryFixture);
      const [deployer, owner] = await ethers.getSigners();
      const serverId = "507f1f77bcf86cd799439011";
      const ownerAddress = await owner.getAddress();

      const tx = await registry
        .connect(deployer)
        .createFactoryForServer(serverId, ownerAddress);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);

      // Verify event emission
      await expect(tx)
        .to.emit(registry, "FactoryCreated")
        .withArgs(
          (factoryAddress: string) => factoryAddress !== ethers.ZeroAddress,
          serverId,
          ownerAddress,
          deployer.address,
          block!.timestamp,
          receipt!.blockNumber,
          await registry.factoryImplementation(),
          await registry.merkleAirdropImplementation()
        );

      // Verify factory exists
      const factoryAddress = await registry.getFactoryByServerId(serverId);
      expect(factoryAddress).to.not.equal(ethers.ZeroAddress);

      // Verify reverse lookup
      const retrievedServerId = await registry.getServerIdByFactory(
        factoryAddress
      );
      expect(retrievedServerId).to.equal(serverId);
    });

    it("Should initialize Factory clone with correct serverId and owner", async function () {
      const { registry } = await loadFixture(deployRegistryFixture);
      const [deployer, owner] = await ethers.getSigners();
      const serverId = "507f1f77bcf86cd799439012";
      const ownerAddress = await owner.getAddress();

      const factory = await createServerFactory(registry, serverId, owner);

      // Verify Factory is initialized
      expect(await factory.initialized()).to.be.true;
      expect(await factory.serverId()).to.equal(serverId);
      expect(await factory.owner()).to.equal(ownerAddress);
    });

    it("Should create multiple Factory clones for different servers", async function () {
      const { registry } = await loadFixture(deployRegistryFixture);
      const [deployer, owner1, owner2, owner3] = await ethers.getSigners();
      const serverIds = generateServerIds(3);

      const factory1 = await createServerFactory(
        registry,
        serverIds[0],
        owner1
      );
      const factory2 = await createServerFactory(
        registry,
        serverIds[1],
        owner2
      );
      const factory3 = await createServerFactory(
        registry,
        serverIds[2],
        owner3
      );

      // Verify all factories exist and are different
      expect(await factory1.getAddress()).to.not.equal(
        await factory2.getAddress()
      );
      expect(await factory2.getAddress()).to.not.equal(
        await factory3.getAddress()
      );
      expect(await factory1.getAddress()).to.not.equal(
        await factory3.getAddress()
      );

      // Verify serverId tracking
      expect(await factory1.serverId()).to.equal(serverIds[0]);
      expect(await factory2.serverId()).to.equal(serverIds[1]);
      expect(await factory3.serverId()).to.equal(serverIds[2]);
    });

    it("Should track Factory count correctly", async function () {
      const { registry } = await loadFixture(deployRegistryFixture);
      const [deployer, owner1, owner2, owner3] = await ethers.getSigners();
      const serverIds = generateServerIds(3);

      expect(await registry.getFactoryCount()).to.equal(0);

      await createServerFactory(registry, serverIds[0], owner1);
      expect(await registry.getFactoryCount()).to.equal(1);

      await createServerFactory(registry, serverIds[1], owner2);
      expect(await registry.getFactoryCount()).to.equal(2);

      await createServerFactory(registry, serverIds[2], owner3);
      expect(await registry.getFactoryCount()).to.equal(3);
    });

    it("Should return all factories via getAllFactories", async function () {
      const { registry } = await loadFixture(deployRegistryFixture);
      const [deployer, owner1, owner2, owner3] = await ethers.getSigners();
      const serverIds = generateServerIds(3);

      const factory1 = await createServerFactory(
        registry,
        serverIds[0],
        owner1
      );
      const factory2 = await createServerFactory(
        registry,
        serverIds[1],
        owner2
      );
      const factory3 = await createServerFactory(
        registry,
        serverIds[2],
        owner3
      );

      const allFactories = await registry.getAllFactories();
      expect(allFactories.length).to.equal(3);
      expect(allFactories).to.include(await factory1.getAddress());
      expect(allFactories).to.include(await factory2.getAddress());
      expect(allFactories).to.include(await factory3.getAddress());
    });
  });

  describe("Lookup Functions", function () {
    it("Should return factory address for valid serverId", async function () {
      const { registry } = await loadFixture(deployRegistryFixture);
      const [deployer, owner] = await ethers.getSigners();
      const serverId = "507f1f77bcf86cd799439013";

      const factory = await createServerFactory(registry, serverId, owner);
      const factoryAddress = await factory.getAddress();

      const retrievedAddress = await registry.getFactoryByServerId(serverId);
      expect(retrievedAddress).to.equal(factoryAddress);
    });

    it("Should return zero address for non-existent serverId", async function () {
      const { registry } = await loadFixture(deployRegistryFixture);
      const serverId = "507f1f77bcf86cd799439999";

      const factoryAddress = await registry.getFactoryByServerId(serverId);
      expect(factoryAddress).to.equal(ethers.ZeroAddress);
    });

    it("Should return serverId for valid factory address", async function () {
      const { registry } = await loadFixture(deployRegistryFixture);
      const [deployer, owner] = await ethers.getSigners();
      const serverId = "507f1f77bcf86cd799439014";

      const factory = await createServerFactory(registry, serverId, owner);
      const factoryAddress = await factory.getAddress();

      const retrievedServerId = await registry.getServerIdByFactory(
        factoryAddress
      );
      expect(retrievedServerId).to.equal(serverId);
    });

    it("Should return empty string for non-existent factory address", async function () {
      const { registry } = await loadFixture(deployRegistryFixture);
      const signers = await ethers.getSigners();
      // Use a valid signer index (ensure we have enough signers)
      const fakeFactoryIndex = Math.min(19, signers.length - 1);
      const fakeFactory = signers[fakeFactoryIndex];

      const retrievedServerId = await registry.getServerIdByFactory(
        await fakeFactory.getAddress()
      );
      expect(retrievedServerId).to.equal("");
    });

    it("Should check if server factory exists", async function () {
      const { registry } = await loadFixture(deployRegistryFixture);
      const [deployer, owner] = await ethers.getSigners();
      const serverId = "507f1f77bcf86cd799439015";

      expect(await registry.isServerFactoryExists(serverId)).to.be.false;

      await createServerFactory(registry, serverId, owner);

      expect(await registry.isServerFactoryExists(serverId)).to.be.true;
    });
  });

  describe("Edge Cases", function () {
    it("Should revert when creating factory with empty serverId", async function () {
      const { registry } = await loadFixture(deployRegistryFixture);
      const [deployer, owner] = await ethers.getSigners();
      const ownerAddress = await owner.getAddress();

      await expect(
        registry.connect(deployer).createFactoryForServer("", ownerAddress)
      ).to.be.revertedWith("ServerAirdropRegistry: serverId cannot be empty");
    });

    it("Should revert when creating factory with zero owner address", async function () {
      const { registry } = await loadFixture(deployRegistryFixture);
      const [deployer] = await ethers.getSigners();
      const serverId = "507f1f77bcf86cd799439016";

      await expect(
        registry
          .connect(deployer)
          .createFactoryForServer(serverId, ethers.ZeroAddress)
      ).to.be.revertedWith("ServerAirdropRegistry: owner cannot be zero");
    });

    it("Should revert when creating factory with duplicate serverId", async function () {
      const { registry } = await loadFixture(deployRegistryFixture);
      const [deployer, owner1, owner2] = await ethers.getSigners();
      const serverId = "507f1f77bcf86cd799439017";

      await createServerFactory(registry, serverId, owner1);

      const owner2Address = await owner2.getAddress();
      await expect(
        registry
          .connect(deployer)
          .createFactoryForServer(serverId, owner2Address)
      ).to.be.revertedWith("ServerAirdropRegistry: factory already exists");
    });

    it("Should allow anyone to create factory for any serverId", async function () {
      const { registry } = await loadFixture(deployRegistryFixture);
      const signers = await ethers.getSigners();
      // Use a valid signer index (ensure we have enough signers)
      const anyoneIndex = Math.min(19, signers.length - 1);
      const anyone = signers[anyoneIndex];
      const serverId = "507f1f77bcf86cd799439018";
      const ownerAddress = await anyone.getAddress();

      // Permissionless: anyone can create
      await expect(
        registry.connect(anyone).createFactoryForServer(serverId, ownerAddress)
      ).to.not.be.reverted;
    });
  });

  describe("Event Emissions", function () {
    it("Should emit FactoryCreated event with all details", async function () {
      const { registry } = await loadFixture(deployRegistryFixture);
      const [deployer, owner] = await ethers.getSigners();
      const serverId = "507f1f77bcf86cd799439019";
      const ownerAddress = await owner.getAddress();

      const tx = await registry
        .connect(deployer)
        .createFactoryForServer(serverId, ownerAddress);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);

      // Verify all event parameters
      await expect(tx)
        .to.emit(registry, "FactoryCreated")
        .withArgs(
          (factoryAddress: string) => factoryAddress !== ethers.ZeroAddress,
          serverId,
          ownerAddress,
          deployer.address,
          block!.timestamp,
          receipt!.blockNumber,
          await registry.factoryImplementation(),
          await registry.merkleAirdropImplementation()
        );
    });

    it("Should emit separate events for different servers", async function () {
      const { registry } = await loadFixture(deployRegistryFixture);
      const [deployer, owner1, owner2] = await ethers.getSigners();
      const serverIds = generateServerIds(2);

      const tx1 = await registry
        .connect(deployer)
        .createFactoryForServer(serverIds[0], await owner1.getAddress());

      const tx2 = await registry
        .connect(deployer)
        .createFactoryForServer(serverIds[1], await owner2.getAddress());

      // Verify both events are emitted
      await expect(tx1)
        .to.emit(registry, "FactoryCreated")
        .withArgs(
          (factory: string) => factory !== ethers.ZeroAddress,
          serverIds[0],
          await owner1.getAddress(),
          deployer.address,
          (timestamp: number) => timestamp > 0,
          (blockNum: number) => blockNum > 0,
          await registry.factoryImplementation(),
          await registry.merkleAirdropImplementation()
        );

      await expect(tx2)
        .to.emit(registry, "FactoryCreated")
        .withArgs(
          (factory: string) => factory !== ethers.ZeroAddress,
          serverIds[1],
          await owner2.getAddress(),
          deployer.address,
          (timestamp: number) => timestamp > 0,
          (blockNum: number) => blockNum > 0,
          await registry.factoryImplementation(),
          await registry.merkleAirdropImplementation()
        );
    });
  });
});
