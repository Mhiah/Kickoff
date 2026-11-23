// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Rehearsal} from "./Rehearsal.sol";

/// A rehearsal on a PRIVATE COPY of X Layer mainnet. Nothing here is sent to the real network.
///
/// It does what going live will do: creates a Kickoff processor through the real TapeOut factory,
/// publishes ("tapes out") the three scoring circuits from circuits/out/, then asks the real
/// TapeOut evaluator for the points on every possible input and compares each answer with the
/// rules written out again below in plain Solidity.
contract PublishCircuitsTest is Rehearsal {
    uint256 footballId;
    uint256 basketballId;
    uint256 tennisId;

    function setUp() public {
        _startCopyOfXLayer();
        footballId = _publishScoringCircuit("football", 16);
        basketballId = _publishScoringCircuit("basketball", 6);
        tennisId = _publishScoringCircuit("tennis", 7);

        emit log_named_uint("football circuit id", footballId);
        emit log_named_uint("basketball circuit id", basketballId);
        emit log_named_uint("tennis circuit id", tennisId);
        emit log_named_uint("transistor fee for one circuit (BEM, smallest unit)", transistors.protocolFee());
        emit log_named_uint("tape-out fee for one circuit (OKB wei)", processor.TAPEOUT_FEE());
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
