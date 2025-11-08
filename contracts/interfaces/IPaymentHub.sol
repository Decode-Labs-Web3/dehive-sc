// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title IPaymentHub
 * @notice Interface for PaymentHub contract - peer-to-peer payments in chat conversations
 * @dev This interface defines the payment protocol with support for:
 *      - Native token transfers (ETH, MATIC, etc.)
 *      - ERC-20 token transfers
 *      - ERC-20 transfers with EIP-2612 permit (gasless approvals)
 *      - Conversation-linked payments
 *      - Off-chain data linking (IPFS CID + content hash)
 *      - Optional transaction fees
 *
 * @custom:usage The payment system supports two modes:
 *      - Public (mode = 0): Payment message readable by anyone
 *      - Secret (mode = 1): Payment message encrypted and stored on IPFS
 *
 * @custom:dualmode This interface supports both standalone and facet modes:
 *      - Standalone: Deployed as a regular contract, uses constructor for initialization
 *      - Facet: Installed in DehiveProxy, uses init() function for initialization
 */
interface IPaymentHub {
    //============== INITIALIZATION ==============

    /**
     * @notice Initialize the PaymentHub facet (for facet mode)
     * @param _owner The address that will own the facet (should be proxy owner)
     * @dev This function is called when the facet is installed in the DehiveProxy.
     *      It initializes the Diamond Storage with default values.
     *      Can only be called once per deployment.
     *
     * @custom:reverts "PaymentHub: already initialized" if called more than once
     */
    function init(address _owner) external;

    //============== EVENTS ==============

    /**
     * @notice Emitted when a payment is sent successfully
     * @param conversationId The unique identifier for the conversation (hash of both addresses)
     * @param sender The address sending the payment
     * @param recipient The address receiving the payment
     * @param token The token address (address(0) for native tokens)
     * @param amount The total payment amount (including fee)
     * @param fee The transaction fee charged (in same token)
     * @param ipfsCid IPFS CID pointing to payment metadata JSON
     * @param contentHash Cryptographic hash of the IPFS payload for verification
     * @param mode Payment visibility mode (0 = public, 1 = secret/encrypted)
     * @param clientMsgId Client-side message ID for UI synchronization
     * @param timestamp Block timestamp when payment was made
     *
     * @dev This event is used by The Graph to index payments and by the frontend
     *      to render payment bubbles in chat conversations
     */
    event PaymentSent(
        uint256 indexed conversationId,
        address indexed sender,
        address indexed recipient,
        address token,
        uint256 amount,
        uint256 fee,
        string ipfsCid,
        bytes32 contentHash,
        uint8 mode,
        string clientMsgId,
        uint256 timestamp
    );

    /**
     * @notice Emitted when the transaction fee percentage is updated
     * @param newFeePercent The new fee percentage in basis points (100 = 1%)
     * @param timestamp Block timestamp when fee was updated
     * @dev Only the contract owner can update the transaction fee
     */
    event TransactionFeeSet(uint256 newFeePercent, uint256 timestamp);

    /**
     * @notice Emitted when accumulated fees are withdrawn
     * @param token The token address (address(0) for native tokens)
     * @param amount The amount of fees withdrawn
     * @param recipient The address receiving the withdrawn fees (owner)
     * @param timestamp Block timestamp when fees were withdrawn
     */
    event FeesWithdrawn(
        address indexed token,
        uint256 amount,
        address indexed recipient,
        uint256 timestamp
    );

    //============== PAYMENT FUNCTIONS ==============

    /**
     * @notice Send native tokens (ETH, MATIC, etc.) to another user
     * @param conversationId The unique identifier for the conversation
     * @param recipient The address receiving the payment
     * @param ipfsCid IPFS CID pointing to payment metadata
     * @param contentHash Hash of the IPFS payload for verification
     * @param mode Payment visibility mode (0 = public, 1 = secret)
     * @param clientMsgId Client-side message ID for UI sync
     * @return success True if payment was successful
     *
     * @dev Payment flow:
     *      1. Validate recipient and amount
     *      2. Calculate transaction fee
     *      3. Send (msg.value - fee) to recipient
     *      4. Accumulate fee in contract
     *      5. Emit PaymentSent event
     *
     * @custom:reverts "PaymentHub: recipient cannot be zero address" if recipient is address(0)
     * @custom:reverts "PaymentHub: amount must be greater than 0" if msg.value is 0
     */
    function sendNative(
        uint256 conversationId,
        address recipient,
        string memory ipfsCid,
        bytes32 contentHash,
        uint8 mode,
        string memory clientMsgId
    ) external payable returns (bool success);

    /**
     * @notice Send ERC-20 tokens to another user
     * @param conversationId The unique identifier for the conversation
     * @param recipient The address receiving the payment
     * @param token The ERC-20 token contract address
     * @param amount The amount of tokens to send (including fee)
     * @param ipfsCid IPFS CID pointing to payment metadata
     * @param contentHash Hash of the IPFS payload for verification
     * @param mode Payment visibility mode (0 = public, 1 = secret)
     * @param clientMsgId Client-side message ID for UI sync
     * @return success True if payment was successful
     *
     * @dev Payment flow:
     *      1. Validate recipient, token, and amount
     *      2. Transfer tokens from sender to contract (requires prior approval)
     *      3. Calculate transaction fee
     *      4. Transfer (amount - fee) to recipient
     *      5. Accumulate fee in contract
     *      6. Emit PaymentSent event
     *
     * @dev Sender must have approved this contract to spend at least `amount` tokens
     *
     * @custom:reverts "PaymentHub: recipient cannot be zero address" if recipient is address(0)
     * @custom:reverts "PaymentHub: token cannot be zero address" if token is address(0)
     * @custom:reverts "PaymentHub: amount must be greater than 0" if amount is 0
     */
    function sendERC20(
        uint256 conversationId,
        address recipient,
        address token,
        uint256 amount,
        string memory ipfsCid,
        bytes32 contentHash,
        uint8 mode,
        string memory clientMsgId
    ) external returns (bool success);

    /**
     * @notice Send ERC-20 tokens using EIP-2612 permit (gasless approval)
     * @param conversationId The unique identifier for the conversation
     * @param recipient The address receiving the payment
     * @param token The ERC-20 token contract address (must support EIP-2612)
     * @param amount The amount of tokens to send (including fee)
     * @param ipfsCid IPFS CID pointing to payment metadata
     * @param contentHash Hash of the IPFS payload for verification
     * @param mode Payment visibility mode (0 = public, 1 = secret)
     * @param clientMsgId Client-side message ID for UI sync
     * @param deadline Permit signature expiration timestamp
     * @param v ECDSA signature v component
     * @param r ECDSA signature r component
     * @param s ECDSA signature s component
     * @return success True if payment was successful
     *
     * @dev Payment flow:
     *      1. Call permit() on token contract to approve spending
     *      2. Execute same logic as sendERC20()
     *
     * @dev This function allows users to send tokens without a separate approve transaction,
     *      reducing gas costs and improving UX
     *
     * @custom:reverts Same as sendERC20(), plus any permit-related errors
     */
    function sendERC20WithPermit(
        uint256 conversationId,
        address recipient,
        address token,
        uint256 amount,
        string memory ipfsCid,
        bytes32 contentHash,
        uint8 mode,
        string memory clientMsgId,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (bool success);

    //============== VIEW FUNCTIONS ==============

    /**
     * @notice Get the current transaction fee percentage
     * @return The transaction fee in basis points (100 = 1%)
     */
    function transactionFeePercent() external view returns (uint256);

    /**
     * @notice Get accumulated fees for a specific token
     * @param token The token address (address(0) for native tokens)
     * @return The accumulated fee amount for the token
     */
    function accumulatedFees(address token) external view returns (uint256);

    /**
     * @notice Get the owner address
     * @return The owner address (proxy owner in facet mode, stored owner in standalone mode)
     */
    function owner() external view returns (address);

    /**
     * @notice Compute conversation ID from two addresses
     * @param user1 First address in the conversation
     * @param user2 Second address in the conversation
     * @return conversationId The deterministic conversation ID
     *
     * @dev Conversation ID is computed as:
     *      uint256(keccak256(abi.encodePacked(smallerAddress, largerAddress)))
     *      This ensures the same conversation ID regardless of order
     */
    function computeConversationId(address user1, address user2)
        external
        pure
        returns (uint256 conversationId);

    //============== OWNER FUNCTIONS ==============

    /**
     * @notice Set the transaction fee percentage
     * @param newFeePercent The new fee percentage in basis points (max 1000 = 10%)
     *
     * @dev Only callable by the contract owner
     *      Fee is applied to all payments (native and ERC-20)
     *      Fee is accumulated in the contract and can be withdrawn by owner
     *
     * @custom:reverts "PaymentHub: fee cannot exceed 10%" if newFeePercent > 1000
     * @custom:reverts "PaymentHub: caller is not the owner" if caller is not owner
     */
    function setTransactionFee(uint256 newFeePercent) external;

    /**
     * @notice Withdraw accumulated fees for a specific token
     * @param token The token address (address(0) for native tokens)
     *
     * @dev Only callable by the contract owner
     *      Transfers all accumulated fees for the token to the owner
     *
     * @custom:reverts "PaymentHub: no fees to withdraw" if accumulated fees are 0
     * @custom:reverts "PaymentHub: caller is not the owner" if caller is not owner
     */
    function withdrawFees(address token) external;
}
