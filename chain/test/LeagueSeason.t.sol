// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITapeSendHub} from "../src/ITapeOut.sol";
import {KickoffCheck} from "../src/KickoffCheck.sol";
import {Rehearsal} from "./Rehearsal.sol";

/// A rehearsal on a PRIVATE COPY of X Layer mainnet. Nothing here is sent to the real network.
///
/// A small league plays three matches, one for each sport, from start to finish. The picks were
/// sealed and bundled by the picks engine (engine/vectors/league.json holds every value it worked
/// out). Here the chain does its half: the league locks each bundle through TapeOut's real mailbox
/// before kickoff, then every pick is opened, checked and scored by the real scoring circuits.
///
/// It also shows the engine and the chain agree: every fingerprint, every bundle root, every
/// receipt and every score in the engine's file is worked out again here in Solidity.
contract LeagueSeasonTest is Rehearsal {
    bytes constant PUBLIC_MESSAGE_HEADER = hex"54530200"; // "TS", version 2, kind 0 (public)

    struct MatchV {
        bytes32 id;
        uint8 sport;
        bool bestOf5;
        uint256 kickoffAfter;
        uint8 resultByte;
        uint64 count;
        bytes32 root;
        bytes32 lockRef;
    }

    struct PickV {
        bytes32 player;
        uint8 pickByte;
        bytes32 salt;
        bytes32 fingerprint;
        uint256 index;
        bytes32[] path;
        uint256 points;
    }

    string vectors;
    bytes32 league;
    uint256 matchCount;
    uint256 playerCount;

    mapping(uint8 => uint256) circuitOf; // sport -> scoring circuit id
    uint256 leagueCircuit;
    address leagueAccount;
    bytes32 leagueInbox;

    mapping(bytes32 => uint256) pointsOf;
    mapping(bytes32 => uint256) threesOf;
    mapping(bytes32 => uint256) onesOf;

    function setUp() public {
        _startCopyOfXLayer();
        circuitOf[KickoffCheck.FOOTBALL] = _publishScoringCircuit("football", 16);
        circuitOf[KickoffCheck.BASKETBALL] = _publishScoringCircuit("basketball", 6);
        circuitOf[KickoffCheck.TENNIS] = _publishScoringCircuit("tennis", 7);
        leagueCircuit = _tapeout(ONE_GATE, 1, 1);
        leagueAccount = _open(leagueCircuit);
        leagueInbox = HUB.endpointOf(leagueAccount);

        vectors = vm.readFile(string.concat(vm.projectRoot(), "/../engine/vectors/league.json"));
        league = vm.parseJsonBytes32(vectors, ".league");
        matchCount = vm.parseJsonUint(vectors, ".matchCount");
        playerCount = vm.parseJsonUint(vectors, ".playerCount");
    }

    // ------------------------------------------------------------------ reading the engine's file

    function _matchKey(uint256 i, string memory key) internal pure returns (string memory) {
        return string.concat(".matches[", vm.toString(i), "].", key);
    }

    function _pickKey(uint256 i, uint256 j, string memory key) internal pure returns (string memory) {
        return string.concat(".matches[", vm.toString(i), "].picks[", vm.toString(j), "].", key);
    }

    function _match(uint256 i) internal view returns (MatchV memory m) {
        m.id = vm.parseJsonBytes32(vectors, _matchKey(i, "id"));
        m.sport = uint8(vm.parseJsonUint(vectors, _matchKey(i, "sport")));
        m.bestOf5 = vm.parseJsonBool(vectors, _matchKey(i, "bestOf5"));
        m.kickoffAfter = vm.parseJsonUint(vectors, _matchKey(i, "kickoffAfter"));
        m.resultByte = uint8(vm.parseJsonUint(vectors, _matchKey(i, "resultByte")));
        m.count = uint64(vm.parseJsonUint(vectors, _matchKey(i, "count")));
        m.root = vm.parseJsonBytes32(vectors, _matchKey(i, "root"));
        m.lockRef = vm.parseJsonBytes32(vectors, _matchKey(i, "lockRef"));
    }

    function _pick(uint256 i, uint256 j) internal view returns (PickV memory p) {
        p.player = vm.parseJsonBytes32(vectors, _pickKey(i, j, "player"));
        p.pickByte = uint8(vm.parseJsonUint(vectors, _pickKey(i, j, "pickByte")));
        p.salt = vm.parseJsonBytes32(vectors, _pickKey(i, j, "salt"));
        p.fingerprint = vm.parseJsonBytes32(vectors, _pickKey(i, j, "fingerprint"));
        p.index = vm.parseJsonUint(vectors, _pickKey(i, j, "index"));
        p.path = vm.parseJsonBytes32Array(vectors, _pickKey(i, j, "path"));
        p.points = vm.parseJsonUint(vectors, _pickKey(i, j, "points"));
    }

    // ------------------------------------------------------------------ what the league puts on chain

    function _lockMessage(MatchV memory m) internal pure returns (bytes memory) {
        return bytes.concat(
            PUBLIC_MESSAGE_HEADER,
            bytes(
                string.concat(
                    '{"v":1,"kind":"message","subject":"kickoff/lock/v1","body":"',
                    vm.toString(m.id),
                    " ",
                    vm.toString(uint256(m.count)),
                    " ",
                    vm.toString(m.root),
                    '"}'
                )
            )
        );
    }

    function _resultMessage(MatchV memory m) internal pure returns (bytes memory) {
        return bytes.concat(
            PUBLIC_MESSAGE_HEADER,
            bytes(
                string.concat(
                    '{"v":1,"kind":"message","subject":"kickoff/result/v1","body":"',
                    vm.toString(m.id),
                    " final ",
                    vm.toString(uint256(m.resultByte)),
                    '"}'
                )
            )
        );
    }

    /// The league writes to its own inbox, so everything about a league is in one place.
    function _post(bytes32 ref, bytes memory payload) internal returns (uint256 index) {
        vm.prank(deployer);
        index = HUB.send(address(processor), leagueCircuit, leagueInbox, ref, payload);
    }

    // ------------------------------------------------------------------ the engine and the chain agree

    function test_theChainWorksOutTheSameValuesAsTheEngine() public view {
        uint256 checked;
        for (uint256 i; i < matchCount; ++i) {
            MatchV memory m = _match(i);
            assertEq(
                KickoffCheck.lockRef(league, m.id, m.count, m.root), m.lockRef, "the value that goes on chain for the bundle"
            );
            for (uint256 j; j < m.count; ++j) {
                PickV memory p = _pick(i, j);
                assertEq(
                    KickoffCheck.fingerprint(league, m.id, m.sport, p.pickByte, p.player, p.salt),
                    p.fingerprint,
                    "the pick's fingerprint"
                );
                assertTrue(
                    KickoffCheck.inBundle(KickoffCheck.leaf(p.player, p.fingerprint), p.index, m.count, p.path, m.root),
                    "the receipt proves the pick is in the bundle"
                );
                ++checked;
            }
        }
        assertEq(checked, matchCount * playerCount, "every pick of every match was checked");
    }

    // ------------------------------------------------------------------ a whole season

    function test_aLeaguePlaysAWholeSeason() public {
        uint256 start = block.timestamp;
        uint256[] memory lockIndex = new uint256[](matchCount);
        uint256 lastKickoff;

        // Before any match starts, the league locks every bundle.
        for (uint256 i; i < matchCount; ++i) {
            MatchV memory m = _match(i);
            lockIndex[i] = _post(m.lockRef, _lockMessage(m));
            if (start + m.kickoffAfter > lastKickoff) lastKickoff = start + m.kickoffAfter;
        }

        // The matches are played.
        vm.warp(lastKickoff + 2 hours);

        // The league posts each result, then every pick is opened, checked and scored.
        for (uint256 i; i < matchCount; ++i) {
            MatchV memory m = _match(i);
            _post(m.id, _resultMessage(m));
            _openAndScoreEveryPick(i, m, start + m.kickoffAfter, lockIndex[i]);
        }

        // The totals are the engine's table.
        for (uint256 k; k < playerCount; ++k) {
            string memory row = string.concat(".table[", vm.toString(k), "].");
            bytes32 player = vm.parseJsonBytes32(vectors, string.concat(row, "player"));
            assertEq(pointsOf[player], vm.parseJsonUint(vectors, string.concat(row, "points")), "points");
            assertEq(threesOf[player], vm.parseJsonUint(vectors, string.concat(row, "threes")), "3-point picks");
            assertEq(onesOf[player], vm.parseJsonUint(vectors, string.concat(row, "ones")), "1-point picks");
            emit log_named_string("player", vm.parseJsonString(vectors, string.concat(row, "name")));
            emit log_named_uint("  position", vm.parseJsonUint(vectors, string.concat(row, "position")));
            emit log_named_uint("  points, scored by the real circuits", pointsOf[player]);
        }
    }

    function _openAndScoreEveryPick(uint256 i, MatchV memory m, uint256 kickoff, uint256 lockAt) internal {
        // What is on chain for this match: who locked it, when, and what.
        ITapeSendHub.Entry memory lock = HUB.inboxAt(leagueInbox, lockAt);
        assertEq(lock.from, leagueAccount, "locked by the league's own account");
        assertLt(lock.timestamp, kickoff, "locked before kickoff");
        assertEq(lock.digest, HUB.digestOf(m.lockRef, _lockMessage(m)), "the lock on chain is this bundle");

        for (uint256 j; j < m.count; ++j) {
            PickV memory p = _pick(i, j);
            // The pick and salt the player gives out must produce the sealed fingerprint...
            bytes32 fingerprint = KickoffCheck.fingerprint(league, m.id, m.sport, p.pickByte, p.player, p.salt);
            // ...and that fingerprint must be in the bundle that was locked.
            assertTrue(
                KickoffCheck.inBundle(KickoffCheck.leaf(p.player, fingerprint), p.index, m.count, p.path, m.root),
                "the opened pick is in the locked bundle"
            );
            // Then the sport's real circuit scores it.
            uint256 points = _points(
                circuitOf[m.sport], KickoffCheck.circuitInputs(m.sport, p.pickByte, m.resultByte, m.bestOf5)
            );
            assertEq(points, p.points, "the real circuit gives the points the engine gave");
            pointsOf[p.player] += points;
            if (points == 3) threesOf[p.player] += 1;
            if (points == 1) onesOf[p.player] += 1;
        }
    }

    // ------------------------------------------------------------------ cheating

    function test_cheat_lockingAfterKickoffIsStampedLate() public {
        MatchV memory m = _match(0);
        uint256 kickoff = block.timestamp + m.kickoffAfter;
        vm.warp(kickoff + 5 minutes);
        uint256 index = _post(m.lockRef, _lockMessage(m));
        assertGt(HUB.inboxAt(leagueInbox, index).timestamp, kickoff, "the chain's own time shows the lock came after kickoff");
    }

    function test_cheat_aChangedPickDoesNotMatchWhatWasSealed() public view {
        MatchV memory m = _match(0);
        PickV memory p = _pick(0, 0);
        uint8 changed = p.pickByte == m.resultByte ? p.pickByte + 1 : m.resultByte; // claim the exact score instead
        bytes32 claimed = KickoffCheck.fingerprint(league, m.id, m.sport, changed, p.player, p.salt);
        assertTrue(claimed != p.fingerprint, "a different pick gives a different fingerprint");
        assertFalse(
            KickoffCheck.inBundle(KickoffCheck.leaf(p.player, claimed), p.index, m.count, p.path, m.root),
            "so it is not in the locked bundle"
        );
    }

    function test_cheat_anotherPlayersSealedPickCannotBeOpenedAsYourOwn() public view {
        MatchV memory m = _match(0);
        PickV memory theirs = _pick(0, 0);
        PickV memory mine = _pick(0, 1);
        // Open their pick and salt under my name.
        bytes32 claimed = KickoffCheck.fingerprint(league, m.id, m.sport, theirs.pickByte, mine.player, theirs.salt);
        assertTrue(claimed != theirs.fingerprint, "the fingerprint covers the player");
        assertFalse(
            KickoffCheck.inBundle(KickoffCheck.leaf(mine.player, claimed), mine.index, m.count, mine.path, m.root),
            "so their pick is not in the bundle under my name"
        );
    }

    function test_cheat_aPickFromOneMatchCannotBeUsedInAnother() public view {
        MatchV memory first = _match(0);
        MatchV memory second = _match(1);
        PickV memory p = _pick(0, 0);
        assertFalse(
            KickoffCheck.inBundle(KickoffCheck.leaf(p.player, p.fingerprint), p.index, second.count, p.path, second.root),
            "a pick sealed for one match is not in another match's bundle"
        );
        assertTrue(
            KickoffCheck.inBundle(KickoffCheck.leaf(p.player, p.fingerprint), p.index, first.count, p.path, first.root),
            "it is in its own"
        );
    }
}
