// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IAirdropFactory
 * @dev Interface for the Airdrop Factory contract
 * @notice Factory contract that creates MerkleAirdrop campaign clones for a server
 * @dev Each Factory instance is tied to a specific server via serverId
 */
interface IAirdropFactory {
    /**
     * @dev Emitted when a new airdrop campaign is created
     * @param campaign Address of the deployed airdrop campaign contract
     * @param creator Address of the campaign creator
     * @param serverId MongoDB _id string identifier for the server
     * @param factory Address of the Factory that created this campaign
     * @param token Address of the ERC20 token being airdropped
     * @param merkleRoot Root of the Merkle tree for claim verification
     * @param metadataURI URI containing claim data and metadata
     * @param totalAmount Total amount of tokens in the airdrop campaign
     * @param timestamp Block timestamp when campaign was created
     * @param blockNumber Block number when campaign was created
     * @notice Only campaign, creator, and serverId are indexed (max 3 indexed params in Solidity)
     */
    event AirdropCampaignCreated(
        address indexed campaign,
        address indexed creator,
        string indexed serverId,
        address factory,
        address token,
        bytes32 merkleRoot,
        string metadataURI,
        uint256 totalAmount,
        uint256 timestamp,
        uint256 blockNumber
    );

    /**
     * @dev Emitted when Factory is initialized
     * @param factory Address of the Factory being initialized
     * @param serverId MongoDB _id string identifier for the server
     * @param owner Address that owns the Factory
     * @param implementation Address of MerkleAirdrop implementation
     * @param timestamp Block timestamp when factory was initialized
     */
    event FactoryInitialized(
        address indexed factory,
        string indexed serverId,
        address indexed owner,
        address implementation,
        uint256 timestamp
    );

    /**
     * @notice Initialize the Factory clone
     * @param implementation_ Address of the MerkleAirdrop implementation to use
     * @param serverId_ MongoDB _id string identifier for the server
     * @param owner_ Address that will own the Factory
     * @dev Can only be called once per clone
     * @dev Emits FactoryInitialized event with all details
     *
     * @custom:example
     * ```solidity
     * // Initialize factory clone after deployment
     * factory.initialize(
     *     0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0, // MerkleAirdrop impl
     *     "507f1f77bcf86cd799439011", // serverId
     *     0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0  // owner
     * );
     * ```
     */
    function initialize(
        address implementation_,
        string memory serverId_,
        address owner_
    ) external;

    /**
     * @notice Create a new airdrop campaign and fund it in a single transaction
     * @param token Address of the ERC20 token being airdropped
     * @param merkleRoot Root of the Merkle tree for claim verification
     * @param metadataURI URI containing claim data and metadata
     * @param totalAmount Total amount of tokens to fund the airdrop
     * @return campaign Address of the deployed airdrop campaign contract
     * @dev This function deploys a new MerkleAirdrop contract and transfers tokens to it
     * @dev Emits AirdropCampaignCreated event with all details for indexing
     *
     * @custom:example
     * ```solidity
     * // Create and fund an airdrop campaign
     * address campaign = factory.createAirdropAndFund(
     *     0x1234..., // token address
     *     0xabcd..., // merkle root
     *     "ipfs://Qm...", // metadata URI
     *     1000000 * 10**18 // total amount (1M tokens)
     * );
     * ```
     */
    function createAirdropAndFund(
        address token,
        bytes32 merkleRoot,
        string calldata metadataURI,
        uint256 totalAmount
    ) external returns (address campaign);

    /**
     * @notice Get the serverId associated with this Factory
     * @return serverId MongoDB _id string identifier for the server
     * @dev Returns the serverId this Factory was initialized with
     */
    function getServerId() external view returns (string memory serverId);

    /**
     * @notice Get the MerkleAirdrop implementation address
     * @return implementation Address of the MerkleAirdrop implementation
     * @dev Returns the implementation address used to create campaigns
     */
    function implementation() external view returns (address);

    /**
     * @notice Check if Factory has been initialized
     * @return initialized True if initialized, false otherwise
     * @dev Helper function to check initialization status
     */
    function initialized() external view returns (bool);

    /**
     * @notice Get the serverId associated with this Factory
     * @return serverId MongoDB _id string identifier for the server
     * @dev Returns the serverId this Factory was initialized with
     */
    function serverId() external view returns (string memory);
}
