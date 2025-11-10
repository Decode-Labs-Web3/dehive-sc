// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IDehiveProxy
 * @dev Main interface for the Dehive Proxy implementing the Diamond Pattern
 *
 * DIAMOND PATTERN OVERVIEW:
 * ========================
 * The Diamond pattern is a proxy pattern that allows a single contract to delegate
 * function calls to multiple implementation contracts (called "facets"). This enables:
 *
 * 1. MODULARITY: Different functionality in separate contracts
 * 2. UPGRADABILITY: Individual facets can be upgraded without affecting others
 * 3. SIZE LIMITS: Bypasses Ethereum's 24KB contract size limit
 * 4. GAS EFFICIENCY: Only deploy what you need, when you need it
 *
 * HOW IT WORKS:
 * =============
 * 1. Proxy stores a mapping: functionSelector => facetAddress
 * 2. When a function is called, proxy looks up which facet handles it
 * 3. Proxy delegates the call to the appropriate facet using delegatecall
 * 4. Facet executes the function using the proxy's storage
 *
 * FACET MANAGEMENT:
 * ================
 * Facets can be Added, Upgraded, or Removed:
 * - ADD: New facet with new functions
 * - UPGRADE: Replace existing facet with new implementation
 * - REMOVE: Remove functions from the proxy
 *
 * SECURITY MODEL:
 * ==============
 * - Only the proxy owner can manage facets
 * - Function selectors must be unique across all facets
 * - Facet upgrades maintain storage compatibility
 * - Ownership can be transferred to new addresses
 *
 * @author DeHive
 */
interface IDehiveProxy {
  // ========== PROXY INITIALIZATION ==========
  // Functions for initializing the proxy (alternative to constructor)

  /**
   * @dev Initialize the proxy (alternative to constructor)
   * @param _init Address of the first facet to initialize (optional)
   *
   * PURPOSE:
   * - Allows for more complex initialization logic than constructor
   * - Can initialize the first facet during proxy setup
   * - Sets the caller as the proxy owner
   *
   * PROCESS:
   * 1. Check proxy hasn't been initialized yet
   * 2. Set the caller as owner
   * 3. If _init is provided, call its init() function via delegatecall
   *
   * NOTE: This is typically not used in our case since we use constructor
   */
  function construct(address _init) external;

  // ========== FACET MANAGEMENT ==========
  // Core functions for managing facets in the Diamond pattern

  /**
   * @dev Event emitted when facets are modified
   * @param facetAddress Address of the facet being modified
   * @param functionSelectors Array of function selectors being affected
   * @param action The type of operation (Add, Upgrade, Remove)
   *
   * USAGE:
   * - Provides transparency for all facet operations
   * - Allows off-chain systems to track proxy state changes
   * - Essential for debugging and monitoring
   */
  event FacetCutEvent(address indexed facetAddress, bytes4[] functionSelectors, FacetCutAction action);

  /**
   * @dev Enum defining the types of facet operations
   *
   * ACTIONS:
   * - Add: Add new functions to the proxy
   * - Upgrade: Replace existing functions with new implementation
   * - Remove: Remove functions from the proxy
   *
   * USAGE:
   * - Used in FacetCutStruct to specify the operation type
   * - Determines how the proxy handles the facet modification
   */
  enum FacetCutAction {
    Add,      // 0: Add new functions
    Upgrade,  // 1: Replace existing functions
    Remove    // 2: Remove functions
  }

  /**
   * @dev Struct defining a facet modification operation
   * @param facetAddress Address of the facet contract
   * @param functionSelectors Array of 4-byte function selectors
   * @param action The type of operation to perform
   *
   * USAGE:
   * - Bundles all information needed for a facet operation
   * - Allows multiple operations in a single transaction
   * - Function selectors are the first 4 bytes of keccak256(function signature)
   */
  struct FacetCutStruct {
    address facetAddress;        // Contract implementing the functions
    bytes4[] functionSelectors;  // Array of function selectors
    FacetCutAction action;       // Type of operation (Add/Upgrade/Remove)
  }

  /**
   * @dev Main function for managing facets - the heart of the Diamond pattern
   * @param _facetCuts Array of facet operations to perform
   * @param _init Address of facet to initialize after cuts (optional)
   * @param _calldata Initialization data for the facet (optional)
   *
   * PROCESS:
   * 1. Loop through each facet cut operation
   * 2. Check the action type and call appropriate internal function
   * 3. Emit event for each operation
   * 4. Initialize new facet if provided
   *
   * SECURITY:
   * - Only proxy owner can call this function
   * - Function selectors must be unique across all facets
   * - Facet addresses must be valid contracts
   *
 * EXAMPLE:
 * ```solidity
 * // Add MessageFacet
 * facetCut([{
 *   facetAddress: 0x1234...,
 *   functionSelectors: [0x412738c8, 0x6eeb9b10, ...],
 *   action: FacetCutAction.Add
 * }], 0x1234..., "0x19ab453c000000000000000000000000...")
 * ```
   */
  function facetCut(FacetCutStruct[] calldata _facetCuts, address _init, bytes calldata _calldata) external;

  // ========== FACET LOUPE ==========
  // "Loupe" functions provide introspection into the Diamond's current state

  /**
   * @dev Struct for returning facet information
   * @param facetAddress Address of the facet contract
   * @param functionSelectors Array of function selectors handled by this facet
   *
   * USAGE:
   * - Used by loupe functions to return facet information
   * - Provides complete view of what functions a facet handles
   */
  struct FacetStruct {
    address facetAddress;        // Contract address
    bytes4[] functionSelectors;  // Functions this facet implements
  }

  /**
   * @dev Returns the first facet and its function selectors
   * @return facetAddress Address of the first facet
   * @return selectors Array of function selectors for the first facet
   *
   * PURPOSE:
   * - Used for compatibility with Diamond standard
   * - Returns information about the first registered facet
   * - Useful for basic introspection
   *
   * NOTE: Returns (address(0), []) if no facets are registered
   */
  function facetsStruct() external view returns (address, bytes4[] memory);

  /**
   * @dev Returns all function selectors for a specific facet
   * @param _facet Address of the facet to query
   * @return Array of function selectors this facet handles
   *
   * USAGE:
   * - Query what functions a specific facet implements
   * - Useful for debugging and verification
   * - Returns empty array if facet is not registered
   */
  function facetFunctionSelectors(address _facet) external view returns (bytes4[] memory);

  /**
   * @dev Returns all facet addresses currently registered
   * @return Array of all facet addresses
   *
   * USAGE:
   * - Get complete list of all facets in the proxy
   * - Useful for enumeration and management
   * - Returns empty array if no facets are registered
   */
  function facetAddresses() external view returns (address[] memory);

  /**
   * @dev Returns which facet handles a specific function
   * @param _functionSelector Function selector to look up (4-byte identifier)
   * @return Address of the facet that handles this function (or address(0) if not found)
   *
   * USAGE:
   * - Find which facet implements a specific function
   * - Essential for debugging function routing
   * - Returns address(0) if function is not registered
   *
 * EXAMPLE:
 * ```solidity
 * address facet = proxy.facetAddress(0x412738c8); // sendMessage selector
 * // Returns the address of the facet that handles sendMessage
 * ```
   */
  function facetAddress(bytes4 _functionSelector) external view returns (address);

  // ========== OWNERSHIP MANAGEMENT ==========
  // Functions for managing proxy ownership (ERC-173 standard)

  /**
   * @dev Returns the current owner of the proxy
   * @return Address of the proxy owner
   *
   * PURPOSE:
   * - Identifies who can manage facets
   * - Follows ERC-173 standard for ownership
   * - Owner has exclusive rights to call facetCut
   */
  function owner() external view returns (address);

  /**
   * @dev Transfers ownership of the proxy to a new address
   * @param newOwner Address of the new owner
   *
   * REQUIREMENTS:
   * - Only current owner can call this function
   * - newOwner cannot be address(0)
   *
   * PROCESS:
   * 1. Verify caller is current owner
   * 2. Verify new owner is not zero address
   * 3. Transfer ownership to new address
   *
   * SECURITY:
   * - Prevents accidental ownership transfer
   * - Ensures proxy always has a valid owner
   * - New owner immediately gains facet management rights
   */
  function transferOwnership(address newOwner) external;

  // ========== FUNDS MANAGEMENT ==========

  /**
   * @dev Event emitted when funds are withdrawn from the proxy
   * @param owner Address of the owner withdrawing funds
   * @param amount Amount withdrawn in wei
   * @param reason Reason for withdrawal
   * @param timestamp Block timestamp of the withdrawal
   *
   * PURPOSE:
   * - Provides transparency for fund withdrawals
   * - Allows off-chain systems to track proxy fund movements
   * - Essential for auditing and monitoring
   */
  event FundsWithdrawn(address indexed owner, uint256 amount, string reason, uint256 timestamp);

  /**
   * @dev Withdraw funds from the proxy contract
   * @param amount Amount to withdraw in wei
   * @param reason Reason for withdrawal (emitted in event)
   *
   * REQUIREMENTS:
   * - Only proxy owner can call this function
   * - amount must be greater than 0
   * - Proxy must have sufficient balance
   *
   * PURPOSE:
   * - Allows owner to recover any ETH sent directly to the proxy
   * - Provides transparency through event emission with reason
   * - Useful for emergency withdrawals or maintenance
   *
   * SECURITY:
   * - Only owner can withdraw funds
   * - Prevents accidental withdrawals with zero amount
   * - Ensures sufficient balance before withdrawal
   *
   * @custom:example
   * ```solidity
   * // Owner withdraws 1 ETH with reason
   * proxy.withdrawFunds(1 ether, "Emergency withdrawal for maintenance");
   * ```
   */
  function withdrawFunds(uint256 amount, string calldata reason) external;
}
