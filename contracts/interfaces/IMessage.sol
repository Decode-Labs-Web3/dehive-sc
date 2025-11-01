// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title IMessage
 * @notice Interface for the Message contract implementing a two-tier fee messaging system
 * @dev This interface defines the messaging protocol with support for:
 *      - Direct message sending (pay-as-you-go with higher fees)
 *      - Relayer-based message sending (credit system with lower fees)
 *      - Encrypted conversations with per-user encryption keys
 *      - Fee management and fund deposits
 *
 * @custom:usage The messaging system supports two payment models:
 *      - Pay-as-you-go: Users send messages directly with ETH payment (higher fee)
 *      - Credit-based: Users deposit ETH, then relayer sends messages on their behalf (lower fee)
 *
 * @custom:dualmode This interface supports both standalone and facet modes:
 *      - Standalone: Deployed as a regular contract, uses constructor for initialization
 *      - Facet: Installed in DehiveProxy, uses init() function for initialization
 */
interface IMessage {
    //============== INITIALIZATION ==============

    /**
     * @notice Initialize the Message facet (for facet mode)
     * @param owner The address that will own the facet (should be proxy owner)
     * @dev This function is called when the facet is installed in the DehiveProxy.
     *      It initializes the Diamond Storage with default values.
     *      Can only be called once per deployment.
     *
     * @dev In standalone mode, the constructor initializes the contract.
     *      In facet mode, init() is called via delegatecall through the proxy.
     *
     * @custom:reverts "Message: already initialized" if called more than once
     */
    function init(address owner) external;
    //============== EVENTS ==============

    /**
     * @notice Emitted when a message is sent successfully
     * @param conversationId The unique identifier for the conversation (hash of both addresses)
     * @param from The address sending the message
     * @param to The address receiving the message
     * @param encryptedMessage The encrypted message content (client-side encryption required)
     * @dev The message content should be encrypted using the conversation key before calling sendMessage
     */
    event MessageSent(
        uint256 indexed conversationId,
        address indexed from,
        address indexed to,
        string encryptedMessage
    );

    /**
     * @notice Emitted when a new conversation is created between two users
     * @param conversationId The unique identifier for the conversation (hash of both addresses)
     * @param smallerAddress The smaller address in the conversation pair (deterministic ordering)
     * @param largerAddress The larger address in the conversation pair (deterministic ordering)
     * @param createdAt The timestamp when the conversation was created
     * @dev Conversation IDs are deterministic and can be computed off-chain for any two addresses
     */
    event ConversationCreated(
        uint256 indexed conversationId,
        address indexed smallerAddress,
        address indexed largerAddress,
        uint256 createdAt
    );

    /**
     * @notice Emitted when the relayer address is updated
     * @param relayer The new relayer address authorized to send messages via relayer
     * @param createdAt The timestamp when the relayer was set
     * @dev Only the contract owner can set the relayer address
     */
    event RelayerSet(
        address indexed relayer,
        uint256 createdAt
    );

    /**
     * @notice Emitted when a user deposits funds for credit-based messaging
     * @param amount The amount of ETH deposited
     * @param from The address that deposited the funds
     * @param createdAt The timestamp when the deposit was made
     * @dev Deposited funds can only be used for messaging (no withdrawal supported)
     */
    event FundsDeposited(
        uint256 amount,
        address indexed from,
        uint256 createdAt
    );

    /**
     * @notice Emitted when a fee is charged for sending a message
     * @param amount The fee amount charged
     * @param from The address that paid the fee
     * @param createdAt The timestamp when the fee was charged
     * @dev Emitted for both pay-as-you-go and relayer-based message sending
     */
    event FeeCharged(
        uint256 amount,
        address indexed from,
        uint256 createdAt
    );

    /**
     * @notice Emitted when the pay-as-you-go fee is updated
     * @param amount The new fee amount for direct message sends
     * @param createdAt The timestamp when the fee was updated
     * @dev Only the contract owner can update this fee
     */
    event PayAsYouGoFeeSet(
        uint256 amount,
        uint256 createdAt
    );

    /**
     * @notice Emitted when the relayer fee is updated
     * @param amount The new fee amount for relayer-based message sends
     * @param createdAt The timestamp when the fee was updated
     * @dev Only the contract owner can update this fee. Must be less than pay-as-you-go fee.
     */
    event RelayerFeeSet(
        uint256 amount,
        uint256 createdAt
    );
    //============== MESSAGE FUNCTIONS ==============

    /**
     * @notice Send a message directly from the caller's wallet (pay-as-you-go model)
     * @param conversationId The unique identifier for the conversation
     * @param to The address of the message recipient
     * @param encryptedMessage The encrypted message content (must be encrypted client-side)
     * @return success True if the message was sent successfully
     * @dev Requires payment of payAsYouGoFee via msg.value. Any excess will be refunded.
     *      The conversation must exist before sending messages.
     *      The message content must be encrypted using the conversation key.
     *
     * @custom:example
     * ```solidity
     * // Calculate conversation ID
     * uint256 convId = uint256(keccak256(abi.encodePacked(sender, recipient)));
     *
     * // Encrypt message (client-side)
     * string memory encrypted = encrypt(message, conversationKey);
     *
     * // Send with fee payment
     * messageContract.sendMessage{value: payAsYouGoFee}(convId, recipient, encrypted);
     * ```
     */
    function sendMessage(
        uint256 conversationId,
        address to,
        string memory encryptedMessage) external payable returns (bool success);

    /**
     * @notice Send a message via relayer for users with deposited credits (credit-based model)
     * @param conversationId The unique identifier for the conversation
     * @param from The address of the message sender (must have deposited funds)
     * @param to The address of the message recipient
     * @param encryptedMessage The encrypted message content
     * @param feeAmount The fee amount to charge (must equal current relayerFee)
     * @return success True if the message was sent successfully
     * @dev Only callable by the authorized relayer.
     *      Charges the lower relayerFee from the sender's deposited funds.
     *      The sender must have sufficient deposited funds.
     *
     * @custom:security The relayer fee amount is validated to prevent overcharging users.
     */
    function sendMessageViaRelayer(
        uint256 conversationId,
        address from,
        address to,
        string memory encryptedMessage,
        uint256 feeAmount) external returns (bool success);

    //============== CONVERSATION FUNCTIONS ==============

    /**
     * @notice Create a new conversation between the caller and another address
     * @param to The address of the other participant in the conversation
     * @param encryptedConversationKeyForSender The encrypted conversation key for the sender
     * @param encryptedConversationKeyForReceiver The encrypted conversation key for the receiver
     * @return conversationId The unique identifier for the created conversation
     * @dev The conversationId is deterministic and can be computed off-chain:
     *      conversationId = uint256(keccak256(abi.encodePacked(smallerAddress, largerAddress)))
     *      Addresses are ordered to ensure consistent conversation IDs regardless of who creates it.
     *      Each participant must have their own encrypted version of the shared conversation key.
     *
     * @custom:example
     * ```solidity
     * // Generate conversation key (client-side)
     * bytes32 conversationKey = generateKey();
     *
     * // Encrypt for both participants (client-side)
     * bytes memory keyForSender = encryptToAddress(conversationKey, senderPublicKey);
     * bytes memory keyForReceiver = encryptToAddress(conversationKey, receiverPublicKey);
     *
     * // Create conversation
     * uint256 convId = messageContract.createConversation(
     *     receiver,
     *     keyForSender,
     *     keyForReceiver
     * );
     * ```
     */
    function createConversation(
        address to,
        bytes calldata encryptedConversationKeyForSender,
        bytes calldata encryptedConversationKeyForReceiver
    ) external returns (uint256 conversationId);

    /**
     * @notice Get the encrypted conversation key for the caller
     * @param conversationId The unique identifier for the conversation
     * @return encryptedConversationKeyForMe The encrypted conversation key specific to the caller
     * @dev Only participants in the conversation can retrieve their encrypted key.
     *      The caller must decrypt this key client-side using their private key.
     *
     * @custom:example
     * ```solidity
     * bytes memory encryptedKey = messageContract.getMyEncryptedConversationKeys(convId);
     * bytes32 conversationKey = decrypt(encryptedKey, myPrivateKey);
     * ```
     */
    function getMyEncryptedConversationKeys(
        uint256 conversationId
    ) external view returns (bytes memory encryptedConversationKeyForMe);

    //============== VIEW FUNCTIONS ==============

    /**
     * @notice Get the pay-as-you-go fee
     * @return The current pay-as-you-go fee
     */
    function payAsYouGoFee() external view returns (uint256);

    /**
     * @notice Get the relayer fee
     * @return The current relayer fee
     */
    function relayerFee() external view returns (uint256);

    /**
     * @notice Get the relayer address
     * @return The current relayer address
     */
    function relayer() external view returns (address);

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
    );

    /**
     * @notice Get user's deposited funds balance
     * @param user The user address
     * @return The user's deposited funds balance
     */
    function funds(address user) external view returns (uint256);

    /**
     * @notice Get the owner address
     * @return The owner address (proxy owner in facet mode, stored owner in standalone mode)
     */
    function owner() external view returns (address);

    //============== FUNDS FUNCTIONS ==============

    /**
     * @notice Deposit ETH to enable credit-based messaging via relayer
     * @dev Deposited funds can only be used for messaging through the relayer.
     *      Deposits are non-refundable and must be consumed through message fees.
     *      The deposited amount is stored in the funds mapping for the caller.
     *
     * @custom:example
     * ```solidity
     * // Deposit 0.01 ETH for 100 messages at relayerFee
     * messageContract.depositFunds{value: 0.01 ether}();
     * ```
     */
    function depositFunds() external payable;

    //============== FEE FUNCTIONS ==============

    /**
     * @notice Update the pay-as-you-go fee for direct message sending
     * @param newPayAsYouGoFee The new fee amount in wei
     * @dev Only callable by the contract owner. Must be greater than 0.
     *      This fee should be higher than the relayer fee to incentivize credit deposits.
     */
    function setPayAsYouGoFee(uint256 newPayAsYouGoFee) external;

    /**
     * @notice Update the relayer fee for credit-based message sending
     * @param newRelayerFee The new fee amount in wei
     * @dev Only callable by the contract owner. Must be greater than 0.
     *      This fee should be lower than the pay-as-you-go fee to incentivize credit deposits.
     */
    function setRelayerFee(uint256 newRelayerFee) external;

    //============== RELAYER FUNCTIONS ==============

    /**
     * @notice Set or update the relayer address authorized to send messages via relayer
     * @param relayer The address of the new relayer
     * @dev Only callable by the contract owner. The relayer cannot be the zero address.
     *      The relayer is trusted to call sendMessageViaRelayer correctly and charge appropriate fees.
     */
    function setRelayer(address relayer) external;

}
