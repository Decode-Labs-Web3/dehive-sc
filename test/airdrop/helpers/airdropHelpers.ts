import { ethers } from "hardhat";
import {
  ServerAirdropRegistry,
  AirdropFactory,
  MerkleAirdrop,
  MockERC20,
} from "../../../typechain-types";
import { ClaimData, MerkleTreeData, generateMerkleTree } from "./merkleHelpers";
import { Signer } from "ethers";

/**
 * Airdrop Test Fixture Helpers
 *
 * Utilities for deploying contracts and creating test scenarios
 */

export interface RegistryFixture {
  registry: ServerAirdropRegistry;
  factoryImplementation: AirdropFactory;
  merkleAirdropImplementation: MerkleAirdrop;
  deployer: Signer;
  deployerAddress: string;
}

export interface FactoryFixture {
  factory: AirdropFactory;
  serverId: string;
  owner: Signer;
  ownerAddress: string;
  implementation: string;
}

export interface CampaignFixture {
  campaign: MerkleAirdrop;
  token: MockERC20;
  merkleTreeData: MerkleTreeData;
  owner: Signer;
  ownerAddress: string;
  creator: Signer;
  creatorAddress: string;
}

/**
 * Deploy Registry and implementations fixture
 */
export async function deployAirdropRegistryFixture(): Promise<RegistryFixture> {
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();

  // Deploy MerkleAirdrop implementation
  // MerkleAirdrop uses constructor, so we deploy it as implementation with dummy values
  const MockERC20Factory = await ethers.getContractFactory("MockERC20");
  const dummyToken = await MockERC20Factory.deploy(
    "Dummy Token",
    "DUMMY",
    18,
    ethers.parseEther("1000000")
  );
  await dummyToken.waitForDeployment();

  const MerkleAirdropFactory = await ethers.getContractFactory("MerkleAirdrop");
  // Deploy MerkleAirdrop with dummy values - this will be used as implementation
  // The actual campaigns are deployed via Factory.createAirdropAndFund
  const merkleAirdropImplementation = await MerkleAirdropFactory.deploy(
    await dummyToken.getAddress(),
    deployerAddress,
    ethers.keccak256("0x00"), // Dummy merkle root
    "ipfs://dummy",
    ethers.parseEther("1000")
  );
  await merkleAirdropImplementation.waitForDeployment();

  // Deploy AirdropFactory implementation (pass address(0) for clone mode)
  const AirdropFactoryFactory = await ethers.getContractFactory(
    "AirdropFactory"
  );
  const factoryImplementation = await AirdropFactoryFactory.deploy(
    ethers.ZeroAddress
  );
  await factoryImplementation.waitForDeployment();

  // Deploy Registry
  const RegistryFactory = await ethers.getContractFactory(
    "ServerAirdropRegistry"
  );
  const registry = await RegistryFactory.deploy(
    await factoryImplementation.getAddress(),
    await merkleAirdropImplementation.getAddress()
  );
  await registry.waitForDeployment();

  return {
    registry,
    factoryImplementation,
    merkleAirdropImplementation,
    deployer,
    deployerAddress,
  };
}

/**
 * Create a server factory via Registry
 */
export async function createServerFactory(
  registry: ServerAirdropRegistry,
  serverId: string,
  owner: Signer
): Promise<AirdropFactory> {
  const ownerAddress = await owner.getAddress();

  const tx = await registry
    .connect(owner)
    .createFactoryForServer(serverId, ownerAddress);
  const receipt = await tx.wait();

  // Extract factory address from event
  const factoryCreatedEvent = receipt?.logs.find((log) => {
    try {
      const parsed = registry.interface.parseLog(log as any);
      return parsed?.name === "FactoryCreated";
    } catch {
      return false;
    }
  });

  if (!factoryCreatedEvent) {
    throw new Error("FactoryCreated event not found");
  }

  const parsed = registry.interface.parseLog(factoryCreatedEvent as any);
  const factoryAddress = parsed?.args[0]; // First arg is factory address

  const AirdropFactoryFactory = await ethers.getContractFactory(
    "AirdropFactory"
  );
  return AirdropFactoryFactory.attach(
    factoryAddress
  ) as unknown as AirdropFactory;
}

/**
 * Create a test campaign via Factory
 */
export async function createTestCampaign(
  factory: AirdropFactory,
  token: MockERC20,
  claims: ClaimData[],
  creator: Signer,
  metadataURI: string = "ipfs://test"
): Promise<{ campaign: MerkleAirdrop; merkleTreeData: MerkleTreeData }> {
  const creatorAddress = await creator.getAddress();

  // Generate Merkle tree
  const merkleTreeData = generateMerkleTree(claims);

  // Calculate total amount
  const totalAmount = claims.reduce((sum, claim) => {
    const amount =
      typeof claim.amount === "string" ? BigInt(claim.amount) : claim.amount;
    return sum + amount;
  }, BigInt(0));

  // Approve tokens to factory (creator must approve first)
  const tokenAddress = await token.getAddress();
  await token.connect(creator).approve(await factory.getAddress(), totalAmount);

  // Create campaign
  const tx = await factory
    .connect(creator)
    .createAirdropAndFund(
      tokenAddress,
      merkleTreeData.root,
      metadataURI,
      totalAmount
    );
  const receipt = await tx.wait();

  // Extract campaign address from event
  const campaignCreatedEvent = receipt?.logs.find((log) => {
    try {
      const parsed = factory.interface.parseLog(log as any);
      return parsed?.name === "AirdropCampaignCreated";
    } catch {
      return false;
    }
  });

  if (!campaignCreatedEvent) {
    throw new Error("AirdropCampaignCreated event not found");
  }

  const parsed = factory.interface.parseLog(campaignCreatedEvent as any);
  const campaignAddress = parsed?.args[0]; // First arg is campaign address

  const MerkleAirdropFactory = await ethers.getContractFactory("MerkleAirdrop");
  const campaign = MerkleAirdropFactory.attach(
    campaignAddress
  ) as unknown as MerkleAirdrop;

  return {
    campaign,
    merkleTreeData,
  };
}

/**
 * Deploy a test MockERC20 token
 */
export async function deployMockERC20(
  name: string = "Test Token",
  symbol: string = "TEST",
  decimals: number = 18,
  initialSupply: bigint = ethers.parseEther("1000000")
): Promise<MockERC20> {
  const [deployer] = await ethers.getSigners();
  const MockERC20Factory = await ethers.getContractFactory("MockERC20");
  const token = await MockERC20Factory.deploy(
    name,
    symbol,
    decimals,
    initialSupply
  );
  await token.waitForDeployment();
  return token;
}

/**
 * Mint tokens to an address (using token owner)
 */
export async function mintTokensTo(
  token: MockERC20,
  to: Signer,
  amount: bigint
): Promise<void> {
  const [owner] = await ethers.getSigners();
  const toAddress = await to.getAddress();
  // Use explicit function signature to avoid ambiguity with mint(uint256)
  await token.connect(owner)["mint(address,uint256)"](toAddress, amount);
}

/**
 * Deploy complete airdrop system fixture (Registry + Factory + Campaign)
 */
export async function deployCompleteAirdropFixture(
  serverId: string,
  claims: ClaimData[],
  serverOwner?: Signer,
  campaignCreator?: Signer
): Promise<{
  registry: ServerAirdropRegistry;
  factory: AirdropFactory;
  campaign: MerkleAirdrop;
  token: MockERC20;
  merkleTreeData: MerkleTreeData;
}> {
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const owner = serverOwner || signers[1];
  const creator = campaignCreator || signers[2];

  // Deploy Registry
  const registryFixture = await deployAirdropRegistryFixture();
  const { registry } = registryFixture;

  // Create server factory
  const factory = await createServerFactory(registry, serverId, owner);

  // Deploy token and mint to creator
  const token = await deployMockERC20();
  const totalAmount = claims.reduce((sum, claim) => {
    const amount =
      typeof claim.amount === "string" ? BigInt(claim.amount) : claim.amount;
    return sum + amount;
  }, BigInt(0));
  await mintTokensTo(token, creator, totalAmount);

  // Create campaign
  const { campaign, merkleTreeData } = await createTestCampaign(
    factory,
    token,
    claims,
    creator
  );

  return {
    registry,
    factory,
    campaign,
    token,
    merkleTreeData,
  };
}
