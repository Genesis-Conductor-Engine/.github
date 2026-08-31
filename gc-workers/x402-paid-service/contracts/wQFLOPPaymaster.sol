// SPDX-License-Identifier: MIT
pragma solidity ^0.8.32;

/// ERC-4337 v0.6 UserOperation. Not PackedUserOperation (v0.7).
struct UserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    uint256 callGasLimit;
    uint256 verificationGasLimit;
    uint256 preVerificationGas;
    uint256 maxFeePerGas;
    uint256 maxPriorityFeePerGas;
    bytes paymasterAndData;
    bytes signature;
}

interface IEntryPoint {
    function depositTo(address) external payable;
    function balanceOf(address) external view returns (uint256);
    function withdrawTo(address payable, uint256) external;
}

interface IWQFLOP {
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
    function allowance(address, address) external view returns (uint256);
}

/// wQFLOP ERC-4337 v0.6 paymaster.
/// Tokens are pulled in validation (precharge) and excess is refunded in postOp.
/// This closes the approve-then-revoke drain: callData cannot un-pull funds
/// after validatePaymasterUserOp has already transferFrom'd the max.
///
/// postOpMode: 0 opSucceeded, 1 opReverted, 2 postOpReverted.
/// Mode 2 must not revert (EntryPoint would otherwise retry forever).
contract WQFLOPPaymaster {
    IEntryPoint public immutable entryPoint;
    IWQFLOP public immutable wqflop;
    address public immutable owner;

    uint256 public rate;
    uint256 public constant SLIPPAGE_BPS = 300;
    uint256 public constant MIN_RATE = 1e12;

    event Deposit(address indexed from, uint256 amount);
    event RateUpdated(uint256 oldRate, uint256 newRate);
    event WQFLOPCollected(address indexed user, uint256 amount, uint256 gasCost);
    event WQFLOPRefunded(address indexed user, uint256 amount);
    event WQFLOPWithdrawn(address indexed to, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "WQFP: not owner");
        _;
    }

    constructor(IEntryPoint _entryPoint, IWQFLOP _wqflop, uint256 _initialRate) {
        require(_initialRate >= MIN_RATE, "WQFP: rate too low");
        entryPoint = _entryPoint;
        wqflop = _wqflop;
        owner = msg.sender;
        rate = _initialRate;
        emit RateUpdated(0, _initialRate);
    }

    receive() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
        emit Deposit(msg.sender, msg.value);
    }

    function deposit() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
        emit Deposit(msg.sender, msg.value);
    }

    function setRate(uint256 _rate) external onlyOwner {
        require(_rate >= MIN_RATE, "WQFP: rate too low");
        emit RateUpdated(rate, _rate);
        rate = _rate;
    }

    function withdrawETH(address payable to, uint256 amount) external onlyOwner {
        entryPoint.withdrawTo(to, amount);
    }

    function withdrawWQFLOP(address to, uint256 amount) external onlyOwner {
        uint256 bal = wqflop.balanceOf(address(this));
        uint256 wAmount = amount == 0 ? bal : amount;
        require(wqflop.transfer(to, wAmount), "WQFP: transfer failed");
        emit WQFLOPWithdrawn(to, wAmount);
    }

    function entryPointBalance() external view returns (uint256) {
        return entryPoint.balanceOf(address(this));
    }

    function maxCharge(uint256 maxCost) public view returns (uint256) {
        return (maxCost * rate * (10000 + SLIPPAGE_BPS)) / 1e18 / 10000 + 1;
    }

    function validatePaymasterUserOp(
        UserOperation calldata userOp,
        bytes32,
        uint256 maxCost
    ) external returns (bytes memory context, uint256 validationData) {
        require(msg.sender == address(entryPoint), "WQFP: only entrypoint");
        require(rate >= MIN_RATE, "WQFP: rate not set");

        uint256 maxWQFLOP = maxCharge(maxCost);
        require(wqflop.balanceOf(userOp.sender) >= maxWQFLOP, "WQFP: low balance");
        require(
            wqflop.transferFrom(userOp.sender, address(this), maxWQFLOP),
            "WQFP: pull failed"
        );

        context = abi.encode(userOp.sender, maxWQFLOP, rate);
        return (context, 0);
    }

    function postOp(uint8 mode, bytes calldata context, uint256 actualGasCost) external {
        require(msg.sender == address(entryPoint), "WQFP: only entrypoint");
        (address sender, uint256 maxWQFLOP, uint256 rate_) = abi.decode(
            context, (address, uint256, uint256)
        );

        uint256 actualWQFLOP = (actualGasCost * rate_) / 1e18;
        if (actualWQFLOP > maxWQFLOP) actualWQFLOP = maxWQFLOP;
        uint256 refund = maxWQFLOP - actualWQFLOP;

        if (refund > 0) {
            bool ok = wqflop.transfer(sender, refund);
            if (!ok) {
                if (mode == 2) {
                    emit WQFLOPRefunded(sender, 0);
                } else {
                    revert("WQFP: refund failed");
                }
            } else {
                emit WQFLOPRefunded(sender, refund);
            }
        }

        emit WQFLOPCollected(sender, actualWQFLOP, actualGasCost);
    }
}
