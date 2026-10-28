// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC1155/utils/ERC1155HolderUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC1155/utils/ERC1155ReceiverUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// ERC-3643 Interfaces
interface IIdentityRegistry {
    function isVerified(address _userAddress) external view returns (bool);
    function identity(address _userAddress) external view returns (bytes32);
}

interface ICompliance {
    function canTransfer(address _from, address _to, uint256 _id, uint256 _amount) external view returns (bool);
    function transferred(address _from, address _to, uint256 _id, uint256 _amount) external;
}

contract RWAHubMarketplace is
    Initializable,
    ERC1155Upgradeable,
    ERC1155HolderUpgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    // Roles
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant WITHDRAWER_ROLE = keccak256("WITHDRAWER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    // Counters
    uint256 private _assetIds;
    uint256 private _listingIds;

    // Enums
    enum AssetStatus { Pending, Validated, Rejected, ActionRequired }
    enum ListingType { Fixed, Auction, Swap }
    enum TokenizationType { Fractional, Whole }

    // Structs
    struct Asset {
        uint256 id;
        address owner;
        string title;
        string description;
        string category;
        AssetStatus status;
        uint256 price;
        TokenizationType tokenizationType;
        uint256 totalTokens;
        uint256 availableTokens;
        uint256 pricePerToken;
        ListingType listingType;
        bool isVerified;
        uint256 createdAt;
        uint256 updatedAt;
        uint256 auctionEndTime;
        address royaltyReceiver;
        uint96 royaltyFraction;
    }

    struct Listing {
        uint256 id;
        uint256 assetId;
        address seller;
        address paymentToken; // address(0) for ETH
        uint256 price;
        uint256 tokenAmount;
        ListingType listingType;
        bool active;
        uint256 createdAt;
        uint256 auctionEndTime;
    }

    struct Bid {
        address bidder;
        uint256 amount;
        uint256 timestamp;
    }

    // Storage
    IIdentityRegistry public identityRegistry;
    ICompliance public compliance;
    address public feeCollector;
    uint256 public platformFeeRate; // In basis points (e.g., 250 = 2.5%)
    mapping(uint256 => Asset) public assets;
    mapping(uint256 => Listing) public listings;
    mapping(uint256 => Bid[]) public bids;
    mapping(address => bool) public supportedPaymentTokens; // Includes address(0) for ETH
    mapping(address => uint256[]) public userAssets;
    mapping(address => uint256[]) public userListings;
    uint256[] private _activeListingIds;
    mapping(uint256 => uint256) private _activeListingIndex; // 1-based
    mapping(address => uint256) public pendingWithdrawals;
    uint256 public reservedETH;

    // Events
    event AssetCreated(uint256 indexed assetId, address indexed owner, string title);
    event AssetValidated(uint256 indexed assetId, address indexed validator);
    event AssetRejected(uint256 indexed assetId, address indexed validator);
    event ListingCreated(uint256 indexed listingId, uint256 indexed assetId, address indexed seller);
    event BatchListingCreated(uint256[] listingIds, uint256[] assetIds);
    event ListingCanceled(uint256 indexed listingId);
    event ListingSold(uint256 indexed listingId, address indexed buyer, uint256 price);
    event BidPlaced(uint256 indexed listingId, address indexed bidder, uint256 amount);
    event RoyaltyPaid(uint256 indexed assetId, address indexed recipient, uint256 amount, address paymentToken);
    event PlatformFeeUpdated(uint256 newFeeRate);
    event FeeCollectorUpdated(address indexed newFeeCollector);
    event PaymentTokenAdded(address indexed token);
    event PaymentTokenRemoved(address indexed token);
    event FundsWithdrawn(address indexed token, address indexed recipient, uint256 amount);
    event Withdrawal(address indexed account, uint256 amount);

    uint256[40] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _identityRegistry,
        address _compliance,
        uint256 _platformFeeRate,
        address _feeCollector
    ) public initializer {
        __ERC1155_init("");
        __ERC1155Holder_init();
        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        require(_identityRegistry != address(0), "Invalid identity registry");
        require(_compliance != address(0), "Invalid compliance");
        require(_platformFeeRate <= 1000, "Fee rate cannot exceed 10%");
        require(_feeCollector != address(0), "Invalid fee collector");

        identityRegistry = IIdentityRegistry(_identityRegistry);
        compliance = ICompliance(_compliance);
        platformFeeRate = _platformFeeRate;
        feeCollector = _feeCollector;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(VALIDATOR_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
        _grantRole(WITHDRAWER_ROLE, msg.sender);
        _grantRole(UPGRADER_ROLE, msg.sender);

        supportedPaymentTokens[address(0)] = true; // Enable ETH by default
    }

    // UUPS Upgradeable
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(UPGRADER_ROLE) {}

    // Pausable Functions
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function _addActiveListing(uint256 listingId) internal {
        _activeListingIds.push(listingId);
        _activeListingIndex[listingId] = _activeListingIds.length;
    }

    function _removeActiveListing(uint256 listingId) internal {
        uint256 index = _activeListingIndex[listingId];
        if (index == 0) {
            return;
        }

        uint256 lastIndex = _activeListingIds.length;
        uint256 lastListingId = _activeListingIds[lastIndex - 1];
        if (index != lastIndex) {
            _activeListingIds[index - 1] = lastListingId;
            _activeListingIndex[lastListingId] = index;
        }
        _activeListingIds.pop();
        _activeListingIndex[listingId] = 0;
    }

    function _credit(address to, uint256 amount) internal {
        if (to == address(0) || amount == 0) {
            return;
        }
        pendingWithdrawals[to] += amount;
    }

    function _payoutETH(address to, uint256 amount) internal {
        if (to == address(0) || amount == 0) {
            return;
        }
        (bool success, ) = to.call{value: amount}("");
        if (!success) {
            pendingWithdrawals[to] += amount;
            reservedETH += amount;
        }
    }

    // Asset Management
    function createAsset(
        string memory title,
        string memory description,
        string memory category,
        uint256 price,
        TokenizationType tokenizationType,
        uint256 totalTokens,
        uint256 pricePerToken,
        ListingType listingType,
        uint256 auctionEndTime,
        address royaltyReceiver,
        uint96 royaltyFraction
    ) external whenNotPaused returns (uint256) {
        require(identityRegistry.isVerified(msg.sender), "Sender not verified");
        require(bytes(title).length > 0, "Title cannot be empty");
        require(totalTokens > 0, "Total tokens must be greater than 0");
        require(pricePerToken > 0, "Price per token must be greater than 0");
        require(royaltyFraction <= 1000, "Royalty fraction cannot exceed 10%");
        if (royaltyFraction > 0) {
            require(royaltyReceiver != address(0), "Invalid royalty receiver");
        }
        if (listingType == ListingType.Auction) {
            require(auctionEndTime > block.timestamp, "Auction end must be in the future");
        }

        _assetIds += 1;
        uint256 newAssetId = _assetIds;

        Asset storage newAsset = assets[newAssetId];
        newAsset.id = newAssetId;
        newAsset.owner = msg.sender;
        newAsset.title = title;
        newAsset.description = description;
        newAsset.category = category;
        newAsset.status = AssetStatus.Pending;
        newAsset.price = price;
        newAsset.tokenizationType = tokenizationType;
        newAsset.totalTokens = totalTokens;
        newAsset.availableTokens = totalTokens;
        newAsset.pricePerToken = pricePerToken;
        newAsset.listingType = listingType;
        newAsset.isVerified = false;
        newAsset.createdAt = block.timestamp;
        newAsset.updatedAt = block.timestamp;
        newAsset.auctionEndTime = auctionEndTime;
        newAsset.royaltyReceiver = royaltyReceiver;
        newAsset.royaltyFraction = royaltyFraction;

        userAssets[msg.sender].push(newAssetId);
        _mint(msg.sender, newAssetId, totalTokens, "");

        emit AssetCreated(newAssetId, msg.sender, title);
        return newAssetId;
    }

    function validateAsset(uint256 assetId) external onlyRole(VALIDATOR_ROLE) {
        require(assets[assetId].id != 0, "Asset does not exist");
        require(assets[assetId].status == AssetStatus.Pending, "Invalid asset status");
        assets[assetId].status = AssetStatus.Validated;
        assets[assetId].isVerified = true;
        assets[assetId].updatedAt = block.timestamp;

        emit AssetValidated(assetId, msg.sender);
    }

    function rejectAsset(uint256 assetId) external onlyRole(VALIDATOR_ROLE) {
        require(assets[assetId].id != 0, "Asset does not exist");
        require(assets[assetId].status == AssetStatus.Pending, "Invalid asset status");
        assets[assetId].status = AssetStatus.Rejected;
        assets[assetId].updatedAt = block.timestamp;

        emit AssetRejected(assetId, msg.sender);
    }

    // Listing Management
    function createListing(
        uint256 assetId,
        address paymentToken,
        uint256 price,
        uint256 tokenAmount,
        ListingType listingType,
        uint256 auctionEndTime
    ) public whenNotPaused nonReentrant returns (uint256) {
        return _createListing(assetId, paymentToken, price, tokenAmount, listingType, auctionEndTime);
    }

    function _createListing(
        uint256 assetId,
        address paymentToken,
        uint256 price,
        uint256 tokenAmount,
        ListingType listingType,
        uint256 auctionEndTime
    ) internal returns (uint256) {
        require(assets[assetId].status == AssetStatus.Validated, "Asset not validated");
        require(tokenAmount > 0, "Token amount must be greater than 0");
        require(balanceOf(msg.sender, assetId) >= tokenAmount, "Insufficient tokens");
        require(supportedPaymentTokens[paymentToken], "Unsupported payment token");
        require(price > 0, "Price must be greater than 0");
        require(identityRegistry.isVerified(msg.sender), "Seller not verified");
        require(listingType != ListingType.Swap, "Swap listings not supported");
        if (listingType == ListingType.Auction) {
            require(paymentToken == address(0), "Auction only supports ETH");
            require(auctionEndTime > block.timestamp, "Auction end must be in the future");
        }

        _listingIds += 1;
        uint256 newListingId = _listingIds;

        Listing storage newListing = listings[newListingId];
        newListing.id = newListingId;
        newListing.assetId = assetId;
        newListing.seller = msg.sender;
        newListing.paymentToken = paymentToken;
        newListing.price = price;
        newListing.tokenAmount = tokenAmount;
        newListing.listingType = listingType;
        newListing.active = true;
        newListing.createdAt = block.timestamp;
        newListing.auctionEndTime = auctionEndTime;

        assets[assetId].availableTokens -= tokenAmount;
        userListings[msg.sender].push(newListingId);
        _addActiveListing(newListingId);

        // Escrow listed tokens so the seller cannot transfer them away
        _safeTransferFrom(msg.sender, address(this), assetId, tokenAmount, "");

        emit ListingCreated(newListingId, assetId, msg.sender);
        return newListingId;
    }

    function batchCreateListings(
        uint256[] memory assetIds,
        address[] memory paymentTokens,
        uint256[] memory prices,
        uint256[] memory tokenAmounts,
        ListingType[] memory listingTypes,
        uint256[] memory auctionEndTimes
    ) external whenNotPaused nonReentrant returns (uint256[] memory) {
        require(
            assetIds.length == paymentTokens.length &&
            paymentTokens.length == prices.length &&
            prices.length == tokenAmounts.length &&
            tokenAmounts.length == listingTypes.length &&
            listingTypes.length == auctionEndTimes.length,
            "Array length mismatch"
        );

        uint256[] memory newListingIds = new uint256[](assetIds.length);
        for (uint256 i = 0; i < assetIds.length; i++) {
            newListingIds[i] = _createListing(
                assetIds[i],
                paymentTokens[i],
                prices[i],
                tokenAmounts[i],
                listingTypes[i],
                auctionEndTimes[i]
            );
        }

        emit BatchListingCreated(newListingIds, assetIds);
        return newListingIds;
    }

    function cancelListing(uint256 listingId) external nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.active, "Listing not active");
        require(
            listing.seller == msg.sender || hasRole(ADMIN_ROLE, msg.sender),
            "Not authorized"
        );

        listing.active = false;
        assets[listing.assetId].availableTokens += listing.tokenAmount;
        _removeActiveListing(listingId);

        // Return escrowed tokens
        _safeTransferFrom(address(this), listing.seller, listing.assetId, listing.tokenAmount, "");

        // Return the current highest bid if this is an auction
        Bid[] storage listingBids = bids[listingId];
        if (listing.listingType == ListingType.Auction && listingBids.length > 0) {
            Bid storage highestBid = listingBids[listingBids.length - 1];
            _credit(highestBid.bidder, highestBid.amount);
        }

        emit ListingCanceled(listingId);
    }

    // Purchase Handling
    function buyListing(uint256 listingId) external payable whenNotPaused nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.active, "Listing not active");
        require(listing.listingType == ListingType.Fixed, "Invalid listing type");
        require(msg.sender != listing.seller, "Cannot buy own listing");
        require(identityRegistry.isVerified(msg.sender), "Buyer not verified");
        require(
            compliance.canTransfer(listing.seller, msg.sender, listing.assetId, listing.tokenAmount),
            "Compliance check failed"
        );

        if (listing.paymentToken == address(0)) {
            require(msg.value >= listing.price, "Insufficient ETH sent");
        } else {
            require(msg.value == 0, "ETH sent for token listing");
            IERC20 paymentToken = IERC20(listing.paymentToken);
            require(paymentToken.balanceOf(msg.sender) >= listing.price, "Insufficient balance");
            require(paymentToken.allowance(msg.sender, address(this)) >= listing.price, "Insufficient allowance");
        }

        _processPurchase(listingId, listing.price, msg.sender, false);
    }

    // Auction Handling
    function placeBid(uint256 listingId) external payable whenNotPaused nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.active, "Listing not active");
        require(listing.listingType == ListingType.Auction, "Not an auction");
        require(block.timestamp < listing.auctionEndTime, "Auction ended");
        require(msg.sender != listing.seller, "Seller cannot bid");
        require(identityRegistry.isVerified(msg.sender), "Bidder not verified");
        require(listing.paymentToken == address(0), "Auction only supports ETH");

        Bid[] storage listingBids = bids[listingId];
        if (listingBids.length > 0) {
            require(msg.value > listingBids[listingBids.length - 1].amount, "Bid too low");
            Bid storage previousBid = listingBids[listingBids.length - 1];
            _credit(previousBid.bidder, previousBid.amount);
        } else {
            require(msg.value >= listing.price, "Bid below starting price");
        }

        reservedETH += msg.value;
        listingBids.push(Bid(msg.sender, msg.value, block.timestamp));
        emit BidPlaced(listingId, msg.sender, msg.value);
    }

    function finalizeAuction(uint256 listingId) external whenNotPaused nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.active, "Listing not active");
        require(listing.listingType == ListingType.Auction, "Not an auction");
        require(block.timestamp >= listing.auctionEndTime, "Auction not ended");

        Bid[] storage listingBids = bids[listingId];
        require(listingBids.length > 0, "No bids placed");

        Bid storage winningBid = listingBids[listingBids.length - 1];
        require(
            compliance.canTransfer(listing.seller, winningBid.bidder, listing.assetId, listing.tokenAmount),
            "Compliance check failed"
        );

        // ETH was already deposited with the winning bid
        reservedETH -= winningBid.amount;
        _processPurchase(listingId, winningBid.amount, winningBid.bidder, true);
    }

    function withdrawPending() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing to withdraw");
        pendingWithdrawals[msg.sender] = 0;
        reservedETH -= amount;
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Withdraw failed");
        emit Withdrawal(msg.sender, amount);
    }

    function _processPurchase(uint256 listingId, uint256 amount, address buyer, bool paymentPrepaid) internal {
        Listing storage listing = listings[listingId];
        Asset storage asset = assets[listing.assetId];

        uint256 platformFee = (amount * platformFeeRate) / 10000;
        uint256 royaltyAmount = (asset.royaltyFraction > 0 && asset.royaltyReceiver != address(0))
            ? (amount * asset.royaltyFraction) / 10000
            : 0;
        uint256 sellerAmount = amount - platformFee - royaltyAmount;

        if (listing.paymentToken == address(0)) {
            if (!paymentPrepaid) {
                require(msg.value >= amount, "Insufficient ETH sent");
            }

            _payoutETH(feeCollector, platformFee);
            if (royaltyAmount > 0) {
                _payoutETH(asset.royaltyReceiver, royaltyAmount);
                emit RoyaltyPaid(listing.assetId, asset.royaltyReceiver, royaltyAmount, address(0));
            }
            _payoutETH(listing.seller, sellerAmount);

            if (!paymentPrepaid && msg.value > amount) {
                _payoutETH(buyer, msg.value - amount);
            }
        } else {
            IERC20 paymentToken = IERC20(listing.paymentToken);
            if (platformFee > 0) {
                paymentToken.safeTransferFrom(buyer, feeCollector, platformFee);
            }
            if (royaltyAmount > 0) {
                paymentToken.safeTransferFrom(buyer, asset.royaltyReceiver, royaltyAmount);
                emit RoyaltyPaid(listing.assetId, asset.royaltyReceiver, royaltyAmount, listing.paymentToken);
            }
            paymentToken.safeTransferFrom(buyer, listing.seller, sellerAmount);
        }

        // Deliver escrowed tokens to the buyer
        _safeTransferFrom(
            address(this),
            buyer,
            listing.assetId,
            listing.tokenAmount,
            ""
        );
        compliance.transferred(listing.seller, buyer, listing.assetId, listing.tokenAmount);

        listing.active = false;
        asset.owner = buyer;
        _removeActiveListing(listingId);

        emit ListingSold(listingId, buyer, amount);
    }

    // Admin Functions
    function addPaymentToken(address token) external onlyRole(ADMIN_ROLE) {
        require(token != address(0), "Invalid token address");
        require(!supportedPaymentTokens[token], "Token already supported");
        supportedPaymentTokens[token] = true;
        emit PaymentTokenAdded(token);
    }

    function removePaymentToken(address token) external onlyRole(ADMIN_ROLE) {
        require(token != address(0), "Cannot remove ETH");
        require(supportedPaymentTokens[token], "Token not supported");
        supportedPaymentTokens[token] = false;
        emit PaymentTokenRemoved(token);
    }

    function updatePlatformFee(uint256 newFeeRate) external onlyRole(ADMIN_ROLE) {
        require(newFeeRate <= 1000, "Fee rate cannot exceed 10%");
        platformFeeRate = newFeeRate;
        emit PlatformFeeUpdated(newFeeRate);
    }

    function updateFeeCollector(address newFeeCollector) external onlyRole(ADMIN_ROLE) {
        require(newFeeCollector != address(0), "Invalid fee collector");
        feeCollector = newFeeCollector;
        emit FeeCollectorUpdated(newFeeCollector);
    }

    function withdrawFunds(address token, address recipient, uint256 amount)
        external
        onlyRole(WITHDRAWER_ROLE)
        nonReentrant
    {
        require(recipient != address(0), "Invalid recipient");
        require(amount > 0, "Amount must be greater than 0");

        if (token == address(0)) {
            require(address(this).balance >= amount + reservedETH, "ETH reserved for users");
            (bool success, ) = recipient.call{value: amount}("");
            require(success, "ETH withdrawal failed");
        } else {
            require(supportedPaymentTokens[token], "Token not supported");
            IERC20 paymentToken = IERC20(token);
            require(paymentToken.balanceOf(address(this)) >= amount, "Insufficient token balance");
            paymentToken.safeTransfer(recipient, amount);
        }

        emit FundsWithdrawn(token, recipient, amount);
    }

    // View Functions
    function getAssetDetails(uint256 assetId) external view returns (Asset memory) {
        return assets[assetId];
    }

    function getListingDetails(uint256 listingId)
        external
        view
        returns (
            uint256 id,
            uint256 assetId,
            address seller,
            address paymentToken,
            uint256 price,
            uint256 tokenAmount,
            ListingType listingType,
            bool active,
            uint256 createdAt,
            uint256 auctionEndTime
        )
    {
        Listing storage listing = listings[listingId];
        return (
            listing.id,
            listing.assetId,
            listing.seller,
            listing.paymentToken,
            listing.price,
            listing.tokenAmount,
            listing.listingType,
            listing.active,
            listing.createdAt,
            listing.auctionEndTime
        );
    }

    function getBids(uint256 listingId) external view returns (Bid[] memory) {
        return bids[listingId];
    }

    function getUserAssets(address user) external view returns (uint256[] memory) {
        return userAssets[user];
    }

    function getUserListings(address user) external view returns (uint256[] memory) {
        return userListings[user];
    }

    function getAllActiveListings() external view returns (uint256[] memory) {
        return _activeListingIds;
    }

    function _beforeTokenTransfer(
        address operator,
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) internal virtual override {
        super._beforeTokenTransfer(operator, from, to, ids, amounts, data);

        if (from == address(0) || to == address(0)) {
            return;
        }

        // Escrow movements are performed by this contract
        if (from == address(this) || to == address(this)) {
            return;
        }

        require(!paused(), "Token transfer while paused");
        require(identityRegistry.isVerified(from), "Sender not verified");
        require(identityRegistry.isVerified(to), "Recipient not verified");

        for (uint256 i = 0; i < ids.length; i++) {
            require(assets[ids[i]].status == AssetStatus.Validated, "Asset not validated");
            require(
                compliance.canTransfer(from, to, ids[i], amounts[i]),
                "Transfer not compliant"
            );
        }
    }

    function _afterTokenTransfer(
        address operator,
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) internal virtual override {
        super._afterTokenTransfer(operator, from, to, ids, amounts, data);

        if (
            from != address(0) &&
            to != address(0) &&
            from != address(this) &&
            to != address(this) &&
            address(compliance) != address(0)
        ) {
            for (uint256 i = 0; i < ids.length; i++) {
                compliance.transferred(from, to, ids[i], amounts[i]);
            }
        }
    }

    // Interface Support
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC1155Upgradeable, ERC1155ReceiverUpgradeable, AccessControlUpgradeable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    // Fallback to receive ETH
    receive() external payable {}
}
