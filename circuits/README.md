# circuits

Kickoff's scoring rules as TapeOut circuits, and the checker that proves they match the
written rules in [docs/RULES.md](../docs/RULES.md).

> [!NOTE]
> Football, basketball and tennis are published on X Layer as circuits 6, 7 and 8 of processor
> `0x39e44dba62811e87fde122ca4d6c082568a384d0`. Result, Goal Goal and Score, football's three
> predictions, were published beside them on 26 November 2026 as circuits 9, 10 and 11.

## What a scoring circuit is

A TapeOut circuit is a tiny rule machine made of one kind of part, the NAND gate. You give it
facts as a row of 0s and 1s, it gives an answer as 0s and 1s, and once it is published nobody can
change it.

Each Kickoff circuit takes one pick and the real result, and answers with the points.

Every circuit has two outputs:

| Output | Meaning |
| --- | --- |
| 0 | 1 when the pick scores at least 1 point |
| 1 | 1 when the pick scores the full 3 points |

**Points = output 0 + 2 x output 1.** So the only totals a circuit can give are 0, 1 and 3.

## The circuits

| Circuit | Inputs | Outputs | Gates | Size | Cases checked |
| --- | --- | --- | --- | --- | --- |
| Football | 16 | 2 | 148 | 1,036 bytes | 65,536 (all of them) |
| Basketball | 6 | 2 | 20 | 140 bytes | 64 (all of them) |
| Tennis | 7 | 2 | 37 | 259 bytes | 128 (all of them) |
| Result | 10 | 2 | 61 | 427 bytes | 1,024 (all of them) |
| Goal Goal | 9 | 2 | 26 | 182 bytes | 512 (all of them) |
| Score | 16 | 2 | 55 | 385 bytes | 65,536 (all of them) |

The last three are football's three predictions: the result, goal goal and the exact score. Each
is scored by its own circuit. "Football" is the older single football prediction (the exact score,
with 1 point for the right result), which the first matches were played under.

The circuits themselves are the `.hex` files in [`out/`](out/), in TapeOut's circuit format
(TAP-02). `out/manifest.json` lists the size and fingerprint of each.

## What goes in

Bits are numbered from 0. A number that takes several bits is written lowest bit first, which is
how TapeOut packs inputs.

### Football (16 inputs)

| Bits | What it is |
| --- | --- |
| 0 to 3 | Your home goals (0 to 15) |
| 4 to 7 | Your away goals (0 to 15) |
| 8 to 11 | Real home goals (0 to 15) |
| 12 to 15 | Real away goals (0 to 15) |

Packed into two bytes, the first byte is your pick and the second is the real score.

| You picked | Real score | Input | Output | Points |
| --- | --- | --- | --- | --- |
| 2-1 | 2-1 | `0x1212` | `0x03` | 3 |
| 1-0 | 2-1 | `0x0112` | `0x01` | 1 |
| 3-1 | 2-1 | `0x1312` | `0x01` | 1 |
| 1-1 | 2-1 | `0x1112` | `0x00` | 0 |
| 0-2 | 2-1 | `0x2012` | `0x00` | 0 |

### Result (10 inputs)

| Bits | What it is |
| --- | --- |
| 0 to 1 | Your result: 0 home win, 1 draw, 2 away win. 3 is not a prediction and scores 0 |
| 2 to 5 | Real home goals (0 to 15) |
| 6 to 9 | Real away goals (0 to 15) |

1 point for the right result. Output 1 is always 0, so the circuit can only give 0 or 1.

### Goal Goal (9 inputs)

| Bits | What it is |
| --- | --- |
| 0 | Your answer: 1 if you say both teams score, 0 if you say they do not |
| 1 to 4 | Real home goals (0 to 15) |
| 5 to 8 | Real away goals (0 to 15) |

1 point for the right answer. Both teams score when each has at least one goal. Output 1 is
always 0.

### Score (16 inputs)

Laid out exactly as Football above: your home goals, your away goals, real home goals, real away
goals. 3 points for the exact score and nothing otherwise: both outputs are 1 together, or both 0.

### Basketball (6 inputs)

| Bits | What it is |
| --- | --- |
| 0 | Your winner: 0 for home, 1 for away |
| 1 to 2 | Your margin band: 0 for A (1 to 5), 1 for B (6 to 10), 2 for C (11 to 15), 3 for D (16 and over) |
| 3 | Real winner |
| 4 to 5 | Real margin band |

| You picked | Real result | Input | Output | Points |
| --- | --- | --- | --- | --- |
| Home, band B | Home, band B | `0x12` | `0x03` | 3 |
| Home, band A | Home, band B | `0x10` | `0x01` | 1 |
| Away, band B | Home, band B | `0x13` | `0x00` | 0 |

### Tennis (7 inputs)

| Bits | What it is |
| --- | --- |
| 0 | Your winner: 0 for player A, 1 for player B |
| 1 to 2 | Your number of sets, minus 2 (so 2 sets is 0 and 5 sets is 3) |
| 3 | Real winner |
| 4 to 5 | Real number of sets, minus 2 |
| 6 | 1 when the match is best of 5, 0 when it is best of 3 |

The tennis circuit also refuses impossible picks by itself. A number of sets that cannot happen in
that kind of match, such as 2 sets in a best of 5, scores 0 whatever else is true.

| Match | You picked | Real result | Input | Output | Points |
| --- | --- | --- | --- | --- | --- |
| Best of 3 | A in 3 | A in 3 | `0x12` | `0x03` | 3 |
| Best of 3 | A in 2 | A in 3 | `0x10` | `0x01` | 1 |
| Best of 3 | B in 3 | A in 3 | `0x13` | `0x00` | 0 |
| Best of 5 | A in 4 | A in 4 | `0x64` | `0x03` | 3 |
| Best of 5 | A in 2 (impossible) | A in 3 | `0x50` | `0x00` | 0 |

## How they were checked

`check.py` does four things for each circuit:

1. Confirms the saved circuit is exactly what the builder produces.
2. Confirms it is a well-formed TapeOut circuit.
3. Runs **every possible combination of inputs** through it and compares the points with
   `rules.py`, a plain-code version of the rules that knows nothing about circuits. Each case is
   evaluated twice, once with Kickoff's own evaluator and once with TapeOut's official reference
   evaluator for the circuit format.
4. Damages the circuit on purpose, one gate at a time, and confirms the check notices. A check that
   cannot fail proves nothing.

The latest results are in [docs/CHECK-RESULTS.md](../docs/CHECK-RESULTS.md).

## Run it yourself

You need Python 3.11 or newer. Nothing else to install. From the repository root:

```
python3 circuits/build.py     # builds the circuits into circuits/out/
python3 circuits/check.py     # checks every possible case, writes the results
```

## The files

| File | What it is |
| --- | --- |
| `gates.py` | A small builder that turns ordinary logic (and, or, equal, greater than) into NAND gates in TapeOut's format |
| `build.py` | The rules written with that builder |
| `rules.py` | The same rules as plain code, used as the answer sheet |
| `tap02.py` | Kickoff's own reader and evaluator for TapeOut circuits, written separately from the builder |
| `check.py` | The checker |
| `third_party/` | TapeOut's official reference evaluator, copied unchanged, with its source and licence |
| `out/` | The finished circuits, their fingerprints and the raw check results |
