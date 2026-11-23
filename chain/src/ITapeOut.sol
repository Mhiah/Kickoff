// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// The parts of TapeOut that Kickoff talks to on X Layer.
//
// Where these come from: the reading and tape-out functions are specified in TAP-02 section 6
// ("Circuit Netlist Format and Evaluation Semantics"). The factory and transistor functions are
// not in a TAP; they were taken from the public fork tests of other TapeOut Accelerate entries. The
// mailbox is specified in TAP-10 section 13. All of them are confirmed for Kickoff by the tests in
// chain/test/, which run them against a copy of X Layer.

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
    function supplyCap() external view returns (uint256);
    function minted() external view returns (uint256);
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

    // A circuit is an ordinary NFT, so it can change hands.
    function transferFrom(address from, address to, uint256 id) external;
}

/// Opens a circuit's own account ("container"). The address is the same on Base and X Layer and is
/// published in TapeKit's network settings.
interface IContainerOpener {
    function open(address circuits, uint256 tokenId) external payable returns (address container);
    function FEE() external view returns (uint256);
    function accountOf(address circuits, uint256 tokenId) external view returns (address);
    function isOpened(address circuits, uint256 tokenId) external view returns (bool);
}

/// The DeWEB hub: TapeOut's mailbox (TapeSend). Specified in TAP-10 section 13. The same address
/// on every chain.
interface ITapeSendHub {
    /// One line of an inbox (TAP-10 section 13.6). The message text itself is not stored. It is in
    /// the Sent event, and `digest` ties that text to this line.
    struct Entry {
        address from;
        uint56 blockNumber;
        uint40 timestamp;
        bytes32 digest;
    }

    event Sent(
        bytes32 indexed to, address indexed from, bytes32 indexed ref, uint256 inboxIndex, uint256 outboxIndex, bytes payload
    );

    function send(address circuits, uint256 tokenId, bytes32 to, bytes32 ref, bytes calldata payload)
        external
        returns (uint256 inboxIndex);
    function endpointOf(address container) external view returns (bytes32);
    function accountOf(address circuits, uint256 tokenId) external view returns (address);
    function inboxCount(bytes32 to) external view returns (uint256);
    function inboxAt(bytes32 to, uint256 i) external view returns (Entry memory);
    function outboxCount(address from) external view returns (uint256);
    function digestOf(bytes32 ref, bytes calldata payload) external view returns (bytes32);
    function MAX_PAYLOAD() external view returns (uint256);
}

/// The site store: where a circuit's website files live on chain (DeWEB). Specified in TAP-10
/// section 7 and its appendix. Only the circuit's holder, or an operator they name, may write.
interface ISiteRegistry {
    /// Writes the first piece of a file (at most 24,000 bytes) and replaces any file already there.
    /// `sha256Hash` is the fingerprint of the WHOLE file, so a reader can tell when it is complete.
    function putFile(
        address container,
        string calldata path,
        string calldata contentType,
        bytes32 sha256Hash,
        bytes calldata data
    ) external;

    /// Adds the next piece. `expectIndex` must be the number of pieces the file already has.
    function appendChunk(address container, string calldata path, uint256 expectIndex, bytes calldata data) external;
    function removeFile(address container, string calldata path) external;
    function setFallback(address container, string calldata path) external;

    function fileInfo(address container, string calldata path)
        external
        view
        returns (uint32 size, string memory contentType, bytes32 sha256Hash, uint40 updatedAt, uint256 chunkCount);
    function read(address container, string calldata path) external view returns (bytes memory);
    function readRange(address container, string calldata path, uint256 offset, uint256 len)
        external
        view
        returns (bytes memory);
    function pathCount(address container) external view returns (uint256);
    function pathsRange(address container, uint256 from, uint256 n) external view returns (string[] memory);
    function fallbackPath(address container) external view returns (string memory);
}

/// Pays for a site's on-chain name (TAP-10 section 6 and its appendix).
interface IDomainBinding {
    function bind(string calldata name, address container, uint256 months) external payable;
    function monthlyFee() external view returns (uint256);
    function paidUntil(bytes32 nameHash, address container) external view returns (uint40);
}

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
    function symbol() external view returns (string memory);
}

/// On networks built the way X Layer is, a transaction also pays for the data it posts to
/// Ethereum. This standard contract quotes that extra fee. Only used by the fees report.
interface IL1FeeOracle {
    function getL1Fee(bytes calldata data) external view returns (uint256);
}
