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

`test/LeagueAccount.t.sol`. Written. Its result is recorded in
[docs/REHEARSAL-RESULTS.md](../docs/REHEARSAL-RESULTS.md) once it has run.

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

## What the rehearsals showed about going live

- **Creating a processor is paid for in the BEM token, not in OKB.** So is the fee for buying
  transistors on a new processor. The first rehearsal paid both in BEM and the real factory
  accepted it.
- **The transistor fee is one flat charge for each circuit**, whatever its size. Kickoff's
  processor sets its own transistor price to zero, so only TapeOut's flat fee is paid.
- **Publishing a circuit costs 0.0013 OKB.**

So a wallet that creates a Kickoff processor needs BEM as well as OKB. The other route is to publish
the circuits on an existing processor, which needs OKB only. The numbers are in
[docs/REHEARSAL-RESULTS.md](../docs/REHEARSAL-RESULTS.md).

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
| `test/Rehearsal.sol` | What every rehearsal starts with: the private copy of X Layer and a Kickoff processor on it |
| `test/PublishCircuits.t.sol` | Rehearsal 1: publish the three circuits and check every case |
| `test/LeagueAccount.t.sol` | Rehearsal 2: a league's account, its mailbox, and one pick from start to finish |
| `foundry.toml` | Settings for the test tool |
| `lib/forge-std` | The standard Foundry test library, pinned to a release |
