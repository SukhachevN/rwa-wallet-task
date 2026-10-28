// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// ERC-3643 Identity Registry Interface
interface IIdentityRegistry {
    function isVerified(address _userAddress) external view returns (bool);
    function identity(address _userAddress) external view returns (bytes32);
}

contract RWAHubKYC is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable,
    IIdentityRegistry
{
    using SafeERC20 for IERC20;

    // Roles
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant WITHDRAWER_ROLE = keccak256("WITHDRAWER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant CONFIGURATOR_ROLE = keccak256("CONFIGURATOR_ROLE");

    // Enums
    enum KYCStatus { Pending, Verified, Rejected }
    enum RiskLevel { Low, Medium, High }

    // Structs
    struct KYCData {
        address user;
        KYCStatus status;
        bytes32 identityId; // Unique identifier (hash of user data)
        bool idVerified;
        bool addressVerified;
        string governmentId; // IPFS URI or hash
        string proofOfAddress; // IPFS URI or hash
        string[] additionalDocs; // Additional document URIs
        string nationality;
        RiskLevel riskLevel;
        uint256 verificationDate;
        uint256 lastReviewDate;
        address verifiedBy;
    }

    struct VerificationRequirements {
        bool requireId;
        bool requireAddress;
        bool requireAdditionalDocs;
        uint256 minDocsCount;
    }

    // Storage
    mapping(address => KYCData) public kycData;
    mapping(address => KYCData[]) public kycHistory; // Historical KYC submissions
    address[] public pendingUsers;
    mapping(address => uint256) private pendingUserIndex; // 1-based index into pendingUsers
    VerificationRequirements public verificationRequirements;
    bool public selfVerifyEnabled;

    // Events
    event KYCSubmitted(address indexed user, bytes32 indexed identityId);
    event KYCVerified(address indexed user, address indexed validator, bytes32 indexed identityId);
    event KYCRejected(address indexed user, address indexed validator, bytes32 indexed identityId);
    event KYCRevoked(address indexed user, address indexed validator, bytes32 indexed identityId);
    event DocumentsUpdated(address indexed user, bytes32 indexed identityId);
    event BatchKYCVerified(address[] users, address indexed validator);
    event BatchKYCRejected(address[] users, address indexed validator);
    event VerificationRequirementsUpdated(
        bool requireId,
        bool requireAddress,
        bool requireAdditionalDocs,
        uint256 minDocsCount
    );
    event FundsWithdrawn(address indexed token, address indexed recipient, uint256 amount);

    uint256[44] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initializes the contract with default verification requirements.
     */
    function initialize() public initializer {
        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(VALIDATOR_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
        _grantRole(WITHDRAWER_ROLE, msg.sender);
        _grantRole(UPGRADER_ROLE, msg.sender);
        _grantRole(CONFIGURATOR_ROLE, msg.sender);

        verificationRequirements = VerificationRequirements({
            requireId: true,
            requireAddress: true,
            requireAdditionalDocs: false,
            minDocsCount: 0
        });

        emit VerificationRequirementsUpdated(true, true, false, 0);
    }

    // UUPS Upgradeable
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(UPGRADER_ROLE) {}

    function setSelfVerifyEnabled(bool enabled) external onlyRole(ADMIN_ROLE) {
        selfVerifyEnabled = enabled;
    }

    /// @dev Local-demo helper so a connected wallet can pass marketplace KYC checks in the UI.
    function selfVerify() external whenNotPaused {
        require(selfVerifyEnabled, "Self-verify disabled");

        KYCData storage data = kycData[msg.sender];
        data.user = msg.sender;
        data.status = KYCStatus.Verified;
        data.identityId = keccak256(abi.encodePacked(msg.sender, block.timestamp));
        data.idVerified = true;
        data.addressVerified = true;
        data.verificationDate = block.timestamp;
        data.lastReviewDate = block.timestamp;
        data.verifiedBy = msg.sender;

        _removePending(msg.sender);
        emit KYCVerified(msg.sender, msg.sender, data.identityId);
    }

    // Pausable Functions
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function _hasSubmission(address user) internal view returns (bool) {
        return kycData[user].user != address(0);
    }

    function _addPending(address user) internal {
        if (pendingUserIndex[user] != 0) {
            return;
        }
        pendingUsers.push(user);
        pendingUserIndex[user] = pendingUsers.length;
    }

    function _removePending(address user) internal {
        uint256 index = pendingUserIndex[user];
        if (index == 0) {
            return;
        }

        uint256 lastIndex = pendingUsers.length;
        address lastUser = pendingUsers[lastIndex - 1];
        if (index != lastIndex) {
            pendingUsers[index - 1] = lastUser;
            pendingUserIndex[lastUser] = index;
        }
        pendingUsers.pop();
        pendingUserIndex[user] = 0;
    }

    function _validateDocumentRequirements(
        string memory governmentId,
        string memory proofOfAddress,
        string[] memory additionalDocs
    ) internal view {
        require(
            !verificationRequirements.requireId || bytes(governmentId).length > 0,
            "Government ID required"
        );
        require(
            !verificationRequirements.requireAddress || bytes(proofOfAddress).length > 0,
            "Proof of address required"
        );
        require(
            !verificationRequirements.requireAdditionalDocs ||
            additionalDocs.length >= verificationRequirements.minDocsCount,
            "Insufficient additional documents"
        );
    }

    // KYC Submission
    /**
     * @dev Submits KYC data for verification.
     * @param governmentId IPFS URI or hash of government ID.
     * @param proofOfAddress IPFS URI or hash of proof of address.
     * @param additionalDocs Array of additional document URIs.
     * @param nationality User's nationality (e.g., ISO 3166-1 alpha-2 code).
     */
    function submitKYC(
        string memory governmentId,
        string memory proofOfAddress,
        string[] memory additionalDocs,
        string memory nationality
    ) external whenNotPaused {
        require(kycData[msg.sender].status != KYCStatus.Verified, "KYC already verified");
        _validateDocumentRequirements(governmentId, proofOfAddress, additionalDocs);

        // Generate unique identityId
        bytes32 identityId = keccak256(
            abi.encodePacked(msg.sender, governmentId, proofOfAddress, nationality, block.timestamp)
        );

        // Store current data in history only if a real submission already exists
        if (_hasSubmission(msg.sender) && kycData[msg.sender].status != KYCStatus.Pending) {
            kycHistory[msg.sender].push(kycData[msg.sender]);
        }

        // Update KYC data
        KYCData storage data = kycData[msg.sender];
        data.user = msg.sender;
        data.status = KYCStatus.Pending;
        data.identityId = identityId;
        data.governmentId = governmentId;
        data.proofOfAddress = proofOfAddress;
        data.additionalDocs = additionalDocs;
        data.nationality = nationality;
        data.riskLevel = RiskLevel.Low; // Default, updated during verification
        data.verificationDate = 0;
        data.lastReviewDate = block.timestamp;
        data.verifiedBy = address(0);
        data.idVerified = false;
        data.addressVerified = false;

        _addPending(msg.sender);

        emit KYCSubmitted(msg.sender, identityId);
    }

    // KYC Verification
    /**
     * @dev Verifies KYC data for a user.
     * @param user The user to verify.
     * @param idVerified Whether the ID is verified.
     * @param addressVerified Whether the address is verified.
     * @param riskLevel The assessed risk level.
     */
    function verifyKYC(
        address user,
        bool idVerified,
        bool addressVerified,
        RiskLevel riskLevel
    ) external onlyRole(VALIDATOR_ROLE) {
        require(user != address(0), "Invalid user");
        require(_hasSubmission(user), "No KYC submission");
        require(kycData[user].status == KYCStatus.Pending, "Invalid KYC status");
        require(
            !verificationRequirements.requireId || idVerified,
            "ID verification required"
        );
        require(
            !verificationRequirements.requireAddress || addressVerified,
            "Address verification required"
        );

        KYCData storage data = kycData[user];
        data.status = KYCStatus.Verified;
        data.idVerified = idVerified;
        data.addressVerified = addressVerified;
        data.riskLevel = riskLevel;
        data.verificationDate = block.timestamp;
        data.lastReviewDate = block.timestamp;
        data.verifiedBy = msg.sender;

        _removePending(user);

        emit KYCVerified(user, msg.sender, data.identityId);
    }

    /**
     * @dev Verifies KYC data for multiple users in a batch.
     * @param users Array of users to verify.
     * @param idVerifieds Array of ID verification statuses.
     * @param addressVerifieds Array of address verification statuses.
     * @param riskLevels Array of risk levels.
     */
    function batchVerifyKYC(
        address[] memory users,
        bool[] memory idVerifieds,
        bool[] memory addressVerifieds,
        RiskLevel[] memory riskLevels
    ) external onlyRole(VALIDATOR_ROLE) {
        require(
            users.length == idVerifieds.length &&
            idVerifieds.length == addressVerifieds.length &&
            addressVerifieds.length == riskLevels.length,
            "Array length mismatch"
        );

        for (uint256 i = 0; i < users.length; i++) {
            require(users[i] != address(0), "Invalid user");
            require(_hasSubmission(users[i]), "No KYC submission");
            require(kycData[users[i]].status == KYCStatus.Pending, "Invalid KYC status for user");
            require(
                !verificationRequirements.requireId || idVerifieds[i],
                "ID verification required"
            );
            require(
                !verificationRequirements.requireAddress || addressVerifieds[i],
                "Address verification required"
            );

            KYCData storage data = kycData[users[i]];
            data.status = KYCStatus.Verified;
            data.idVerified = idVerifieds[i];
            data.addressVerified = addressVerifieds[i];
            data.riskLevel = riskLevels[i];
            data.verificationDate = block.timestamp;
            data.lastReviewDate = block.timestamp;
            data.verifiedBy = msg.sender;

            _removePending(users[i]);

            emit KYCVerified(users[i], msg.sender, data.identityId);
        }

        emit BatchKYCVerified(users, msg.sender);
    }

    /**
     * @dev Rejects KYC data for a user.
     * @param user The user to reject.
     */
    function rejectKYC(address user) external onlyRole(VALIDATOR_ROLE) {
        require(user != address(0), "Invalid user");
        require(_hasSubmission(user), "No KYC submission");
        require(kycData[user].status == KYCStatus.Pending, "Invalid KYC status");

        kycData[user].status = KYCStatus.Rejected;
        kycData[user].lastReviewDate = block.timestamp;

        _removePending(user);

        emit KYCRejected(user, msg.sender, kycData[user].identityId);
    }

    /**
     * @dev Rejects KYC data for multiple users in a batch.
     * @param users Array of users to reject.
     */
    function batchRejectKYC(address[] memory users) external onlyRole(VALIDATOR_ROLE) {
        for (uint256 i = 0; i < users.length; i++) {
            require(users[i] != address(0), "Invalid user");
            require(_hasSubmission(users[i]), "No KYC submission");
            require(kycData[users[i]].status == KYCStatus.Pending, "Invalid KYC status");

            kycData[users[i]].status = KYCStatus.Rejected;
            kycData[users[i]].lastReviewDate = block.timestamp;

            _removePending(users[i]);

            emit KYCRejected(users[i], msg.sender, kycData[users[i]].identityId);
        }

        emit BatchKYCRejected(users, msg.sender);
    }

    /**
     * @dev Revokes a previously verified KYC record.
     */
    function revokeKYC(address user) external onlyRole(VALIDATOR_ROLE) {
        require(user != address(0), "Invalid user");
        require(kycData[user].status == KYCStatus.Verified, "User is not verified");

        kycHistory[user].push(kycData[user]);
        kycData[user].status = KYCStatus.Rejected;
        kycData[user].lastReviewDate = block.timestamp;

        emit KYCRevoked(user, msg.sender, kycData[user].identityId);
    }

    // Document Updates
    /**
     * @dev Updates KYC documents for a user.
     * @param governmentId New government ID URI.
     * @param proofOfAddress New proof of address URI.
     * @param additionalDocs New additional document URIs.
     * @param nationality New nationality.
     */
    function updateDocuments(
        string memory governmentId,
        string memory proofOfAddress,
        string[] memory additionalDocs,
        string memory nationality
    ) external whenNotPaused {
        require(_hasSubmission(msg.sender), "No KYC submission");
        require(kycData[msg.sender].status != KYCStatus.Verified, "KYC already verified");
        _validateDocumentRequirements(governmentId, proofOfAddress, additionalDocs);

        // Store current data in history
        kycHistory[msg.sender].push(kycData[msg.sender]);

        // Generate new identityId
        bytes32 identityId = keccak256(
            abi.encodePacked(msg.sender, governmentId, proofOfAddress, nationality, block.timestamp)
        );

        // Update KYC data
        KYCData storage data = kycData[msg.sender];
        data.governmentId = governmentId;
        data.proofOfAddress = proofOfAddress;
        data.additionalDocs = additionalDocs;
        data.nationality = nationality;
        data.status = KYCStatus.Pending;
        data.identityId = identityId;
        data.lastReviewDate = block.timestamp;
        data.idVerified = false;
        data.addressVerified = false;
        data.verifiedBy = address(0);

        _addPending(msg.sender);

        emit DocumentsUpdated(msg.sender, identityId);
    }

    // Configuration
    /**
     * @dev Updates verification requirements.
     * @param requireId Whether ID verification is required.
     * @param requireAddress Whether address verification is required.
     * @param requireAdditionalDocs Whether additional documents are required.
     * @param minDocsCount Minimum number of additional documents.
     */
    function updateVerificationRequirements(
        bool requireId,
        bool requireAddress,
        bool requireAdditionalDocs,
        uint256 minDocsCount
    ) external onlyRole(CONFIGURATOR_ROLE) {
        if (requireAdditionalDocs) {
            require(minDocsCount > 0, "minDocsCount must be greater than 0");
        }

        verificationRequirements = VerificationRequirements({
            requireId: requireId,
            requireAddress: requireAddress,
            requireAdditionalDocs: requireAdditionalDocs,
            minDocsCount: minDocsCount
        });

        emit VerificationRequirementsUpdated(requireId, requireAddress, requireAdditionalDocs, minDocsCount);
    }

    // Fund Withdrawal
    /**
     * @dev Withdraws stuck ETH or ERC-20 tokens.
     * @param token The token address (address(0) for ETH).
     * @param recipient The recipient address.
     * @param amount The amount to withdraw.
     */
    function withdrawFunds(address token, address recipient, uint256 amount)
        external
        onlyRole(WITHDRAWER_ROLE)
        nonReentrant
    {
        require(recipient != address(0), "Invalid recipient");
        require(amount > 0, "Amount must be greater than 0");

        if (token == address(0)) {
            require(address(this).balance >= amount, "Insufficient ETH balance");
            (bool success, ) = recipient.call{value: amount}("");
            require(success, "ETH withdrawal failed");
        } else {
            IERC20 paymentToken = IERC20(token);
            require(paymentToken.balanceOf(address(this)) >= amount, "Insufficient token balance");
            paymentToken.safeTransfer(recipient, amount);
        }

        emit FundsWithdrawn(token, recipient, amount);
    }

    // IIdentityRegistry Implementation
    /**
     * @dev Checks if a user is verified.
     * @param userAddress The user address.
     * @return True if verified, false otherwise.
     */
    function isVerified(address userAddress) external view override returns (bool) {
        return kycData[userAddress].status == KYCStatus.Verified;
    }

    /**
     * @dev Returns the unique identity ID for a user.
     * @param userAddress The user address.
     * @return The identity ID (bytes32).
     */
    function identity(address userAddress) external view override returns (bytes32) {
        return kycData[userAddress].identityId;
    }

    // View Functions
    /**
     * @dev Returns the KYC status of a user.
     * @param user The user address.
     * @return The KYC status.
     */
    function getKYCStatus(address user) external view returns (KYCStatus) {
        return kycData[user].status;
    }

    /**
     * @dev Returns the full KYC data for a user.
     * @param user The user address.
     * @return The KYCData struct.
     */
    function getKYCData(address user) external view returns (KYCData memory) {
        return kycData[user];
    }

    /**
     * @dev Returns the KYC history for a user.
     * @param user The user address.
     * @return Array of historical KYCData.
     */
    function getUserHistory(address user) external view returns (KYCData[] memory) {
        return kycHistory[user];
    }

    /**
     * @dev Returns all users with pending KYC submissions.
     * @return Array of pending user addresses.
     */
    function getAllPendingUsers() external view returns (address[] memory) {
        return pendingUsers;
    }

    /**
     * @dev Returns the current verification requirements.
     * @return The VerificationRequirements struct.
     */
    function getVerificationRequirements() external view returns (VerificationRequirements memory) {
        return verificationRequirements;
    }

    // Fallback to receive ETH
    receive() external payable {}
}
