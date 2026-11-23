// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Kickoff's checks, written for the chain. These work out exactly the same values as the picks
/// engine in engine/src/ (seal.js, bundle.js, score.js), so a pick can be checked on chain as well
/// as in a browser. The rehearsal in test/LeagueSeason.t.sol confirms the two agree.
library KickoffCheck {
    uint8 internal constant FOOTBALL = 1;
    uint8 internal constant BASKETBALL = 2;
    uint8 internal constant TENNIS = 3;

    /// The fingerprint of a sealed pick: the SHA-256 of 145 bytes, in this order.
    ///   "kickoff/pick/v1" (15) | league (32) | match (32) | sport (1) | pick (1) | player (32) | salt (32)
    function fingerprint(bytes32 league, bytes32 matchId, uint8 sport, uint8 pickByte, bytes32 player, bytes32 salt)
        internal
        pure
        returns (bytes32)
    {
        return sha256(abi.encodePacked("kickoff/pick/v1", league, matchId, sport, pickByte, player, salt));
    }

    /// One sealed pick as a leaf of the bundle: SHA-256( 0x00 | player | fingerprint ).
    function leaf(bytes32 player, bytes32 pickFingerprint) internal pure returns (bytes32) {
        return sha256(abi.encodePacked(bytes1(0x00), player, pickFingerprint));
    }

    function _node(bytes32 left, bytes32 right) private pure returns (bytes32) {
        return sha256(abi.encodePacked(bytes1(0x01), left, right));
    }

    /// Is this leaf, at place `index` of a bundle of `size` picks, covered by `root`?
    /// The checking procedure from RFC 9162 section 2.1.3.2, for a tree built as in RFC 6962.
    function inBundle(bytes32 leafHash, uint256 index, uint256 size, bytes32[] memory path, bytes32 root)
        internal
        pure
        returns (bool)
    {
        if (index >= size) return false;
        uint256 fn = index;
        uint256 sn = size - 1;
        bytes32 r = leafHash;
        for (uint256 i; i < path.length; ++i) {
            if (sn == 0) return false;
            if (fn % 2 == 1 || fn == sn) {
                r = _node(path[i], r);
                if (fn % 2 == 0) {
                    while (fn % 2 == 0 && fn != 0) {
                        fn >>= 1;
                        sn >>= 1;
                    }
                }
            } else {
                r = _node(r, path[i]);
            }
            fn >>= 1;
            sn >>= 1;
        }
        return sn == 0 && r == root;
    }

    /// The one value a league puts on chain before kickoff. It covers the league, the match, the
    /// number of picks and the bundle's root.
    function lockRef(bytes32 league, bytes32 matchId, uint64 count, bytes32 root) internal pure returns (bytes32) {
        return sha256(abi.encodePacked("kickoff/lock/v1", league, matchId, count, root));
    }

    /// The bytes handed to a sport's scoring circuit: the pick, then the result, and for tennis
    /// whether the match is best of 5.
    function circuitInputs(uint8 sport, uint8 pickByte, uint8 resultByte, bool bestOf5)
        internal
        pure
        returns (bytes memory)
    {
        if (sport == FOOTBALL) return abi.encodePacked(pickByte, resultByte);
        if (sport == BASKETBALL) return abi.encodePacked(uint8(pickByte | (resultByte << 3)));
        if (sport == TENNIS) return abi.encodePacked(uint8(pickByte | (resultByte << 3) | (bestOf5 ? 64 : 0)));
        revert("unknown sport");
    }
}
