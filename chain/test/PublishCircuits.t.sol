// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IProcessorFactory, ITransistors, IProcessor, IERC20} from "../src/ITapeOut.sol";

/// A rehearsal on a PRIVATE COPY of X Layer mainnet. Nothing here is sent to the real network.
///
/// It does what going live will do: creates a Kickoff processor through the real TapeOut factory,
/// publishes ("tapes out") the three scoring circuits from circuits/out/, then asks the real
/// TapeOut evaluator for the points on every possible input and compares each answer with the
/// rules written out again below in plain Solidity.
contract PublishCircuitsTest is Test {
    IProcessorFactory constant FACTORY = IProcessorFactory(0x1f09DAeFA827f02CBb40967cc91b259763760761);
    uint256 constant NAND = 0;
    uint32 constant N_OUT = 2;

    address deployer = makeAddr("kickoff-deployer");

    IProcessor processor;
    ITransistors transistors;
    IERC20 bem;

    uint256 footballId;
    uint256 basketballId;
    uint256 tennisId;

    // ------------------------------------------------------------------ setting up

    function setUp() public {
        vm.createSelectFork(vm.envOr("XLAYER_RPC_URL", string("https://rpc.xlayer.tech")));
        vm.deal(deployer, 10 ether);

        // Create the Kickoff processor. The factory charges its fee in the BEM token, so the
        // rehearsal gives the deployer test BEM. On the real network the wallet must hold real BEM.
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

        footballId = _publish("football", 16);
        basketballId = _publish("basketball", 6);
        tennisId = _publish("tennis", 7);
    }

    /// Reads one circuit from circuits/out/, buys exactly the NAND transistors it needs, publishes
    /// it, and confirms the processor stored it byte for byte.
    function _publish(string memory name, uint32 nIn) internal returns (uint256 id) {
        string memory root = string.concat(vm.projectRoot(), "/../circuits/out/");
        bytes memory netlist = vm.parseBytes(string.concat("0x", vm.readLine(string.concat(root, name, ".hex"))));
        string memory manifest = vm.readFile(string.concat(root, "manifest.json"));
        uint256 gates = vm.parseJsonUint(manifest, string.concat(".", name, ".gates"));
        assertEq(vm.parseJsonUint(manifest, string.concat(".", name, ".inputs")), nIn, "inputs match the manifest");
        assertEq(netlist.length, gates * 7, "seven bytes for each NAND gate");

        uint256 mintFee = gates * transistors.mintPrice() + transistors.protocolFee();
        uint256 tapeoutFee = processor.TAPEOUT_FEE();
        deal(address(bem), deployer, mintFee);

        vm.startPrank(deployer);
        bem.approve(address(transistors), mintFee);
        transistors.mint(NAND, gates);
        assertEq(transistors.balanceOf(deployer, NAND), gates, "bought one NAND for each gate");
        id = processor.tapeout{value: tapeoutFee}(netlist, nIn, N_OUT);
        vm.stopPrank();

        assertEq(transistors.balanceOf(deployer, NAND), 0, "publishing burns one NAND for each gate");
        assertEq(processor.ownerOf(id), deployer, "the deployer owns the circuit");
        (uint32 gotIn, uint32 gotOut, uint32 gotState, uint32 gotGates) = processor.circuitInfo(id);
        assertEq(gotIn, nIn, "inputs");
        assertEq(gotOut, N_OUT, "outputs");
        assertEq(gotState, 0, "no memory, so eval() works");
        assertEq(gotGates, gates, "gate count");
        assertEq(keccak256(processor.netlist(id)), keccak256(netlist), "stored circuit is byte-identical");

        emit log_named_string("published", name);
        emit log_named_uint("  circuit id", id);
        emit log_named_uint("  gates", gates);
        emit log_named_uint("  transistor fee (BEM, smallest unit)", mintFee);
        emit log_named_uint("  tape-out fee (OKB wei)", tapeoutFee);
    }

    // ------------------------------------------------------------------ asking the real evaluator

    /// Points from a circuit's two outputs: output 0 + 2 x output 1.
    function _points(uint256 id, bytes memory inputs) internal view returns (uint256) {
        bytes memory out = processor.eval(id, inputs);
        require(out.length == 1, "two outputs pack into one byte");
        uint8 o = uint8(out[0]);
        require(o < 4, "unused output bits must be zero");
        return (o & 1) + 2 * ((o >> 1) & 1);
    }

    // ------------------------------------------------------------------ the rules, written again

    function _footballRule(uint256 myHome, uint256 myAway, uint256 realHome, uint256 realAway)
        internal
        pure
        returns (uint256)
    {
        if (myHome == realHome && myAway == realAway) return 3;
        bool sameResult = (myHome > myAway && realHome > realAway) || (myHome < myAway && realHome < realAway)
            || (myHome == myAway && realHome == realAway);
        return sameResult ? 1 : 0;
    }

    function _winnerPlusDetailRule(uint256 myWinner, uint256 myDetail, uint256 realWinner, uint256 realDetail)
        internal
        pure
        returns (uint256)
    {
        if (myWinner != realWinner) return 0;
        return myDetail == realDetail ? 3 : 1;
    }

    /// Sets are passed as the real number of sets (2 to 5).
    function _tennisRule(uint256 myWinner, uint256 mySets, uint256 realWinner, uint256 realSets, bool bestOf5)
        internal
        pure
        returns (uint256)
    {
        if (!_possibleSets(mySets, bestOf5) || !_possibleSets(realSets, bestOf5)) return 0;
        return _winnerPlusDetailRule(myWinner, mySets, realWinner, realSets);
    }

    function _possibleSets(uint256 sets, bool bestOf5) internal pure returns (bool) {
        return bestOf5 ? (sets >= 3 && sets <= 5) : (sets == 2 || sets == 3);
    }

    // ------------------------------------------------------------------ every possible case

    function test_basketball_everyCase() public view {
        uint256 cases;
        for (uint256 b; b < 64; ++b) {
            uint256 want = _winnerPlusDetailRule(b & 1, (b >> 1) & 3, (b >> 3) & 1, (b >> 4) & 3);
            uint256 got = _points(basketballId, abi.encodePacked(uint8(b)));
            if (got != want) revert(string.concat("basketball wrong on input ", vm.toString(b)));
            ++cases;
        }
        assertEq(cases, 64);
    }

    function test_tennis_everyCase() public view {
        uint256 cases;
        for (uint256 b; b < 128; ++b) {
            uint256 want = _tennisRule(b & 1, ((b >> 1) & 3) + 2, (b >> 3) & 1, ((b >> 4) & 3) + 2, ((b >> 6) & 1) == 1);
            uint256 got = _points(tennisId, abi.encodePacked(uint8(b)));
            if (got != want) revert(string.concat("tennis wrong on input ", vm.toString(b)));
            ++cases;
        }
        assertEq(cases, 128);
    }

    /// Football has 65,536 cases. They are split into eight tests by the real home goals, so no
    /// single test runs for too long.
    function _footballSlice(uint256 fromRealHome) internal view {
        uint256 cases;
        for (uint256 realHome = fromRealHome; realHome < fromRealHome + 2; ++realHome) {
            for (uint256 realAway; realAway < 16; ++realAway) {
                uint8 realByte = uint8(realHome | (realAway << 4));
                for (uint256 myHome; myHome < 16; ++myHome) {
                    for (uint256 myAway; myAway < 16; ++myAway) {
                        uint256 want = _footballRule(myHome, myAway, realHome, realAway);
                        uint256 got = _points(footballId, abi.encodePacked(uint8(myHome | (myAway << 4)), realByte));
                        if (got != want) {
                            revert(
                                string.concat(
                                    "football wrong: pick ",
                                    vm.toString(myHome),
                                    "-",
                                    vm.toString(myAway),
                                    ", real ",
                                    vm.toString(realHome),
                                    "-",
                                    vm.toString(realAway)
                                )
                            );
                        }
                        ++cases;
                    }
                }
            }
        }
        assertEq(cases, 8192);
    }

    function test_football_everyCase_realHome_00_01() public view { _footballSlice(0); }
    function test_football_everyCase_realHome_02_03() public view { _footballSlice(2); }
    function test_football_everyCase_realHome_04_05() public view { _footballSlice(4); }
    function test_football_everyCase_realHome_06_07() public view { _footballSlice(6); }
    function test_football_everyCase_realHome_08_09() public view { _footballSlice(8); }
    function test_football_everyCase_realHome_10_11() public view { _footballSlice(10); }
    function test_football_everyCase_realHome_12_13() public view { _footballSlice(12); }
    function test_football_everyCase_realHome_14_15() public view { _footballSlice(14); }

    // ------------------------------------------------------------------ the worked examples

    /// The examples printed in docs/RULES.md and circuits/README.md, asked of the real evaluator.
    function test_workedExamples() public view {
        assertEq(_points(footballId, hex"1212"), 3, "football 2-1 against 2-1");
        assertEq(_points(footballId, hex"0112"), 1, "football 1-0 against 2-1");
        assertEq(_points(footballId, hex"1312"), 1, "football 3-1 against 2-1");
        assertEq(_points(footballId, hex"1112"), 0, "football 1-1 against 2-1");
        assertEq(_points(footballId, hex"2012"), 0, "football 0-2 against 2-1");

        assertEq(_points(basketballId, hex"12"), 3, "basketball home B against home B");
        assertEq(_points(basketballId, hex"10"), 1, "basketball home A against home B");
        assertEq(_points(basketballId, hex"13"), 0, "basketball away B against home B");

        assertEq(_points(tennisId, hex"12"), 3, "tennis best of 3, A in 3 against A in 3");
        assertEq(_points(tennisId, hex"10"), 1, "tennis best of 3, A in 2 against A in 3");
        assertEq(_points(tennisId, hex"13"), 0, "tennis best of 3, B in 3 against A in 3");
        assertEq(_points(tennisId, hex"64"), 3, "tennis best of 5, A in 4 against A in 4");
        assertEq(_points(tennisId, hex"50"), 0, "tennis best of 5, impossible pick of 2 sets");
    }
}
