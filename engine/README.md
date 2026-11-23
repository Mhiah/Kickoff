# engine

Kickoff's picks engine: the code that seals a pick, bundles everyone's sealed picks into one
fingerprint, decides whether an opened pick counts, scores it with the scoring circuits, and builds
the league table.

It is plain JavaScript with nothing to install, and it runs the same in Node and in a browser, so
the website and anyone checking a league use exactly the same code.

> [!NOTE]
> **What is here:** sealing, bundling, opening and checking, scoring with the circuits, the table
> and personal records, reading a league back from its inbox, and fetching that inbox and the
> opened picks from an X Layer node, with 112 tests. **Not live yet:** no league exists on X Layer
> itself. The fetching has been run against a stand-in node in the tests, and against the real
> TapeOut contracts on a private copy of X Layer, where it passed
> ([rehearsal 5](../docs/REHEARSAL-RESULTS.md)). It has not been run against a real league.

## How a pick stays secret, then gets proven

**1. Sealing.** Before kickoff a player does not send their pick. They send its **fingerprint**: a
short code worked out from the pick and a secret random number, the **salt**, that never leaves
their device. Nobody can work the pick out from the fingerprint. There are only 256 possible
football scores, but the salt is 32 random bytes, so trying every score does not help.

**2. Bundling.** The league gathers every player's fingerprint for a match and works out **one**
fingerprint that covers them all, the **root**. Only that one value goes on chain, before kickoff.
Each player gets a **receipt** proving their sealed pick is covered by it.

**3. Opening.** After kickoff a player gives out their pick and their salt. Anyone can work the
fingerprint out again, check it against the receipt, check the receipt against the root on chain,
and check the chain's own time stamp on the root is before kickoff.

## What a fingerprint covers

The fingerprint is the SHA-256 of these 145 bytes:

| Part | Size | Why it is there |
| --- | --- | --- |
| `kickoff/pick/v1` | 15 bytes | So it can never be confused with any other kind of fingerprint |
| League | 32 bytes | A pick cannot be reused in another league |
| Match | 32 bytes | A pick cannot be reused for another match |
| Sport | 1 byte | 1 football, 2 basketball, 3 tennis |
| Pick | 1 byte | Laid out exactly as that sport's scoring circuit expects |
| Player | 32 bytes | One player cannot pass off another's sealed pick as their own |
| Salt | 32 bytes | Keeps the pick secret until the player gives it out |

## The bundle

The root is a Merkle tree built the standard way: RFC 6962, the scheme Certificate Transparency
uses. Each sealed pick is one leaf, the player's id followed by the fingerprint. Leaves are put in
order of player id, and a player may appear only once.

The one value that goes on chain covers the league, the match, the number of picks and the root.
The number of picks is in there on purpose: a receipt cannot prove on its own how big the bundle
was, so the size is taken from the chain, not from the receipt.

## When an opened pick is refused

Every one of these must hold. The first that fails is the reason given.

| Reason | What it means |
| --- | --- |
| `locked-late` | The bundle was put on chain at or after kickoff. Nothing in it counts. |
| `wrong-bundle` | The receipt is for a different bundle from the one on chain. |
| `wrong-match` | The receipt or the opening is for another league or another match. |
| `wrong-player` | The opening is by a different player from the receipt. |
| `not-in-bundle` | The receipt does not prove the sealed pick is in the bundle. |
| `does-not-match` | The pick and salt given do not produce the sealed fingerprint. |
| `impossible-pick` | The pick cannot happen in this kind of match, such as 2 sets in a best of 5. |

## Scoring: the same circuits that go on chain

The engine does not have its own copy of the scoring rules. It reads the three circuit files in
[`circuits/out/`](../circuits/out/), the ones that get published on chain, and runs them. So the
points the website shows are worked out by the same gates a TapeOut processor uses.

The tests run all 65,536 football cases, all 64 basketball cases and all 128 tennis cases through
the JavaScript reader and compare each with the rules written out plainly. They also confirm the
split of 0, 1 and 3-point cases is the one the Python checker recorded for the same files. That
makes four separate things that agree on every case: Kickoff's Python evaluator, TapeOut's
reference evaluator, the real TapeOut contracts in the rehearsal, and this JavaScript reader.

## The table and the personal record

Nothing is stored. Hand the table builder the matches, with what is on chain for each and the picks
that were opened, and it works the table out. Anyone who does the same gets the same table, in
whatever order the facts arrive.

What happens to a player in a match is one of:

| | What it means | Points |
| --- | --- | --- |
| `scored` | The pick was opened, checked and scored by the circuit | 0, 1 or 3 |
| `refused` | The pick was opened but failed a check. The reason is recorded. | 0 |
| `not-opened` | The player has a sealed pick in the bundle but never opened it | 0 |
| `no-pick` | The player made no pick | 0 |
| `void` | The match was postponed, abandoned, or ended in a walkover or retirement | nobody scores |
| `pending` | The match has no result yet | none yet |

The table is ordered as [docs/RULES.md](../docs/RULES.md) says: most points, then most 3-point
picks, then most 1-point picks. Players level on all three share a position, and the next position
is skipped.

## Reading a league back from the chain

Everything a league does is in its inbox in TapeOut's mailbox: the matches it announced, the
bundles it locked, the results it gave. `src/reader.js` takes that inbox's messages and works out
the league, believing nothing it cannot check. `src/league.js` then joins that with the published
files of opened picks and hands it to the table builder. So the table comes from chain data and
files that prove themselves, and from nothing else.

The exact format of each message, and every rule for what counts, is written out in
[docs/PROTOCOL.md](../docs/PROTOCOL.md). In short:

- Only the league's own account speaks for the league. Anyone can write to an inbox, so the rest
  is ignored.
- A match's id is made from its facts, kickoff time included, so the kickoff cannot be moved
  afterwards.
- The last lock stamped before kickoff is in force. A lock stamped at or after kickoff never is.
- The last result is in force, so a mistake can be corrected, but every result stays on the record.
- A member's challenge is never hidden.

## Fetching a league from X Layer

`src/xlayer.js` goes and gets a league from an X Layer node. Give it the league's id and it returns
the table. It only reads: nothing is sent and no wallet is needed.

```
cd engine
node bin/table.js <league id>
node bin/table.js --circuit <processor address> <circuit number>
```

It asks `https://rpc.xlayer.tech` unless told otherwise with `--node <address>`. It prints each
match with its result and when its bundle was locked, the table, every dispute, and every message
it did not believe with the reason.

How it reads an inbox is the way TapeOut's mailbox is meant to be read (TAP-10, section 13):

1. It asks the mailbox for its list of the inbox. For each message the mailbox itself stores who
   sent it, the block it is in, the time, and a fingerprint of the message.
2. The text of a message is not stored. It is in the log of the block the message is in. So it
   fetches that block's log and accepts a message only if it is the mailbox's own log, for this
   inbox, from the sender the mailbox recorded, at that place in the inbox, and its text matches
   the fingerprint. Only the text and its reference are taken from the log.
3. Everything is read as it stood at one block, so the list and the messages cannot disagree.

**If one message cannot be fetched, or does not match its fingerprint, no table is built.** A table
from an inbox with a hole in it could be wrong, because the missing message might be the one that
matters.

The opened picks for each match are read from the league's on-chain site, at
`openings/<match id>.json`, and checked against the SHA-256 the site store keeps with every file.
A file that is half uploaded is not used, and the output says so.

The mailbox's fingerprint is a Keccak-256, which neither Node nor a browser has built in. It is
written out in `src/keccak.js` with nothing to install, and tested against published values. The
function codes it works out for the mailbox are tested against the ones TAP-10 publishes.

## The cheating the tests try

Each of these is a test in `test/open.test.js`, and each is refused:

- Changing your pick after kickoff.
- Opening with the wrong salt.
- Copying another player's sealed pick as your own.
- Using someone else's receipt.
- The league locking the bundle at or after kickoff.
- The league slipping a pick in after kickoff by making a new bundle.
- The league leaving a pick out of the bundle.
- A receipt that claims a different bundle size from the one on chain.
- Reusing a pick from another match.
- A forged receipt.

And in `test/table.test.js`, at the level of a whole league:

- A pick changed after kickoff scores 0 and the record says why.
- A bundle locked after kickoff: every pick in that match is refused.
- Nothing put on chain before kickoff: opened picks are refused.
- Opening the same pick twice does not score twice.
- A published list of sealed picks that does not match the chain is not taken on trust.

And in `test/reader.test.js`, at the level of what is on chain:

- A stranger writing to the league's inbox: none of it is believed.
- A bundle locked after kickoff is not in force.
- The league swapping in a new bundle after kickoff: the one locked before kickoff stays in force.
- Moving the kickoff time: a later kickoff is a different match, and picks do not carry over.
- A match announced after its own kickoff does not count.
- A message carrying someone else's reference is not believed.

And in `test/xlayer.test.js`, a node that lies about what is on chain:

- A node that changes one message's text: caught, and no table is built.
- A node that leaves a message out: caught, and no table is built.
- A node that swaps a message's reference: caught.
- The right text in a log from some other contract: not believed.
- The right text under another sender's name: not believed.

The tree itself is checked against the published reference values from RFC 6962, and every leaf of
every tree from 1 to 17 leaves is checked to have a proof that works only for its own place.

## Honest limits

- **Lose the salt and the pick cannot be opened.** It then scores 0 and shows as "not opened". The
  salt lives on the player's device.
- **A player dropped from the bundle can show it, but only if they were given a receipt.** A
  receipt for a bundle that is not the one on chain is the evidence. The receipt is not yet signed
  by the league, so the league could deny having issued it. Signing receipts is still to do.
- **This hides a pick behind a fingerprint. It does not encrypt it.** Encrypted messages between
  players who have their own TapeOut identity are a later step.
- **A league decides when to publish the opened picks.** Until it does, the chain shows a bundle
  was locked but not who is in it. A player can publish their own opening without waiting.
- **The fetcher asks one node.** It checks every message against the mailbox's fingerprint, but it
  believes that node about what the mailbox stores. A node that lied could claim the inbox is
  shorter than it is. TapeOut's own rule is to ask several independent nodes and require them to
  agree. That is still to do. Until then, use a node you trust.

## The engine and the chain agree

`scripts/vectors.js` plays out a small fixed league with the engine and writes every value it
works out to `vectors/league.json`: each fingerprint, each bundle root, each receipt, the points
and the final table. The chain rehearsal in
[`chain/test/LeagueSeason.t.sol`](../chain/test/LeagueSeason.t.sol) reads that file and works every
value out again in Solidity, with the real TapeOut circuits doing the scoring. A test here fails if
the file is not what the engine produces today.

To remake the file after changing the engine:

```
cd engine
npm run vectors
```

## The season rehearsal

`scripts/season-on-chain.js` plays a whole season on a private copy of X Layer, through TapeOut's
real contracts: it publishes a circuit to be the league, opens its account, announces three
matches, locks each bundle before kickoff, gives each result, and publishes the opened picks on the
league's site. It also does two things that should not work: the host locks a changed bundle one
minute after kickoff, and an outsider writes a result to the league's inbox. A member disputes a
result.

Then it throws everything away except the league's id, fetches the league back from the node, and
rebuilds the table from that alone. It has to come out as ada 7, bola 4, chidi 1, with both cheats
refused and the dispute listed.

It passed on its first run against the real contracts
([rehearsal 5](../docs/REHEARSAL-RESULTS.md)). GitHub runs it on every change to the engine. The script only works against a test node that lets
it act as any account, which no real node allows, so it cannot touch the real network. To run it
yourself you need [Foundry](https://getfoundry.sh):

```
anvil --fork-url https://rpc.xlayer.tech
cd engine
node scripts/season-on-chain.js --node http://127.0.0.1:8545
```

## Run the tests

You need Node 22 or newer. Nothing to install.

```
cd engine
npm test
```

## The files

| File | What it is |
| --- | --- |
| `src/picks.js` | What a pick is for each sport, and how it is written as one byte |
| `src/seal.js` | Sealing a pick: the fingerprint and the salt |
| `src/bundle.js` | The bundle, its root, receipts, and the value that goes on chain |
| `src/open.js` | Opening a pick and deciding whether it counts |
| `src/circuit.js` | Reading a TapeOut circuit and working out its answer, in JavaScript |
| `src/score.js` | Scoring an opened pick with the circuits, and turning a real score into a result |
| `src/table.js` | The league table and every player's record |
| `src/match.js` | A match's id, made from the facts about it |
| `src/messages.js` | What a league writes on chain, and how to read each message |
| `src/reader.js` | Reading a league back from its inbox, and deciding what to believe |
| `src/openings.js` | The published file of opened picks |
| `src/league.js` | From the chain to the table in one step |
| `src/xlayer.js` | Fetching a league's inbox and its opened picks from an X Layer node |
| `src/keccak.js` | Keccak-256, the fingerprint the mailbox uses, written out with nothing to install |
| `src/abi.js` | How to ask a contract a question and read its answer |
| `src/bytes.js` | Small helpers for raw bytes, and SHA-256 from the platform |
| `src/index.js` | Everything, in one place to import from |
| `bin/table.js` | The command that prints a league's table from X Layer |
| `scripts/season-on-chain.js` | The season rehearsal on a private copy of X Layer |
| `scripts/vectors.js` | Plays out a small fixed league and writes down every value, for the chain rehearsal to check |
| `vectors/league.json` | Those values. Made by the script, not by hand. |
| `test/` | The tests |
