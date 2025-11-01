// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "./interfaces/IServerAirdropRegistry.sol";
import "./interfaces/IAirdropFactory.sol";
import "./AirdropFactory.sol";

/**
 * @title ServerAirdropRegistry
 * @dev Registry contract that manages Factory clones for each server
 * @notice Top-level contract in the airdrop hierarchy that creates Factory clones per server
 *
 * ARCHITECTURE:
 * =============
 * Registry Contract
 *     ↓ (creates Factory clones via EIP-1167)
 * Factory Clone (serverId: "mongodb_id_123")
 *     ↓ (creates MerkleAirdrop campaigns via direct deployment)
 * Campaign #1, Campaign #2, Campaign #3, ...
 *
 * USAGE:
 * ======
 * 1. Deploy Registry with Factory and MerkleAirdrop implementations
 * 2. Call createFactoryForServer(serverId, owner) to create a Factory clone
 * 3. Users interact with their Factory clone to create airdrop campaigns
 *
 * @custom:gas-optimization Using EIP-1167 clones saves ~95% gas vs full deployment
 * @custom:indexing Events include all details for The Graph subgraph indexing
 *
 * @author DeHive
 */
contract ServerAirdropRegistry is IServerAirdropRegistry {
    using Clones for address;

    /**
     * @dev Address of the AirdropFactory implementation contract
     * @notice This is the implementation that gets cloned for each server
     */
    address public immutable override factoryImplementation;

    /**
     * @dev Address of the MerkleAirdrop implementation contract
     * @notice This is passed to Factory clones for creating airdrop campaigns
     */
    address public immutable override merkleAirdropImplementation;

    /**
     * @dev Mapping from serverId (MongoDB _id) to Factory clone address
     * @notice Each server gets exactly one Factory clone
     */
    mapping(string => address) private _serverIdToFactory;

    /**
     * @dev Reverse mapping from Factory address to serverId
     * @notice Used for reverse lookups and validation
     */
    mapping(address => string) private _factoryToServerId;

    /**
     * @dev Array of all Factory clones created
     * @notice Used for enumeration and analytics
     */
    address[] private _allFactories;

    /**
     * @dev Constructor that sets implementation addresses
     * @param factoryImplementation_ Address of the AirdropFactory implementation contract
     * @param merkleAirdropImplementation_ Address of the MerkleAirdrop implementation contract
     * @notice Both implementations must be deployed before creating the Registry
     *
     * @custom:example
     * ```solidity
     * // Deploy implementations first
     * address factoryImpl = address(new AirdropFactory(address(0)));
     * address merkleImpl = address(new MerkleAirdrop(...));
     *
     * // Then deploy registry
     * address registry = address(new ServerAirdropRegistry(factoryImpl, merkleImpl));
     * ```
     */
    constructor(
        address factoryImplementation_,
        address merkleAirdropImplementation_
    ) {
        require(
            factoryImplementation_ != address(0),
            "ServerAirdropRegistry: factory implementation cannot be zero"
        );
        require(
            merkleAirdropImplementation_ != address(0),
            "ServerAirdropRegistry: merkle airdrop implementation cannot be zero"
        );

        factoryImplementation = factoryImplementation_;
        merkleAirdropImplementation = merkleAirdropImplementation_;
    }

    /**
     * @notice Create a Factory clone for a server
     * @param serverId MongoDB _id string identifier for the server
     * @param owner Address that will own the Factory clone
     * @return factory Address of the created Factory clone
     * @dev This function creates a minimal proxy clone of the Factory implementation
     *      and initializes it with the serverId and owner
     * @dev Emits FactoryCreated event with all details for The Graph indexing
     * @dev Permissionless: anyone can create a Factory for any serverId
     *
     * @custom:example
     * ```solidity
     * // Create factory for server with MongoDB _id "507f1f77bcf86cd799439011"
     * address factory = registry.createFactoryForServer(
     *     "507f1f77bcf86cd799439011", // MongoDB server _id
     *     0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0 // owner address
     * );
     * ```
     *
     * @custom:reverts "ServerAirdropRegistry: serverId cannot be empty" if serverId is empty
     * @custom:reverts "ServerAirdropRegistry: owner cannot be zero" if owner is zero address
     * @custom:reverts "ServerAirdropRegistry: factory already exists" if factory already exists for serverId
     */
    function createFactoryForServer(
        string memory serverId,
        address owner
    ) external override returns (address factory) {
        require(
            bytes(serverId).length > 0,
            "ServerAirdropRegistry: serverId cannot be empty"
        );
        require(
            owner != address(0),
            "ServerAirdropRegistry: owner cannot be zero"
        );
        require(
            _serverIdToFactory[serverId] == address(0),
            "ServerAirdropRegistry: factory already exists"
        );

        // Clone the factory implementation using EIP-1167 minimal proxy
        factory = factoryImplementation.clone();

        // Initialize the clone with serverId, implementation, and owner
        IAirdropFactory(factory).initialize(
            merkleAirdropImplementation,
            serverId,
            owner
        );

        // Store mappings for lookup
        _serverIdToFactory[serverId] = factory;
        _factoryToServerId[factory] = serverId;
        _allFactories.push(factory);

        // Emit detailed event for The Graph indexing (event defined in interface)
        emit IServerAirdropRegistry.FactoryCreated(
            factory,
            serverId,
            owner,
            msg.sender,
            block.timestamp,
            block.number,
            factoryImplementation,
            merkleAirdropImplementation
        );
    }

    /**
     * @notice Get the Factory address for a given serverId
     * @param serverId MongoDB _id string identifier for the server
     * @return factory Address of the Factory clone, or address(0) if not exists
     * @dev Returns address(0) if no factory exists for the serverId
     *
     * @custom:example
     * ```solidity
     * address factory = registry.getFactoryByServerId("507f1f77bcf86cd799439011");
     * if (factory != address(0)) {
     *     // Factory exists, use it to create campaigns
     * }
     * ```
     */
    function getFactoryByServerId(
        string memory serverId
    ) external view override returns (address factory) {
        return _serverIdToFactory[serverId];
    }

    /**
     * @notice Check if a Factory exists for a given serverId
     * @param serverId MongoDB _id string identifier for the server
     * @return exists True if factory exists, false otherwise
     * @dev Helper function to check existence without returning address
     *
     * @custom:example
     * ```solidity
     * if (registry.isServerFactoryExists("507f1f77bcf86cd799439011")) {
     *     // Factory exists
     * }
     * ```
     */
    function isServerFactoryExists(
        string memory serverId
    ) external view override returns (bool exists) {
        return _serverIdToFactory[serverId] != address(0);
    }

    /**
     * @notice Get the serverId for a given Factory address
     * @param factory Address of the Factory clone
     * @return serverId MongoDB _id string identifier, or empty string if not found
     * @dev Reverse lookup: get serverId from factory address
     * @dev Returns empty string if factory is not registered
     *
     * @custom:example
     * ```solidity
     * string memory serverId = registry.getServerIdByFactory(0x1234...);
     * // Use serverId for database queries or validation
     * ```
     */
    function getServerIdByFactory(
        address factory
    ) external view override returns (string memory serverId) {
        return _factoryToServerId[factory];
    }

    /**
     * @notice Get the total number of factories created
     * @return count Total number of Factory clones created
     * @dev Useful for enumeration and analytics
     *
     * @custom:example
     * ```solidity
     * uint256 count = registry.getFactoryCount();
     * // Display count in UI or use for pagination
     * ```
     */
    function getFactoryCount() external view override returns (uint256 count) {
        return _allFactories.length;
    }

    /**
     * @notice Get all factory addresses
     * @return factories Array of all Factory clone addresses
     * @dev Returns all factories created through this registry
     * @dev Use with caution on large arrays due to gas costs
     *
     * @custom:example
     * ```solidity
     * address[] memory factories = registry.getAllFactories();
     * // Iterate over factories for analytics or UI display
     * ```
     */
    function getAllFactories()
        external
        view
        override
        returns (address[] memory factories)
    {
        return _allFactories;
    }
}
