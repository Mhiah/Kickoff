# engine

Kickoff's picks engine: the code that seals a pick, bundles everyone's sealed picks into one
fingerprint, decides whether an opened pick counts, scores it with the scoring circuits, and builds
the league table.

It is plain JavaScript with nothing to install, and it runs the same in Node and in a browser, so
the website and anyone checking a league use exactly the same code.

> [!NOTE]
> **What is here:** sealing, bundling, opening and checking, scoring with the circuits, and the
> table and personal records, with 64 tests. **Not here yet:** reading a league's facts from the
> chain, and the rehearsal that runs a whole league on a copy of X Layer. At the moment the table
> builder is handed the facts. It does not fetch them.

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
| `src/bytes.js` | Small helpers for raw bytes, and SHA-256 from the platform |
| `src/index.js` | Everything, in one place to import from |
| `scripts/vectors.js` | Plays out a small fixed league and writes down every value, for the chain rehearsal to check |
| `vectors/league.json` | Those values. Made by the script, not by hand. |
| `test/` | The tests |
