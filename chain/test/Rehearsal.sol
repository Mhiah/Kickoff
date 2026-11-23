// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {
    IProcessorFactory,
    ITransistors,
    IProcessor,
    IContainerOpener,
    ITapeSendHub,
    ISiteRegistry,
    IDomainBinding,
    IERC20
} from "../src/ITapeOut.sol";

/// What every rehearsal starts with: a PRIVATE COPY of X Layer mainnet and a Kickoff processor
/// created on it through the real TapeOut factory. Nothing is sent to the real network.
abstract contract Rehearsal is Test {
    // TapeOut's contracts on X Layer. The opener and the hub are the ones TapeKit publishes.
    IProcessorFactory constant FACTORY = IProcessorFactory(0x1f09DAeFA827f02CBb40967cc91b259763760761);
    IContainerOpener constant OPENER = IContainerOpener(0x536adD8F30f03b69f6fbF29d425A816A0dC50106);
    ITapeSendHub constant HUB = ITapeSendHub(0xe61A9C7213a6Aa616C246a2B569e555B417b25ee);
    ISiteRegistry constant SITES = ISiteRegistry(0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6);
    IDomainBinding constant NAMES = IDomainBinding(0x68809Fd2fb343aA57D0aeB7f33Defe477c9666f9);

    uint256 constant NAND = 0;

    address deployer = makeAddr("kickoff-deployer");

    IProcessor processor;
    ITransistors transistors;
    IERC20 bem;

    /// Copies X Layer as it is right now and creates the Kickoff processor on the copy.
    function _startCopyOfXLayer() internal {
        vm.createSelectFork(vm.envOr("XLAYER_RPC_URL", string("https://rpc.xlayer.tech")));
        vm.deal(deployer, 10 ether);

        // The factory charges its fee in the BEM token, so the rehearsal gives the deployer test
        // BEM. On the real network the wallet must hold real BEM.
        bem = IERC20(FACTORY.bem());
        uint256 deployFee = FACTORY.deployFee();
        deal(address(bem), deployer, deployFee);
        vm.startPrank(deployer);
        bem.approve(address(FACTORY), deployFee);
        (address transistorToken, address circuits) = FACTORY.createCPU(
            "Kickoff", "KICKOFF", "Scoring rules for Kickoff, the prediction game", 1_000_000, 0
        );
        vm.stopPrank();
        processor = IProcessor(circuits);
        transistors = ITransistors(transistorToken);
        assertEq(processor.transistors(), transistorToken, "processor and transistor token are paired");
    }

    /// Buys exactly the NAND transistors a circuit needs, publishes it, and confirms the processor
    /// stored it byte for byte.
    function _tapeout(bytes memory netlist, uint32 nIn, uint32 nOut) internal returns (uint256 id) {
        uint256 gates = netlist.length / 7;
        assertEq(netlist.length, gates * 7, "seven bytes for each NAND gate");

        uint256 mintFee = gates * transistors.mintPrice() + transistors.protocolFee();
        deal(address(bem), deployer, mintFee);

        vm.startPrank(deployer);
        bem.approve(address(transistors), mintFee);
        transistors.mint(NAND, gates);
        assertEq(transistors.balanceOf(deployer, NAND), gates, "bought one NAND for each gate");
        id = processor.tapeout{value: processor.TAPEOUT_FEE()}(netlist, nIn, nOut);
        vm.stopPrank();

        assertEq(transistors.balanceOf(deployer, NAND), 0, "publishing burns one NAND for each gate");
        assertEq(processor.ownerOf(id), deployer, "the deployer owns the circuit");
        (uint32 gotIn, uint32 gotOut, uint32 gotState, uint32 gotGates) = processor.circuitInfo(id);
        assertEq(gotIn, nIn, "inputs");
        assertEq(gotOut, nOut, "outputs");
        assertEq(gotState, 0, "no memory, so eval() works");
        assertEq(gotGates, gates, "gate count");
        assertEq(keccak256(processor.netlist(id)), keccak256(netlist), "stored circuit is byte-identical");
    }

    /// The smallest possible circuit: one NAND gate that flips its one input. It stands in for the
    /// circuit a league or a player would own.
    bytes constant ONE_GATE = hex"00000002000002";

    /// Opens a circuit's own account and returns its address.
    function _open(uint256 id) internal returns (address account) {
        uint256 fee = OPENER.FEE();
        vm.prank(deployer);
        account = OPENER.open{value: fee}(address(processor), id);
    }

    /// Reads one of Kickoff's scoring circuits from circuits/out/.
    function _readScoringCircuit(string memory name, uint32 nIn) internal view returns (bytes memory netlist) {
        string memory root = string.concat(vm.projectRoot(), "/../circuits/out/");
        netlist = vm.parseBytes(string.concat("0x", vm.readLine(string.concat(root, name, ".hex"))));
        string memory manifest = vm.readFile(string.concat(root, "manifest.json"));
        assertEq(vm.parseJsonUint(manifest, string.concat(".", name, ".inputs")), nIn, "inputs match the manifest");
        assertEq(
            vm.parseJsonUint(manifest, string.concat(".", name, ".gates")), netlist.length / 7, "gates match the manifest"
        );
    }

    /// Publishes one of Kickoff's scoring circuits from circuits/out/.
    function _publishScoringCircuit(string memory name, uint32 nIn) internal returns (uint256 id) {
        id = _tapeout(_readScoringCircuit(name, nIn), nIn, 2);
    }

    /// Points from a scoring circuit's two outputs: output 0 + 2 x output 1.
    function _points(uint256 id, bytes memory inputs) internal view returns (uint256) {
        bytes memory out = processor.eval(id, inputs);
        require(out.length == 1, "two outputs pack into one byte");
        uint8 o = uint8(out[0]);
        require(o < 4, "unused output bits must be zero");
        return (o & 1) + 2 * ((o >> 1) & 1);
    }
}
