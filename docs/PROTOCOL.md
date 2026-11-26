# What a league puts on chain, and how to read it

This page is for anyone who wants to check a Kickoff league without asking Kickoff. It says exactly
what a league writes on chain, what each piece means, and the rules for deciding what to believe.
The code that follows these rules is in [`engine/src/`](../engine/src/), and the same checks
written for the chain are in [`chain/src/KickoffCheck.sol`](../chain/src/KickoffCheck.sol).

> [!NOTE]
> This is the format the picks engine uses today and the rehearsals have run. Nothing is live on
> X Layer yet. If the format changes before it goes live, the `v1` in each name changes with it.

## Where a league lives

A league is one TapeOut circuit with its own account and its own inbox in TapeOut's mailbox
(TapeSend). **The league's id is its inbox's address in the mailbox**, 32 bytes.

The league writes everything to its own inbox. To read a league, read that inbox. Only messages
sent by the league's own account are the league's word. Anyone can write to any inbox, so messages
from other accounts are ignored, apart from challenges.

## The ids and fingerprints

Every one of these is a SHA-256. The first part of each is a fixed label, so one kind can never be
passed off as another. Numbers are written biggest part first.

| What | SHA-256 of |
| --- | --- |
| **A match's id** | `kickoff/match/v1` (16 bytes), league (32), sport (1), kickoff time in seconds (8), best of (1), the label as text |
| **A sealed pick's fingerprint** | `kickoff/pick/v1` (15 bytes), league (32), match (32), sport (1), pick (1), player (32), salt (32) |
| **A leaf of the bundle** | `0x00`, player (32), fingerprint (32) |
| **A node of the bundle** | `0x01`, left (32), right (32) |
| **The lock value** | `kickoff/lock/v1` (15 bytes), league (32), match (32), number of picks (8), bundle root (32) |

Sport is 1 for football, 2 for basketball, 3 for tennis. A football match is three predictions,
and each is a match of its own with a sport number of its own: 4 for the result, 5 for goal goal
and 6 for the exact score. They share the kickoff time and the label, so only the sport number
tells their ids apart, and all three are given the same result. Sport 1 is the older single
football prediction, which the first matches were played under. Best of is 3 or 5 for tennis and 0 for the
other sports. The pick byte is laid out as that sport's scoring circuit expects, as shown in
[circuits/README.md](../circuits/README.md).

The bundle is a Merkle tree built as in RFC 6962. Its leaves are in order of player id, and a
player appears only once.

**Why a match's id is made from its facts.** The id is inside every sealed pick and every lock. So
the kickoff time cannot be changed afterwards: a match with a different kickoff is a different
match, and picks sealed for the first do not count for the second.

## The messages

Each is an ordinary public TapeSend message (TAP-10): the four bytes `TS` `0x02` `0x00`, then this
JSON, with the keys in this order and no spaces:

```
{"v":1,"kind":"message","subject":"<subject>","body":"<body>"}
```

Each message also carries a 32-byte reference. The mailbox records, for every message, who sent it,
the time it arrived, and a fingerprint of the reference and the message together.

| Subject | Sent by | Reference | Body |
| --- | --- | --- | --- |
| `kickoff/match/v1` | the league | the match's id | `<sport> <kickoff> <best of> <label>` |
| `kickoff/lock/v1` | the league | the lock value | `<match id> <number of picks> <bundle root>` |
| `kickoff/result/v1` | the league | the match's id | `<match id> final <result byte>` or `<match id> void` |
| `kickoff/challenge/v1` | any member | the match's id | `<match id> <the result byte they say is right>` |

Ids and roots are written as `0x` and 64 lowercase hex digits. Numbers are written in decimal with
no leading zeros. A result byte is laid out the same way as a pick byte. A label is plain text of at
most 80 bytes, with no quotation marks or backslashes.

## What counts

Go through the inbox in order. A message that fails any of these is ignored.

**A match** counts if it was sent by the league, its reference is the id its own facts produce, and
the chain stamped it before its kickoff. The first announcement of a match is the one that counts.

**A lock** counts if it was sent by the league, its match was already announced, and its reference
is the lock value its own contents produce. Of the locks for a match, **the last one stamped before
kickoff is in force**. A lock stamped at or after kickoff is never in force. If no lock is in force,
no pick for that match counts.

**A result** counts if it was sent by the league, its reference is its match, the chain stamped it
at or after kickoff, and it is a result that can happen in that sport. **The last result is in
force**, so a league can correct a mistake, but every result it gave stays in the inbox for good.
`void` means the match was postponed, abandoned, or ended in a walkover or retirement, and nobody
scores.

**A challenge** is never hidden. It is listed with its match, along with whether it came within 24
hours of the result it disputes. In this first version a challenge does not change a result by
itself. The league answers it by giving a new result or by leaving the result as it is, and either
way the challenge stays visible.

## The opened picks

A pick is opened by giving its pick byte and its salt. A player can do that from their own device.
So that nobody has to, a device also sends, with its fingerprint, a **locked copy**: the pick byte
and salt encrypted to the league robot's public key (P-256 ECDH with a one-time key, HKDF-SHA-256,
AES-256-GCM, bound to the league, match, player and fingerprint; 127 bytes; see
`engine/src/envelope.js`). The robot opens the copies once the match has started. A locked copy
gives nobody any way to change a pick: whatever comes out of it must still produce the fingerprint
that was locked before kickoff, exactly as below.

After kickoff the league publishes, for each match, a file with the list of sealed picks that went
into the bundle and the picks that have been opened:

```
{
  "v": 1,
  "match": "0x…",
  "entries":  [ { "player": "0x…", "fingerprint": "0x…", "joined": 1764000000 }, … ],
  "openings": [ { "player": "0x…", "pickByte": 18, "salt": "0x…", "index": 1, "path": ["0x…", …] }, … ]
}
```

This file is not in the mailbox, and does not need to be. Nothing in it is taken on trust:

- The list of entries is used only if it produces exactly the root and the number of picks in the
  lock that is in force.
- Each opened pick must produce a fingerprint that its `index` and `path` prove is in that root.
- Then the pick must be one that can happen in that kind of match.

`joined` is the one thing in the file that is the league's word: when that player joined Kickoff,
in seconds. Joining happens on Kickoff, not on chain, so it cannot prove itself. It is published so
that anyone building the table can put players who are level on points in the same order Kickoff
does, and so that it is on the public record if it ever changes. It decides nothing about points.
It may be left out, and it is used only from a list of entries that produces the root on chain. If
two files give one player different times, the earlier is used.

So the file can be kept anywhere. Kickoff keeps it on the league's on-chain site (TapeOut's site
store, under the league's own account), at the path `openings/<match id>.json`, where the match id
is 64 lowercase hex digits with no `0x`. The site store takes a file in pieces of up to 24,000
bytes (`putFile` for the first, `appendChunk` for each one after), so the file can be any size: a
match picked by a hundred players is about 85,000 bytes, in four pieces. The store keeps a SHA-256
of the whole file from the first piece on, so a reader can tell a whole file from a half-uploaded
one, and uses nothing from a file that does not match it. A player who holds their own pick, salt and
receipt can also publish their own opening, and it proves itself in the same way.

## Fetching a league from a node

A league's id says where it is: 4 zero bytes, the chain's number (8 bytes; X Layer is 196), then
the address of the league's account (20 bytes). The account in the id is the one whose word counts.

To read the inbox, follow TAP-10 section 13:

1. Pick one block and read everything as it stood at that block.
2. Ask the mailbox `inboxCount(id)`, then `inboxPage(id, start, 200)` until every entry is in hand.
   Each entry is who sent the message, the block it is in, its time, and its fingerprint.
3. For each entry, fetch the mailbox's `Sent` logs in that entry's block. Accept a log only if it
   is from the mailbox, for this inbox, from the entry's sender, with the entry's place in the
   inbox, and `keccak256(reference, then keccak256(text))` equals the entry's fingerprint. Take only
   the reference and the text from the log.
4. If any message cannot be found in a form that passes, stop. Do not build a table from part of an
   inbox.

Kickoff's code for this is [`engine/src/xlayer.js`](../engine/src/xlayer.js), and
`node engine/bin/table.js <league id>` prints the result.

## Building the table

1. Read the league's inbox and apply the rules above. That gives each match, the lock in force for
   it, and its result.
2. For each match with a final result, check each opened pick against the lock in force.
3. Score each pick that passes with the sport's scoring circuit: `eval` on the circuit, with the
   pick byte and the result byte as inputs, gives 0, 1 or 3 points.
4. Add up each player's points. Most points first. Between players level on points, whoever has
   the earlier `joined` time is ahead, a player with none comes after those who have one, and
   players level even on that go in order of player id. Nobody shares a position.

Anyone who does this gets the same table. The rules of the game are in [RULES.md](RULES.md).

## Honest limits

- **A league decides when to publish the openings file.** Until it does, the chain alone shows
  that a bundle was locked, but not who is in it. A player can publish their own opening without
  waiting for the league.
- **Results are entered by the league.** They are checked for being possible, not for being true.
  A wrong result is visible to everyone, and so is every challenge to it.
- **Kickoff's fetcher asks one node.** Every message is checked against the mailbox's fingerprint,
  but the node is believed about what the mailbox stores. TAP-10 says to ask several independent
  nodes and require them to agree. That is still to do.
- **Receipts are not signed by the league yet.** A player dropped from a bundle can show their
  receipt is for a different bundle from the one on chain, but the league could deny having issued
  it.
