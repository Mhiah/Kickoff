# Kickoff

**A multi-sport prediction game where every pick is sealed before the match starts, scored by a rule nobody can change, and kept on a record nobody can edit.**

X Layer TapeOut Accelerate (OKX Build X Series). A new project, built during this event by Mhiah.

[![Circuit check](https://github.com/Mhiah/Kickoff/actions/workflows/check.yml/badge.svg)](https://github.com/Mhiah/Kickoff/actions/workflows/check.yml)
[![Engine tests](https://github.com/Mhiah/Kickoff/actions/workflows/engine.yml/badge.svg)](https://github.com/Mhiah/Kickoff/actions/workflows/engine.yml)
[![X Layer rehearsal](https://github.com/Mhiah/Kickoff/actions/workflows/rehearsal.yml/badge.svg)](https://github.com/Mhiah/Kickoff/actions/workflows/rehearsal.yml)
[![Season rehearsal](https://github.com/Mhiah/Kickoff/actions/workflows/season.yml/badge.svg)](https://github.com/Mhiah/Kickoff/actions/workflows/season.yml)

> [!NOTE]
> **Where this is today:** the rules are written, the three scoring circuits are built and checked
> on every possible case, and rehearsals on a private copy of X Layer have run every TapeOut part
> Kickoff depends on against the real contracts: publishing the circuits and scoring with them, a
> league's own account and mailbox, and the on-chain site. The picks engine and the table builder
> are built and tested. Nothing is live on X Layer itself yet, and the website is not built yet. This README describes
> what Kickoff is and how it will work. The section
> [Where the build is](#where-the-build-is) says exactly what exists, and it is updated as each
> part is finished.

## What Kickoff is

### The problem

Every prediction league among friends or fans runs on trust. One person keeps the spreadsheet.
They can add a late pick, fix a score, or change the points rule halfway through the season, and
nobody could prove it. And after every match, everyone claims they predicted it, while the picks
they got wrong quietly disappear.

### How it works

1. You join a league, either private with friends or public and run by a brand or community.
2. Before each match you make your pick. It goes in sealed, so nobody can see it or copy it.
3. At kickoff, picks lock. Nothing can be changed or added.
4. After the match, picks open, the result goes in, and everyone is scored by the same fixed rule.
5. The table updates, and every pick, right or wrong, stays on your personal record for good.

### The sports and the points

Every sport gives a maximum of 3 points per match.

| Sport | What you predict | Points |
| --- | --- | --- |
| Football | The exact score | 3 for the exact score. 1 for the right result (win, draw or loss) with the wrong score. 0 otherwise. |
| Basketball | The winner and the winning margin | 1 for the right winner, plus 2 more for the right margin band: 1 to 5, 6 to 10, 11 to 15, or 16 and over. |
| Tennis | The winner and the number of sets | 1 for the right winner, plus 2 more for the right number of sets. |

The bonus points only count when the winner is right. The full rules, with examples for each
sport, are in [docs/RULES.md](docs/RULES.md).

### What makes it different

- **No trusted organiser.** Nobody, including the league host and us, can alter picks, scores or
  the table.
- **The rules are fixed in public.** Each sport's scoring rule is published before the season and
  can never be changed.
- **Anyone can check the table.** It is not stored in a private database. Anyone can recompute it
  and get the same result.
- **Your record is yours.** It shows hits and misses, follows you between leagues, and cannot be
  deleted.

## Who it is for

- **Friend groups** who already run a predictor league on a spreadsheet or a group chat.
- **Fan communities** that want a table nobody argues about.
- **Brands** that want to run a prediction campaign for their audience.

## How it earns

Brands pay to run sponsored leagues with prizes, and private leagues pay for extras.

There is no betting. Players never stake money.

## TapeOut, plainly

Kickoff is built on TapeOut, the protocol this hackathon is about. Think of TapeOut as a toolbox.
These are the tools, what each one is in plain words, and the job it does in Kickoff.

| Tool | What it is in plain words | Its job in Kickoff |
| --- | --- | --- |
| **Circuit** | A tiny rule machine. You give it facts, it gives an answer, and once it is published nobody can change it. | The scoring rules, one per sport. Free for anyone to check. |
| **Processor** | The workshop a circuit is published from. | Kickoff's own processor is the home of its scoring rules. |
| **Container** | An account that belongs to a circuit, so it can hold money and own a page. | Each league is one identity with its own page, prize account and mailbox. |
| **TapeSend** | Sealed mail between those accounts. | Sealed picks before kickoff, reveals after, and the result. |
| **DeWEB** | A website stored on the blockchain, so it cannot be secretly changed. | The verified copy of the Kickoff site. |
| **TapeKit** | The checker that opens a DeWEB site and confirms it is genuine. | Comes with DeWEB. It is how a visitor knows the site is the real one. |
| **TapeCode** | The tool for uploading to all of the above. | Uploading the site and attaching a normal web address. |

Not used: FabX (mining). It has no role in this product.

TapeOut already has a published draft standard for sealed forecasts, TAP-12: a claim is sealed on
chain, opened at a set time, then judged in public, so anyone can rebuild the same track record.
That document leaves scoring and leaderboards for others to build. Kickoff is that layer.

Not every part of Kickoff runs inside a circuit, and it does not need to. TapeOut is used where it
gives the guarantee: sealed picks, a fixed scoring rule and a permanent record. The pages you click
through are an ordinary website.

## Honest limits

- **Match results are entered by a person.** The league host enters the result and members can
  challenge it. A live results feed is meant to replace this later.
- **Guest picks go in through the league.** A guest plays without a wallet, and the league posts
  one fingerprint covering everyone's sealed picks before kickoff. The host could leave a pick out,
  but cannot change one or add one after kickoff. Each guest gets a receipt proving their pick was
  included.
- **TAP-12 is still a draft.** The standard Kickoff builds on may change.
- **Nothing here is audited.**

## Where the build is

| Stage | What it is | State |
| --- | --- | --- |
| 1 | Project setup: this README, the folders, the licence | Done |
| 2 | The three scoring circuits and the checker that tests every possible case | Built and checked off chain. Not published on X Layer yet. |
| 3 | Proving the TapeOut parts on a private copy of X Layer | Done. Four rehearsals and a fees report passed, 29 tests in all, against the real TapeOut contracts: publishing the three circuits and getting the right points on every case; a league's own account and mailbox, with one pick locked before kickoff, opened after and scored; the on-chain site, which only its owner can change and which moves with the league; and a whole season, with the picks engine's values checked on chain. Results in [docs/REHEARSAL-RESULTS.md](docs/REHEARSAL-RESULTS.md). What going live costs, read from the chain, is in [docs/FEES.md](docs/FEES.md). |
| 4 | The picks engine and the table builder | Built and tested, 112 tests. Sealing a pick, bundling everyone's sealed picks, opening and checking them, scoring them with the same circuit files that go on chain, and building the table and each player's record. Twenty of the tests try to cheat, and every attempt is refused. A rehearsal of a whole season on a copy of X Layer passed: the chain worked out every one of the engine's values again and got the same, and the real circuits scored every pick. The engine also fetches a league from an X Layer node and rebuilds the table from that alone, with one command: `node engine/bin/table.js <league id>`. Five more tests have the node lie about what is on chain, and each lie is caught. The format is written out in [docs/PROTOCOL.md](docs/PROTOCOL.md). A second season rehearsal passed too: a league was played through the real mailbox and site store on a copy of X Layer, with two cheats and a dispute, then fetched back from its id alone, and the table came out the same ([rehearsal 5](docs/REHEARSAL-RESULTS.md)). GitHub repeats it on every change to the engine. Still to do: asking several nodes instead of one. See [engine/README.md](engine/README.md). |
| 5 | The website | Not started |
| 6 | Going live on X Layer: processor, circuits, the first league | Not started |
| 7 | Publishing the site, with the verified copy on DeWEB | Not started |
| 8 | A real test league with real people and real matches | Not started |
| 9 | Players with their own TapeOut identity, and sponsor prizes | Not started |
| 10 | Demo video and submission | Not started |

**The scoring circuits so far**

| Circuit | Gates | Cases checked | Cases wrong |
| --- | --- | --- | --- |
| Football | 148 | 65,536 (every possible case) | 0 |
| Basketball | 20 | 64 (every possible case) | 0 |
| Tennis | 37 | 128 (every possible case) | 0 |

Each case was evaluated four ways: with Kickoff's own evaluator, with TapeOut's official reference
evaluator, by the real TapeOut contracts on a private copy of X Layer
([docs/REHEARSAL-RESULTS.md](docs/REHEARSAL-RESULTS.md)), and by the JavaScript reader the website
uses ([engine/README.md](engine/README.md)). The full results are in [docs/CHECK-RESULTS.md](docs/CHECK-RESULTS.md), and anyone can
repeat the check with `python3 circuits/check.py`. GitHub also repeats it on every push, and the
badge at the top of this page shows whether it passed.

Nothing is deployed, so there are no contract addresses, no circuit IDs and no live link yet. They
will be listed here as soon as they exist.

## What is in this repository

| Folder | What goes in it |
| --- | --- |
| `circuits/` | The three scoring circuits in TapeOut's format, and the checker. Start with [circuits/README.md](circuits/README.md) |
| `chain/` | Rehearsals of the parts that touch X Layer, run on a private copy of it |
| `engine/` | The picks engine: sealing, bundling, opening, scoring with the circuits, and the table |
| `web/` | The website |
| `docs/` | The rules in plain words, design notes, test results and evidence |

## License

MIT
