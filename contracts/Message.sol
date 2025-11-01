// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./interfaces/IMessage.sol";
import "./interfaces/DehiveProxy.sol";
import "./libraries/MessageStorage.sol";

/**
 * @title Message
 * @notice A decentralized messaging contract with two-tier fee system and encrypted conversations
 * @dev This contract implements a messaging system where users can:
 *      - Send messages directly (pay-as-you-go with higher fees)
 *      - Deposit credits and use a relayer (credit-based with lower fees)
 *      - Create encrypted conversations with per-user encryption keys
 *
 * @custom:architecture The contract uses a two-tier fee structure:
 *      - Pay-as-you-go fee (payAsYouGoFee): Higher fee for direct message sends
 *      - Relayer fee (relayerFee): Lower fee for messages sent via relayer using deposited credits
 *
 * @custom:security Access control is managed through:
 *      - Proxy owner (in facet mode) or stored owner (in standalone mode): Can update fees and relayer address
 *      - onlyRelayer modifier: Only authorized relayer can send messages via relayer
 *
 * @custom:dualmode This contract supports dual-mode operation:
 *      - Standalone mode: Deployed as a regular contract, uses stored owner
 *      - Facet mode: Installed in DehiveProxy, uses proxy owner via IDehiveProxy interface
 *
 * @custom:conversation-id Conversation IDs are deterministic and computed as:
 *      conversationId = uint256(keccak256(abi.encodePacked(smallerAddress, largerAddress)))
 *      This ensures the same conversation ID regardless of who creates it.
 *
 * @author DeHive
 */
contract Message is IMessage {
    using MessageStorage for MessageStorage.MessageStorageStruct;

    /**
     * @notice Initialize the Message contract (standalone mode)
     * @param owner The address that will own the contract and can configure fees/relayer
     * @dev Sets up the contract in standalone mode with an owner
     */
    constructor(address owner) {
        MessageStorage.MessageStorageStruct storage ds = MessageStorage.messageStorage();
        require(!ds.initialized, "Message: already initialized");
        ds.owner = owner;
        ds.payAsYouGoFee = 0.0000002 ether;
        ds.relayerFee = 0.0000001 ether;
        ds.initialized = true;
    }

    //============== STORAGE ACCESSORS ==============
    // Public getters for state variables to maintain interface compatibility

    /**
     * @notice Get the pay-as-you-go fee
     * @return The current pay-as-you-go fee
     */
    function payAsYouGoFee() external view returns (uint256) {
        return MessageStorage.messageStorage().payAsYouGoFee;
    }

    /**
     * @notice Get the relayer fee
     * @return The current relayer fee
     */
    function relayerFee() external view returns (uint256) {
        return MessageStorage.messageStorage().relayerFee;
    }

    /**
     * @notice Get the relayer address
     * @return The current relayer address
     */
    function relayer() external view returns (address) {
        return MessageStorage.messageStorage().relayer;
    }

    /**
     * @notice Get conversation data
     * @param conversationId The conversation ID
     * @return smallerAddress The smaller address in the conversation pair
     * @return largerAddress The larger address in the conversation pair
     * @return encryptedConversationKeyForSmallerAddress The encrypted key for smaller address
     * @return encryptedConversationKeyForLargerAddress The encrypted key for larger address
     * @return createdAt The timestamp when the conversation was created
     */
    function conversations(uint256 conversationId) external view returns (
        address smallerAddress,
        address largerAddress,
        bytes memory encryptedConversationKeyForSmallerAddress,
        bytes memory encryptedConversationKeyForLargerAddress,
        uint256 createdAt
    ) {
        MessageStorage.Conversation storage conv = MessageStorage.messageStorage().conversations[conversationId];
        return (
            conv.smallerAddress,
            conv.largerAddress,
            conv.encryptedConversationKeyForSmallerAddress,
            conv.encryptedConversationKeyForLargerAddress,
            conv.createdAt
        );
    }

    /**
     * @notice Get user's deposited funds balance
     * @param user The user address
     * @return The user's deposited funds balance
     */
    function funds(address user) external view returns (uint256) {
        return MessageStorage.messageStorage().funds[user];
    }

    /**
     * @notice Get the owner address
     * @return The owner address (proxy owner in facet mode, stored owner in standalone mode)
     * @dev This function works in both standalone and facet modes
     */
    function owner() external view returns (address) {
        return _getMessageOwner();
    }

    //============== INITIALIZATION ==============

    /**
     * @notice Initialize the Message facet (for facet mode)
     * @param owner The address that will own the facet (proxy owner)
     * @dev This function is called when the facet is installed in the proxy
     *      It initializes the storage with default values
     * @dev Can only be called once per deployment
     */
    function init(address owner) external override {
        MessageStorage.MessageStorageStruct storage ds = MessageStorage.messageStorage();
        require(!ds.initialized, "Message: already initialized");
        ds.owner = owner;
        ds.payAsYouGoFee = 0.0000002 ether;
        ds.relayerFee = 0.0000001 ether;
        ds.initialized = true;
    }

    //============== HELPER FUNCTIONS ==============

    /**
     * @notice Get the owner address (supports both standalone and facet modes)
     * @return The owner address
     * @dev In standalone mode: returns stored owner
     *      In facet mode: queries proxy owner via IDehiveProxy interface
     */
    function _getMessageOwner() internal view returns (address) {
        MessageStorage.MessageStorageStruct storage ds = MessageStorage.messageStorage();

        // Try to detect if we're in facet mode by checking if we can call owner() on this address
        // In facet mode, address(this) will be the proxy address
        try IDehiveProxy(address(this)).owner() returns (address proxyOwner) {
            // We're in facet mode - use proxy owner
            return proxyOwner;
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
        require(msg.sender == _getMessageOwner(), "Message: caller is not the owner");
        _;
    }

    //============== MESSAGE FUNCTIONS ==============

    /**
     * @notice Send a message directly from the caller's wallet (pay-as-you-go model)
     * @param conversationId The unique identifier for the conversation
     * @param to The address of the message recipient
     * @param encryptedMessage The encrypted message content (must be encrypted client-side using conversation key)
     * @return success Always returns true if execution succeeds
     *
     * @dev This function implements the pay-as-you-go payment model:
     *      - Requires payment of payAsYouGoFee via msg.value
     *      - Any excess payment is automatically refunded to the sender
     *      - The fee is collected and stored in funds[address(this)]
     *      - Emits both FeeCharged and MessageSent events
     *
     * @dev Gas considerations:
     *      - Sending messages costs approximately 60,000-80,000 gas
     *      - Refund transfer adds ~21,000 gas if excess is sent
     *      - Consider using relayer model for bulk messaging to save gas
     *
     * @custom:reverts "Message: insufficient fee payment" if msg.value < payAsYouGoFee
     *
     * @custom:example
     * ```solidity
     * // Calculate conversation ID (off-chain)
     * uint256 convId = uint256(keccak256(abi.encodePacked(msg.sender, recipient)));
     *
     * // Encrypt message client-side
     * string memory encrypted = encryptMessage(message, conversationKey);
     *
     * // Send with exact fee
     * messageContract.sendMessage{value: payAsYouGoFee}(convId, recipient, encrypted);
     * ```
     */
    function sendMessage(uint256 conversationId, address to, string memory encryptedMessage) external payable override returns (bool success) {
        MessageStorage.MessageStorageStruct storage ds = MessageStorage.messageStorage();

        // Validate fee payment
        require(msg.value >= ds.payAsYouGoFee, "Message: insufficient fee payment");

        // Collect the fee into contract balance
        ds.funds[address(this)] += ds.payAsYouGoFee;

        // Refund excess payment to prevent overcharging
        if (msg.value > ds.payAsYouGoFee) {
            payable(msg.sender).transfer(msg.value - ds.payAsYouGoFee);
        }

        // Emit events for off-chain indexing
        emit FeeCharged(ds.payAsYouGoFee, msg.sender, block.timestamp);
        emit MessageSent(conversationId, msg.sender, to, encryptedMessage);
        return true;
    }

    /**
     * @notice Send a message via relayer for users with deposited credits (credit-based model)
     * @param conversationId The unique identifier for the conversation
     * @param from The address of the message sender (must have deposited funds)
     * @param to The address of the message recipient
     * @param encryptedMessage The encrypted message content
     * @param feeAmount The fee amount to charge (must equal current relayerFee)
     * @return success Always returns true if execution succeeds
     *
     * @dev This function implements the credit-based payment model:
     *      - Only callable by the authorized relayer (onlyRelayer modifier)
     *      - Charges the lower relayerFee from the sender's deposited funds
     *      - Validates fee amount to prevent overcharging users
     *      - Emits FeeCharged and MessageSent events
     *
     * @dev Access control:
     *      - Protected by onlyRelayer modifier
     *      - Relayer must be authorized by owner via setRelayer()
     *
     * @dev Security considerations:
     *      - Fee amount is validated to prevent relayer from overcharging
     *      - User must have sufficient deposited funds
     *      - Relayer is trusted to call this function correctly
     *
     * @custom:reverts "Message: invalid fee amount for relayer" if feeAmount != relayerFee
     * @custom:reverts "Message: caller is not the relayer" if called by non-relayer
     * @custom:reverts "Message: user does not have enough funds to pay the fee" if insufficient balance
     *
     * @custom:example
     * ```solidity
     * // Backend relayer calls this after user requests message send
     * messageContract.sendMessageViaRelayer(
     *     conversationId,
     *     userAddress,
     *     recipientAddress,
     *     encryptedMessage,
     *     relayerFee
     * );
     * ```
     */
    function sendMessageViaRelayer(uint256 conversationId, address from, address to, string memory encryptedMessage, uint256 feeAmount) external override onlyRelayer returns (bool success) {
        MessageStorage.MessageStorageStruct storage ds = MessageStorage.messageStorage();

        // Validate fee amount to prevent relayer from overcharging users
        require(feeAmount == ds.relayerFee, "Message: invalid fee amount for relayer");

        // Charge the fee from user's deposited funds
        _chargeUserFunds(from, ds.relayerFee);

        // Emit events for off-chain indexing
        emit FeeCharged(ds.relayerFee, from, block.timestamp);
        emit MessageSent(conversationId, from, to, encryptedMessage);
        return true;
    }

    /**
     * @notice Create a new conversation between the caller and another address
     * @param to The address of the other participant in the conversation
     * @param encryptedConversationKeyForSender The encrypted conversation key for the caller
     * @param encryptedConversationKeyForReceiver The encrypted conversation key for the recipient
     * @return conversationId The unique identifier for the created conversation
     *
     * @dev Conversation ID Generation Algorithm:
     *      1. Order addresses deterministically (smaller < larger)
     *      2. Compute: conversationId = uint256(keccak256(abi.encodePacked(smallerAddress, largerAddress)))
     *      3. This ensures the same conversation ID regardless of who creates it
     *
     * @dev Key Storage:
     *      - Each participant has their own encrypted version of the shared conversation key
     *      - Keys are encrypted using the participant's public key (client-side)
     *      - Only the participant can decrypt their key using their private key
     *
     * @dev Address Ordering:
     *      - Addresses are ordered as smallerAddress < largerAddress
     *      - This deterministic ordering ensures consistent conversation IDs
     *      - The ordering is based on address comparison (address1 < address2)
     *
     * @dev Gas considerations:
     *      - Creating a conversation costs approximately 120,000-150,000 gas
     *      - This is a one-time cost per conversation pair
     *
     * @custom:reverts If any validation fails (currently no explicit reverts, but may revert on state changes)
     *
     * @custom:example
     * ```solidity
     * // Client-side: Generate conversation key and encrypt for both parties
     * bytes32 conversationKey = generateRandomKey();
     * bytes memory keyForMe = encryptForAddress(conversationKey, myPublicKey);
     * bytes memory keyForThem = encryptForAddress(conversationKey, theirPublicKey);
     *
     * // Create conversation
     * uint256 convId = messageContract.createConversation(
     *     theirAddress,
     *     keyForMe,
     *     keyForThem
     * );
     * ```
     */
    function createConversation(address to, bytes calldata encryptedConversationKeyForSender, bytes calldata encryptedConversationKeyForReceiver) external override returns (uint256 conversationId) {
        MessageStorage.MessageStorageStruct storage ds = MessageStorage.messageStorage();

        // Order addresses deterministically to ensure consistent conversation IDs
        (address smallerAddress, address largerAddress) = msg.sender < to ? (msg.sender, to) : (to, msg.sender);

        // Compute deterministic conversation ID using both addresses
        conversationId = uint256(keccak256(abi.encodePacked(smallerAddress, largerAddress)));

        // Store conversation data based on who is the smaller address
        if (smallerAddress == msg.sender) {
            // Caller is smaller address - store keys in order
            ds.conversations[conversationId] = MessageStorage.Conversation(
                smallerAddress,
                largerAddress,
                encryptedConversationKeyForSender,
                encryptedConversationKeyForReceiver,
                block.timestamp
            );
        } else {
            // Caller is larger address - swap key positions to maintain consistency
            ds.conversations[conversationId] = MessageStorage.Conversation(
                largerAddress,
                smallerAddress,
                encryptedConversationKeyForReceiver,
                encryptedConversationKeyForSender,
                block.timestamp
            );
        }

        // Emit event for off-chain indexing
        emit ConversationCreated(conversationId, smallerAddress, largerAddress, block.timestamp);
        return conversationId;
    }

    /**
     * @notice Get the encrypted conversation key for the caller
     * @param conversationId The unique identifier for the conversation
     * @return encryptedConversationKeyForMe The encrypted conversation key specific to the caller
     *
     * @dev This function retrieves the caller's encrypted conversation key:
     *      - Only participants in the conversation can retrieve their key
     *      - The key is encrypted using the participant's public key
     *      - The caller must decrypt the key client-side using their private key
     *
     * @dev Key Retrieval Logic:
     *      - If caller is the smaller address: return encryptedConversationKeyForSmallerAddress
     *      - If caller is the larger address: return encryptedConversationKeyForLargerAddress
     *      - Otherwise: revert (not a participant)
     *
     * @dev Usage Flow:
     *      1. User calls this function to get their encrypted key
     *      2. Client decrypts the key using user's private key
     *      3. Decrypted key is used to encrypt/decrypt messages in the conversation
     *
     * @custom:reverts "Message: conversation does not exist" if conversationId doesn't exist
     * @custom:reverts "Message: caller is not a participant in this conversation" if caller is not a participant
     *
     * @custom:example
     * ```solidity
     * // Get encrypted key from contract
     * bytes memory encryptedKey = messageContract.getMyEncryptedConversationKeys(convId);
     *
     * // Decrypt client-side using private key
     * bytes32 conversationKey = decrypt(encryptedKey, myPrivateKey);
     *
     * // Use key to encrypt messages
     * string memory encrypted = encryptMessage(message, conversationKey);
     * ```
     */
    function getMyEncryptedConversationKeys(uint256 conversationId) external view override returns (bytes memory encryptedConversationKeyForMe) {
        MessageStorage.MessageStorageStruct storage ds = MessageStorage.messageStorage();

        // Load conversation data
        MessageStorage.Conversation storage conv = ds.conversations[conversationId];

        // Verify conversation exists (createdAt > 0 indicates existence)
        require(conv.createdAt > 0, "Message: conversation does not exist");

        // Return the appropriate encrypted key based on caller's address
        if (msg.sender == conv.smallerAddress) {
            return conv.encryptedConversationKeyForSmallerAddress;
        } else if (msg.sender == conv.largerAddress) {
            return conv.encryptedConversationKeyForLargerAddress;
        } else {
            // Caller is not a participant in this conversation
            revert("Message: caller is not a participant in this conversation");
        }
    }

    /**
     * @notice Internal function to charge fees from user's deposited funds
     * @param user The address of the user to charge
     * @param amount The amount to charge from the user's balance
     *
     * @dev This function:
     *      - Validates the user has sufficient funds
     *      - Deducts the amount from the user's balance
     *      - Does not move funds to contract balance (funds remain in contract)
     *
     * @custom:reverts "Message: user does not have enough funds to pay the fee" if insufficient balance
     */
    function _chargeUserFunds(address user, uint256 amount) internal {
        MessageStorage.MessageStorageStruct storage ds = MessageStorage.messageStorage();

        // Validate user has sufficient deposited funds
        require(ds.funds[user] >= amount, "Message: user does not have enough funds to pay the fee");

        // Deduct the fee from user's deposited balance
        ds.funds[user] -= amount;
        // Note: Funds remain in contract balance (no explicit transfer needed)
    }

    //============== FUNDS FUNCTIONS ==============

    /**
     * @notice Deposit ETH to enable credit-based messaging via relayer
     * @dev This function allows users to deposit ETH that will be used for relayer fees.
     *      Deposited funds are non-refundable and must be consumed through message fees.
     *
     * @dev Deposit Behavior:
     *      - Deposits are added to the caller's balance in the funds mapping
     *      - Funds can only be used for relayer-based message sending
     *      - No withdrawal function exists - funds must be consumed
     *      - Minimum deposit is enforced via msg.value > 0 check
     *
     * @dev Gas considerations:
     *      - Depositing funds costs approximately 45,000-55,000 gas
     *      - Consider depositing larger amounts to reduce transaction frequency
     *
     * @custom:reverts "Message: must send ETH" if msg.value is 0
     *
     * @custom:example
     * ```solidity
     * // Deposit 0.01 ETH for credit-based messaging
     * // This allows ~100 messages at relayerFee of 0.0001 ether
     * messageContract.depositFunds{value: 0.01 ether}();
     * ```
     */
    function depositFunds() external payable override {
        MessageStorage.MessageStorageStruct storage ds = MessageStorage.messageStorage();

        // Validate that ETH is being sent
        require(msg.value > 0, "Message: must send ETH");

        // Add deposited amount to user's balance
        ds.funds[msg.sender] += msg.value;

        // Emit event for off-chain tracking
        emit FundsDeposited(msg.value, msg.sender, block.timestamp);
    }

    //============== FEE FUNCTIONS ==============

    /**
     * @notice Update the pay-as-you-go fee for direct message sending
     * @param newPayAsYouGoFee The new fee amount in wei
     *
     * @dev This function allows the owner to adjust the pay-as-you-go fee.
     *      This fee is charged when users send messages directly via sendMessage().
     *
     * @dev Fee Strategy:
     *      - Should be higher than relayerFee to incentivize credit deposits
     *      - Consider gas costs when setting fee amounts
     *      - Fee changes take effect immediately
     *
     * @custom:security Only callable by owner (proxy owner in facet mode, stored owner in standalone mode)
     *
     * @custom:reverts "Message: Pay as you go fee must be greater than 0" if newPayAsYouGoFee is 0
     *
     * @custom:example
     * ```solidity
     * // Owner sets pay-as-you-go fee to 0.0002 ether
     * messageContract.setPayAsYouGoFee(0.0002 ether);
     * ```
     */
    function setPayAsYouGoFee(uint256 newPayAsYouGoFee) external override onlyOwner {
        MessageStorage.MessageStorageStruct storage ds = MessageStorage.messageStorage();

        // Validate fee is greater than zero
        require(newPayAsYouGoFee > 0, "Message: Pay as you go fee must be greater than 0");

        // Update fee
        ds.payAsYouGoFee = newPayAsYouGoFee;

        // Emit event for off-chain tracking
        emit PayAsYouGoFeeSet(newPayAsYouGoFee, block.timestamp);
    }

    /**
     * @notice Update the relayer fee for credit-based message sending
     * @param newRelayerFee The new fee amount in wei
     *
     * @dev This function allows the owner to adjust the relayer fee.
     *      This fee is charged when relayer sends messages via sendMessageViaRelayer().
     *
     * @dev Fee Strategy:
     *      - Should be lower than payAsYouGoFee to incentivize credit deposits
     *      - Lower fees encourage users to deposit credits and use relayer
     *      - Fee changes take effect immediately
     *
     * @custom:security Only callable by owner (proxy owner in facet mode, stored owner in standalone mode)
     *
     * @custom:reverts "Message: Relayer fee must be greater than 0" if newRelayerFee is 0
     *
     * @custom:example
     * ```solidity
     * // Owner sets relayer fee to 0.0001 ether
     * messageContract.setRelayerFee(0.0001 ether);
     * ```
     */
    function setRelayerFee(uint256 newRelayerFee) external override onlyOwner {
        MessageStorage.MessageStorageStruct storage ds = MessageStorage.messageStorage();

        // Validate fee is greater than zero
        require(newRelayerFee > 0, "Message: Relayer fee must be greater than 0");

        // Update fee
        ds.relayerFee = newRelayerFee;

        // Emit event for off-chain tracking
        emit RelayerFeeSet(newRelayerFee, block.timestamp);
    }

    //============== RELAYER FUNCTIONS ==============

    /**
     * @notice Set or update the relayer address authorized to send messages via relayer
     * @param newRelayer The address of the new relayer
     *
     * @dev This function allows the owner to set or update the relayer address.
     *      The relayer is authorized to call sendMessageViaRelayer() on behalf of users.
     *
     * @dev Relayer Responsibilities:
     *      - Must call sendMessageViaRelayer with correct fee amounts
     *      - Must send messages on behalf of users who have deposited funds
     *      - Should verify user authorization before sending messages
     *
     * @dev Security Considerations:
     *      - Relayer is trusted to charge correct fees
     *      - Relayer cannot overcharge (fee amount is validated in sendMessageViaRelayer)
     *      - Only one relayer can be set at a time
     *
     * @custom:security Only callable by owner (proxy owner in facet mode, stored owner in standalone mode)
     *
     * @custom:reverts "Message: Relayer cannot be zero address" if newRelayer is address(0)
     *
     * @custom:example
     * ```solidity
     * // Owner sets relayer address
     * messageContract.setRelayer(relayerAddress);
     * ```
     */
    function setRelayer(address newRelayer) external override onlyOwner {
        MessageStorage.MessageStorageStruct storage ds = MessageStorage.messageStorage();

        // Validate relayer is not zero address
        require(newRelayer != address(0), "Message: Relayer cannot be zero address");

        // Update relayer address
        ds.relayer = newRelayer;

        // Emit event for off-chain tracking
        emit RelayerSet(newRelayer, block.timestamp);
    }

    /**
     * @notice Internal function to check if an address is the authorized relayer
     * @param user The address to check
     * @return True if the address is the authorized relayer, false otherwise
     *
     * @dev This is a helper function used by the onlyRelayer modifier
     */
    function _isRelayer(address user) internal view returns (bool) {
        return user == MessageStorage.messageStorage().relayer;
    }

    /**
     * @notice Modifier to restrict function access to authorized relayer only
     *
     * @dev This modifier ensures that only the authorized relayer can call
     *      functions protected by it (e.g., sendMessageViaRelayer).
     *
     * @custom:reverts "Message: caller is not the relayer" if caller is not the authorized relayer
     */
    modifier onlyRelayer() {
        require(_isRelayer(msg.sender), "Message: caller is not the relayer");
        _;
    }

}
