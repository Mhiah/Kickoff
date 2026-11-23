// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Rehearsal} from "./Rehearsal.sol";

/// A rehearsal on a PRIVATE COPY of X Layer mainnet. Nothing here is sent to the real network.
///
/// Kickoff keeps a verified copy of its website on chain (DeWEB), in the account of a circuit. This
/// rehearses that with TapeOut's real site store: uploading a page and reading it back, uploading
/// a file too big for one piece, who is allowed to change the site, and what happens to the site
/// when the circuit changes hands.
contract LeagueSiteTest is Rehearsal {
    string constant HTML = "text/html; charset=utf-8";
    uint256 constant PIECE = 24_000; // the most the site store takes in one piece

    bytes constant PAGE =
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Kickoff</title></head>"
        "<body><h1>Kickoff</h1><p>Picks sealed before the match. A table nobody can edit.</p></body></html>";

    uint256 leagueId;
    address league;

    function setUp() public {
        _startCopyOfXLayer();
        leagueId = _tapeout(ONE_GATE, 1, 1);
        league = _open(leagueId);
    }

    // ------------------------------------------------------------------ helpers

    function _put(address who, string memory path, bytes memory wholeFile, bytes memory firstPiece) internal {
        bytes32 fingerprint = sha256(wholeFile);
        vm.prank(who);
        SITES.putFile(league, path, HTML, fingerprint, firstPiece);
    }

    function _slice(bytes memory data, uint256 start, uint256 len) internal pure returns (bytes memory out) {
        out = new bytes(len);
        for (uint256 i; i < len; ++i) {
            out[i] = data[start + i];
        }
    }

    // ------------------------------------------------------------------ one page

    function test_uploadAOnePageSiteAndReadItBack() public {
        assertEq(SITES.pathCount(league), 0, "the account starts with no files");

        _put(deployer, "index.html", PAGE, PAGE);

        (uint32 size, string memory contentType, bytes32 fingerprint, uint40 updatedAt, uint256 pieces) =
            SITES.fileInfo(league, "index.html");
        assertEq(size, PAGE.length, "the size on chain is the size of the page");
        assertEq(contentType, HTML, "stored as a web page");
        assertEq(fingerprint, sha256(PAGE), "the fingerprint on chain is the page's fingerprint");
        assertEq(updatedAt, block.timestamp, "stamped with the time it was uploaded");
        assertEq(pieces, 1, "small enough for one piece");

        bytes memory readBack = SITES.read(league, "index.html");
        assertEq(keccak256(readBack), keccak256(PAGE), "the page read back is the page that was uploaded");
        assertEq(sha256(readBack), fingerprint, "and it matches the fingerprint on chain");

        assertEq(SITES.pathCount(league), 1, "one file now");
        assertEq(SITES.pathsRange(league, 0, 10)[0], "index.html", "and it is listed by name");

        // The page to show when an address does not match any file.
        vm.prank(deployer);
        SITES.setFallback(league, "index.html");
        assertEq(SITES.fallbackPath(league), "index.html", "the fallback page is set");
    }

    // ------------------------------------------------------------------ a bigger file

    function test_aLargerFileIsUploadedInPiecesAndReadsBackWhole() public {
        // 60,000 bytes: two full pieces and one part piece. The real site will be bigger than one piece.
        bytes memory file = new bytes(60_000);
        for (uint256 i; i < file.length; ++i) {
            file[i] = bytes1(uint8((i * 31 + 7) % 251));
        }
        bytes32 fingerprint = sha256(file);

        // First piece. The fingerprint given is that of the WHOLE file.
        _put(deployer, "app.js", file, _slice(file, 0, PIECE));
        (uint32 sizeSoFar,, bytes32 declared,, uint256 piecesSoFar) = SITES.fileInfo(league, "app.js");
        assertEq(piecesSoFar, 1, "one piece so far");
        assertEq(declared, fingerprint, "the whole file's fingerprint is on chain from the start");
        assertLt(sizeSoFar, file.length, "not all of it is there yet");
        assertTrue(sha256(SITES.read(league, "app.js")) != declared, "a half-uploaded file does not match, so it can be told apart");

        // The remaining pieces, in order.
        bytes memory second = _slice(file, PIECE, PIECE);
        bytes memory third = _slice(file, 2 * PIECE, file.length - 2 * PIECE);
        vm.prank(deployer);
        SITES.appendChunk(league, "app.js", 1, second);
        vm.prank(deployer);
        SITES.appendChunk(league, "app.js", 2, third);

        (uint32 size,,,, uint256 pieces) = SITES.fileInfo(league, "app.js");
        assertEq(size, file.length, "all 60,000 bytes are there");
        assertEq(pieces, 3, "in three pieces");

        bytes memory readBack = SITES.read(league, "app.js");
        assertEq(readBack.length, file.length, "the whole file reads back");
        assertEq(sha256(readBack), fingerprint, "and matches its fingerprint");

        // Reading a stretch that crosses from the first piece into the second.
        bytes memory across = SITES.readRange(league, "app.js", PIECE - 10, 20);
        assertEq(keccak256(across), keccak256(_slice(file, PIECE - 10, 20)), "a read across two pieces is seamless");
    }

    // ------------------------------------------------------------------ who may change the site

    function test_onlyTheLeaguesOwnerCanChangeTheSite() public {
        _put(deployer, "index.html", PAGE, PAGE);
        address stranger = makeAddr("stranger");
        bytes memory defaced = "<h1>Not Kickoff</h1>";
        bytes32 defacedFingerprint = sha256(defaced);

        // A stranger cannot replace the page, add to it, or remove it.
        vm.expectRevert();
        vm.prank(stranger);
        SITES.putFile(league, "index.html", HTML, defacedFingerprint, defaced);

        vm.expectRevert();
        vm.prank(stranger);
        SITES.appendChunk(league, "index.html", 1, defaced);

        vm.expectRevert();
        vm.prank(stranger);
        SITES.removeFile(league, "index.html");

        assertEq(keccak256(SITES.read(league, "index.html")), keccak256(PAGE), "the page is untouched");

        // The owner can.
        bytes memory updated = "<h1>Kickoff, updated</h1>";
        _put(deployer, "index.html", updated, updated);
        assertEq(keccak256(SITES.read(league, "index.html")), keccak256(updated), "the owner replaced the page");

        vm.prank(deployer);
        SITES.removeFile(league, "index.html");
        (,,,, uint256 pieces) = SITES.fileInfo(league, "index.html");
        assertEq(pieces, 0, "the owner removed the page");
    }

    // ------------------------------------------------------------------ changing hands

    /// A league is one circuit that owns its page, its prize account and its mailbox. When the
    /// circuit is handed to someone else, all of it goes with it in that one transfer.
    function test_theSiteMovesWithTheLeagueWhenItChangesHands() public {
        _put(deployer, "index.html", PAGE, PAGE);
        address newOwner = makeAddr("new owner");
        bytes memory fromOld = "<h1>The old owner tries again</h1>";
        bytes memory fromNew = "<h1>Under new ownership</h1>";
        bytes32 oldFingerprint = sha256(fromOld);

        vm.prank(deployer);
        processor.transferFrom(deployer, newOwner, leagueId);

        assertEq(processor.ownerOf(leagueId), newOwner, "the circuit has a new owner");
        assertEq(OPENER.accountOf(address(processor), leagueId), league, "the league's account is the same account");
        assertEq(keccak256(SITES.read(league, "index.html")), keccak256(PAGE), "the page is still there, unchanged");

        // The old owner has lost the site.
        vm.expectRevert();
        vm.prank(deployer);
        SITES.putFile(league, "index.html", HTML, oldFingerprint, fromOld);

        // The new owner has it.
        _put(newOwner, "index.html", fromNew, fromNew);
        assertEq(keccak256(SITES.read(league, "index.html")), keccak256(fromNew), "the new owner controls the page");
    }

    // ------------------------------------------------------------------ a probe, not a test

    /// This one cannot fail. It finds out two things the documents do not settle and prints them:
    /// what it costs to switch on a site's on-chain name, and which way of writing the name the
    /// name contract accepts. The answers are read from the run's output.
    function test_probe_theSitesOnChainName() public {
        uint256 monthlyFee = NAMES.monthlyFee();
        emit log_named_uint("fee for a site's on-chain name, for one month (OKB wei)", monthlyFee);

        uint256 count = FACTORY.cpuCount();
        string memory id = vm.toString(leagueId);
        string[4] memory candidates = [
            string.concat(id, ".2.", vm.toString(count - 1), ".tape"),
            string.concat(id, ".2.", vm.toString(count), ".tape"),
            string.concat(id, ".2.", vm.toString(count - 1)),
            string.concat(id, ".2.", vm.toString(count))
        ];
        bool accepted;
        for (uint256 i; i < candidates.length && !accepted; ++i) {
            vm.prank(deployer);
            try NAMES.bind{value: monthlyFee}(candidates[i], league, 1) {
                accepted = true;
                emit log_named_string("name accepted", candidates[i]);
                emit log_named_uint(
                    "  paid until (unix time)", NAMES.paidUntil(keccak256(bytes(candidates[i])), league)
                );
            } catch (bytes memory reason) {
                emit log_named_string("name refused", candidates[i]);
                emit log_named_bytes("  reason", reason);
            }
        }
        if (!accepted) emit log_string("no way of writing the name was accepted");
    }
}
