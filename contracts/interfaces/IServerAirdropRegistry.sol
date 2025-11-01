// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IServerAirdropRegistry
 * @dev Interface for the Server Airdrop Registry contract
 * @notice This registry manages Factory contract clones for each server in the platform
 * @dev Each server gets its own Factory clone that can create multiple airdrop campaigns
 */
interface IServerAirdropRegistry {
    /**
     * @dev Emitted when a Factory clone is created for a server
     * @param factory Address of the created Factory clone
     * @param serverId MongoDB _id string identifier for the server
     * @param owner Address that owns the Factory clone
     * @param creator Address that called createFactoryForServer
     * @param timestamp Block timestamp when factory was created
     * @param blockNumber Block number when factory was created
     * @param factoryImplementation Address of the Factory implementation used for cloning
     * @param merkleAirdropImplementation Address of the MerkleAirdrop implementation
     * @notice Only factory, serverId, and owner are indexed (max 3 indexed params in Solidity)
     */
    event FactoryCreated(
        address indexed factory,
        string indexed serverId,
        address indexed owner,
        address creator,
        uint256 timestamp,
        uint256 blockNumber,
        address factoryImplementation,
        address merkleAirdropImplementation
    );

    /**
     * @notice Create a Factory clone for a server
     * @param serverId MongoDB _id string identifier for the server
     * @param owner Address that will own the Factory clone
     * @return factory Address of the created Factory clone
     * @dev This function creates a minimal proxy clone of the Factory implementation
     *      and initializes it with the serverId and owner
     * @dev Emits FactoryCreated event with all details for indexing
     *
     * @custom:example
     * ```solidity
     * // Create factory for server with MongoDB _id "507f1f77bcf86cd799439011"
     * address factory = registry.createFactoryForServer(
     *     "507f1f77bcf86cd799439011",
     *     0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0
     * );
     * ```
     */
    function createFactoryForServer(
        string memory serverId,
        address owner
    ) external returns (address factory);

    /**
     * @notice Get the Factory address for a given serverId
     * @param serverId MongoDB _id string identifier for the server
     * @return factory Address of the Factory clone, or address(0) if not exists
     * @dev Returns address(0) if no factory exists for the serverId
     */
    function getFactoryByServerId(
        string memory serverId
    ) external view returns (address factory);

    /**
     * @notice Check if a Factory exists for a given serverId
     * @param serverId MongoDB _id string identifier for the server
     * @return exists True if factory exists, false otherwise
     * @dev Helper function to check existence without returning address
     */
    function isServerFactoryExists(
        string memory serverId
    ) external view returns (bool exists);

    /**
     * @notice Get the serverId for a given Factory address
     * @param factory Address of the Factory clone
     * @return serverId MongoDB _id string identifier, or empty string if not found
     * @dev Reverse lookup: get serverId from factory address
     * @dev Returns empty string if factory is not registered
     */
    function getServerIdByFactory(
        address factory
    ) external view returns (string memory serverId);

    /**
     * @notice Get the total number of factories created
     * @return count Total number of Factory clones created
     * @dev Useful for enumeration and analytics
     */
    function getFactoryCount() external view returns (uint256 count);

    /**
     * @notice Get all factory addresses
     * @return factories Array of all Factory clone addresses
     * @dev Returns all factories created through this registry
     * @dev Use with caution on large arrays due to gas costs
     */
    function getAllFactories() external view returns (address[] memory factories);

    /**
     * @notice Get the Factory implementation address
     * @return implementation Address of the Factory implementation contract
     * @dev This is the implementation that gets cloned for each server
     */
    function factoryImplementation() external view returns (address);

    /**
     * @notice Get the MerkleAirdrop implementation address
     * @return implementation Address of the MerkleAirdrop implementation contract
     * @dev This is passed to Factory clones for creating airdrop campaigns
     */
    function merkleAirdropImplementation() external view returns (address);
}
