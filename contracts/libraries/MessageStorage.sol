// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title MessageStorage
 * @notice Library for Diamond Storage pattern implementation for Message facet
 * @dev This library provides a storage structure that can be used both in standalone
 *      Message contract and as a facet in DehiveProxy.
 *
 * DIAMOND STORAGE PATTERN:
 * =======================
 * Diamond Storage uses a unique storage slot calculated from a string identifier.
 * This ensures that different facets/modules can have separate storage without collisions.
 *
 * STORAGE SLOT:
 * ============
 * Storage slot = keccak256("dehive.message.storage")
 * This slot stores a pointer to MessageStorageStruct which contains all state variables.
 *
 * @author DeHive
 */
library MessageStorage {
    /**
     * @notice Conversation data structure storing encrypted keys for both participants
     * @dev Addresses are ordered deterministically (smaller < larger) to ensure consistent conversation IDs
     */
    struct Conversation {
        address smallerAddress;  /// @dev The smaller address in the pair (deterministic ordering)
        address largerAddress;   /// @dev The larger address in the pair (deterministic ordering)
        bytes encryptedConversationKeyForSmallerAddress;  /// @dev Encrypted conversation key for smaller address
        bytes encryptedConversationKeyForLargerAddress;   /// @dev Encrypted conversation key for larger address
        uint256 createdAt;      /// @dev Timestamp when the conversation was created
    }

    /**
     * @notice Storage structure for Message facet/contract
     * @dev This struct contains all state variables used by the Message contract
     */
    struct MessageStorageStruct {
        /// @notice Fee charged for direct message sending (pay-as-you-go model)
        /// @dev This fee is higher than relayerFee to incentivize credit deposits
        uint256 payAsYouGoFee;

        /// @notice Fee charged for relayer-based message sending (credit model)
        /// @dev This fee is lower than payAsYouGoFee to incentivize credit deposits
        uint256 relayerFee;

        /// @notice Address of the authorized relayer that can send messages via sendMessageViaRelayer
        /// @dev Only this address can call sendMessageViaRelayer. Set by contract/proxy owner.
        address relayer;

        /// @notice Mapping from conversation ID to Conversation struct
        /// @dev Conversation IDs are deterministic: uint256(keccak256(abi.encodePacked(addr1, addr2)))
        mapping(uint256 => Conversation) conversations;

        /// @notice Mapping from user address to their deposited credit balance
        /// @dev Funds deposited via depositFunds() are non-refundable and used for relayer fees
        mapping(address => uint256) funds;

        /// @notice Owner address for standalone mode
        /// @dev In standalone mode, this stores the contract owner
        ///      In facet mode, this may not be used (proxy owner is used instead)
        address owner;

        /// @notice Initialization flag to prevent re-initialization
        /// @dev Set to true after init() is called
        bool initialized;
    }

    /**
     * @notice Get the storage slot for MessageStorageStruct
     * @dev Uses keccak256 to calculate a unique storage slot
     * @return ds Pointer to MessageStorageStruct storage
     */
    function messageStorage() internal pure returns (MessageStorageStruct storage ds) {
        // Unique storage slot based on the string identifier
        bytes32 storagePosition = keccak256("dehive.message.storage");
        assembly {
            ds.slot := storagePosition
        }
    }
}
