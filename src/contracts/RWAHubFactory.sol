// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "./RWAHubToken.sol";

contract RWAHubTokenFactory is Initializable, UUPSUpgradeable, AccessControlUpgradeable {
    // Roles
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    // Implementation address for RWAHubToken
    address public implementation;

    // Events
    event TokenDeployed(
        address indexed tokenAddress,
        address indexed admin,
        string name,
        string symbol
    );
    event ImplementationSet(address indexed implementation);

    // Storage gap for future upgrades
    uint256[49] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initializes the factory with admin, upgrader roles, and implementation address.
     * @param admin Address to receive admin and upgrader roles.
     * @param _implementation Address of the RWAHubToken implementation.
     */
    function initialize(address admin, address _implementation) public initializer {
        require(admin != address(0), "Invalid admin address");
        require(_implementation != address(0), "Invalid implementation address");

        __AccessControl_init();
        __UUPSUpgradeable_init();

        implementation = _implementation;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);
        _setRoleAdmin(ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(UPGRADER_ROLE, DEFAULT_ADMIN_ROLE);

        emit ImplementationSet(_implementation);
    }

    /**
     * @dev Authorizes contract upgrades, restricted to UPGRADER_ROLE.
     * @param newImplementation Address of the new implementation.
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(UPGRADER_ROLE) {}

    /**
     * @dev Updates the RWAHubToken implementation used for new deployments.
     */
    function setImplementation(address _implementation) external onlyRole(ADMIN_ROLE) {
        require(_implementation != address(0), "Invalid implementation address");
        implementation = _implementation;
        emit ImplementationSet(_implementation);
    }

    /**
     * @dev Deploys a new upgradeable RWAHubToken via ERC1967 proxy.
     * Clones cannot be upgraded, so UUPS on the token requires a real proxy.
     */
    function deployToken(
        address admin,
        string memory name,
        string memory symbol,
        address identityRegistry,
        address compliance
    ) external onlyRole(ADMIN_ROLE) returns (address) {
        require(admin != address(0), "Invalid admin address");
        require(admin != address(this), "Factory cannot be token admin");
        require(bytes(name).length > 0, "Name cannot be empty");
        require(bytes(symbol).length > 0, "Symbol cannot be empty");
        require(implementation != address(0), "Implementation not set");

        ERC1967Proxy proxy = new ERC1967Proxy(
            implementation,
            abi.encodeWithSelector(RWAHubToken.initialize.selector)
        );
        address proxyAddress = address(proxy);
        RWAHubToken token = RWAHubToken(proxyAddress);

        // Configure compliance while the factory still holds COMPLIANCE_ROLE
        if (identityRegistry != address(0)) {
            token.setIdentityRegistry(identityRegistry);
        }
        if (compliance != address(0)) {
            token.setCompliance(compliance);
        }

        token.grantRole(token.DEFAULT_ADMIN_ROLE(), admin);
        token.grantRole(token.MINTER_ROLE(), admin);
        token.grantRole(token.PAUSER_ROLE(), admin);
        token.grantRole(token.FORCED_TRANSFER_ROLE(), admin);
        token.grantRole(token.COMPLIANCE_ROLE(), admin);
        token.grantRole(token.UPGRADER_ROLE(), admin);

        token.revokeRole(token.MINTER_ROLE(), address(this));
        token.revokeRole(token.PAUSER_ROLE(), address(this));
        token.revokeRole(token.FORCED_TRANSFER_ROLE(), address(this));
        token.revokeRole(token.COMPLIANCE_ROLE(), address(this));
        token.revokeRole(token.UPGRADER_ROLE(), address(this));
        token.revokeRole(token.DEFAULT_ADMIN_ROLE(), address(this));

        emit TokenDeployed(proxyAddress, admin, name, symbol);
        return proxyAddress;
    }

    /**
     * @dev Returns the implementation address.
     * @return Address of the RWAHubToken implementation.
     */
    function getImplementation() external view returns (address) {
        return implementation;
    }

    /**
     * @dev Checks if the contract supports a given interface.
     * @param interfaceId The interface ID to check.
     * @return True if supported, false otherwise.
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(AccessControlUpgradeable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
