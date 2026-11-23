# chain

Rehearsals of the parts of Kickoff that touch X Layer, run on a **private copy** of X Layer
mainnet. Nothing in this folder sends anything to the real network, and nothing is paid.

> [!NOTE]
> A rehearsal shows that the real TapeOut contracts accept Kickoff's circuits and give the right
> answers. It does **not** mean the circuits are published. That happens later, from a real wallet,
> and the addresses will be listed in the main README when it does.

## Why a private copy

The rehearsal starts from the real state of X Layer, with the real TapeOut factory and the real
evaluator, but every change it makes stays on the machine running the test and is thrown away
afterwards. That makes it a fair test of what going live will do, at no cost.

It runs on GitHub's machines (see `.github/workflows/rehearsal.yml`) every time this folder or the
circuits change. The output of each run is on that run's summary page under the repository's
Actions tab.

## The rehearsals

### 1. Publishing the scoring circuits

`test/PublishCircuits.t.sol`. **Passed on its first run, 23 November 2026.**

1. Creates a processor called Kickoff through the real TapeOut factory.
2. Buys exactly the NAND transistors each circuit needs, one for each gate.
3. Publishes ("tapes out") the football, basketball and tennis circuits from
   [`circuits/out/`](../circuits/out/).
4. Confirms the processor stored each circuit byte for byte, with the right number of inputs,
   outputs and gates.
5. Asks the real TapeOut evaluator for the points on **every possible input** (65,536 for football,
   64 for basketball, 128 for tennis) and compares each answer with the rules written out again in
   plain Solidity.
6. Asks it the worked examples printed in [docs/RULES.md](../docs/RULES.md).

### 2. A league's account and mailbox

`test/LeagueAccount.t.sol`. **Passed, 23 November 2026.**

A Kickoff league is one TapeOut circuit with its own account and mailbox. This rehearsal:

1. Opens a league's account and confirms TapeOut's opener and mailbox agree on which account it is.
2. Sends OKB to the account, to confirm it can hold a sponsor's prize money.
3. Confirms only an opened account can send, while any account can receive.
4. Sends a message through the mailbox and reads it back: who sent it, when, and the exact text.
5. Walks one pick through its whole life: its fingerprint is sent before kickoff and stamped with
   the time, a pick sent after kickoff is stamped late, the pick is opened and checked against its
   fingerprint, and the football circuit scores it.

What it does not cover: encrypted messages. TapeSend's sealed messages are encrypted in the
browser, so they are tested with the picks engine, not here. This rehearsal hides the pick behind a
fingerprint instead, which is how guest picks work.

### 3. The on-chain site

`test/LeagueSite.t.sol`. **Passed on its first run, 23 November 2026.**

Kickoff keeps a verified copy of its website on chain, in the account of a circuit. This rehearsal:

1. Uploads a one-page site and reads it back: same bytes, same fingerprint, listed by name.
2. Uploads a file too big for one piece (60,000 bytes, in three pieces), confirms a half-uploaded
   file can be told apart from a finished one, and reads the whole file back.
3. Confirms a stranger cannot replace, add to or remove a page, and the owner can.
4. Hands the circuit to a new owner and confirms the site goes with it: same account, same page,
   the old owner locked out and the new owner in control.
5. Probes the name contract to find out what a site's on-chain name costs and how the name must be
   written. This one prints what it finds and cannot fail.

### 4. A whole season

`test/LeagueSeason.t.sol`. **Passed on its first run, 23 November 2026.**

This joins the picks engine to the chain. The engine plays out a small fixed league, three players
and one match in each sport, and writes down every value it works out in
[`engine/vectors/league.json`](../engine/vectors/league.json). The rehearsal then does the chain's
half with the real TapeOut contracts:

1. Works out every fingerprint, every bundle root and every receipt again in Solidity and confirms
   each is exactly what the engine got.
2. Has the league lock each match's bundle through the real mailbox before kickoff.
3. After the matches, posts each result, then opens every pick: checks the lock on chain is that
   bundle and was stamped before kickoff, checks the pick against its fingerprint and its receipt,
   and has the sport's real circuit score it.
4. Confirms each score, and the final totals, are the engine's.
5. Tries four ways of cheating: locking after kickoff, changing a pick, opening another player's
   pick as your own, and using a pick from another match.

The Solidity side of these checks is `src/KickoffCheck.sol`. It is real product code, not test
code: it is what a contract paying out a sponsor's prize would use to check a pick.

### The fees report

`test/Fees.t.sol`. **Passed on its first run, 23 November 2026.** The page written from its output
is [docs/FEES.md](../docs/FEES.md).

It does everything going live will do, reads each fee from the chain, measures the gas of each
step, and prints it all. It covers two routes. Route A creates Kickoff's own processor and must
work, so it is a real test. Route B publishes on a processor somebody else created. That depends on
a contract Kickoff does not control, so it is a probe that prints what it finds and cannot fail.

## What the rehearsals showed about going live

- **Creating a processor is paid for in the BEM token, not in OKB.** So is the fee for buying
  transistors on a new processor. The first rehearsal paid both in BEM and the real factory
  accepted it.
- **The transistor fee is one flat charge for each circuit**, whatever its size. Kickoff's
  processor sets its own transistor price to zero, so only TapeOut's flat fee is paid.
- **Publishing a circuit costs 0.0013 OKB.**
- **Opening a circuit's own account costs 0.08 OKB.** Every league that wants its own identity pays
  this once. Sending messages through the mailbox costs only gas.
- **A site's on-chain name is free at the moment.** The monthly fee read from the chain was 0. The
  name is written `<circuit id>.2.<processor number>.tape`.
- **Uploading the site costs only gas.**

So a wallet that creates a Kickoff processor needs BEM as well as OKB: 0.14 BEM and about 0.0853
OKB in all. The other route is to publish the circuits on an existing processor, which needs about
0.0879 OKB and no BEM. Either way almost all of it is the 0.08 OKB for the league's account. Every
figure, step by step, is in [docs/FEES.md](../docs/FEES.md).

## Run it yourself

You need [Foundry](https://book.getfoundry.sh/). From the repository root:

```
git submodule update --init --recursive
cd chain
forge test -vv
```

It reads X Layer through the public node at `https://rpc.xlayer.tech`. To use another node, set
`XLAYER_RPC_URL`.

## The files

| File | What it is |
| --- | --- |
| `src/ITapeOut.sol` | The parts of TapeOut that Kickoff talks to, and where each one was taken from |
| `src/KickoffCheck.sol` | Kickoff's own checks, written for the chain: the same fingerprints, bundle proofs and circuit inputs as the picks engine |
| `test/Rehearsal.sol` | What every rehearsal starts with: the private copy of X Layer and a Kickoff processor on it |
| `test/PublishCircuits.t.sol` | Rehearsal 1: publish the three circuits and check every case |
| `test/LeagueAccount.t.sol` | Rehearsal 2: a league's account, its mailbox, and one pick from start to finish |
| `test/LeagueSite.t.sol` | Rehearsal 3: the on-chain site, who may change it, and what happens when it changes hands |
| `test/LeagueSeason.t.sol` | Rehearsal 4: a whole season, with the engine's values checked on chain and every pick scored by the real circuits |
| `test/Fees.t.sol` | The fees report: every fee read from the chain and the gas of every step |
| `foundry.toml` | Settings for the test tool |
| `lib/forge-std` | The standard Foundry test library, pinned to a release |
