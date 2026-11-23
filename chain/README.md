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

## What the first rehearsal does

`test/PublishCircuits.t.sol`:

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

## Something to know about going live

The public tests of another TapeOut Accelerate entry report that creating a processor is paid for
in the **BEM token**, not in OKB, and so is the fee for buying transistors on a new processor,
while publishing a circuit is paid for in OKB. This rehearsal is written to pay that way and gives
itself test BEM. Its first run will confirm whether that is right, and this section will be
updated with what it found.

If it is right, the real wallet will need BEM as well as OKB to create a Kickoff processor. The
other route is to publish the circuits on an existing processor, which needs OKB only.

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
| `test/PublishCircuits.t.sol` | The first rehearsal: publish the three circuits and check every case |
| `foundry.toml` | Settings for the test tool |
| `lib/forge-std` | The standard Foundry test library, pinned to a release |
