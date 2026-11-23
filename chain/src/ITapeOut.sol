// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// The parts of TapeOut that Kickoff talks to on X Layer.
//
// Where these come from: the reading and tape-out functions are specified in TAP-02 section 6
// ("Circuit Netlist Format and Evaluation Semantics"). The factory and transistor functions are
// not in a TAP; they were taken from the public fork tests of other TapeOut Accelerate entries and
// are confirmed for Kickoff by the tests in chain/test/, which run them against a copy of X Layer.

/// The factory that creates processors. Same address for every processor on X Layer.
interface IProcessorFactory {
    function createCPU(
        string calldata name,
        string calldata symbol,
        string calldata story,
        uint256 transistorSupply,
        uint256 mintPrice
    ) external payable returns (address transistors, address circuits);

    /// What it costs to create a processor, paid in the BEM token.
    function deployFee() external view returns (uint256);

    /// The BEM token the factory charges fees in.
    function bem() external view returns (address);

    function cpuCount() external view returns (uint256);
}

/// A processor's transistor token. Id 0 is NAND, id 1 is LATCH.
/// One mint call costs: amount x mintPrice() + protocolFee().
interface ITransistors {
    function mint(uint256 id, uint256 amount) external payable;
    function mintPrice() external view returns (uint256);
    function protocolFee() external view returns (uint256);
    function balanceOf(address account, uint256 id) external view returns (uint256);
}

/// A processor: the contract that stores circuits and works out their answers.
interface IProcessor {
    // Publishing a circuit. Burns one NAND transistor for each gate.
    function tapeout(bytes calldata netlist, uint32 nIn, uint32 nOut) external payable returns (uint256 id);
    function TAPEOUT_FEE() external view returns (uint256);
    function transistors() external view returns (address);

    // Reading a published circuit (TAP-02 section 6).
    function circuitInfo(uint256 id)
        external
        view
        returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount);
    function netlist(uint256 id) external view returns (bytes memory);
    function eval(uint256 id, bytes calldata inputs) external view returns (bytes memory outputs);
    function ownerOf(uint256 id) external view returns (address);
}

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}
