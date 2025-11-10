// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./interfaces/IPaymentHub.sol";
import "./interfaces/DehiveProxy.sol";
import "./libraries/PaymentHubStorage.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PaymentHub
 * @notice Peer-to-peer payment contract for chat conversations with native and ERC-20 support
 * @dev This contract implements a payment system where users can:
 *      - Send native tokens (ETH, MATIC, etc.) directly to other users
 *      - Send ERC-20 tokens with standard approval flow
 *      - Send ERC-20 tokens with EIP-2612 permit (gasless approval)
 *      - Link payments to chat conversations via conversationId
 *      - Reference off-chain metadata via IPFS CID and content hash
 *
 * @custom:architecture The contract uses a fee structure:
 *      - Transaction fee: Optional percentage-based fee (0-10% in basis points)
 *      - Fees are accumulated per token and withdrawable by owner
 *      - Non-custodial: Funds are transferred directly, not held by contract
 *
 * @custom:security Access control is managed through:
 *      - Proxy owner (in facet mode) or stored owner (in standalone mode): Can set fees and withdraw
 *      - ReentrancyGuard: Protects against reentrancy attacks
 *      - SafeERC20: Ensures safe token transfers
 *
 * @custom:dualmode This contract supports dual-mode operation:
 *      - Standalone mode: Deployed as a regular contract, uses stored owner
 *      - Facet mode: Installed in DehiveProxy, uses proxy owner via IDehiveProxy interface
 *
 * @custom:conversation-id Conversation IDs are deterministic and computed as:
 *      conversationId = uint256(keccak256(abi.encodePacked(smallerAddress, largerAddress)))
 *      This matches the Message contract pattern for consistency.
 *
 * @author DeHive
 */
contract PaymentHub is IPaymentHub, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using PaymentHubStorage for PaymentHubStorage.PaymentHubStorageStruct;

    /// @dev Maximum transaction fee: 1000 basis points = 10%
    uint256 private constant MAX_FEE_PERCENT = 1000;

    /// @dev Basis points divisor: 10000 basis points = 100%
    uint256 private constant BASIS_POINTS = 10000;

    /**
     * @notice Initialize the PaymentHub contract (standalone mode)
     * @param _owner The address that will own the contract and can configure fees
     * @dev Sets up the contract in standalone mode with an owner
     */
    constructor(address _owner) {
        PaymentHubStorage.PaymentHubStorageStruct storage ds = PaymentHubStorage
            .paymentHubStorage();
        require(!ds.initialized, "PaymentHub: already initialized");
        ds.owner = _owner;
        ds.transactionFeePercent = 0; // Default: no fees
        ds.initialized = true;
    }

    //============== STORAGE ACCESSORS ==============

    /**
     * @notice Get the current transaction fee percentage
     * @return The transaction fee in basis points (100 = 1%)
     */
    function transactionFeePercent() external view returns (uint256) {
        return PaymentHubStorage.paymentHubStorage().transactionFeePercent;
    }

    /**
     * @notice Get accumulated fees for a specific token
     * @param token The token address (address(0) for native tokens)
     * @return The accumulated fee amount for the token
     */
    function accumulatedFees(address token) external view returns (uint256) {
        return PaymentHubStorage.paymentHubStorage().accumulatedFees[token];
    }

    /**
     * @notice Get the owner address
     * @return The owner address (proxy owner in facet mode, stored owner in standalone mode)
     * @dev This function works in both standalone and facet modes
     */
    function owner() external view returns (address) {
        return _getPaymentHubOwner();
    }

    //============== INITIALIZATION ==============

    /**
     * @notice Initialize the PaymentHub facet (for facet mode)
     * @param _owner The address that will own the facet (proxy owner)
     * @dev This function is called when the facet is installed in the proxy
     *      It initializes the storage with default values
     * @dev Can only be called once per deployment
     */
    function init(address _owner) external override {
        PaymentHubStorage.PaymentHubStorageStruct storage ds = PaymentHubStorage
            .paymentHubStorage();
        require(!ds.initialized, "PaymentHub: already initialized");
        ds.owner = _owner;
        ds.transactionFeePercent = 0; // Default: no fees
        ds.initialized = true;
    }

    //============== HELPER FUNCTIONS ==============

    /**
     * @notice Get the owner address (supports both standalone and facet modes)
     * @return The owner address
     * @dev In standalone mode: returns stored owner
     *      In facet mode: queries proxy owner via IDehiveProxy interface
     */
    function _getPaymentHubOwner() internal view returns (address) {
        PaymentHubStorage.PaymentHubStorageStruct storage ds = PaymentHubStorage
            .paymentHubStorage();

        // Try to detect if we're in facet mode by checking if we can call owner() on this address
        // In facet mode, address(this) will be the proxy address
        try IDehiveProxy(address(this)).owner() returns (address proxyOwner) {
            // We're in facet mode - use proxy owner
            // But validate it's not a zero or invalid address
            // If proxy owner is invalid, fall back to stored owner
            if (proxyOwner != address(0) && proxyOwner != address(0x1)) {
                return proxyOwner;
            }
            // Invalid proxy owner, use stored owner
            return ds.owner;
        } catch {
            // We're in standalone mode - use stored owner
            return ds.owner;
        }
    }

    /**
     * @notice Modifier to restrict function access to owner only
     * @dev Works in both standalone and facet modes
     */
    modifier onlyOwner() {
        require(
            msg.sender == _getPaymentHubOwner(),
            "PaymentHub: caller is not the owner"
        );
        _;
    }

    /**
     * @notice Calculate transaction fee for a given amount
     * @param amount The payment amount
     * @return fee The calculated fee amount
     */
    function _calculateFee(uint256 amount) internal view returns (uint256 fee) {
        PaymentHubStorage.PaymentHubStorageStruct storage ds = PaymentHubStorage
            .paymentHubStorage();
        if (ds.transactionFeePercent == 0) {
            return 0;
        }
        return (amount * ds.transactionFeePercent) / BASIS_POINTS;
    }

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
     */
    function sendNative(
        uint256 conversationId,
        address recipient,
        string memory ipfsCid,
        bytes32 contentHash,
        uint8 mode,
        string memory clientMsgId
    ) external payable override nonReentrant returns (bool success) {
        // Validate inputs
        require(
            recipient != address(0),
            "PaymentHub: recipient cannot be zero address"
        );
        require(msg.value > 0, "PaymentHub: amount must be greater than 0");

        PaymentHubStorage.PaymentHubStorageStruct storage ds = PaymentHubStorage
            .paymentHubStorage();

        // Calculate fee
        uint256 fee = _calculateFee(msg.value);
        uint256 amountToRecipient = msg.value - fee;

        // Accumulate fee
        if (fee > 0) {
            ds.accumulatedFees[address(0)] += fee;
        }

        // Transfer to recipient
        (bool sent, ) = recipient.call{value: amountToRecipient}("");
        require(sent, "PaymentHub: failed to send native tokens");

        // Emit event
        emit PaymentSent(
            conversationId,
            msg.sender,
            recipient,
            address(0), // Native token
            msg.value,
            fee,
            ipfsCid,
            contentHash,
            mode,
            clientMsgId,
            block.timestamp
        );

        return true;
    }

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
     * @dev Sender must have approved this contract to spend at least `amount` tokens
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
    ) external override nonReentrant returns (bool success) {
        // Validate inputs
        require(
            recipient != address(0),
            "PaymentHub: recipient cannot be zero address"
        );
        require(
            token != address(0),
            "PaymentHub: token cannot be zero address"
        );
        require(amount > 0, "PaymentHub: amount must be greater than 0");

        PaymentHubStorage.PaymentHubStorageStruct storage ds = PaymentHubStorage
            .paymentHubStorage();

        // Calculate fee
        uint256 fee = _calculateFee(amount);
        uint256 amountToRecipient = amount - fee;

        // Transfer tokens from sender to this contract
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        // Accumulate fee
        if (fee > 0) {
            ds.accumulatedFees[token] += fee;
        }

        // Transfer tokens to recipient
        IERC20(token).safeTransfer(recipient, amountToRecipient);

        // Emit event
        emit PaymentSent(
            conversationId,
            msg.sender,
            recipient,
            token,
            amount,
            fee,
            ipfsCid,
            contentHash,
            mode,
            clientMsgId,
            block.timestamp
        );

        return true;
    }

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
     * @dev This function allows users to send tokens without a separate approve transaction
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
    ) external override nonReentrant returns (bool success) {
        // Execute permit to approve spending
        IERC20Permit(token).permit(
            msg.sender,
            address(this),
            amount,
            deadline,
            v,
            r,
            s
        );

        // Validate inputs
        require(
            recipient != address(0),
            "PaymentHub: recipient cannot be zero address"
        );
        require(
            token != address(0),
            "PaymentHub: token cannot be zero address"
        );
        require(amount > 0, "PaymentHub: amount must be greater than 0");

        PaymentHubStorage.PaymentHubStorageStruct storage ds = PaymentHubStorage
            .paymentHubStorage();

        // Calculate fee
        uint256 fee = _calculateFee(amount);
        uint256 amountToRecipient = amount - fee;

        // Transfer tokens from sender to this contract
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        // Accumulate fee
        if (fee > 0) {
            ds.accumulatedFees[token] += fee;
        }

        // Transfer tokens to recipient
        IERC20(token).safeTransfer(recipient, amountToRecipient);

        // Emit event
        emit PaymentSent(
            conversationId,
            msg.sender,
            recipient,
            token,
            amount,
            fee,
            ipfsCid,
            contentHash,
            mode,
            clientMsgId,
            block.timestamp
        );

        return true;
    }

    //============== VIEW FUNCTIONS ==============

    /**
     * @notice Compute conversation ID from two addresses
     * @param user1 First address in the conversation
     * @param user2 Second address in the conversation
     * @return conversationId The deterministic conversation ID
     *
     * @dev Conversation ID is computed as:
     *      uint256(keccak256(abi.encodePacked(smallerAddress, largerAddress)))
     *      This ensures the same conversation ID regardless of order
     *      Matches the Message contract pattern for consistency
     */
    function computeConversationId(address user1, address user2)
        external
        pure
        override
        returns (uint256 conversationId)
    {
        // Order addresses deterministically to ensure consistent conversation IDs
        (address smallerAddress, address largerAddress) = user1 < user2
            ? (user1, user2)
            : (user2, user1);

        // Compute deterministic conversation ID using both addresses
        conversationId = uint256(
            keccak256(abi.encodePacked(smallerAddress, largerAddress))
        );

        return conversationId;
    }

    //============== OWNER FUNCTIONS ==============

    /**
     * @notice Set the transaction fee percentage
     * @param newFeePercent The new fee percentage in basis points (max 1000 = 10%)
     *
     * @dev Only callable by the contract owner
     *      Fee is applied to all payments (native and ERC-20)
     *      Fee is accumulated in the contract and can be withdrawn by owner
     */
    function setTransactionFee(uint256 newFeePercent)
        external
        override
        onlyOwner
    {
        require(
            newFeePercent <= MAX_FEE_PERCENT,
            "PaymentHub: fee cannot exceed 10%"
        );

        PaymentHubStorage.PaymentHubStorageStruct storage ds = PaymentHubStorage
            .paymentHubStorage();

        ds.transactionFeePercent = newFeePercent;

        emit TransactionFeeSet(newFeePercent, block.timestamp);
    }

    /**
     * @notice Withdraw accumulated fees for a specific token
     * @param token The token address (address(0) for native tokens)
     *
     * @dev Only callable by the contract owner
     *      Transfers all accumulated fees for the token to the owner
     */
    function withdrawFees(address token) external override onlyOwner nonReentrant {
        PaymentHubStorage.PaymentHubStorageStruct storage ds = PaymentHubStorage
            .paymentHubStorage();

        uint256 amount = ds.accumulatedFees[token];
        require(amount > 0, "PaymentHub: no fees to withdraw");

        // Reset accumulated fees
        ds.accumulatedFees[token] = 0;

        address ownerAddress = _getPaymentHubOwner();

        // Transfer fees to owner
        if (token == address(0)) {
            // Native token
            (bool sent, ) = ownerAddress.call{value: amount}("");
            require(sent, "PaymentHub: failed to send native tokens");
        } else {
            // ERC-20 token
            IERC20(token).safeTransfer(ownerAddress, amount);
        }

        emit FeesWithdrawn(token, amount, ownerAddress, block.timestamp);
    }

    /**
     * @notice Receive function to accept native token transfers
     * @dev Allows the contract to receive native tokens for fee accumulation
     */
    receive() external payable {}
}
