// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IMerkleAirdrop.sol";
import "./interfaces/IAirdropFactory.sol";
import "./MerkleAirdrop.sol";

/**
 * @title AirdropFactory
 * @dev Factory contract for deploying MerkleAirdrop campaign contracts for a specific server
 * @notice Each Factory instance is tied to a server via serverId and can create multiple airdrop campaigns
 * @dev Supports both standalone deployment and clone pattern via initialize() function
 *
 * USAGE:
 * ======
 * 1. Standalone: Deploy with constructor, sets implementation and owner
 * 2. Clone: Deploy via Registry, then initialize() with serverId and owner
 *
 * @custom:architecture Factory creates MerkleAirdrop campaigns via direct deployment
 *                     (MerkleAirdrop uses constructor, so we deploy directly rather than clone)
 */
contract AirdropFactory is IAirdropFactory, Ownable {
    using SafeERC20 for IERC20;

    /**
     * @dev Address of the MerkleAirdrop implementation contract
     * @notice Changed from immutable to storage to support clone pattern
     */
    address public override implementation;

    /**
     * @dev MongoDB _id string identifier for the server this Factory belongs to
     * @notice Set during initialize(), used for event emissions and indexing
     */
    string public override serverId;

    /**
     * @dev Initialization flag to prevent re-initialization
     * @notice Prevents initialize() from being called multiple times on clones
     */
    bool public override initialized;

    /**
     * @dev Constructor for standalone deployment
     * @param implementation_ Address of the MerkleAirdrop implementation contract
     * @notice This constructor is used when deploying Factory as a standalone contract
     * @notice For clone pattern, use empty constructor and call initialize() instead
     */
    constructor(address implementation_) Ownable(msg.sender) {
        if (implementation_ != address(0)) {
            // Standalone mode: initialize immediately
            require(implementation_ != address(0), "AirdropFactory: implementation cannot be zero address");
            implementation = implementation_;
            initialized = true;
        }
        // Clone mode: constructor empty, will call initialize() later
    }

    /**
     * @notice Initialize the Factory clone (for clone pattern)
     * @param implementation_ Address of the MerkleAirdrop implementation to use
     * @param serverId_ MongoDB _id string identifier for the server
     * @param owner_ Address that will own the Factory
     * @dev Can only be called once per clone
     * @dev Sets implementation, serverId, owner, and initialized flag
     * @dev Emits FactoryInitialized event with all details for indexing
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
    ) external override {
        require(!initialized, "AirdropFactory: already initialized");
        require(implementation_ != address(0), "AirdropFactory: implementation cannot be zero");
        require(owner_ != address(0), "AirdropFactory: owner cannot be zero");
        require(bytes(serverId_).length > 0, "AirdropFactory: serverId cannot be empty");

        implementation = implementation_;
        serverId = serverId_;
        initialized = true;
        _transferOwnership(owner_);

        emit FactoryInitialized(
            address(this),
            serverId_,
            owner_,
            implementation_,
            block.timestamp
        );
    }

    /**
     * @notice Create a new airdrop campaign and fund it in a single transaction
     * @param token Address of the ERC20 token being airdropped
     * @param merkleRoot Root of the Merkle tree for claim verification
     * @param metadataURI URI containing claim data and metadata
     * @param totalAmount Total amount of tokens to fund the airdrop
     * @return campaign Address of the deployed airdrop campaign contract
     * @dev This function deploys a new MerkleAirdrop contract and transfers tokens to it
     * @dev Emits AirdropCampaignCreated event with all details for The Graph indexing
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
    ) external override returns (address campaign) {
        require(initialized, "AirdropFactory: not initialized");
        require(token != address(0), "AirdropFactory: token cannot be zero address");
        require(merkleRoot != bytes32(0), "AirdropFactory: merkle root cannot be zero");
        require(totalAmount > 0, "AirdropFactory: total amount must be greater than zero");

        // Deploy a new MerkleAirdrop contract (direct deployment, not clone)
        // Note: We deploy directly instead of using clone since MerkleAirdrop uses constructor
        campaign = address(new MerkleAirdrop(
            token,
            msg.sender,
            merkleRoot,
            metadataURI,
            totalAmount
        ));

        // Transfer tokens from creator to the airdrop contract
        IERC20(token).safeTransferFrom(msg.sender, campaign, totalAmount);

        // Emit detailed event for The Graph indexing
        emit AirdropCampaignCreated(
            campaign,
            msg.sender,
            serverId,
            address(this),
            token,
            merkleRoot,
            metadataURI,
            totalAmount,
            block.timestamp,
            block.number
        );
    }

    /**
     * @dev Predict the address of a clone before deployment
     * @param salt Salt for deterministic address generation
     * @return predictedAddress Predicted address of the clone
     */
    function predictCloneAddress(bytes32 salt) external view returns (address predictedAddress) {
        return Clones.predictDeterministicAddress(implementation, salt, address(this));
    }

    /**
     * @notice Create a deterministic airdrop campaign using a salt
     * @param token Address of the ERC20 token being airdropped
     * @param merkleRoot Root of the Merkle tree for claim verification
     * @param metadataURI URI containing claim data and metadata
     * @param totalAmount Total amount of tokens to fund the airdrop
     * @return campaign Address of the deployed airdrop campaign contract
     * @dev Note: CREATE2 would be needed for truly deterministic deployment with constructor
     * @dev Currently uses same logic as createAirdropAndFund since MerkleAirdrop uses constructor
     * @dev Emits AirdropCampaignCreated event with all details for The Graph indexing
     */
    function createDeterministicAirdropAndFund(
        bytes32 /* salt */,
        address token,
        bytes32 merkleRoot,
        string calldata metadataURI,
        uint256 totalAmount
    ) external returns (address campaign) {
        require(initialized, "AirdropFactory: not initialized");
        require(token != address(0), "AirdropFactory: token cannot be zero address");
        require(merkleRoot != bytes32(0), "AirdropFactory: merkle root cannot be zero");
        require(totalAmount > 0, "AirdropFactory: total amount must be greater than zero");

        // Deploy a new MerkleAirdrop contract (direct deployment, not clone)
        campaign = address(new MerkleAirdrop(
            token,
            msg.sender,
            merkleRoot,
            metadataURI,
            totalAmount
        ));

        // Transfer tokens from creator to the airdrop contract
        IERC20(token).safeTransferFrom(msg.sender, campaign, totalAmount);

        // Emit detailed event for The Graph indexing
        emit AirdropCampaignCreated(
            campaign,
            msg.sender,
            serverId,
            address(this),
            token,
            merkleRoot,
            metadataURI,
            totalAmount,
            block.timestamp,
            block.number
        );
    }

    /**
     * @notice Get the serverId associated with this Factory
     * @return serverId MongoDB _id string identifier for the server
     * @dev Returns the serverId this Factory was initialized with
     * @dev Returns empty string if Factory is in standalone mode (no serverId)
     */
    function getServerId() external view override returns (string memory) {
        return serverId;
    }

    /**
     * @notice Get the MerkleAirdrop implementation address
     * @return implementation Address of the MerkleAirdrop implementation
     * @dev Returns the implementation address used to create campaigns
     */
    function getImplementation() external view returns (address) {
        return implementation;
    }
}
