// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title PaymentHubStorage
 * @notice Diamond Storage library for PaymentHub contract
 * @dev Uses Diamond Storage pattern to enable facet-based upgradability
 *      Storage position: keccak256("paymenthub.storage") - 1
 *
 * @custom:storage-layout The storage struct contains:
 *      - owner: Address with admin privileges (can set fees, withdraw accumulated fees)
 *      - transactionFeePercent: Fee percentage in basis points (100 = 1%, max 1000 = 10%)
 *      - accumulatedFees: Mapping of token address to accumulated fee amount
 *      - initialized: Flag to prevent re-initialization
 *
 * @custom:diamond-storage This library implements the Diamond Storage pattern (EIP-2535)
 *      which allows multiple facets to share storage without collisions by using
 *      a deterministic storage slot based on a unique namespace hash.
 *
 * @author DeHive
 */
library PaymentHubStorage {
    /**
     * @dev Storage struct for PaymentHub
     * @param owner Address with admin privileges
     * @param transactionFeePercent Transaction fee in basis points (100 = 1%, max 1000 = 10%)
     * @param accumulatedFees Mapping of token addresses to accumulated fee amounts
     * @param initialized Initialization flag to prevent re-initialization
     */
    struct PaymentHubStorageStruct {
        address owner;
        uint256 transactionFeePercent;
        mapping(address => uint256) accumulatedFees;
        bool initialized;
    }

    /**
     * @notice Get the storage position for PaymentHub
     * @dev Storage position = keccak256("paymenthub.storage") - 1
     *      This ensures a unique storage slot that won't collide with other facets
     * @return ds Storage struct at the calculated position
     */
    function paymentHubStorage()
        internal
        pure
        returns (PaymentHubStorageStruct storage ds)
    {
        bytes32 position = keccak256("paymenthub.storage");
        assembly {
            ds.slot := position
        }
    }
}
