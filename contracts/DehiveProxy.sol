// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./interfaces/DehiveProxy.sol";

/**
 * @title DehiveProxy
 * @dev Diamond proxy contract for Dehive system using Diamond pattern
 *
 * DIAMOND PATTERN EXPLANATION:
 * ============================
 * The Diamond pattern allows a single proxy contract to delegate function calls
 * to multiple implementation contracts (called "facets"). This enables:
 *
 * 1. MODULARITY: Different functionality can be in separate contracts
 * 2. UPGRADABILITY: Individual facets can be upgraded without affecting others
 * 3. SIZE LIMITS: Bypasses Ethereum's 24KB contract size limit
 * 4. GAS EFFICIENCY: Only deploy what you need, when you need it
 *
 * HOW IT WORKS:
 * =============
 * 1. Proxy stores a mapping: functionSelector => facetAddress
 * 2. When a function is called, proxy looks up which facet handles it
 * 3. Proxy delegates the call to the appropriate facet
 * 4. Facet executes the function using the proxy's storage
 *
 * FACET MANAGEMENT:
 * ================
 * Facets can be Added, Upgraded, or Removed:
 * - ADD: New facet with new functions
 * - UPGRADE: Replace existing facet with new implementation
 * - REMOVE: Remove functions from the proxy
 *
 * @author DeHive
 */
contract DehiveProxy is IDehiveProxy {
    // ========== STORAGE ==========

    /**
     * @dev Owner of the proxy - only this address can manage facets
     * This is separate from facet-specific owners (e.g., Message facet relayer)
     */
    address private _owner;

    /**
     * @dev Core mapping that routes function calls to facets
     * Key: Function selector (first 4 bytes of function signature)
     * Value: Address of the facet that implements this function
     *
     * Example: createProfile(bytes32) => 0x412738c8 => 0x1234... (facet address)
     */
    mapping(bytes4 => address) private _selectorToFacet;

    /**
     * @dev Array of all facet addresses currently registered
     * Used for enumeration and management
     */
    address[] private _facetAddresses;

    /**
     * @dev Reverse mapping: facet address => array of function selectors it handles
     * Used for facet management (upgrade, remove operations)
     *
     * Example: 0x1234... => [0x412738c8, 0x6eeb9b10, ...]
     */
    mapping(address => bytes4[]) private _facetToSelectors;

    // ========== MODIFIERS ==========

    modifier onlyOwner() {
        require(msg.sender == _owner, "Only owner can call this function");
        _;
    }

    // ========== CONSTRUCTOR ==========

    constructor() {
        _owner = msg.sender;
    }

    // ========== INITIALIZATION ==========

    /**
     * @dev Initialize the proxy (alternative to constructor)
     * This allows for more complex initialization logic
     *
     * @param _init Address of the first facet to initialize (optional)
     *
     * PROCESS:
     * 1. Check proxy hasn't been initialized yet
     * 2. Set the caller as owner
     * 3. If _init is provided, call its init() function via delegatecall
     *
     * NOTE: This is typically not used in our case since we use constructor
     */
    function construct(address _init) external override {
        require(_owner == address(0), "Already initialized");
        _owner = msg.sender;

        if (_init != address(0)) {
            // Initialize the first facet if provided
            // delegatecall means the facet's init() runs in proxy's context
            (bool success, ) = _init.delegatecall(abi.encodeWithSignature("init()"));
            require(success, "Initialization failed");
        }
    }

    // ========== FACET MANAGEMENT ==========

    /**
     * @dev Main function for managing facets - the heart of the Diamond pattern
     *
     * @param _facetCuts Array of facet operations to perform
     * @param _init Address of facet to initialize after cuts (optional)
     * @param _calldata Initialization data for the facet (optional)
     *
     * FACET CUT ACTIONS:
     * ==================
     * 0 = Add: Add new functions to the proxy
     * 1 = Upgrade: Replace existing functions with new implementation
     * 2 = Remove: Remove functions from the proxy
     *
     * HOW THE PROXY KNOWS WHICH ACTION:
     * ================================
     * Each FacetCutStruct contains:
     * - facetAddress: The contract implementing the functions
     * - functionSelectors: Array of function selectors (4-byte identifiers)
     * - action: Enum value (0=Add, 1=Upgrade, 2=Remove)
     *
     * PROCESS:
     * 1. Loop through each facet cut operation
     * 2. Check the action type and call appropriate internal function
     * 3. Emit event for each operation
     * 4. Initialize new facet if provided
     *
     * EXAMPLE USAGE:
     * =============
     * // Add MessageFacet
     * facetCut([{
     *   facetAddress: 0x1234...,
     *   functionSelectors: [0x412738c8, 0x6eeb9b10, ...],
     *   action: 0  // Add
     * }], 0x1234..., "0x19ab453c000000000000000000000000...")
     */
    function facetCut(
        FacetCutStruct[] calldata _facetCuts,
        address _init,
        bytes calldata _calldata
    ) external override onlyOwner {
        // Process each facet cut operation
        for (uint256 i = 0; i < _facetCuts.length; i++) {
            FacetCutStruct calldata cut = _facetCuts[i];

            // Route to appropriate action based on enum value
            if (cut.action == FacetCutAction.Add) {
                _addFacet(cut.facetAddress, cut.functionSelectors);
            } else if (cut.action == FacetCutAction.Upgrade) {
                _upgradeFacet(cut.facetAddress, cut.functionSelectors);
            } else if (cut.action == FacetCutAction.Remove) {
                _removeFacet(cut.facetAddress, cut.functionSelectors);
            }

            // Emit event for transparency and off-chain tracking
            emit FacetCutEvent(cut.facetAddress, cut.functionSelectors, cut.action);
        }

        // Initialize new facet if provided (e.g., call init() function)
        if (_init != address(0)) {
            // delegatecall means the facet's initialization runs in proxy's context
            (bool success, ) = _init.delegatecall(_calldata);
            require(success, "Initialization failed");
        }
    }

    /**
     * @dev Internal function to add a new facet with its functions
     *
     * @param _facetAddress Address of the facet contract
     * @param _functionSelectors Array of function selectors this facet implements
     *
     * PROCESS:
     * 1. Validate inputs (non-zero address, non-empty selectors)
     * 2. Check if facet address already exists in our registry
     * 3. Add facet address to registry if new
     * 4. For each function selector:
     *    - Ensure it's not already taken by another facet
     *    - Map selector => facet address (for routing)
     *    - Add selector to facet's list (for management)
     *
     * EXAMPLE:
     * ========
     * Adding MessageFacet:
     * - facetAddress: 0x1234...
     * - selectors: [0x412738c8 (sendMessage), 0x6eeb9b10 (createConversation), ...]
     *
     * Result:
     * - _selectorToFacet[0x412738c8] = 0x1234...
     * - _facetToSelectors[0x1234...] = [0x412738c8, 0x6eeb9b10, ...]
     */
    function _addFacet(address _facetAddress, bytes4[] memory _functionSelectors) internal {
        require(_facetAddress != address(0), "Invalid facet address");
        require(_functionSelectors.length > 0, "No function selectors provided");

        // Check if this facet address is already registered
        bool facetExists = false;
        for (uint256 i = 0; i < _facetAddresses.length; i++) {
            if (_facetAddresses[i] == _facetAddress) {
                facetExists = true;
                break;
            }
        }

        // Add facet address to registry if it's new
        if (!facetExists) {
            _facetAddresses.push(_facetAddress);
        }

        // Register each function selector with this facet
        for (uint256 i = 0; i < _functionSelectors.length; i++) {
            bytes4 selector = _functionSelectors[i];

            // Ensure this function isn't already handled by another facet
            require(_selectorToFacet[selector] == address(0), "Function selector already exists");

            // Map function selector to facet address (for routing calls)
            _selectorToFacet[selector] = _facetAddress;

            // Add selector to facet's function list (for management)
            _facetToSelectors[_facetAddress].push(selector);
        }
    }

    /**
     * @dev Internal function to upgrade existing functions to a new facet
     *
     * @param _facetAddress Address of the new facet contract
     * @param _functionSelectors Array of function selectors to upgrade
     *
     * UPGRADE PROCESS:
     * ================
     * 1. Validate inputs
     * 2. Add new facet to registry if not already present
     * 3. For each function selector:
     *    - Find which facet currently handles it
     *    - Remove it from the old facet's function list
     *    - Route it to the new facet
     *    - Add it to the new facet's function list
     *
     * EXAMPLE:
     * ========
     * Upgrading MessageFacet from v1 to v2:
     * - Old facet: 0x1111... (handles sendMessage)
     * - New facet: 0x2222... (new implementation)
     * - Selectors: [0x412738c8 (sendMessage)]
     *
     * Result:
     * - _selectorToFacet[0x412738c8] changes from 0x1111... to 0x2222...
     * - _facetToSelectors[0x1111...] removes 0x412738c8
     * - _facetToSelectors[0x2222...] adds 0x412738c8
     *
     * NOTE: This allows upgrading individual functions without affecting others
     */
    function _upgradeFacet(address _facetAddress, bytes4[] memory _functionSelectors) internal {
        require(_facetAddress != address(0), "Invalid facet address");
        require(_functionSelectors.length > 0, "No function selectors provided");

        // Check if new facet address is already registered
        bool facetExists = false;
        for (uint256 i = 0; i < _facetAddresses.length; i++) {
            if (_facetAddresses[i] == _facetAddress) {
                facetExists = true;
                break;
            }
        }

        // Add new facet to registry if it's not already there
        if (!facetExists) {
            _facetAddresses.push(_facetAddress);
        }

        // Upgrade each function selector to the new facet
        for (uint256 i = 0; i < _functionSelectors.length; i++) {
            bytes4 selector = _functionSelectors[i];
            address oldFacet = _selectorToFacet[selector];

            // Remove function from old facet's list (if it exists)
            if (oldFacet != address(0)) {
                _removeSelectorFromFacet(oldFacet, selector);
            }

            // Route function to new facet
            _selectorToFacet[selector] = _facetAddress;

            // Add function to new facet's list
            _facetToSelectors[_facetAddress].push(selector);
        }
    }

    /**
     * @dev Internal function to remove functions from a facet
     *
     * @param _facetAddress Address of the facet to remove functions from
     * @param _functionSelectors Array of function selectors to remove
     *
     * REMOVE PROCESS:
     * ==============
     * 1. Validate inputs
     * 2. For each function selector:
     *    - Verify it's currently handled by the specified facet
     *    - Remove the selector => facet mapping
     *    - Remove selector from facet's function list
     * 3. If facet has no functions left, remove it from registry
     *
     * EXAMPLE:
     * ========
     * Removing deprecated functions from MessageFacet:
     * - facetAddress: 0x1234... (current MessageFacet)
     * - selectors: [0x12345678 (deprecatedFunction)]
     *
     * Result:
     * - _selectorToFacet[0x12345678] = address(0) (deleted)
     * - _facetToSelectors[0x1234...] removes 0x12345678
     * - If no functions left, 0x1234... removed from _facetAddresses
     *
     * NOTE: Removing functions makes them permanently unavailable
     */
    function _removeFacet(address _facetAddress, bytes4[] memory _functionSelectors) internal {
        require(_facetAddress != address(0), "Invalid facet address");
        require(_functionSelectors.length > 0, "No function selectors provided");

        // Remove each function selector
        for (uint256 i = 0; i < _functionSelectors.length; i++) {
            bytes4 selector = _functionSelectors[i];

            // Ensure this function is actually handled by the specified facet
            require(_selectorToFacet[selector] == _facetAddress, "Function selector not found in facet");

            // Remove the function routing (calls to this function will now fail)
            delete _selectorToFacet[selector];

            // Remove from facet's function list
            _removeSelectorFromFacet(_facetAddress, selector);
        }

        // Clean up: remove facet from registry if it has no functions left
        if (_facetToSelectors[_facetAddress].length == 0) {
            // Find and remove the facet address from the registry
            for (uint256 i = 0; i < _facetAddresses.length; i++) {
                if (_facetAddresses[i] == _facetAddress) {
                    // Move last element to current position and pop
                    _facetAddresses[i] = _facetAddresses[_facetAddresses.length - 1];
                    _facetAddresses.pop();
                    break;
                }
            }
        }
    }

    /**
     * @dev Helper function to remove a specific selector from a facet's function list
     *
     * @param _facetAddress Address of the facet
     * @param _selector Function selector to remove
     *
     * PROCESS:
     * 1. Get the facet's function selector array
     * 2. Find the selector in the array
     * 3. Replace it with the last element and pop (efficient removal)
     *
     * NOTE: This is a utility function used by _upgradeFacet and _removeFacet
     */
    function _removeSelectorFromFacet(address _facetAddress, bytes4 _selector) internal {
        bytes4[] storage selectors = _facetToSelectors[_facetAddress];
        for (uint256 i = 0; i < selectors.length; i++) {
            if (selectors[i] == _selector) {
                // Efficient removal: move last element to current position and pop
                selectors[i] = selectors[selectors.length - 1];
                selectors.pop();
                break;
            }
        }
    }

    // ========== FACET LOUPE ==========
    // "Loupe" functions provide introspection into the Diamond's current state

    /**
     * @dev Returns the first facet and its function selectors
     * Used for compatibility with Diamond standard
     *
     * @return facetAddress Address of the first facet
     * @return selectors Array of function selectors for the first facet
     */
    function facetsStruct() external view override returns (address, bytes4[] memory) {
        if (_facetAddresses.length == 0) {
            return (address(0), new bytes4[](0));
        }

        address firstFacet = _facetAddresses[0];
        return (firstFacet, _facetToSelectors[firstFacet]);
    }

    /**
     * @dev Returns all function selectors for a specific facet
     *
     * @param _facet Address of the facet to query
     * @return Array of function selectors this facet handles
     */
    function facetFunctionSelectors(address _facet) external view override returns (bytes4[] memory) {
        return _facetToSelectors[_facet];
    }

    /**
     * @dev Returns all facet addresses currently registered
     *
     * @return Array of all facet addresses
     */
    function facetAddresses() external view override returns (address[] memory) {
        return _facetAddresses;
    }

    /**
     * @dev Returns which facet handles a specific function
     *
     * @param _functionSelector Function selector to look up
     * @return Address of the facet that handles this function (or address(0) if not found)
     */
    function facetAddress(bytes4 _functionSelector) external view override returns (address) {
        return _selectorToFacet[_functionSelector];
    }

    // ========== OWNERSHIP ==========

    /**
     * @dev Returns the current owner of the proxy
     * @return Address of the proxy owner
     */
    function owner() external view override returns (address) {
        return _owner;
    }

    /**
     * @dev Transfers ownership of the proxy to a new address
     * @param newOwner Address of the new owner
     */
    function transferOwnership(address newOwner) external override onlyOwner {
        require(newOwner != address(0), "New owner cannot be zero address");
        _owner = newOwner;
    }

    /**
     * @dev Withdraw funds from the proxy contract
     * @param amount Amount to withdraw in wei
     * @param reason Reason for withdrawal (emitted in event)
     *
     * @dev Only the proxy owner can withdraw funds
     *      This allows the owner to recover any ETH sent directly to the proxy
     *      The reason is emitted in an event for transparency
     *
     * @custom:example
     * ```solidity
     * // Owner withdraws 1 ETH with reason
     * proxy.withdrawFunds(1 ether, "Emergency withdrawal for maintenance");
     * ```
     */
    function withdrawFunds(uint256 amount, string calldata reason) external onlyOwner {
        require(amount > 0, "Amount must be greater than 0");
        require(address(this).balance >= amount, "Insufficient balance");

        // Transfer funds to owner
        (bool sent, ) = payable(_owner).call{value: amount}("");
        require(sent, "Failed to send funds");

        // Emit event with reason
        emit FundsWithdrawn(_owner, amount, reason, block.timestamp);
    }

    // ========== FALLBACK ==========

    /**
     * @dev Fallback function - the heart of the Diamond pattern
     *
     * HOW IT WORKS:
     * ============
     * 1. Extract function selector from call data (first 4 bytes)
     * 2. Look up which facet handles this function
     * 3. Delegate the call to that facet
     * 4. Return the result
     *
     * ASSEMBLY BREAKDOWN:
     * ==================
     * - calldatacopy(0, 0, calldatasize()): Copy all call data to memory
     * - delegatecall(gas(), facet, 0, calldatasize(), 0, 0):
     *   * Execute facet's code in proxy's context
     *   * Use proxy's storage and balance
     *   * Pass all call data to facet
     * - returndatacopy(0, 0, returndatasize()): Copy return data to memory
     * - switch result: Handle success (1) or failure (0)
     *
     * EXAMPLE:
     * ========
     * User calls: proxy.sendMessage(conversationId, recipient, encryptedMessage)
     * 1. msg.sig = 0x412738c8 (sendMessage selector)
     * 2. facet = _selectorToFacet[0x412738c8] = 0x1234... (MessageFacet address)
     * 3. delegatecall to 0x1234... with sendMessage parameters
     * 4. MessageFacet executes using proxy's storage
     * 5. Return result to user
     */
    fallback() external payable {
        // Get the facet that handles this function
        address facet = _selectorToFacet[msg.sig];
        require(facet != address(0), "Function not found");

        // Delegate the call to the appropriate facet
        assembly {
            // Copy call data to memory
            calldatacopy(0, 0, calldatasize())

            // Delegate call to facet (executes facet's code in proxy's context)
            let result := delegatecall(gas(), facet, 0, calldatasize(), 0, 0)

            // Copy return data to memory
            returndatacopy(0, 0, returndatasize())

            // Handle result
            switch result
            case 0 {
                // Call failed - revert with return data
                revert(0, returndatasize())
            }
            default {
                // Call succeeded - return data
                return(0, returndatasize())
            }
        }
    }

    /**
     * @dev Receive function to accept ETH transfers
     * Allows the proxy to receive ETH directly
     */
    receive() external payable {}
}
