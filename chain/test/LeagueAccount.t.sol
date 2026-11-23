// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "forge-std/Vm.sol";
import {ITapeSendHub} from "../src/ITapeOut.sol";
import {Rehearsal} from "./Rehearsal.sol";

/// A rehearsal on a PRIVATE COPY of X Layer mainnet. Nothing here is sent to the real network.
///
/// A Kickoff league is one TapeOut circuit with its own account ("container") and mailbox. This
/// rehearses that with the real TapeOut contracts: opening the account, sending a message through
/// the mailbox and reading it back, and the whole life of one pick in miniature. The pick is
/// locked before kickoff, opened after, and scored by the football circuit.
contract LeagueAccountTest is Rehearsal {
    /// The smallest possible circuit: one NAND gate that flips its one input. It stands in for the
    /// circuit a league or a player would own.
    bytes constant ONE_GATE = hex"00000002000002";

    /// The start of every TapeSend message (TAP-10 section 15.1): "TS", version 2, kind 0 (public).
    bytes constant PUBLIC_MESSAGE_HEADER = hex"54530200";

    bytes32 constant SENT_TOPIC = keccak256("Sent(bytes32,address,bytes32,uint256,uint256,bytes)");

    uint256 footballId;
    uint256 leagueId;
    uint256 playerId;

    function setUp() public {
        _startCopyOfXLayer();
        footballId = _publishScoringCircuit("football", 16);
        leagueId = _tapeout(ONE_GATE, 1, 1);
        playerId = _tapeout(ONE_GATE, 1, 1);
    }

    // ------------------------------------------------------------------ helpers

    function _open(uint256 id) internal returns (address account) {
        uint256 fee = OPENER.FEE();
        vm.prank(deployer);
        account = OPENER.open{value: fee}(address(processor), id);
    }

    function _message(string memory subject, string memory body) internal pure returns (bytes memory) {
        return bytes.concat(
            PUBLIC_MESSAGE_HEADER, bytes(string.concat('{"v":1,"kind":"message","subject":"', subject, '","body":"', body, '"}'))
        );
    }

    function _send(uint256 fromId, address to, bytes32 ref, bytes memory payload) internal returns (uint256 index) {
        vm.prank(deployer);
        index = HUB.send(address(processor), fromId, HUB.endpointOf(to), ref, payload);
    }

    /// The fingerprint of a football pick. It hides the pick until the salt is given out.
    function _fingerprint(uint256 matchId, uint8 homeGoals, uint8 awayGoals, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encode("kickoff/football-pick/v0", matchId, homeGoals, awayGoals, salt));
    }

    // ------------------------------------------------------------------ the league's account

    function test_openingALeagueGivesItItsOwnAccount() public {
        uint256 fee = OPENER.FEE();
        emit log_named_uint("fee to open an account (OKB wei)", fee);

        assertFalse(OPENER.isOpened(address(processor), leagueId), "not opened yet");
        uint256 before = deployer.balance;
        address league = _open(leagueId);

        assertTrue(OPENER.isOpened(address(processor), leagueId), "opened");
        assertEq(before - deployer.balance, fee, "opening costs exactly the fee");
        assertEq(league, OPENER.accountOf(address(processor), leagueId), "the opener knows the account");
        assertEq(league, HUB.accountOf(address(processor), leagueId), "the mailbox knows the same account");
        assertGt(league.code.length, 0, "the account is a real contract");
    }

    function test_theLeagueAccountCanHoldPrizeMoney() public {
        address league = _open(leagueId);
        address sponsor = makeAddr("sponsor");
        vm.deal(sponsor, 1 ether);

        vm.prank(sponsor);
        (bool ok,) = league.call{value: 0.5 ether}("");

        assertTrue(ok, "the account accepts OKB");
        assertEq(league.balance, 0.5 ether, "the prize money is in the league's account");
    }

    // ------------------------------------------------------------------ the mailbox

    function test_onlyAnOpenedAccountCanSend_butAnyAccountCanReceive() public {
        address league = OPENER.accountOf(address(processor), leagueId);
        bytes memory payload = _message("Kickoff rehearsal", "hello");
        bytes32 to = HUB.endpointOf(league);

        // The player has not opened an account, so the mailbox refuses to send for them.
        vm.expectRevert(bytes4(0x6d36408a)); // NotOpened
        vm.prank(deployer);
        HUB.send(address(processor), playerId, to, bytes32(0), payload);

        // Once the player's account is open, they can write to the league even though the league's
        // own account is still closed.
        _open(playerId);
        assertFalse(OPENER.isOpened(address(processor), leagueId), "the league is still closed");
        uint256 index = _send(playerId, league, bytes32(0), payload);
        assertEq(HUB.inboxCount(to), index + 1, "the message is in the league's inbox");
    }

    function test_sendAMessageAndReadItBack() public {
        address league = _open(leagueId);
        address player = _open(playerId);
        bytes32 to = HUB.endpointOf(league);
        bytes32 ref = keccak256("kickoff/rehearsal");
        bytes memory payload = _message("Kickoff rehearsal", "A message from a player to their league.");
        assertLe(payload.length, HUB.MAX_PAYLOAD(), "within the size limit");

        uint256 inboxBefore = HUB.inboxCount(to);
        uint256 outboxBefore = HUB.outboxCount(player);

        vm.recordLogs();
        uint256 index = _send(playerId, league, ref, payload);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        // The inbox has one more line, and it says who sent it, when, and the message's fingerprint.
        assertEq(index, inboxBefore, "it took the next place in the inbox");
        assertEq(HUB.inboxCount(to), inboxBefore + 1, "one more message in the league's inbox");
        assertEq(HUB.outboxCount(player), outboxBefore + 1, "one more message in the player's outbox");
        ITapeSendHub.Entry memory entry = HUB.inboxAt(to, index);
        assertEq(entry.from, player, "sent by the player's account");
        assertEq(entry.timestamp, block.timestamp, "stamped with the time it arrived");
        assertEq(entry.blockNumber, block.number, "stamped with the block it arrived in");
        assertEq(entry.digest, keccak256(abi.encodePacked(ref, keccak256(payload))), "fingerprint of the message");
        assertEq(entry.digest, HUB.digestOf(ref, payload), "the mailbox works the fingerprint out the same way");

        // The message text travels in the Sent event. Read it back and compare.
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(HUB) || logs[i].topics.length != 4 || logs[i].topics[0] != SENT_TOPIC) continue;
            (uint256 inboxIndex,, bytes memory text) = abi.decode(logs[i].data, (uint256, uint256, bytes));
            assertEq(logs[i].topics[1], to, "addressed to the league");
            assertEq(address(uint160(uint256(logs[i].topics[2]))), player, "from the player");
            assertEq(logs[i].topics[3], ref, "with the same reference");
            assertEq(inboxIndex, index, "same place in the inbox");
            assertEq(keccak256(text), keccak256(payload), "the text read back is the text that was sent");
            found = true;
        }
        assertTrue(found, "the Sent event was emitted");
    }

    // ------------------------------------------------------------------ one pick, start to finish

    /// The life of one pick, in miniature:
    ///   1. before kickoff the player sends only the fingerprint of their pick (nobody can read it);
    ///   2. the mailbox stamps it with the time, which proves it was made before kickoff;
    ///   3. a pick sent after kickoff is stamped late, so it can be told apart and refused;
    ///   4. after the match the player gives out the pick and its salt, and anyone can check they
    ///      match the fingerprint from step 1;
    ///   5. the football circuit scores the opened pick against the real result.
    ///
    /// This rehearses hiding a pick behind a fingerprint, which is how guest picks work. Encrypted
    /// messages (TapeSend's sealed kind) are done in the browser and are tested with the picks
    /// engine, not here.
    function test_aPickIsLockedBeforeKickoff_openedAfter_andScored() public {
        address league = _open(leagueId);
        _open(playerId);
        bytes32 inbox = HUB.endpointOf(league);

        uint256 matchId = 1;
        uint256 kickoff = block.timestamp + 1 hours;
        bytes32 salt = keccak256("a secret only the player knows");

        // 1 and 2. The player picks 2-1 and sends only its fingerprint, before kickoff.
        bytes32 sealedPick = _fingerprint(matchId, 2, 1, salt);
        uint256 pickIndex = _send(playerId, league, sealedPick, _message("Kickoff pick", "sealed"));
        ITapeSendHub.Entry memory pickEntry = HUB.inboxAt(inbox, pickIndex);
        assertLt(pickEntry.timestamp, kickoff, "the pick arrived before kickoff");

        // The match kicks off and is played. It ends 2-1.
        vm.warp(kickoff + 2 hours);

        // 3. Someone tries to slip in a pick of the right score after the match. Its time gives it away.
        bytes32 latePick = _fingerprint(matchId, 2, 1, keccak256("another salt"));
        uint256 lateIndex = _send(playerId, league, latePick, _message("Kickoff pick", "sealed"));
        assertGt(HUB.inboxAt(inbox, lateIndex).timestamp, kickoff, "a pick sent after kickoff is stamped late");

        // 4. The player opens the first pick by giving out the score and the salt.
        _send(playerId, league, sealedPick, _message("Kickoff pick opened", "2-1"));
        assertEq(_fingerprint(matchId, 2, 1, salt), sealedPick, "the opened pick matches its fingerprint");
        assertTrue(_fingerprint(matchId, 3, 1, salt) != sealedPick, "a different score does not match");
        assertTrue(_fingerprint(matchId + 1, 2, 1, salt) != sealedPick, "nor does the same score for another match");

        // The original line in the inbox has not moved or changed.
        ITapeSendHub.Entry memory again = HUB.inboxAt(inbox, pickIndex);
        assertEq(again.timestamp, pickEntry.timestamp, "the time on the pick cannot be changed afterwards");
        assertEq(again.digest, pickEntry.digest, "nor can its fingerprint");

        // 5. The football circuit scores it: picked 2-1, ended 2-1.
        assertEq(_points(footballId, hex"1212"), 3, "exact score, 3 points");
    }
}
